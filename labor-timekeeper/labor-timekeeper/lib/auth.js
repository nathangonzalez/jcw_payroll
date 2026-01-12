import bcrypt from "bcryptjs";
import { id } from "./db.js";

const COOKIE_NAME = "sid";

export function cookieName() {
  return COOKIE_NAME;
}

export function hashPin(pin) {
  return bcrypt.hashSync(String(pin), 10);
}

export function verifyPin(pin, hash) {
  return bcrypt.compareSync(String(pin), hash);
}

export function createSession(db, employeeId) {
  const sid = id("sess_");
  const now = new Date();
  const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? 168);
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  db.prepare(
    "INSERT INTO sessions (id, employee_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(sid, employeeId, now.toISOString(), expires.toISOString());
  return { sid, expires };
}

export function destroySession(db, sid) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
}

export function getSession(db, sid) {
  if (!sid) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sid);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(db, sid);
    return null;
  }
  return row;
}

export function requireAuth(db) {
  return (req, res, next) => {
    const sid = req.cookies?.[COOKIE_NAME];
    const sess = getSession(db, sid);
    if (!sess) return res.status(401).json({ error: "Not authenticated" });
    const emp = db
      .prepare("SELECT id, name, default_bill_rate, default_pay_rate, is_admin, aliases_json FROM employees WHERE id = ?")
      .get(sess.employee_id);
    if (!emp) return res.status(401).json({ error: "Invalid session" });
    req.employee = emp;
    req.session = sess;
    next();
  };
}

export function requireAdmin(db) {
  const auth = requireAuth(db);
  return (req, res, next) => {
    auth(req, res, () => {
      if (!req.employee?.is_admin) return res.status(403).json({ error: "Admin only" });
      next();
    });
  };
}
