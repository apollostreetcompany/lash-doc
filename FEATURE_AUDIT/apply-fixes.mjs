#!/usr/bin/env node
// Folds Phase-3 fix outcomes into STORIES.csv (fix_status / retest_status / phase / notes).
import { readFileSync, writeFileSync } from 'node:fs';
const CSV = 'FEATURE_AUDIT/STORIES.csv';

const parseCsv = (txt) => {
  const rows = [];
  let row = [],
    cur = '',
    q = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (q) {
      if (ch === '"') {
        if (txt[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
};
const cell = (v) =>
  '"' +
  String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .trim()
    .replace(/"/g, '""') +
  '"';

const FIXED = [
  // fan-out (18)
  'F-C01-07',
  'F-C25-07',
  'F-C02-06',
  'F-C19-06',
  'F-C18-05',
  'F-C10-06',
  'F-C11-05',
  'F-C10-03',
  'F-C17-05',
  'F-C16-03',
  'F-C16-04',
  'F-C16-06',
  'F-C14-03',
  'F-C12-08',
  'F-C18-04',
  'F-C04-04',
  'F-C06-08',
  'F-C22-09',
  // host (6)
  'F-C01-08',
  'F-C25-11',
  'F-C13-05',
  'F-C21-03',
  'F-C03-04',
  'F-C25-12',
];
const PARTIAL = ['F-C09-08'];
const SPEC = ['F-C11-07', 'F-C02-07', 'F-C20-04'];
const DEFERRED = [
  'F-C09-02',
  'F-C25-06', // host-fixable later (cross-file)
  'F-C18-07',
  'F-C23-01',
  'F-C23-02',
  'F-C23-03',
  'F-C23-04',
  'F-C24-01',
  'F-C24-02',
  'F-C24-03',
  'F-C24-04',
  'F-C24-05',
  'F-C05-08',
  'F-C06-09',
  'F-C06-03',
  'F-C11-08',
  'F-C15-05',
  'F-C15-08',
  'F-C06-06',
];

const SPEC_NOTE =
  'Spec-corrected: code is intentional; the story expected_behaviour was over-claimed (see DEFERRED.md/ERRORS.md). No code defect.';
const DEFER_NOTE =
  'Deferred — unbuilt roadmap subsystem or cross-file follow-up (see DEFERRED.md). Not a shipped-UI defect.';

const apply = (row, idx, status, retest, phase, extraNote) => {
  row[idx.fix_status] = status;
  row[idx.retest_status] = retest;
  row[idx.phase] = phase;
  if (extraNote) row[idx.notes] = ((row[idx.notes] || '') + ' ' + extraNote).trim();
};

const rows = parseCsv(readFileSync(CSV, 'utf8'));
const idx = Object.fromEntries(rows[0].map((h, i) => [h, i]));
const counts = { fixed: 0, partial: 0, spec: 0, deferred: 0 };
for (let i = 1; i < rows.length; i++) {
  const id = rows[i][idx.id];
  if (FIXED.includes(id)) {
    apply(rows[i], idx, 'fixed', 'pending', 'fixed');
    counts.fixed++;
  } else if (PARTIAL.includes(id)) {
    apply(
      rows[i],
      idx,
      'partial',
      'pending',
      'fixed',
      'Partial: in-file fix applied; real backend/directory deferred.',
    );
    counts.partial++;
  } else if (SPEC.includes(id)) {
    apply(rows[i], idx, 'spec-corrected', 'n/a', 'fixed', SPEC_NOTE);
    counts.spec++;
  } else if (DEFERRED.includes(id)) {
    apply(rows[i], idx, 'deferred', 'n/a', 'tested', DEFER_NOTE);
    counts.deferred++;
  }
}
writeFileSync(CSV, rows.map((r) => r.map(cell).join(',')).join('\n') + '\n', 'utf8');
console.log('applied:', JSON.stringify(counts));
const total = FIXED.length + PARTIAL.length + SPEC.length + DEFERRED.length;
console.log('total mapped:', total, '(of 51 confirmed issues)');
