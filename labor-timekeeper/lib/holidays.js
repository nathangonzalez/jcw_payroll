/**
 * US Federal Holidays for payroll auto-population
 * Returns holidays for a given year
 */

// Memorial Day: last Monday of May
function getMemorialDay(year) {
  const lastDayOfMay = new Date(year, 4, 31);
  const dayOfWeek = lastDayOfMay.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return new Date(year, 4, 31 - diff);
}

// Labor Day: first Monday of September
function getLaborDay(year) {
  const firstOfSept = new Date(year, 8, 1);
  const dayOfWeek = firstOfSept.getDay();
  const diff = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
  return new Date(year, 8, 1 + diff);
}

// Thanksgiving: fourth Thursday of November
function getThanksgiving(year) {
  const firstOfNov = new Date(year, 10, 1);
  const dayOfWeek = firstOfNov.getDay();
  const firstThursday = dayOfWeek <= 4 ? 4 - dayOfWeek + 1 : 11 - dayOfWeek + 1;
  return new Date(year, 10, firstThursday + 21);
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Get all US federal holidays for a given year
 * @param {number} year - The year to get holidays for
 * @returns {Array<{date: string, name: string}>} Array of holiday objects
 */
export function getHolidaysForYear(year) {
  return [
    { date: `${year}-01-01`, name: "New Year's Day" },
    { date: formatYmd(getMemorialDay(year)), name: "Memorial Day" },
    { date: `${year}-07-04`, name: "Independence Day" },
    { date: formatYmd(getLaborDay(year)), name: "Labor Day" },
    { date: formatYmd(getThanksgiving(year)), name: "Thanksgiving" },
    { date: `${year}-12-25`, name: "Christmas" },
  ];
}

/**
 * Check if a date is a US federal holiday
 * @param {string} ymd - Date in YYYY-MM-DD format
 * @returns {{isHoliday: boolean, name: string|null}}
 */
export function isHoliday(ymd) {
  const year = parseInt(ymd.split("-")[0], 10);
  const holidays = getHolidaysForYear(year);
  const found = holidays.find((h) => h.date === ymd);
  return { isHoliday: !!found, name: found?.name || null };
}

/**
 * Get holidays within a date range
 * @param {string} startYmd - Start date YYYY-MM-DD
 * @param {string} endYmd - End date YYYY-MM-DD
 * @returns {Array<{date: string, name: string}>}
 */
export function getHolidaysInRange(startYmd, endYmd) {
  const startYear = parseInt(startYmd.split("-")[0], 10);
  const endYear = parseInt(endYmd.split("-")[0], 10);
  const allHolidays = [];
  
  for (let y = startYear; y <= endYear; y++) {
    allHolidays.push(...getHolidaysForYear(y));
  }
  
  return allHolidays.filter((h) => h.date >= startYmd && h.date <= endYmd);
}
