import { readFileSync, writeFileSync } from 'fs';

const fp = 'c:/Users/natha/dev/repos/jcw_payroll/labor-timekeeper/public/app.html';
let c = readFileSync(fp, 'utf16le');
if (c.charCodeAt(0) === 0xFEFF) c = c.substring(1);

// Find "Speak it" and dump surrounding chars
const idx = c.indexOf('Speak it');
if (idx >= 0) {
  const snippet = c.substring(Math.max(0, idx - 8), idx + 2);
  console.log('Before "Speak it":');
  for (let i = 0; i < snippet.length; i++) {
    const code = snippet.charCodeAt(i);
    console.log(`  ${i}: U+${code.toString(16).padStart(4,'0')} ${code > 127 ? '***' : ''} ${JSON.stringify(snippet[i])}`);
  }
}
