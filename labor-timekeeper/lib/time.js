import { addDays, startOfWeek, format } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

export const TZ = process.env.TIMEZONE || "America/New_York";

export function todayYMD() {
  const now = new Date();
  return formatInTimeZone(now, TZ, "yyyy-MM-dd");
}

export function weekStartYMD(date = new Date()) {
  const weekStartsOn = Number(process.env.PAYROLL_WEEK_START ?? 1); // Monday default
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
  const weekStartsOn = Number(process.env.PAYROLL_WEEK_START ?? 1);
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
