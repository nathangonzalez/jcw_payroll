#!/usr/bin/env node
/**
 * Fix garbled UTF-8 mojibake in UTF-16LE HTML files.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

function fixFile(relPath, replacements) {
  const fullPath = resolve(ROOT, relPath);
  // Read as UTF-16LE (the files have BOM ff fe)
  let content = readFileSync(fullPath, 'utf16le');
  // Strip BOM if present
  if (content.charCodeAt(0) === 0xFEFF) content = content.substring(1);
  
  let changed = 0;
  for (const [search, replace, label] of replacements) {
    const before = content;
    content = content.split(search).join(replace);
    if (content !== before) {
      changed++;
      console.log(`  [${label || search}] replaced`);
    }
  }
  
  // Write back as UTF-16LE with BOM
  const bom = Buffer.from([0xFF, 0xFE]);
  const body = Buffer.from(content, 'utf16le');
  writeFileSync(fullPath, Buffer.concat([bom, body]));
  console.log(`${relPath}: ${changed} replacements applied\n`);
}

// app.html: fix em-dash, pin icon, delete button X
fixFile('public/app.html', [
  ['\u0393\u00C7\u00F6', '\u2014', 'em-dash'],
  ['\u2261\u0192\u00F4\u00EC', '\uD83D\uDCCC', 'pin-icon'],
  ['\u0393\u00A3\u00FB', '\u2715', 'delete-X'],
]);

// admin.html: fix all garbled emoji/special chars
fixFile('public/admin.html', [
  ['\u2261\u0192\u00F4\u00E8', '\uD83D\uDCCA', 'chart-emoji'],
  ['\u0393\u00BC\u00E7\u2229\u2555\u0178', '\uD83D\uDEE0\uFE0F', 'wrench-emoji'],
  ['\u2261\u0192\u00EE\u00B1', '\uD83C\uDF31', 'seedling-emoji'],
  ['\u0393\u00A3\u00E0', '\u2705', 'check-emoji'],
  ['\u2261\u0192\u00F4\u00EF', '\uD83D\uDCCB', 'clipboard-emoji'],
  ['\u0393\u00A5\u00EE', '\u274C', 'cross-emoji'],
  ['\u0393\u0178\u00A1\u2229\u2555\u0178', '\u26A0\uFE0F', 'warning-emoji'],
  ['\u0393\u00C7\u00F6', '\u2014', 'em-dash'],
]);

console.log('Done!');
