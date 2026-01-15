import fs from 'fs';
import path from 'path';

const PERSIST_PATH = path.resolve(process.cwd(), 'persist.txt');

export function persist(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(PERSIST_PATH, line, { encoding: 'utf8' });
  } catch (e) {
    // best-effort only
    console.warn('[persist] write failed', String(e));
  }
}

export default persist;
