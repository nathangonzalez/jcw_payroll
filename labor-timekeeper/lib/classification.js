/**
 * Employee Classification Utilities
 * Splits employees into admin (salaried) vs hourly categories
 * Handles overtime calculation for hourly employees
 */

// Admin employees (salaried, no OT)
const ADMIN_NAMES = ["Chris Jacobi", "Chris Z", "Chris Zavesky"];

/**
 * Check if employee is classified as admin/salaried
 * @param {string} employeeName - Employee name
 * @returns {boolean}
 */
export function isAdmin(employeeName) {
  const normalized = employeeName.toLowerCase().trim();
  return ADMIN_NAMES.some((name) => normalized === name.toLowerCase());
}

/**
 * Get employee category
 * @param {string} employeeName - Employee name
 * @returns {"admin" | "hourly"}
 */
export function getEmployeeCategory(employeeName) {
  return isAdmin(employeeName) ? "admin" : "hourly";
}

/**
 * Calculate pay with overtime for hourly employees
 * OT applies after 40 hours/week at 1.5x rate
 * @param {number} weeklyHours - Total hours for the week
 * @param {number} rate - Base hourly rate
 * @param {string} category - "admin" or "hourly"
 * @returns {{regularHours: number, otHours: number, regularPay: number, otPay: number, totalPay: number}}
 */
export function calculatePayWithOT(weeklyHours, rate, category) {
  // Admins: no overtime calculation, straight pay
  if (category === "admin") {
    return {
      regularHours: weeklyHours,
      otHours: 0,
      regularPay: round2(weeklyHours * rate),
      otPay: 0,
      totalPay: round2(weeklyHours * rate),
    };
  }

  // Hourly: OT after 40 hours at 1.5x
  const OT_THRESHOLD = 40;
  const OT_MULTIPLIER = 1.5;

  const regularHours = Math.min(weeklyHours, OT_THRESHOLD);
  const otHours = Math.max(0, weeklyHours - OT_THRESHOLD);
  const regularPay = round2(regularHours * rate);
  const otPay = round2(otHours * rate * OT_MULTIPLIER);
  const totalPay = round2(regularPay + otPay);

  return { regularHours, otHours, regularPay, otPay, totalPay };
}

/**
 * Split entries into regular and overtime portions
 * For weekly breakdown by day
 * @param {Array} entries - Array of {hours, rate} objects sorted by date
 * @param {string} category - "admin" or "hourly"
 * @returns {Array} Entries with added type field ("Regular" or "OT")
 */
export function splitEntriesWithOT(entries, category) {
  if (category === "admin") {
    // Admin: all regular
    return entries.map((e) => ({ ...e, type: "Regular" }));
  }

  // Hourly: track cumulative hours, mark OT after 40
  const OT_THRESHOLD = 40;
  let cumulative = 0;
  const result = [];

  for (const entry of entries) {
    const hours = Number(entry.hours);
    const beforeThis = cumulative;
    cumulative += hours;

    if (beforeThis >= OT_THRESHOLD) {
      // All OT
      result.push({ ...entry, type: "OT", hours });
    } else if (cumulative <= OT_THRESHOLD) {
      // All regular
      result.push({ ...entry, type: "Regular", hours });
    } else {
      // Split: some regular, some OT
      const regularPortion = OT_THRESHOLD - beforeThis;
      const otPortion = hours - regularPortion;
      if (regularPortion > 0) {
        result.push({ ...entry, type: "Regular", hours: regularPortion });
      }
      if (otPortion > 0) {
        result.push({ ...entry, type: "OT", hours: otPortion });
      }
    }
  }

  return result;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
