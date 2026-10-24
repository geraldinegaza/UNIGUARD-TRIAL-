// Printable documents (situation reports, damage assessments, incident
// summaries, guides). One list of sections feeds the on-screen preview and
// the PDF, so the two never disagree. jsPDF loads only when a PDF is made.
import { PLACE } from './geo';

export interface DocSection {
  title: string;
  note?: string;
  head?: string[];
  rows: (string | number)[][];
  total?: (string | number)[] | null;
  /** free text printed as paragraphs instead of a table */
  text?: string;
}

export interface DocSpec {
  title: string;
  subtitle?: string;
  meta?: string[];
  sections: DocSection[];
  filename: string;
  landscape?: boolean;
  signer?: string;
}

export async function exportPdf(spec: DocSpec): Promise<void> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: spec.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`UNIGUARD · ${PLACE.town.toUpperCase()} MDRRMO`, margin, y);
  y += 18;
  doc.setTextColor(20);
  doc.setFontSize(16);
  doc.text(doc.splitTextToSize(spec.title, pageW - margin * 2), margin, y);
  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  [spec.subtitle, ...(spec.meta || []), `Generated ${new Date().toLocaleString()}`]
    .filter(Boolean)
    .forEach((line) => {
      doc.text(String(line), margin, y);
      y += 12;
    });
  y += 6;

  for (const s of spec.sections) {
    if (y > pageH - 90) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(s.title, margin, y);
    y += 6;
    if (s.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(110);
      y += 9;
      doc.text(doc.splitTextToSize(s.note, pageW - margin * 2), margin, y);
    }
    y += 6;
    if (s.text !== undefined) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(30);
      const lines = doc.splitTextToSize(s.text || '—', pageW - margin * 2);
      for (const line of lines) {
        if (y > pageH - margin) {
          doc.addPage();
          y = margin;
        }
        y += 12;
        doc.text(line, margin, y);
      }
      y += 16;
      continue;
    }
    const width = s.head ? s.head.length : 1;
    const body = s.rows.length
      ? s.rows.map((r) => r.map((c) => String(c ?? '')))
      : [['Nothing recorded', ...Array(Math.max(0, width - 1)).fill('')]];
    autoTable(doc, {
      startY: y,
      head: s.head ? [s.head] : undefined,
      body,
      foot: s.total ? [s.total.map((c) => String(c ?? ''))] : undefined,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak', textColor: 30 },
      headStyles: { fillColor: [24, 24, 27], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [235, 235, 238], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 248, 250] },
      theme: 'grid',
    });
    y = (doc as any).lastAutoTable.finalY + 22;
  }

  if (spec.signer) {
    if (y > pageH - 80) {
      doc.addPage();
      y = margin;
    }
    y += 20;
    doc.setDrawColor(150);
    doc.line(margin, y, margin + 200, y);
    doc.setFontSize(9);
    doc.setTextColor(40);
    doc.text(`Prepared by: ${spec.signer}`, margin, y + 12);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`${spec.title} · page ${i} of ${pages}`, margin, pageH - 20);
  }
  doc.save(spec.filename);
}

export const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// Preparedness guides as a printable handout: one hazard, or every hazard.
export async function exportGuidesPdf(
  guides: { hazard_type: string; phase: string; title: string; summary?: string; body: string; sort_order: number; active: boolean }[],
  hazard: string | 'all'
): Promise<void> {
  const phases = ['before', 'during', 'after'];
  const list = guides
    .filter((g) => g.active && (hazard === 'all' || g.hazard_type === hazard))
    .sort((a, b) => a.hazard_type.localeCompare(b.hazard_type) || phases.indexOf(a.phase) - phases.indexOf(b.phase) || a.sort_order - b.sort_order);
  const sections: DocSection[] = list.map((g) => ({
    title: `${hazard === 'all' ? `${g.hazard_type} · ` : ''}${g.phase.charAt(0).toUpperCase()}${g.phase.slice(1)}: ${g.title}`,
    note: g.summary || undefined,
    rows: [],
    text: g.body,
  }));
  if (!sections.length) sections.push({ title: 'No guides published yet', rows: [], text: 'The LDRRMO has not published guides for this hazard.' });
  await exportPdf({
    title: hazard === 'all' ? 'Preparedness Guides' : `Preparedness Guide · ${hazard}`,
    subtitle: `What to do before, during and after · ${PLACE.label}`,
    sections,
    filename: `uniguard-guide-${hazard === 'all' ? 'all' : hazard.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
  });
}
