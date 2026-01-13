import Database from 'better-sqlite3';

const db = new Database('./data/app.db');

// Update bill rates from the original Payroll Breakdown
const rates = {
  'Chris Jacobi': 100,
  'Chris Zavesky': 100,
  'Boban Abbate': 42.5,
  'Jason Green': 35,
  'Thomas Brinson': 35,
  'Phil Henderson': 30,
  'Doug Kinsey': 30,
  'Sean Matthew': 20,
};

const update = db.prepare('UPDATE employees SET default_bill_rate = ? WHERE name = ?');

for (const [name, rate] of Object.entries(rates)) {
  const result = update.run(rate, name);
  console.log(`${name}: $${rate} (${result.changes} updated)`);
}

console.log('\nCurrent rates:');
console.log(db.prepare('SELECT name, default_bill_rate FROM employees ORDER BY name').all());

db.close();
