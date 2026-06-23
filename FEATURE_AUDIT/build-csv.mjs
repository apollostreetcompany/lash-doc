#!/usr/bin/env node
// Assembles the canonical FEATURE_AUDIT/STORIES.csv from the inventory workflow output.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2];
const OUT_CSV = 'FEATURE_AUDIT/STORIES.csv';
const OUT_MD = 'FEATURE_AUDIT/STORIES_SUMMARY.md';

const raw = readFileSync(SRC, 'utf8');
const parsed = JSON.parse(raw);
const clusters = parsed.result?.clusters ?? parsed.clusters ?? [];

const CLUSTER_NAMES = {
  C01: 'Editor shell & document lifecycle',
  C02: 'Toolbar & text formatting',
  C03: 'Headings, outline & collapse',
  C04: 'Markdown import/export & hotkeys',
  C05: 'Tables (cells/nav/copy-paste/perf)',
  C06: 'Images & media',
  C07: 'Checklists / task lists',
  C08: 'Chips (internal links)',
  C09: 'Mentions (users/groups) & privacy',
  C10: 'Natural-date mentions',
  C11: 'Suggest mode',
  C12: 'History timeline / snapshots / restore',
  C13: 'Deterministic & filtered diffs',
  C14: 'Authorship / blame gutter',
  C15: 'Doc chat (anchors/filters/history)',
  C16: 'Share / RBAC / scopes / expiry / audit',
  C17: 'Redaction (history/chat)',
  C18: 'AI patch / guardrails / scope / citations',
  C19: 'Autosave & focus mode',
  C20: 'Offline edits & collaboration (Yjs)',
  C21: 'Realtime worker (rooms/access/persistence)',
  C22: 'Accessibility / IME / i18n / SR',
  C23: 'Observability / SLOs',
  C24: 'Storage',
  C25: 'Sidebar / nav / doc-identity / title',
  C26: 'Insight routing / writing places (NEW)',
};

const csvCell = (v) => {
  const s = String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .trim();
  return '"' + s.replace(/"/g, '""') + '"';
};

const headers = [
  'id',
  'cluster',
  'cluster_name',
  'feature',
  'user_story',
  'expected_behaviour',
  'evidence',
  'impl_status',
  'phase',
  'test_status',
  'errors',
  'fix_status',
  'retest_status',
  'notes',
];

const rows = [headers.map(csvCell).join(',')];
const counts = {};
const implCounts = { implemented: 0, partial: 0, stub: 0, missing: 0 };
let n = 0;

// keep cluster order C01..C26
const ordered = [...clusters].sort((a, b) => String(a.cluster).localeCompare(String(b.cluster)));
for (const c of ordered) {
  const cl = c.cluster;
  const stories = c.stories ?? [];
  counts[cl] = stories.length;
  let i = 0;
  for (const s of stories) {
    i += 1;
    n += 1;
    const id = `F-${cl}-${String(i).padStart(2, '0')}`;
    const impl = (s.impl_status || 'implemented').toLowerCase();
    if (implCounts[impl] !== undefined) implCounts[impl] += 1;
    rows.push(
      [
        id,
        cl,
        CLUSTER_NAMES[cl] || '',
        s.feature,
        s.user_story,
        s.expected_behaviour,
        s.evidence,
        impl,
        'story-drafted',
        'untested',
        '',
        'none',
        'pending',
        '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
}

writeFileSync(OUT_CSV, rows.join('\n') + '\n', 'utf8');

// Markdown summary
const md = [];
md.push('# Feature Stories — Summary');
md.push('');
md.push(
  `Generated from inventory workflow. **${n} stories** across **${ordered.length} clusters**. Canonical data: \`STORIES.csv\`.`,
);
md.push('');
md.push('## Implementation status (as derived from code)');
md.push('');
md.push('| Status | Count |');
md.push('| --- | --- |');
for (const k of ['implemented', 'partial', 'stub', 'missing'])
  md.push(`| ${k} | ${implCounts[k]} |`);
md.push('');
md.push('## Stories per cluster');
md.push('');
md.push('| Cluster | Name | Stories |');
md.push('| --- | --- | --- |');
for (const c of ordered)
  md.push(`| ${c.cluster} | ${CLUSTER_NAMES[c.cluster] || ''} | ${counts[c.cluster]} |`);
md.push('| C26 | Insight routing / writing places (NEW) | 0 (to design) |');
md.push('');
writeFileSync(OUT_MD, md.join('\n') + '\n', 'utf8');

console.log(`Wrote ${OUT_CSV} (${n} stories) and ${OUT_MD}`);
console.log('impl:', JSON.stringify(implCounts));
console.log('per-cluster:', JSON.stringify(counts));
