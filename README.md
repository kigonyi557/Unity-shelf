# Unity Shelf

A community library system for Unity Homes — real per-branch physical inventory,
PIN-based accounts with email verification, borrowing, reservations, fines, and
a Library Assistant admin desk.

```
unity-shelf/
  backend/     Node.js + Express + SQLite API — everything in this repo that runs on a server
  frontend/    Static site (index.html, app.js, styles.css) — everything served to the browser
```

## How it fits together

The front end in `frontend/` calls nine endpoints, all defined in `frontend/app.js`'s
`CONFIG` object. The backend in `backend/` implements every one of them at the
exact same path, so `CONFIG` only ever needs its **domain** changed, never the paths:

| Front end calls... | Backend route |
|---|---|
| `/webhook/library-auth` | Log in |
| `/webhook/library-registration` | Create account |
| `/webhook/library-verify-account` | Confirm the emailed verification code |
| `/webhook/library-change-pin` | Change PIN (requires login) |
| `/webhook/library-sync` | Pull the catalogue, your loans, your reservations, stats |
| `/webhook/library-update` | Borrow / return a book (requires login) |
| `/webhook/library-reserve` | Join a waitlist (requires login) |
| `/webhook/library-cancel-reservation` | Leave a waitlist (requires login) |
| `/webhook/library-admin-overview` | Library Assistant dashboard (requires login + that role) |

## Known limitation: resident verification has no SMS yet

Staff and Library Assistant accounts register with a real work email, so they
get a genuine emailed verification code. Residents register with a **phone
number only** — there's no SMS provider wired up, so there's no channel to
deliver a code to them. Resident accounts are currently **auto-verified** at
registration so they aren't blocked from using the system. When you're ready
to add real SMS verification for residents, look at `backend/src/routes/register.js`
— the `willAutoVerify` flag is exactly where that logic lives, and Africa's
Talking or Twilio are the usual choices for SMS in Kenya.

## Local setup

```bash
cd backend
npm install
cp .env.example .env
```

Fill in `.env`:
- `JWT_SECRET` — `openssl rand -hex 32`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` — your email provider's settings (Gmail App Password works fine — same setup as before)
- `ALLOWED_ORIGINS` — leave blank for local testing

Then:
```bash
npm run seed    # loads sample titles/copies + 3 ready-to-use test accounts (see terminal output for their emails/phone — all use PIN 1234)
npm start
```

Open `frontend/index.html` directly in a real browser tab (not a preview panel) — it's already pointed at `http://localhost:3000`, which matches the backend's default port.

## Putting this on GitHub

```bash
cd unity-shelf
git init
git add .
git commit -m "Unity Shelf — initial commit"
```

Then create a new empty repository on **github.com** (no README/license, so it stays empty), and:
```bash
git remote add origin https://github.com/YOUR-USERNAME/unity-shelf.git
git branch -M main
git push -u origin main
```

`.gitignore` already keeps `node_modules/`, `.env`, and the SQLite database file out of the repo — those never get committed, by design.

## Deploying for real

**Backend** — GitHub itself can't run a live Node process, so connect the repo to a real host:
1. Sign up at **railway.app** (or render.com), connect your GitHub account.
2. New Project → Deploy from GitHub repo → pick `unity-shelf` → set the **root directory** to `backend`.
3. In the host's dashboard, paste in every value from your `.env` file as environment variables.
4. It builds and gives you a live HTTPS URL, e.g. `https://unity-shelf-backend.up.railway.app`.
5. **Add persistent storage** — most hosts wipe the filesystem on redeploy by default. Add a volume/disk mounted at wherever `DB_PATH` points, or your database resets every time you push new code.

**Frontend** — since it's just static files, GitHub Pages works well:
1. In the repo settings on GitHub → **Pages** → set source to the `frontend/` folder on the `main` branch.
2. GitHub gives you a URL like `https://YOUR-USERNAME.github.io/unity-shelf/`.
3. Edit `frontend/app.js`'s `CONFIG` object — replace every `http://localhost:3000` with your real Railway/Render backend URL.
4. Update the backend's `ALLOWED_ORIGINS` env var to that GitHub Pages URL, and redeploy the backend so it actually accepts requests from it.

## Testing checklist once live

- [ ] Register a resident, staff, and confirm the staff one gets a real verification email
- [ ] Log in as each of the 3 seeded test accounts (PIN `1234`)
- [ ] Borrow a book, confirm it shows on the dashboard with the right due-date math
- [ ] Return a book, confirm the fine calculation and that a waiting reservation gets promoted correctly
- [ ] Reserve a book with zero copies available, then have staff return one, confirm the reservation flips to "Ready for pickup"
- [ ] Log in as the Library Assistant account, confirm the admin overview shows real data and "Mark Returned" works
- [ ] Change your PIN, log out, log back in with the new one
