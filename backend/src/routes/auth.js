const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { safeEqual } = require('../util');

const router = express.Router();

// POST /webhook/library-auth
// Body: { userId, passcodeHash, requestedAt }
router.post('/', (req, res) => {
  const { userId, passcodeHash } = req.body || {};
  if (!userId || !passcodeHash) {
    return res.status(400).json({ authenticated: false, message: 'Missing credentials.' });
  }

  const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  if (!account) {
    return res.json({ authenticated: false, message: 'No account found for that email or phone number.' });
  }
  if (!account.verified) {
    return res.json({ unverified: true, userId, message: 'This account has not been verified yet.' });
  }
  if (!safeEqual(passcodeHash, account.passcode_hash)) {
    return res.json({ authenticated: false, message: 'Incorrect PIN.' });
  }

  const user = {
    userId: account.user_id,
    name: account.name,
    estateBranch: account.estate_branch,
    accountType: account.account_type,
  };
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });

  res.json({ authenticated: true, user, token });
});

module.exports = router;
