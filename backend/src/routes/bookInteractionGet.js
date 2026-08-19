const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-book-interaction-get  (requireAuth)
// Body: { titleId }
router.post('/', requireAuth, (req, res) => {
  const { titleId } = req.body || {};
  const userId = req.account.userId;

  if (!titleId) {
    return res.status(400).json({ success: false, message: 'titleId is required.' });
  }

  const mine = db.prepare('SELECT * FROM library_book_interactions WHERE user_id = ? AND title_id = ?').get(userId, titleId);
  const agg = db.prepare('SELECT AVG(rating) AS avg, COUNT(rating) AS cnt FROM library_book_interactions WHERE title_id = ? AND rating IS NOT NULL').get(titleId);

  res.json({
    success: true,
    isRead: !!(mine && mine.is_read),
    myRating: mine ? mine.rating : null,
    averageRating: agg.avg ? Math.round(agg.avg * 10) / 10 : null,
    ratingCount: agg.cnt,
  });
});

module.exports = router;
