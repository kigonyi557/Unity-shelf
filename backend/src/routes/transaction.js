const express = require('express');
const db = require('../db');
const { evaluateLoanMetrics } = require('../util');
const { requireAuth } = require('../middleware/auth');
const { sendMail } = require('../email');

const router = express.Router();
const HOLD_HOURS = 48; // how long a promoted reservation stays claimable before it's fair game again

// POST /webhook/library-update   (requires Authorization: Bearer <token>)
// Body: { event: 'BOOK_BORROWED' | 'BOOK_RETURNED', timestamp, user, data }
router.post('/', requireAuth, (req, res) => {
  const { event, data } = req.body || {};
  if (event === 'BOOK_BORROWED') return handleBorrow(req, res, data || {});
  if (event === 'BOOK_RETURNED') return handleReturn(req, res, data || {});
  res.status(400).json({ success: false, message: 'Unknown event.' });
});

function handleBorrow(req, res, data) {
  const userId = req.account.userId;
  const { copyId, titleId, title, branch, loanId, borrowedAt } = data;

  // Block borrowing if this account already has a suspended (35+ day
  // overdue) loan outstanding — mirrors the front end's own check, done
  // again server-side since the client can't be trusted to enforce it.
  const activeLoans = db.prepare(`SELECT * FROM library_loans WHERE user_id = ? AND status = 'ACTIVE'`).all(userId);
  if (activeLoans.some(l => evaluateLoanMetrics(l.borrowed_at).lockAccount)) {
    return res.status(409).json({ success: false, message: 'Account locked — please clear your overdue fine balance first.' });
  }

  const copy = db.prepare('SELECT * FROM library_copies WHERE copy_id = ?').get(copyId);
  if (!copy) return res.status(409).json({ success: false, message: 'That copy no longer exists.' });

  const readyReservation = db.prepare(`
    SELECT * FROM library_reservations WHERE user_id = ? AND title_id = ? AND branch = ? AND status = 'READY' AND copy_id = ?
  `).get(userId, titleId, branch, copyId);

  const borrowable = copy.status === 'AVAILABLE' || (copy.status === 'RESERVED' && readyReservation);
  if (!borrowable) {
    return res.status(409).json({ success: false, message: 'That copy is no longer available.' });
  }

  db.prepare('UPDATE library_copies SET status = ? WHERE copy_id = ?').run('ON_LOAN', copyId);
  db.prepare(`
    INSERT INTO library_loans (loan_id, copy_id, title_id, book_title, branch, user_id, borrowed_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(loanId, copyId, titleId, title, branch, userId, borrowedAt);

  if (readyReservation) {
    db.prepare('DELETE FROM library_reservations WHERE reservation_id = ?').run(readyReservation.reservation_id);
  }

  res.json({ success: true });
}

function handleReturn(req, res, data) {
  const { copyId, loanId, returnedAt } = data;

  const loan = db.prepare('SELECT * FROM library_loans WHERE loan_id = ?').get(loanId);
  if (!loan) return res.status(404).json({ success: false, message: 'Loan record not found.' });

  db.prepare(`UPDATE library_loans SET status = 'RETURNED', return_date = ? WHERE loan_id = ?`).run(returnedAt, loanId);

  // If someone's waiting for this exact title+branch, promote the oldest
  // waiting reservation to READY and hold this specific copy for them
  // instead of releasing it back to general availability.
  const nextWaiting = db.prepare(`
    SELECT * FROM library_reservations WHERE title_id = ? AND branch = ? AND status = 'WAITING'
    ORDER BY created_at ASC LIMIT 1
  `).get(loan.title_id, loan.branch);

  if (nextWaiting) {
    const readyAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + HOLD_HOURS * 3600000).toISOString();
    db.prepare(`
      UPDATE library_reservations SET status = 'READY', copy_id = ?, ready_at = ?, expires_at = ? WHERE reservation_id = ?
    `).run(copyId, readyAt, expiresAt, nextWaiting.reservation_id);
    db.prepare('UPDATE library_copies SET status = ? WHERE copy_id = ?').run('RESERVED', copyId);

    // Best-effort notification — a failed send shouldn't roll back the
    // return itself, so this isn't awaited into the response path.
    const account = db.prepare('SELECT name, work_email FROM library_accounts WHERE user_id = ?').get(nextWaiting.user_id);
    if (account?.work_email) {
      sendMail({
        to: account.work_email,
        subject: `Ready for pickup: ${loan.book_title}`,
        text: `Hi ${account.name},\n\nGood news — "${loan.book_title}" is ready for pickup at ${loan.branch}.\n\nIt's being held for you until ${new Date(expiresAt).toLocaleString()}. After that it goes back to general availability, so please pick it up before then.\n\nThe Unity Shelf`,
      }).catch(() => {});
    }
  } else {
    db.prepare('UPDATE library_copies SET status = ? WHERE copy_id = ?').run('AVAILABLE', copyId);
  }

  res.json({ success: true });
}

module.exports = router;
