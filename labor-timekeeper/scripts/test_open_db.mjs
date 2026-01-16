import { openDb } from '../lib/db.js';
try {
  const db = openDb();
  console.log('openDb succeeded');
  const empCols = db.prepare("PRAGMA table_info(employees)").all();
  console.log('employees columns:', empCols.map(c=>c.name));
  const hasPin = empCols.some(c=>c.name==='pin_hash');
  console.log('hasPinHash:', hasPin);
} catch (err) {
  console.error('openDb failed:', err.message);
  console.error(err.stack);
  process.exit(1);
}
