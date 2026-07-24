const express = require('express');
const db = require('../db');
const { safeEqual } = require('../util');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-change-pin  (requires Authorization: Bearer <token>)
router.post('/', requireAuth, (req, res) => {
  const { userId, currentPasscodeHash, newPasscodeHash } = req.body || {};

  if (req.account.userId !== userId) {
    return res.status(403).json({ success: false, message: 'You can only change your own PIN.' });
  }

  const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  if (!account) return res.status(404).json({ success: false, message: 'Account not found.' });

  if (!safeEqual(currentPasscodeHash, account.passcode_hash)) {
    return res.status(400).json({ success: false, message: 'Current PIN is incorrect.' });
  }

  db.prepare('UPDATE library_accounts SET passcode_hash = ? WHERE user_id = ?').run(newPasscodeHash, userId);
  res.json({ success: true });
});

module.exports = router;
