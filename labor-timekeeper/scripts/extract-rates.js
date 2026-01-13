import ExcelJS from 'exceljs';
import path from 'path';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path.resolve('../Payroll Breakdown Hours.xlsx'));

const ws = wb.worksheets[0];
const rates = new Map();

for (let r = 1; r <= 300; r++) {
  const name = ws.getCell(r, 1).value;
  const rate = ws.getCell(r, 2).value;
  if (name && rate && typeof rate === 'number' && rate > 0) {
    rates.set(String(name).trim(), rate);
  }
}

console.log('Employee rates found:');
for (const [name, rate] of [...rates.entries()].sort((a,b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${name}: $${rate}`);
}
