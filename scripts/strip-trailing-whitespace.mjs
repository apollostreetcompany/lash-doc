#!/usr/bin/env node

import fs from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: strip-trailing-whitespace <file...>');
  process.exit(1);
}

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const normalized = original.replace(/[ \t]+$/gm, '');
  if (normalized !== original) {
    fs.writeFileSync(file, normalized);
  }
}
