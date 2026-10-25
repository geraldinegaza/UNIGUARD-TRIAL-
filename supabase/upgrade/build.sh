#!/bin/bash
# Rebuilds upgrade_to_154.sql from the numbered migrations.
cd "$(dirname "$0")/../.." || exit 1
head -14 supabase/upgrade/upgrade_to_154.sql > /tmp/ug_head.sql
{ cat /tmp/ug_head.sql
  for f in supabase/migrations/026_*.sql supabase/migrations/1[2-5][0-9]_*.sql; do
    printf '\n\n-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> %s\n' "$(basename "$f")"; cat "$f"
  done; } > supabase/upgrade/upgrade_to_154.sql.new && mv supabase/upgrade/upgrade_to_154.sql.new supabase/upgrade/upgrade_to_154.sql
