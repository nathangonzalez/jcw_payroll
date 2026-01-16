import ExcelJS from 'exceljs';
import path from 'path';

const file = process.argv[2] || path.join('exports','2026-01','Payroll_Breakdown_2026-01.xlsx');
(async ()=>{
  try{
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    console.log('Workbook:', file);
    console.log('Sheets:', wb.worksheets.map(ws=>ws.name));
    for (const ws of wb.worksheets) {
      console.log('\n--- Sheet:', ws.name, 'Rows:', ws.rowCount, 'Cols:', ws.columnCount);
      const max = Math.min(ws.rowCount, 6);
      for (let r=1;r<=max;r++){
        const row = ws.getRow(r).values;
        // ExcelJS row.values is 1-based
        console.log(row.slice(1,11).map(v=> (v===undefined?'':v)).join(' | '));
      }
    }
  } catch(err){
    console.error('Error reading workbook:', err);
    process.exit(1);
  }
})();
