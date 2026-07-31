const crypto = require('crypto');

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function genVerificationCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Mirrors the front end's evaluateLoanMetrics() exactly — 21-day free
// period, then KSH 50/day, and the account locks once it's been overdue
// (past the 21 days) for 14+ more days (35 days total from borrowing).
function evaluateLoanMetrics(borrowedAtStr, asOf = new Date()) {
  const borrowDate = new Date(borrowedAtStr);
  const daysElapsed = Math.floor((asOf - borrowDate) / 86400000);

  let status = 'NORMAL';
  let fine = 0;
  let lockAccount = false;

  if (daysElapsed > 21) {
    status = 'OVERDUE';
    fine = (daysElapsed - 21) * 50;
    if ((daysElapsed - 21) >= 14) {
      lockAccount = true;
      status = 'SUSPENDED';
    }
  }
  return { daysElapsed, status, fine, lockAccount };
}

// Constant-time comparison for the salted PIN hash — avoids leaking match
// info via response timing, even though the values being compared are
// already hashes rather than raw secrets.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { genId, genVerificationCode, sha256Hex, evaluateLoanMetrics, safeEqual };
