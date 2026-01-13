import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('../Payroll Breakdown Hours.xlsx');

const sheet = wb.worksheets[0];
console.log('Sheet:', sheet.name, '- Cols:', sheet.columnCount, '- Rows:', sheet.rowCount);
console.log('');

sheet.eachRow((row, rowNum) => {
  const cells = [];
  row.eachCell({includeEmpty: true}, (c, cn) => {
    if (cn <= 5) {
      const v = c.value;
      let str;
      if (v && typeof v === 'object' && v.formula) {
        str = `[F:${v.formula.substring(0,10)}]`;
      } else {
        str = v === null ? '' : String(v).substring(0, 20);
      }
      cells.push(str.padEnd(20));
    }
  });
  if (cells.some(c => c.trim())) {
    console.log(`${String(rowNum).padStart(3)}: ${cells.join('|')}`);
  }
});
