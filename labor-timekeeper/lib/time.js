import { addDays, startOfWeek, format } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

export const TZ = process.env.TIMEZONE || "America/New_York";
const PAYROLL_YEAR_STARTS = {
  "2026": "2025-12-31"
};
const PAYROLL_YEAR_START = process.env.PAYROLL_YEAR_START || "";

function getPayrollYearStart(year) {
  const y = String(year || "");
  if (PAYROLL_YEAR_STARTS[y]) return PAYROLL_YEAR_STARTS[y];
  if (PAYROLL_YEAR_START) return PAYROLL_YEAR_START;
  return null;
}

export function payrollMonthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return null;
  const [y, m] = month.split("-").map(Number);
  const yearStart = getPayrollYearStart(y);
  if (!yearStart) return null;
  const pattern = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5];
  const startDate = ymdToDate(yearStart);
  let cursor = new Date(startDate.getTime());
  for (let i = 0; i < 12; i += 1) {
    const days = pattern[i] * 7;
    const bucketStart = new Date(cursor.getTime());
    const bucketEnd = new Date(cursor.getTime());
    bucketEnd.setUTCDate(bucketEnd.getUTCDate() + days - 1);
    if (i + 1 === m) {
      const start = format(bucketStart, "yyyy-MM-dd");
      const end = format(bucketEnd, "yyyy-MM-dd");
      return { start, end };
    }
    cursor.setUTCDate(cursor.getUTCDate() + days);
  }
  return null;
}

export function payrollWeeksForMonth(month) {
  const range = payrollMonthRange(month);
  if (!range) return [];
  const weeks = [];
  let cursor = ymdToDate(range.start);
  const end = ymdToDate(range.end);
  while (cursor <= end) {
    weeks.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function todayYMD() {
  const now = new Date();
  return formatInTimeZone(now, TZ, "yyyy-MM-dd");
}

export function weekStartYMD(date = new Date()) {
  const weekStartsOn = Number(process.env.PAYROLL_WEEK_START ?? 3); // Wednesday default
  // Use zoned time for consistent payroll weeks
  const zoned = toZonedTime(date, TZ);
  const start = startOfWeek(zoned, { weekStartsOn });
  return format(start, "yyyy-MM-dd");
}

export function weekDates(weekStart) {
  // weekStart is YYYY-MM-DD
  const [y,m,d] = weekStart.split("-").map(Number);
  const start = new Date(Date.UTC(y, m-1, d, 12, 0, 0)); // noon UTC avoids DST edge
  const zonedStart = toZonedTime(start, TZ);
  const map = {};
  const keys = ["sun","mon","tue","wed","thu","fri","sat"];
  // Determine actual weekday order relative to configured start
  const weekStartsOn = Number(process.env.PAYROLL_WEEK_START ?? 3);
  // Build 7 days starting at weekStart
  for (let i=0;i<7;i++){
    const day = addDays(zonedStart, i);
    const ymd = format(day, "yyyy-MM-dd");
    const weekdayIdx = day.getDay(); // 0 Sunday ...
    map[keys[weekdayIdx]] = ymd;
  }
  // Also provide ordered list starting at weekStart
  const ordered = [];
  for (let i=0;i<7;i++){
    const day = addDays(zonedStart, i);
    ordered.push({
      ymd: format(day, "yyyy-MM-dd"),
      dow: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day.getDay()]
    });
  }
  return { map, ordered, weekStartsOn };
}

export function ymdToDate(ymd){
  const [y,m,d] = ymd.split("-").map(Number);
  // Return a Date representing noon UTC for stability
  return new Date(Date.UTC(y, m-1, d, 12, 0, 0));
}
