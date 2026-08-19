const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-all-users  (requireAuth, Library Assistant only)
// Returns every registered account (never the passcode hash) plus a quick
// active-loan count per user, for the admin "All Registered Users" table.
router.post('/', requireAuth, requireAdmin, (req, res) => {
    const accounts = db.prepare(`
    SELECT user_id, name, account_type, estate_branch, work_email, unit_number, phone,
           is_adult, verified, must_change_password, registered_date
    FROM library_accounts
    ORDER BY registered_date DESC
  `).all();

    const activeLoanCounts = db.prepare(`
    SELECT user_id, COUNT(*) AS cnt FROM library_loans WHERE status = 'ACTIVE' GROUP BY user_id
  `).all();
    const loanCountMap = {};
    activeLoanCounts.forEach(r => { loanCountMap[r.user_id] = r.cnt; });

    const users = accounts.map(a => ({
        userId: a.user_id,
        name: a.name,
        accountType: a.account_type,
        estateBranch: a.estate_branch,
        email: a.work_email,
        unitNumber: a.unit_number,
        phone: a.phone,
        isAdult: !!a.is_adult,
        verified: !!a.verified,
        mustChangePassword: !!a.must_change_password,
        registeredDate: a.registered_date,
        activeLoans: loanCountMap[a.user_id] || 0,
    }));

    res.json({ success: true, users, totalUsers: users.length });
});

module.exports = router;