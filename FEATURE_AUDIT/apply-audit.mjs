#!/usr/bin/env node
// Folds Phase-2 audit findings into STORIES.csv and writes ERRORS.md.
import { readFileSync, writeFileSync } from 'node:fs';

const AUDIT = process.argv[2];
const CSV = 'FEATURE_AUDIT/STORIES.csv';
const ERRORS = 'FEATURE_AUDIT/ERRORS.md';

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

const audit = JSON.parse(readFileSync(AUDIT, 'utf8'));
const r = audit.result || audit;
const confirmed = (r.perCluster || []).flatMap((c) =>
  (c.verified || []).filter((v) => v.confirmed).map((v) => ({ cluster: c.cluster, ...v })),
);
const byStory = new Map();
for (const f of confirmed) byStory.set(f.story_id, f);

const rows = parseCsv(readFileSync(CSV, 'utf8'));
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
let touched = 0,
  passed = 0;
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const cl = row[idx.cluster];
  if (cl === 'C26') continue; // already verified
  row[idx.phase] = 'tested';
  const f = byStory.get(row[idx.id]);
  if (f) {
    row[idx.test_status] = f.verdict === 'fail' ? 'fail' : 'partial';
    row[idx.errors] = `[${f.issue_type}/${f.severity}] ${f.description}`;
    row[idx.fix_status] = 'needed';
    if (f.issue_type === 'spec-error') {
      row[idx.notes] = (
        (row[idx.notes] || '') + ' SPEC-ERROR: story expected_behaviour to be corrected per audit.'
      ).trim();
    }
    touched++;
  } else {
    row[idx.test_status] = 'pass';
    if (row[idx.fix_status] === 'none' || !row[idx.fix_status]) row[idx.fix_status] = 'none';
    passed++;
  }
}
writeFileSync(CSV, rows.map((row) => row.map(cell).join(',')).join('\n') + '\n', 'utf8');

// ERRORS.md grouped by severity
const order = { high: 0, medium: 1, low: 2 };
const sorted = [...confirmed].sort(
  (a, b) =>
    order[a.severity] - order[b.severity] ||
    a.cluster.localeCompare(b.cluster) ||
    a.story_id.localeCompare(b.story_id),
);
const md = [];
md.push('# Phase 2 — Confirmed Error Register');
md.push('');
md.push(
  `Adversarially-verified findings from the Phase-2 audit (${confirmed.length} confirmed). Each item is a Phase-3 fix candidate. Source: \`STORIES.csv\` test_status/errors columns.`,
);
md.push('');
const sev = confirmed.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {});
const typ = confirmed.reduce((m, f) => ((m[f.issue_type] = (m[f.issue_type] || 0) + 1), m), {});
md.push(`**Severity:** high ${sev.high || 0} · medium ${sev.medium || 0} · low ${sev.low || 0}  `);
md.push(
  `**Type:** logistical ${typ.logistical || 0} · ux ${typ.ux || 0} · spec-error ${typ['spec-error'] || 0} · a11y ${typ.a11y || 0} · bug ${typ.bug || 0}`,
);
md.push('');
for (const level of ['high', 'medium', 'low']) {
  const items = sorted.filter((f) => f.severity === level);
  if (!items.length) continue;
  md.push(`## ${level.toUpperCase()} severity (${items.length})`);
  md.push('');
  for (const f of items) {
    md.push(`### [ ] ${f.story_id} · ${f.feature}  \`${f.issue_type}\``);
    md.push(`- **Cluster:** ${f.cluster} · **Verdict:** ${f.verdict}`);
    md.push(`- **Problem:** ${f.description}`);
    md.push(`- **Fix:** ${f.suggested_fix}`);
    if (f.verifier_note) md.push(`- **Verified:** ${f.verifier_note}`);
    md.push('');
  }
}
writeFileSync(ERRORS, md.join('\n') + '\n', 'utf8');
console.log(
  `Updated CSV: ${touched} stories flagged with issues, ${passed} passed. Wrote ${ERRORS} (${confirmed.length} items).`,
);
console.log('severity', JSON.stringify(sev), 'type', JSON.stringify(typ));
