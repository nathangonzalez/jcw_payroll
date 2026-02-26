import json, urllib.request
BASE = 'https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com'
admins = [('emp_5f843z9p', 'Chris Zavesky'), ('emp_ov9xtazq', 'Chris Jacobi')]
weeks = ['2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18']
for emp_id, name in admins:
    print(f'\n=== {name} ===')
    month_total = 0
    for ws in weeks:
        url = f'{BASE}/api/time-entries?employee_id={emp_id}&week_start={ws}'
        data = json.loads(urllib.request.urlopen(url).read())
        entries = [e for e in data['entries'] if e['customer_name'].lower() != 'lunch']
        total = sum(e['hours'] for e in entries)
        month_total += total
        if entries:
            clients = {}
            for e in entries:
                c = e['customer_name']
                clients[c] = clients.get(c, 0) + e['hours']
            client_str = ', '.join(f'{c}:{h}h' for c, h in sorted(clients.items()))
            print(f'  Week {ws}: {total}h ({client_str})')
        else:
            print(f'  Week {ws}: NO ENTRIES')
    print(f'  MONTH TOTAL: {month_total}h')
