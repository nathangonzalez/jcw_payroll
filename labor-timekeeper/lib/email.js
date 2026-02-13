/**
 * Email utility for sending reports
 * 
 * Supports Gmail SMTP or any SMTP provider
 * 
 * Environment variables:
 *   SMTP_HOST - SMTP server (default: smtp.gmail.com)
 *   SMTP_PORT - SMTP port (default: 587)
 *   SMTP_USER - Email address to send from
 *   SMTP_PASS - App password (for Gmail, use App Password, not account password)
 *   EMAIL_TO - Default recipient(s), comma-separated
 */

import nodemailer from 'nodemailer';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000; // 2s, 4s, 8s exponential backoff

/**
 * Create a fresh SMTP transporter (no connection pooling to avoid stale connections)
 */
function createTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  
  if (!user || !pass) {
    throw new Error('SMTP_USER and SMTP_PASS environment variables required for email');
  }
  
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    pool: false,              // Fresh connection each time (avoids 421 stale conn)
    connectionTimeout: 10000, // 10s connection timeout
    greetingTimeout: 10000,   // 10s EHLO timeout
    socketTimeout: 30000,     // 30s socket timeout
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send an email with optional attachments. Retries up to 3 times with exponential backoff
 * to handle Gmail SMTP 421-4.7.0 rate limiting from App Engine shared IPs.
 * @param {Object} options
 * @param {string} options.to - Recipient email(s), comma-separated
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text body
 * @param {string} [options.html] - HTML body (optional)
 * @param {Array} [options.attachments] - Array of { filename, path } or { filename, content }
 * @returns {Promise<Object>} - Nodemailer send result
 */
export async function sendEmail({ to, subject, text, html, attachments = [] }) {
  const from = process.env.SMTP_USER;
  
  const mailOptions = {
    from,
    to,
    subject,
    text,
    html,
    attachments,
  };
  
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const transport = createTransporter();
      const result = await transport.sendMail(mailOptions);
      console.log(`[email] Sent to ${to}: ${subject} (attempt ${attempt})`);
      try { transport.close(); } catch (_) {}
      return result;
    } catch (err) {
      lastError = err;
      const errMsg = err?.message || String(err);
      console.warn(`[email] Attempt ${attempt}/${MAX_RETRIES} failed: ${errMsg}`);
      
      // Only retry on transient errors (421, ECONNRESET, ETIMEDOUT)
      const isTransient = /421|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up/i.test(errMsg);
      if (!isTransient || attempt === MAX_RETRIES) break;
      
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[email] Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Send a monthly report via email
 * @param {Object} options
 * @param {string} options.month - Month in YYYY-MM format
 * @param {string} options.filepath - Path to the XLSX file
 * @param {string} options.filename - Name of the file
 * @param {Object} options.totals - Totals from the report
 * @param {string} [options.to] - Override recipient (defaults to EMAIL_TO env var)
 */
export async function sendMonthlyReport({ month, filepath, filename, totals, to }) {
  const recipient = to || process.env.EMAIL_TO;
  if (!recipient) {
    throw new Error('No recipient specified and EMAIL_TO not set');
  }
  
  const subject = `Payroll Breakdown - ${month}`;
  const text = `Monthly Payroll Breakdown for ${month}

Customers: ${totals.customers}
Hourly Total: $${totals.hourlyTotal.toLocaleString()}
Admin Total: $${totals.adminTotal.toLocaleString()}
Grand Total: $${totals.grandTotal.toLocaleString()}

See attached XLSX file for details.
`;

  const html = `
<h2>Monthly Payroll Breakdown - ${month}</h2>
<table style="border-collapse: collapse; font-family: Arial, sans-serif;">
  <tr><td style="padding: 4px 12px; border: 1px solid #ddd;"><strong>Customers</strong></td><td style="padding: 4px 12px; border: 1px solid #ddd;">${totals.customers}</td></tr>
  <tr><td style="padding: 4px 12px; border: 1px solid #ddd;"><strong>Hourly Total</strong></td><td style="padding: 4px 12px; border: 1px solid #ddd;">$${totals.hourlyTotal.toLocaleString()}</td></tr>
  <tr><td style="padding: 4px 12px; border: 1px solid #ddd;"><strong>Admin Total</strong></td><td style="padding: 4px 12px; border: 1px solid #ddd;">$${totals.adminTotal.toLocaleString()}</td></tr>
  <tr style="background: #e8f4e8;"><td style="padding: 4px 12px; border: 1px solid #ddd;"><strong>Grand Total</strong></td><td style="padding: 4px 12px; border: 1px solid #ddd;"><strong>$${totals.grandTotal.toLocaleString()}</strong></td></tr>
</table>
<p>See attached XLSX file for details.</p>
`;

  return sendEmail({
    to: recipient,
    subject,
    text,
    html,
    attachments: [{ filename, path: filepath }],
  });
}

export default { sendEmail, sendMonthlyReport };
