const cron = require('node-cron');
const db = require('./db');
const { evaluateLoanMetrics } = require('./util');
const { sendMail } = require('./email');

const DUE_AFTER_DAYS = 21; // matches the fine logic in util.js

// Runs once a day at 08:00 server time. Emails anyone whose loan is
// either 2 days from the due date, or already overdue — using the same
// evaluateLoanMetrics() math the dashboard and admin overview use, so the
// numbers a person sees in their inbox always match what's on-screen.
// Accounts with no email on file (very old rows, if any) are skipped
// rather than erroring the whole run.
function startReminderCron() {
  cron.schedule('0 8 * * *', async () => {
    let sent = 0, skipped = 0;
    try {
      const activeLoans = db.prepare(`SELECT * FROM library_loans WHERE status = 'ACTIVE'`).all();

      for (const loan of activeLoans) {
        const metrics = evaluateLoanMetrics(loan.borrowed_at);
        const daysUntilDue = DUE_AFTER_DAYS - metrics.daysElapsed;
        const isDueSoon = daysUntilDue === 2;
        const isOverdue = metrics.status === 'OVERDUE' || metrics.status === 'SUSPENDED';
        if (!isDueSoon && !isOverdue) continue;

        const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(loan.user_id);
        if (!account || !account.work_email) { skipped++; continue; }

        const subject = isOverdue ? `Overdue: ${loan.book_title}` : `Due in 2 days: ${loan.book_title}`;
        const text = isOverdue
          ? `Hi ${account.name},\n\n"${loan.book_title}" is ${metrics.daysElapsed - DUE_AFTER_DAYS} day(s) overdue. Current fine: KSH ${metrics.fine}. Please return it as soon as you can.\n\nThe Unity Shelf`
          : `Hi ${account.name},\n\n"${loan.book_title}" is due back in 2 days. Return it by then to avoid a KSH 50/day fine.\n\nThe Unity Shelf`;

        const ok = await sendMail({ to: account.work_email, subject, text });
        if (ok) sent++; else skipped++;
      }
      console.log(`[cron] loan reminders: ${sent} sent, ${skipped} skipped (${activeLoans.length} active loans checked).`);
    } catch (err) {
      console.error('[cron] reminder run failed:', err.message);
    }
  });
  console.log('Unity Shelf: daily loan-reminder cron scheduled for 08:00.');
}

module.exports = { startReminderCron };
