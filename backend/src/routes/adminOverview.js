const express = require('express');
const db = require('../db');
const { evaluateLoanMetrics } = require('../util');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-admin-overview   (requires Authorization: Bearer <token>, Library Assistant only)
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const loanRows = db.prepare(`SELECT * FROM library_loans WHERE status = 'ACTIVE'`).all();
  const activeLoans = loanRows.map(l => {
    const borrower = db.prepare('SELECT name, estate_branch FROM library_accounts WHERE user_id = ?').get(l.user_id);
    const metrics = evaluateLoanMetrics(l.borrowed_at);
    return {
      id: l.loan_id, copy_id: l.copy_id, book_title: l.book_title, branch: l.branch,
      borrowerName: borrower?.name || l.user_id, borrowerEstate: borrower?.estate_branch || '',
      daysElapsed: metrics.daysElapsed, overdue: metrics.status !== 'NORMAL',
    };
  });

  const resRows = db.prepare(`SELECT * FROM library_reservations`).all();
  const activeReservations = resRows.map(r => ({
    book_title: r.book_title, requesterName: r.requester_name, branch: r.branch, status: r.status,
  }));

  const totalMembers = db.prepare('SELECT COUNT(*) AS n FROM library_accounts').get().n;
  const pendingVerifications = db.prepare('SELECT COUNT(*) AS n FROM library_accounts WHERE verified = 0').get().n;

  res.json({ activeLoans, activeReservations, totalMembers, pendingVerifications });
});

module.exports = router;
