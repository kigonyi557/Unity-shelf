const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/library.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  -- Accounts: userId is either a work email (Staff / Library Assistant)
  -- or a phone number (Resident). passcode_hash is stored EXACTLY as the
  -- front end computes it client-side — sha256(userId + '::' + pin) — so
  -- the server never sees or stores a raw PIN, only that pre-salted hash.
  CREATE TABLE IF NOT EXISTS library_accounts (
    user_id           TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    account_type      TEXT NOT NULL,  -- 'Resident' | 'Staff' | 'Library Assistant'
    estate_branch     TEXT,
    work_email        TEXT,
    unit_number       TEXT,
    phone             TEXT,
    date_of_birth     TEXT,
    is_adult          INTEGER,
    passcode_hash     TEXT NOT NULL,
    verified          INTEGER NOT NULL DEFAULT 0,
    registered_date   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS library_verification_codes (
    user_id       TEXT PRIMARY KEY,
    code_hash     TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS library_titles (
    title_id      TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    author        TEXT,
    reference_no  TEXT,      -- ISBN
    age_bracket   TEXT DEFAULT 'Adults',  -- 'Adults' | 'Kids'
    grade         TEXT
  );

  CREATE TABLE IF NOT EXISTS library_copies (
    copy_id     TEXT PRIMARY KEY,
    title_id    TEXT NOT NULL REFERENCES library_titles(title_id),
    branch      TEXT NOT NULL,  -- e.g. 'Unity West', 'Unity East', 'Unity Gardens'
    status      TEXT NOT NULL DEFAULT 'AVAILABLE'  -- AVAILABLE | ON_LOAN | RESERVED
  );

  CREATE TABLE IF NOT EXISTS library_loans (
    loan_id       TEXT PRIMARY KEY,
    copy_id       TEXT NOT NULL,
    title_id      TEXT NOT NULL,
    book_title    TEXT,
    branch        TEXT,
    user_id       TEXT NOT NULL,
    borrowed_at   TEXT NOT NULL,
    return_date   TEXT,
    status        TEXT NOT NULL DEFAULT 'ACTIVE'  -- ACTIVE | RETURNED
  );

  CREATE TABLE IF NOT EXISTS library_reservations (
    reservation_id  TEXT PRIMARY KEY,
    title_id        TEXT NOT NULL,
    book_title      TEXT,
    branch          TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    requester_name  TEXT,
    status          TEXT NOT NULL DEFAULT 'WAITING',  -- WAITING | READY
    copy_id         TEXT,          -- set once promoted to READY — the specific copy on hold
    created_at      TEXT NOT NULL,
    ready_at        TEXT,
    expires_at      TEXT
  );

  -- One row per (user, title): whether they've marked it read, and their
  -- own 1-5 star rating. Powers both the "Mark as Read" toggle and the
  -- community average rating shown in the book detail modal.
  CREATE TABLE IF NOT EXISTS library_book_interactions (
    user_id     TEXT NOT NULL,
    title_id    TEXT NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    rating      INTEGER,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, title_id)
  );

  CREATE INDEX IF NOT EXISTS idx_copies_title ON library_copies(title_id);
  CREATE INDEX IF NOT EXISTS idx_loans_status ON library_loans(status);
  CREATE INDEX IF NOT EXISTS idx_loans_user ON library_loans(user_id);
  CREATE INDEX IF NOT EXISTS idx_res_title ON library_reservations(title_id, branch);
  CREATE INDEX IF NOT EXISTS idx_res_user ON library_reservations(user_id);
  CREATE INDEX IF NOT EXISTS idx_interactions_title ON library_book_interactions(title_id);
`);

// Runtime migration: databases created before date_of_birth existed (e.g.
// the already-live production DB) won't have this column yet — CREATE
// TABLE IF NOT EXISTS above only affects brand-new databases. Add it here
// if missing, so existing accounts and data are preserved.
const accountColumns = db.prepare(`PRAGMA table_info(library_accounts)`).all();
if (!accountColumns.some(c => c.name === 'date_of_birth')) {
  db.exec(`ALTER TABLE library_accounts ADD COLUMN date_of_birth TEXT`);
}
if (!accountColumns.some(c => c.name === 'is_adult')) {
  db.exec(`ALTER TABLE library_accounts ADD COLUMN is_adult INTEGER`);
}
// Default-PIN login flow: accounts start with a server-generated PIN and
// must be forced to set their own password on first successful login.
if (!accountColumns.some(c => c.name === 'must_change_password')) {
  db.exec(`ALTER TABLE library_accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
}

module.exports = db;
