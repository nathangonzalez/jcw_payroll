import { readFileSync } from 'fs';
const a = readFileSync('c:/Users/natha/dev/repos/jcw_payroll/labor-timekeeper/public/admin.html', 'utf16le');

// Find garbled chars around Monthly Report button and Simulate Month
for (const search of ['Monthly Report', 'Simulate Month', 'This will archive']) {
  const idx = a.indexOf(search);
  if (idx < 0) { console.log(search, '=> NOT FOUND'); continue; }
  const start = Math.max(0, idx - 8);
  const end = Math.min(a.length, idx + 5);
  const snippet = a.substring(start, end);
  console.log(`\n--- ${search} ---`);
  for (let i = 0; i < snippet.length; i++) {
    const code = snippet.charCodeAt(i);
    console.log(`  ${i}: U+${code.toString(16).padStart(4,'0')} ${code > 127 ? '***' : ''} ${JSON.stringify(snippet[i])}`);
  }
}
