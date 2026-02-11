import { readFileSync, writeFileSync } from 'fs';

const fp = 'c:/Users/natha/dev/repos/jcw_payroll/labor-timekeeper/public/admin.html';
let c = readFileSync(fp, 'utf16le');
if (c.charCodeAt(0) === 0xFEFF) c = c.substring(1);

// wrench: U+0393 U+00BC U+00E7 U+2229 U+2555 U+00C5
const wrench = '\u0393\u00BC\u00E7\u2229\u2555\u00C5';
c = c.split(wrench).join('\uD83D\uDEE0\uFE0F');
console.log('wrench replaced:', c.indexOf('\uD83D\uDEE0') >= 0);

// seedling: U+2261 U+0192 U+00EE U+2592
const seedling = '\u2261\u0192\u00EE\u2592';
c = c.split(seedling).join('\uD83C\uDF31');
console.log('seedling replaced:', c.indexOf('\uD83C\uDF31') >= 0);

// warning: U+0393 U+00DC U+00E1 U+2229 U+2555 U+00C5
const warning = '\u0393\u00DC\u00E1\u2229\u2555\u00C5';
c = c.split(warning).join('\u26A0\uFE0F');
console.log('warning replaced:', c.indexOf('\u26A0') >= 0);

const bom = Buffer.from([0xFF, 0xFE]);
const body = Buffer.from(c, 'utf16le');
writeFileSync(fp, Buffer.concat([bom, body]));
console.log('Done!');
