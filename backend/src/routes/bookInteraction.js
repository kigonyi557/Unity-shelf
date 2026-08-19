const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-book-interaction  (requireAuth)
// Body: { titleId, isRead?, rating? } — partial update; whichever fields
// are provided get changed, the other stays as it was (or defaults to
// unread / no rating on first interaction with a title).
router.post('/', requireAuth, (req, res) => {
  const { titleId, isRead, rating } = req.body || {};
  const userId = req.account.userId;

  if (!titleId) {
    return res.status(400).json({ success: false, message: 'titleId is required.' });
  }
  if (rating !== undefined && rating !== null && (rating < 1 || rating > 5)) {
    return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
  }

  const existing = db.prepare('SELECT * FROM library_book_interactions WHERE user_id = ? AND title_id = ?').get(userId, titleId);
  const nextIsRead = isRead !== undefined ? (isRead ? 1 : 0) : (existing ? existing.is_read : 0);
  const nextRating = rating !== undefined ? rating : (existing ? existing.rating : null);

  db.prepare(`
    INSERT INTO library_book_interactions (user_id, title_id, is_read, rating, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, title_id) DO UPDATE SET is_read=excluded.is_read, rating=excluded.rating, updated_at=excluded.updated_at
  `).run(userId, titleId, nextIsRead, nextRating, new Date().toISOString());

  const agg = db.prepare('SELECT AVG(rating) AS avg, COUNT(rating) AS cnt FROM library_book_interactions WHERE title_id = ? AND rating IS NOT NULL').get(titleId);

  res.json({
    success: true,
    isRead: !!nextIsRead,
    myRating: nextRating,
    averageRating: agg.avg ? Math.round(agg.avg * 10) / 10 : null,
    ratingCount: agg.cnt,
  });
});

module.exports = router;
