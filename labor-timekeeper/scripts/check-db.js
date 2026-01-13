import { openDb } from '../lib/db.js';

const db = openDb();

// Check some customer names
const caputo = db.prepare("SELECT name FROM customers WHERE LOWER(name) LIKE '%caputo%'").all();
console.log('Caputo:', caputo);

// Count all entries in DB  
const entries = db.prepare("SELECT COUNT(*) as n FROM time_entries").get();
console.log('Time entries in DB:', entries.n);

// Check what customers exist
const customers = db.prepare("SELECT name FROM customers ORDER BY name").all();
console.log('\nFirst 20 customers:');
customers.slice(0, 20).forEach(c => console.log('  -', c.name));
