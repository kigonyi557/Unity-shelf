const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-user-detail  (requireAuth, Library Assistant only)
// Body: { userId }
// Returns one account's full profile plus its complete loan and
// reservation history — the "View" drill-down from the users directory.
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId is required.' });
  }

  const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  if (!account) {
    return res.status(404).json({ success: false, message: 'Account not found.' });
  }

  const loans = db.prepare('SELECT * FROM library_loans WHERE user_id = ? ORDER BY borrowed_at DESC').all(userId);
  const reservations = db.prepare('SELECT * FROM library_reservations WHERE user_id = ? ORDER BY created_at DESC').all(userId);

  res.json({
    success: true,
    user: {
      userId: account.user_id,
      name: account.name,
      accountType: account.account_type,
      estateBranch: account.estate_branch,
      email: account.work_email,
      unitNumber: account.unit_number,
      phone: account.phone,
      isAdult: !!account.is_adult,
      verified: !!account.verified,
      mustChangePassword: !!account.must_change_password,
      registeredDate: account.registered_date,
    },
    loans: loans.map(l => ({
      id: l.loan_id,
      bookTitle: l.book_title,
      branch: l.branch,
      borrowedAt: l.borrowed_at,
      returnDate: l.return_date,
      status: l.status,
    })),
    reservations: reservations.map(r => ({
      bookTitle: r.book_title,
      branch: r.branch,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

module.exports = router;
