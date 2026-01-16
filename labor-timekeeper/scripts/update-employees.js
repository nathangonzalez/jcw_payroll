import Database from 'better-sqlite3';

const db = new Database('data/app.db');

const tx = db.transaction(() => {
  console.log('Before:', db.prepare('SELECT COUNT(*) as n FROM employees').get().n);

  // Rename/merge exact 'Chris Z' -> 'Chris Zavesky'
  const src = db.prepare("SELECT id FROM employees WHERE name = ?").get('Chris Z');
  const dest = db.prepare("SELECT id FROM employees WHERE name = ?").get('Chris Zavesky');
  if (src) {
    if (dest) {
      // merge references from src -> dest then delete src
      db.prepare('UPDATE time_entries SET employee_id = ? WHERE employee_id = ?').run(dest.id, src.id);
      db.prepare('UPDATE rate_overrides SET employee_id = ? WHERE employee_id = ?').run(dest.id, src.id);
      db.prepare('UPDATE sessions SET employee_id = ? WHERE employee_id = ?').run(dest.id, src.id);
      db.prepare('DELETE FROM employees WHERE id = ?').run(src.id);
      console.log('Merged employee', src.id, 'into', dest.id);
    } else {
      const r1 = db.prepare("UPDATE employees SET name = ? WHERE id = ?").run('Chris Zavesky', src.id);
      console.log('Renamed rows:', r1.changes);
    }
  } else {
    console.log('No employee named "Chris Z" found');
  }

  // Delete employees matching 'Office Admin' or name like '%Jafid%'
  const toRemove = db.prepare("SELECT id, name FROM employees WHERE name = ? OR name LIKE ?").all('Office Admin', '%Jafid%');
  console.log('Will remove:', toRemove.map(r=>r.name));

  for (const e of toRemove) {
    // Remove dependent rows first
    db.prepare('DELETE FROM time_entries WHERE employee_id = ?').run(e.id);
    db.prepare('DELETE FROM rate_overrides WHERE employee_id = ?').run(e.id);
    db.prepare('DELETE FROM sessions WHERE employee_id = ?').run(e.id);
    db.prepare('DELETE FROM employees WHERE id = ?').run(e.id);
  }

  console.log('After:', db.prepare('SELECT COUNT(*) as n FROM employees').get().n);
});

tx();
console.log('Update complete');
