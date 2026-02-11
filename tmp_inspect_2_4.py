import xlrd, os, glob

files = glob.glob('2_4/*.xls')
for f in sorted(files):
    print(f"\n{'='*60}")
    print(f"FILE: {os.path.basename(f)}")
    print('='*60)
    wb = xlrd.open_workbook(f)
    for sname in wb.sheet_names():
        ws = wb.sheet_by_name(sname)
        print(f"  --- Sheet: {sname} (rows={ws.nrows}, cols={ws.ncols}) ---")
        for r in range(min(ws.nrows, 45)):
            vals = []
            for c in range(min(ws.ncols, 12)):
                v = ws.cell_value(r, c)
                ct = ws.cell_type(r, c)
                if ct == xlrd.XL_CELL_EMPTY:
                    continue
                vals.append(f"C{c+1}:{repr(v)}")
            if vals:
                print(f"    Row {r+1}: {' | '.join(vals)}")
