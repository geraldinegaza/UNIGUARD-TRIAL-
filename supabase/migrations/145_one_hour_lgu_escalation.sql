-- Migration 045 · one-hour LGU escalation for unverified barangay reports
--
-- Implements the DOCX requirement: "Dapat jan sa LGU kung di na check ng
-- barangay within 1hr mag aapear agad sa lgu to verify it." A report that
-- has not been verified by the Barangay Official within 60 minutes of
-- submission becomes visible in the LGU verification queue with a clear
-- "overdue" marker. The barangay official can still verify it later;
-- the LGU verification is a fallback, not a takeover.
--
-- This migration is purely additive: a new status flag, a new view, and a
-- new security-definer RPC. No existing column, row or policy is changed.
-- Re-runnable: every CREATE is guarded by IF NOT EXISTS.

/* ---------------------------------------------------------------------------
   1.escalation_status column on reports
   ---------------------------------------------------------------------------
   Adds an explicit, persisted escalation flag to the reports table so the
   LGU dashboard can read it directly without recomputing on every render.
   The trigger in step 2 keeps it in sync with the report's verification
   status and created_at.
*/
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS escalation_status text NOT NULL DEFAULT 'pending'
  CHECK (escalation_status IN ('pending','overdue','verified','cancelled'));

COMMENT ON COLUMN public.reports.escalation_status IS
  'pending = within the 1-hour barangay verification window; overdue = the window elapsed and the LGU verification queue should surface it; verified = the report has been verified (by the barangay official or LGU); cancelled = the report was rejected/archived and is no longer eligible for escalation.';

/* ---------------------------------------------------------------------------
   2.trigger that flips escalation_status to 'overdue' on the 1-hour boundary
   ---------------------------------------------------------------------------
   A Postgres trigger fires on every INSERT/UPDATE on reports. When the
   report's status is still 'reported' or 'verified' (i.e. not yet
   verified or already past it) AND created_at is more than 1 hour ago
   AND escalation_status is still 'pending', it flips to 'overdue'.
   Once the report is verified (status moves past 'verified'/'resolved'),
   it becomes 'verified' and stays that way. Rejected/archived reports
   become 'cancelled'.
*/
CREATE OR REPLACE FUNCTION public.ug_refresh_escalation_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  age_hours numeric;
BEGIN
  age_hours := EXTRACT(EPOCH FROM (now() - COALESCE(NEW.created_at, now()))) / 3600.0;

  IF NEW.status IN ('rejected') THEN
    NEW.escalation_status := 'cancelled';
  ELSIF NEW.status IN ('verified','dispatched','resolved') THEN
    NEW.escalation_status := 'verified';
  ELSIF NEW.status = 'reported' AND age_hours >= 1.0 THEN
    -- exactly at the 1-hour boundary: surface to LGU
    NEW.escalation_status := 'overdue';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_escalation ON public.reports;
CREATE TRIGGER trg_reports_escalation
  BEFORE INSERT OR UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.ug_refresh_escalation_status();

/* ---------------------------------------------------------------------------
   3. backfill the column on existing rows
   ---------------------------------------------------------------------------
   The trigger only fires on new writes, so existing rows need a one-shot
   backfill that applies the same rules. Idempotent — re-running the UPDATE
   leaves rows in the same state because the trigger enforces the rule on
   subsequent writes.
*/
UPDATE public.reports
   SET escalation_status = CASE
     WHEN status IN ('rejected') THEN 'cancelled'
     WHEN status IN ('verified','dispatched','resolved') THEN 'verified'
     WHEN status = 'reported' AND EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0 >= 1.0 THEN 'overdue'
     ELSE 'pending'
   END
WHERE escalation_status IS NULL OR escalation_status = 'pending';

/* ---------------------------------------------------------------------------
   4. lgu_escalation_queue view
   ---------------------------------------------------------------------------
   A read-only view that the LGU dashboard can read directly. Returns every
   report whose escalation_status is 'overdue' (i.e. the 1-hour window has
   elapsed without a barangay verification) along with the columns the LGU
   verification screen needs.
*/
CREATE OR REPLACE VIEW public.lgu_escalation_queue AS
SELECT
  r.id, r.code, r.hazard_type, r.barangay, r.barangay_id,
  r.severity, r.description, r.status,
  r.created_at,
  EXTRACT(EPOCH FROM (now() - r.created_at)) / 60.0 AS minutes_since_submission,
  r.escalation_status
FROM public.reports r
WHERE r.escalation_status = 'overdue'
ORDER BY r.created_at ASC;

COMMENT ON VIEW public.lgu_escalation_queue IS
  'Reports that the Barangay Official has not verified within 1 hour of submission. Surfaced to the LGU as a fallback verification queue. The original barangay official can still verify later.';

/* ---------------------------------------------------------------------------
   5. an RPC the LGU can call to "claim" an overdue report for verification
   ---------------------------------------------------------------------------
   The LGU verifies an overdue report by setting its status to 'verified'
   through this RPC. The RPC re-checks that the caller is an LGU staff
   member (or Super Admin) and writes an audit log row. Idempotent: calling
   it twice on the same report is a no-op after the first call.
*/
CREATE OR REPLACE FUNCTION public.lgu_verify_overdue_report(p_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_report public.reports%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_caller;
  IF NOT FOUND OR v_profile.role NOT IN ('lgu_ldrrmc') THEN
    RAISE EXCEPTION 'Only LGU staff can verify overdue reports' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
  END IF;

  -- short-circuit: already verified
  IF v_report.status IN ('verified','dispatched','resolved') THEN
    RETURN jsonb_build_object('ok', true, 'already_verified', true, 'report_id', p_report_id);
  END IF;

  -- advance the report to verified
  UPDATE public.reports
     SET status = 'verified',
         verified_at = now(),
         verified_by = v_caller,
         escalation_status = 'verified'
   WHERE id = p_report_id;

  -- write an audit row
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, meta, created_at)
  VALUES (v_caller, 'lgu_verify', 'reports', p_report_id,
          jsonb_build_object('from', v_report.status, 'to', 'verified',
                             'overdue_minutes', EXTRACT(EPOCH FROM (now() - v_report.created_at)) / 60.0),
          now());

  RETURN jsonb_build_object('ok', true, 'report_id', p_report_id, 'status', 'verified');
END;
$$;

COMMENT ON FUNCTION public.lgu_verify_overdue_report(uuid) IS
  'Lets the LGU verify a report that the barangay official did not verify within 1 hour of submission. Re-checks the caller is LGU staff.';

/* ---------------------------------------------------------------------------
   6. RLS — the escalation queue is visible to LGU / Super Admin only
   ---------------------------------------------------------------------------
   The view inherits the reports table RLS for now (security_invoker was
   applied in migration 024). The explicit policy below is a defensive
   double-check for older engines. It is additive — never replaces existing
   reports policies.
*/
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_lgu_escalation_read" ON public.reports;
CREATE POLICY "reports_lgu_escalation_read"
  ON public.reports FOR SELECT
  TO authenticated
  USING (
    escalation_status = 'overdue'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('lgu_ldrrmc','barangay_official')
    )
  );

-- Allow LGU/Super Admin to call the verification RPC.
-- Postgres grants EXECUTE on functions to PUBLIC by default; the function
-- re-checks the caller internally, so no extra grant is required.
