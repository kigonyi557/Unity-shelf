// =========================================================================
// 1. APPLICATION SETUP AND ENDPOINTS
// =========================================================================
const CONFIG = {
    N8N_LOGIN_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-auth",
    N8N_REGISTER_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-registration",
    N8N_SYNC_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-sync",
    N8N_TRANSACTION_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-update",
    N8N_CHANGE_PIN_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-change-pin",
    N8N_VERIFY_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-verify-account",
    N8N_RESERVE_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-reserve",
    N8N_CANCEL_RESERVATION_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-cancel-reservation",
    N8N_ADMIN_OVERVIEW_WEBHOOK: "https://unity-shelf-production.up.railway.app/webhook/library-admin-overview",
    DATABASE_LOCAL_KEY: "unity_hub_circulation_state_v1"
};

// Fallback titles if system cannot connect to the network initially.
// Multi-copy model: each title has a `copies` array — one entry per
// physical copy, each tied to a branch (Unity West / Unity East / Unity
// Gardens are the branches with real inventory today).
const INITIAL_MOCK_TITLES = [
    {
        id: 't_1', title: 'The Lean Startup', author: 'Eric Ries', referenceNo: '9780307887894',
        ageBracket: 'Adults', grade: '',
        copies: [
            { copyId: 'c_1a', branch: 'Unity West', status: 'AVAILABLE' },
            { copyId: 'c_1b', branch: 'Unity East', status: 'ON_LOAN' }
        ]
    },
    {
        id: 't_2', title: 'Zero to One', author: 'Peter Thiel', referenceNo: '9780804139298',
        ageBracket: 'Adults', grade: '',
        copies: [
            { copyId: 'c_2a', branch: 'Unity Gardens', status: 'AVAILABLE' }
        ]
    },
    {
        id: 't_3', title: 'Atomic Habits', author: 'James Clear', referenceNo: '9781847941831',
        ageBracket: 'Adults', grade: '',
        copies: [
            { copyId: 'c_3a', branch: 'Unity West', status: 'ON_LOAN' },
            { copyId: 'c_3b', branch: 'Unity Gardens', status: 'ON_LOAN' }
        ]
    }
];

// Global application state
let AppState = {
    titles: [],
    loans: [],
    reservations: [],
    registeredUsers: [], 
    isAuthenticated: false,
    currentUser: null,
    authToken: null,
    offlineMode: false,
    stats: null
};

let activeCatalogFilter = 'ALL';
let activeCatalogQuery = '';
let heroSliderInterval = null;
let heroSliderIndex = 0;
// Large real inventories (800+ titles) shouldn't all render into the DOM
// at once — each subsection starts at CATALOG_PAGE_SIZE and grows via
// "Show More" rather than paginating server-side (titles are already all
// in memory from sync, so this is just a render-count limit).
const CATALOG_PAGE_SIZE = 12;
let catalogPageState = { Adults: CATALOG_PAGE_SIZE, Children: CATALOG_PAGE_SIZE };

// =========================================================================
// 2. DATA STORAGE AND CRYPTO HELPERS
// =========================================================================

// Converts text (like PIN codes) into a secure SHA-256 hash string
async function sha256Hex(text) {
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// SECURITY: salts the PIN with the account's own userId before hashing.
// Without this, every account on the default PIN (1234) produces the exact
// same PasscodeHash, so one rainbow-table lookup cracks every account at
// once. Salting per-user means each hash is unique even for identical PINs.
async function saltedPasscodeHash(userId, pin) {
    return sha256Hex(`${userId}::${pin}`);
}

// Loads system database state from local browser storage
function initStorageEngine() {
    const data = localStorage.getItem(CONFIG.DATABASE_LOCAL_KEY);
    let parsed = null;
    if (data) {
        try { parsed = JSON.parse(data); } catch (e) { parsed = null; }
    }

    // SCHEMA GUARD: cached state from an older version of this app (e.g.
    // pre-multi-copy, when titles were called "books" and had no `copies`
    // array) will crash every render function that expects the current
    // shape. Rather than trusting old localStorage blindly, validate it
    // looks like the current schema before restoring it — otherwise treat
    // it like a fresh install. This is what silently broke the catalog
    // view (blank white page) when testing across schema changes.
    const looksValid = parsed
        && Array.isArray(parsed.titles)
        && (parsed.titles.length === 0 || Array.isArray(parsed.titles[0]?.copies));

    if (!parsed || !looksValid) {
        AppState.titles = [...INITIAL_MOCK_TITLES];
        AppState.loans = [];
        AppState.registeredUsers = [];
        AppState.isAuthenticated = false;
        AppState.currentUser = null;
        AppState.offlineMode = false;
        AppState.stats = null;
        saveStateToStorage();
    } else {
        AppState = { offlineMode: false, ...parsed };
    }
    configureLayoutVisibility();
}

// Saves current memory state to local browser storage
function saveStateToStorage() {
    localStorage.setItem(CONFIG.DATABASE_LOCAL_KEY, JSON.stringify(AppState));
}

// Shows or hides user login names in the main header bar
function configureLayoutVisibility() {
    const navNode = document.getElementById('nav-user-info');
    const navName = document.getElementById('nav-user-name');
    const navBadge = document.getElementById('nav-user-badge');
    const navAdminLink = document.getElementById('nav-admin-link');

    if (AppState.isAuthenticated && AppState.currentUser) {
        if (navNode) navNode.style.display = 'flex';
        if (navName) navName.textContent = AppState.currentUser.name;
        if (navBadge) navBadge.textContent = `${AppState.currentUser.userId} · ${AppState.currentUser.estateBranch || ''}${AppState.offlineMode ? ' [OFFLINE]' : ''}`;
        if (navAdminLink) navAdminLink.style.display = AppState.currentUser.accountType === 'Library Assistant' ? 'flex' : 'none';
    } else {
        if (navNode) navNode.style.display = 'none';
    }
}

// =========================================================================
// 3. AUTHENTICATION & LOGIN PROCESSORS
// =========================================================================

// Builds the Authorization header for requests that require a logged-in
// session. Returns an empty object if there's no token yet (offline mode,
// or a request made before login) so callers can just spread it in.
function authHeaders() {
    return AppState.authToken ? { 'Authorization': `Bearer ${AppState.authToken}` } : {};
}

// Handles form submission when a user tries to log in
window.handleLoginAttempt = async function(event) {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const userIdInput = document.getElementById('signin-id').value.trim();
    const pinInput = document.getElementById('signin-pass').value.trim();

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Verifying..."; }

    try {
        const passcodeHash = await saltedPasscodeHash(userIdInput, pinInput);
        const loginPayload = { userId: userIdInput, passcodeHash, requestedAt: new Date().toISOString() };

        // Post login fields to the backend
        const response = await fetch(CONFIG.N8N_LOGIN_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginPayload)
        });
        const result = await response.json();

        if (response.ok && result.authenticated) {
            AppState.isAuthenticated = true;
            AppState.currentUser = result.user;
            AppState.authToken = result.token || null;
            AppState.offlineMode = false;
            saveStateToStorage();
            configureLayoutVisibility();
            showToast(`Welcome back, ${result.user.name}`);
            await fetchRemoteIndexData(); // Sync live sheets library records
            // Library Assistants land on the admin overview instead of
            // the resident-facing catalog — different job, different home screen.
            router.navigate(result.user.accountType === 'Library Assistant' ? 'admin' : 'catalog');
            return;
        }
        if (result.unverified) {
            showToast(`⚠️ ${result.message}`);
            switchAuthTab('verify');
            const verifyUserIdField = document.getElementById('verify-userid');
            const verifySubtitle = document.getElementById('verify-subtitle');
            if (verifyUserIdField) verifyUserIdField.value = result.userId || userIdInput;
            if (verifySubtitle) verifySubtitle.textContent = `Enter the code we sent to ${result.userId || userIdInput}`;
            return;
        }
        showToast(`❌ Login Failed: ${result.message || 'Check your entries.'}`);
    } catch (error) {
        console.warn("Network offline — processing verification via local cache.");
        const passcodeHash = await saltedPasscodeHash(userIdInput, pinInput);
        const userMatch = AppState.registeredUsers.find(u => u.userId === userIdInput && u.passcodeHash === passcodeHash);
        
        if (userMatch) {
            AppState.isAuthenticated = true;
            AppState.currentUser = { name: userMatch.name, userId: userMatch.userId, estateBranch: userMatch.estateBranch, accountType: userMatch.accountType };
            AppState.authToken = null; // no server, no token — protected routes simply won't work until back online
            AppState.offlineMode = true;
            saveStateToStorage();
            configureLayoutVisibility();
            showToast(`⚠️ Logged in securely using offline mode cache.`);
            router.navigate('catalog');
        } else {
            showToast("❌ Unable to connect to server. No local backup profile found.");
        }
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Log In"; }
    }
};

// Toggles which extra fields show on the registration form based on
// Account Type — Staff needs a work email, Residents need a Unit Number
// and phone. Only the visible set is marked `required` so the browser
// doesn't block submission on hidden fields.
window.toggleRegistrationFields = function(accountType) {
    const staffGroup = document.getElementById('staff-email-group');
    const unitGroup = document.getElementById('resident-unit-group');
    const phoneGroup = document.getElementById('resident-phone-group');
    const workEmailInput = document.getElementById('signup-work-email');
    const unitInput = document.getElementById('signup-unit');
    const phoneInput = document.getElementById('signup-phone');

    const isStaffLike = accountType === 'Staff' || accountType === 'Library Assistant';
    const isResident = accountType === 'Resident';

    if (staffGroup) staffGroup.style.display = isStaffLike ? 'flex' : 'none';
    if (unitGroup) unitGroup.style.display = isResident ? 'flex' : 'none';
    if (phoneGroup) phoneGroup.style.display = isResident ? 'flex' : 'none';

    if (workEmailInput) workEmailInput.required = isStaffLike;
    if (unitInput) unitInput.required = isResident;
    if (phoneInput) phoneInput.required = isResident;
};

// Handles form submission when creating a new user profile. Staff register
// with a work email (must match the company domain); residents register
// with a Unit Number (checked against the roster) and a phone number.
// Neither path uses National ID / Passport as a credential anymore.
window.handleRegistrationAttempt = async function(event) {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const estateInput = document.getElementById('signup-estate').value;
    const accountTypeInput = document.getElementById('signup-affiliation').value;
    const nameInput = document.getElementById('signup-name').value.trim();
    const dobInput = document.getElementById('signup-dob').value; // 'YYYY-MM-DD'
    const pinInput = "1234"; // Default security pin assigned initially

    if (!dobInput) {
        showToast('❌ Date of birth is required.');
        return;
    }
    if (new Date(dobInput) > new Date()) {
        showToast('❌ Date of birth cannot be in the future.');
        return;
    }

    const isStaffLike = accountTypeInput === 'Staff' || accountTypeInput === 'Library Assistant';
    let userIdInput = '';
    let workEmailInput = '';
    let unitInput = '';
    let phoneInput = '';

    if (isStaffLike) {
        workEmailInput = document.getElementById('signup-work-email').value.trim().toLowerCase();
        if (!workEmailInput.endsWith('@unityhomes.co.ke')) {
            showToast(`❌ ${accountTypeInput} accounts require a work email ending in @unityhomes.co.ke.`);
            return;
        }
        userIdInput = workEmailInput;
    } else {
        unitInput = document.getElementById('signup-unit').value.trim();
        phoneInput = document.getElementById('signup-phone').value.trim();
        userIdInput = phoneInput;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving..."; }

    try {
        const passcodeHash = await saltedPasscodeHash(userIdInput, pinInput);
        const registrationPayload = {
            name: nameInput, estateBranch: estateInput, accountType: accountTypeInput, passcodeHash,
            workEmail: workEmailInput, unitNumber: unitInput, phone: phoneInput, dateOfBirth: dobInput,
            registeredAt: new Date().toISOString()
        };

        // Post registration fields to n8n database sheet writer
        const response = await fetch(CONFIG.N8N_REGISTER_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(registrationPayload)
        });
        const result = await response.json();

        if (response.ok && result.success) {
            AppState.registeredUsers.push({ name: nameInput, userId: userIdInput, estateBranch: estateInput, accountType: accountTypeInput, passcodeHash, dateOfBirth: dobInput });
            saveStateToStorage();
            showToast(`🎉 ${result.message || 'Account created.'}`);
            switchAuthTab('verify');
            const verifyUserIdField = document.getElementById('verify-userid');
            const verifySubtitle = document.getElementById('verify-subtitle');
            if (verifyUserIdField) verifyUserIdField.value = result.userId || userIdInput;
            if (verifySubtitle) verifySubtitle.textContent = `Enter the code we sent to ${result.userId || userIdInput}`;
        } else {
            showToast(`❌ Registration Error: ${result.message || 'Server rejected creation.'}`);
        }
    } catch (error) {
        const keyCollision = AppState.registeredUsers.some(u => u.userId === userIdInput);
        if (keyCollision) {
            showToast("❌ An account already exists for that email/phone inside local memory cache.");
        } else {
            const passcodeHash = await saltedPasscodeHash(userIdInput, pinInput);
            AppState.registeredUsers.push({ name: nameInput, userId: userIdInput, estateBranch: estateInput, accountType: accountTypeInput, passcodeHash, dateOfBirth: dobInput });
            saveStateToStorage();
            showToast(`⚠️ Network unavailable: Saved profile to local cache. You'll need to verify once back online.`);
        }
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Register Account"; }
    }
};

// Handles the verification-code form (shown right after registration, or
// when a login attempt comes back unverified). Confirms the code the
// person received by email/SMS and unlocks their account for login.
window.handleVerifyAccount = async function(event) {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const userId = document.getElementById('verify-userid').value.trim();
    const code = document.getElementById('verify-code').value.trim();

    if (!userId) {
        showToast("❌ Missing account reference — please register or log in again.");
        return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Verifying..."; }

    try {
        const response = await fetch(CONFIG.N8N_VERIFY_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, code })
        });
        const result = await response.json();

        if (response.ok && result.success) {
            showToast("✅ Account verified — you can now log in.");
            switchAuthTab('login');
            document.getElementById('signin-id').value = userId;
        } else {
            showToast(`❌ ${result.message || 'Verification failed.'}`);
        }
    } catch (error) {
        showToast("❌ Network unavailable — verification requires a connection.");
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Verify"; }
    }
};

// Handles the "Change PIN" form — requires the correct current PIN before
// a new one is accepted. Requires network; there is no offline path for
// changing a credential, since the offline cache would then disagree with
// the server about what's valid.
window.handleChangePinAttempt = async function(event) {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const currentPinInput = document.getElementById('changepin-current').value.trim();
    const newPinInput = document.getElementById('changepin-new').value.trim();
    const confirmPinInput = document.getElementById('changepin-confirm').value.trim();

    if (newPinInput.length < 4) {
        showToast("❌ New PIN must be at least 4 characters.");
        return;
    }
    if (newPinInput !== confirmPinInput) {
        showToast("❌ New PIN and confirmation do not match.");
        return;
    }
    if (newPinInput === "1234") {
        showToast("❌ Please choose something other than the default PIN.");
        return;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Updating..."; }

    try {
        const userId = AppState.currentUser.userId;
        const currentPasscodeHash = await saltedPasscodeHash(userId, currentPinInput);
        const newPasscodeHash = await saltedPasscodeHash(userId, newPinInput);

        const response = await fetch(CONFIG.N8N_CHANGE_PIN_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ userId, currentPasscodeHash, newPasscodeHash })
        });
        const result = await response.json();

        if (response.ok && result.success) {
            const cachedIdx = AppState.registeredUsers.findIndex(u => u.userId === userId);
            if (cachedIdx !== -1) AppState.registeredUsers[cachedIdx].passcodeHash = newPasscodeHash;
            saveStateToStorage();
            showToast("✅ PIN updated successfully.");
            router.navigate('dashboard');
        } else {
            showToast(`❌ ${result.message || 'Could not update PIN.'}`);
        }
    } catch (error) {
        showToast("❌ Network unavailable — PIN changes require a connection.");
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Update PIN"; }
    }
};

// Logs out user session safely
window.handleLogout = function() {
    AppState.isAuthenticated = false;
    AppState.currentUser = null;
    AppState.authToken = null;
    AppState.offlineMode = false;
    saveStateToStorage();
    configureLayoutVisibility();
    showToast("Session closed successfully.");
    router.navigate('login');
};

// =========================================================================
// 3a2. USER ACCOUNT DROPDOWN MENU
// =========================================================================

window.toggleUserMenu = function(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('user-menu');
    if (!menu) return;
    menu.classList.toggle('open');
};

window.closeUserMenu = function() {
    const menu = document.getElementById('user-menu');
    if (menu) menu.classList.remove('open');
};

// Close the dropdown on outside click or Escape — standard menu behavior.
document.addEventListener('click', (e) => {
    const menu = document.getElementById('user-menu');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target)) {
        menu.classList.remove('open');
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeUserMenu();
});

// =========================================================================
// 3b. COMBINED LOGIN / REGISTER TOGGLE CARD
// =========================================================================

// Switches between the Log In, Create Account, and Verify panels with a
// cross-fade and a sliding pill indicator (for the login/register pair),
// animating the card's height to match whichever panel is now showing.
// 'verify' is a transitional state reached from either tab, not a tab
// itself — the tab switcher hides while it's active.
window.switchAuthTab = function(mode) {
    const panelsContainer = document.getElementById('auth-panels');
    const switcher = document.getElementById('auth-tab-switcher');
    const loginPanel = document.getElementById('panel-login');
    const registerPanel = document.getElementById('panel-register');
    const verifyPanel = document.getElementById('panel-verify');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    if (!panelsContainer || !loginPanel || !registerPanel || !verifyPanel) return;

    const panelByMode = { login: loginPanel, register: registerPanel, verify: verifyPanel };
    const target = panelByMode[mode] || loginPanel;

    [loginPanel, registerPanel, verifyPanel].forEach(p => p.classList.toggle('active', p === target));

    if (switcher) {
        switcher.style.display = mode === 'verify' ? 'none' : 'flex';
        switcher.classList.toggle('mode-register', mode === 'register');
    }
    if (tabLogin) tabLogin.classList.toggle('active', mode === 'login');
    if (tabRegister) tabRegister.classList.toggle('active', mode === 'register');

    // Animate the container height to the incoming panel's natural height.
    requestAnimationFrame(() => {
        panelsContainer.style.height = target.scrollHeight + 'px';
    });
};

// Sets the initial height of the toggle card when the login view first mounts
// (panels are absolutely positioned, so the container needs an explicit
// starting height rather than shrinking to fit its content automatically).
function initAuthToggleCard() {
    const panelsContainer = document.getElementById('auth-panels');
    const loginPanel = document.getElementById('panel-login');
    if (!panelsContainer || !loginPanel) return;
    panelsContainer.style.height = loginPanel.scrollHeight + 'px';
}

// =========================================================================
// 4. REMOTE DATA SYNCHRONIZATION NETWORKS
// =========================================================================

// Pulls books and active loans database tables directly from Google Sheets via n8n
async function fetchRemoteIndexData() {
    try {
        const response = await fetch(CONFIG.N8N_SYNC_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ userId: AppState.currentUser.userId })
        });
        const result = await response.json();
        if (response.ok && result.titles) {
            AppState.titles = result.titles;
            AppState.loans = result.loans || [];
            AppState.reservations = result.reservations || [];
            AppState.stats = result.stats || null;
            AppState.restrictedForMinor = !!result.restrictedForMinor;
            AppState.offlineMode = false;
            saveStateToStorage();
        }
    } catch (error) {
        console.warn("Unable to fetch live book indices — pulling from local cache instead.", error);
        AppState.offlineMode = true;
        if (AppState.titles.length === 0) AppState.titles = [...INITIAL_MOCK_TITLES];
        saveStateToStorage();
    }
    configureLayoutVisibility();
}

// Transmits fine metrics, returns, and borrow transactions straight out to Google Sheets.
// Returns { ok: true } on success, { ok: false, conflict: true, message } when the server
// actively rejected the request (e.g. book already taken), or { ok: false, conflict: false }
// when it's a genuine network failure that should fall back to offline queueing.
async function transmitTransactionPayload(eventAction, dataContext) {
    const trackingPayload = { event: eventAction, timestamp: new Date().toISOString(), user: AppState.currentUser, data: dataContext };
    try {
        const response = await fetch(CONFIG.N8N_TRANSACTION_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(trackingPayload)
        });
        if (response.status === 409) {
            const result = await response.json().catch(() => ({}));
            return { ok: false, conflict: true, message: result.message || 'That copy is no longer available.' };
        }
        if (!response.ok) throw new Error("Server rejected data mapping.");
        AppState.offlineMode = false;
        saveStateToStorage();
        return { ok: true };
    } catch (error) {
        AppState.offlineMode = true;
        saveStateToStorage();
        configureLayoutVisibility();
        showToast("⚠️ Notice: Saved update locally. Will sync when network returns.");
        return { ok: false, conflict: false };
    }
}

// =========================================================================
// 5. LOAN TIMELINE INTEREST METRICS
// =========================================================================

// Computes if a book is overdue and handles the KSH 50 daily fine logic
function evaluateLoanMetrics(borrowedAtStr) {
    const borrowDate = new Date(borrowedAtStr);
    const currentDate = new Date();
    const timeDelta = currentDate - borrowDate;
    const daysElapsed = Math.floor(timeDelta / (1000 * 60 * 60 * 24));

    let status = 'NORMAL';
    let fine = 0;
    let lockAccount = false;

    // Standard 21-day calculation check
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

// =========================================================================
// 6. SINGLE-PAGE WEBSITE ROUTER
// =========================================================================
// =========================================================================
// 3c. HERO SLIDER — "what's currently on the shelf" preview (pre-login)
// =========================================================================

// Fetches a small public preview of the catalog for the login-page slider.
// Uses the same sync endpoint as the authenticated flow, but with no
// userId — titles/copies aren't sensitive, only the loans portion is
// user-scoped (and an empty userId just matches nothing there). Falls
// back to mock/cached titles if the network call fails.
async function fetchHeroPreview() {
    try {
        const response = await fetch(CONFIG.N8N_SYNC_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: '' })
        });
        const result = await response.json();
        if (response.ok && result.titles && result.titles.length > 0) return result.titles;
    } catch (error) {
        // fall through to local fallback below
    }
    return (AppState.titles && AppState.titles.length > 0) ? AppState.titles : INITIAL_MOCK_TITLES;
}

// Builds and starts the auto-advancing hero slider on the login page.
async function initHeroSlider() {
    const track = document.getElementById('hero-slider');
    const dotsWrap = document.getElementById('hero-slider-dots');
    if (!track || !dotsWrap) return;

    const previewTitles = (await fetchHeroPreview()).slice(0, 4);
    if (previewTitles.length === 0) return;

    const icons = ['fa-book-open', 'fa-book', 'fa-bookmark', 'fa-book-open-reader'];

    track.innerHTML = previewTitles.map((t, i) => {
        const availableCopy = (t.copies || []).find(c => c.status === 'AVAILABLE');
        const tag = availableCopy ? `Available at ${availableCopy.branch}` : 'Currently all on loan';
        return `
            <div class="hero-slide hero-slide-bg-${i % 4} ${i === 0 ? 'active' : ''}" data-slide-index="${i}">
                <i class="fas ${icons[i % icons.length]} hero-slide-icon"></i>
                <p class="hero-slide-title">${t.title}</p>
                <p class="hero-slide-meta">By ${t.author}</p>
                <span class="hero-slide-tag">${tag}</span>
            </div>
        `;
    }).join('');

    dotsWrap.innerHTML = previewTitles.map((_, i) => `<button class="hero-slider-dot ${i === 0 ? 'active' : ''}" onclick="goToHeroSlide(${i})" aria-label="Slide ${i + 1}"></button>`).join('');

    heroSliderIndex = 0;
    if (heroSliderInterval) clearInterval(heroSliderInterval);
    heroSliderInterval = setInterval(() => {
        goToHeroSlide((heroSliderIndex + 1) % previewTitles.length);
    }, 4500);
}

window.goToHeroSlide = function(index) {
    heroSliderIndex = index;
    document.querySelectorAll('.hero-slide').forEach(el => el.classList.toggle('active', Number(el.dataset.slideIndex) === index));
    document.querySelectorAll('.hero-slider-dot').forEach((el, i) => el.classList.toggle('active', i === index));
};

const router = {
    navigate: async (view) => {
        if (!AppState.isAuthenticated && view !== 'login') view = 'login';

        const mount = document.getElementById('view-container');
        if (!mount) return;

        // Stop any running hero slider before swapping views — otherwise it
        // keeps firing setInterval against DOM nodes that no longer exist.
        if (heroSliderInterval) { clearInterval(heroSliderInterval); heroSliderInterval = null; }

        // Fade view out smoothly
        mount.style.opacity = 0;
        await new Promise(resolve => setTimeout(resolve, 120));
        mount.innerHTML = '';

        // Inject requested HTML view layout template matching view argument ID
        const template = document.getElementById(`tmpl-${view}`);
        if (template) mount.appendChild(template.content.cloneNode(true));

        // RESILIENCE: if any of these throw (e.g. unexpected data shape),
        // don't let it leave the page invisible — log it and still fade
        // back in so at least the template markup is visible to debug from.
        try {
            if (view === 'login') {
                initAuthToggleCard();
            }
            if (view === 'catalog') {
                injectShimmerState('catalog-list', 3);
                compileStatsStrip();
                compileTrendingBlock();
                setTimeout(() => compileCatalogDisplayBlock(), 200);
            }
            if (view === 'dashboard') {
                injectShimmerState('loans-list', 2);
                setTimeout(() => compileDashboardDisplayBlock(), 200);
                compileReservationsBlock();
                initHeroSlider();
            }
            if (view === 'admin') {
                compileAdminDisplayBlock();
            }
        } catch (renderError) {
            console.error(`Unity Reads: render error while navigating to "${view}"`, renderError);
        }

        // Fade view back in smoothly — always runs, even if rendering above hit an error
        mount.style.opacity = 1;
    }
};

// Generates loading skeletons elements during navigation switches
function injectShimmerState(targetElementId, placeholderCount) {
    const outputGrid = document.getElementById(targetElementId);
    const skeletonTemplate = document.getElementById('tmpl-shimmer');
    if (!outputGrid || !skeletonTemplate) return;
    outputGrid.innerHTML = '';
    for (let i = 0; i < placeholderCount; i++) {
        outputGrid.appendChild(skeletonTemplate.content.cloneNode(true));
    }
}

// =========================================================================
// 7. USER INTERFACE VIEW RENDERING COMPILERS
// =========================================================================

// Renders title columns inside catalog view window frame. Filtering by
// AVAILABLE/ON_LOAN now looks at whether a title has ANY available copy
// anywhere, since availability is a per-copy, per-branch concept.
function compileCatalogDisplayBlock() {
    const displayGrid = document.getElementById('catalog-list');
    if (!displayGrid) return;

    const titleHasAvailableCopy = (t) => (t.copies || []).some(c => c.status === 'AVAILABLE');

    let filteredDataset = AppState.titles || [];
    if (activeCatalogFilter === 'AVAILABLE') {
        filteredDataset = filteredDataset.filter(titleHasAvailableCopy);
    } else if (activeCatalogFilter === 'ON_LOAN') {
        filteredDataset = filteredDataset.filter(t => !titleHasAvailableCopy(t));
    }
    if (activeCatalogQuery) {
        // Some titles have no author on record (author: null) — guard with
        // `|| ''` so those don't throw and silently break the whole render.
        filteredDataset = filteredDataset.filter(t => (t.title || '').toLowerCase().includes(activeCatalogQuery) || (t.author || '').toLowerCase().includes(activeCatalogQuery));
    }

    document.getElementById('catalog-count-label').textContent = `${filteredDataset.length} titles found in catalog database index.`;

    const restrictionNote = document.getElementById('minor-restriction-note');
    if (restrictionNote) restrictionNote.style.display = AppState.restrictedForMinor ? 'block' : 'none';

    if (filteredDataset.length === 0) {
        displayGrid.innerHTML = `<p style="text-align: center; font-size: 0.85rem; color: var(--text-secondary); padding: 3rem 0; font-style: italic;">No books found matching search terms.</p>`;
        return;
    }

    // Group into Adults / Children subsections — the real inventory data's
    // ageBracket field, normalized here since the source spreadsheet had
    // inconsistent casing/whitespace ("Kids", "kids", "Kids ").
    const isKids = (t) => (t.ageBracket || '').toString().trim().toLowerCase() === 'kids';
    const adults = filteredDataset.filter(t => !isKids(t));
    const children = filteredDataset.filter(isKids);

    const renderCard = (t) => {
        const anyAvailable = titleHasAvailableCopy(t);
        const iconStats = [
            t.ageBracket ? `<span class="icon-stat"><i class="fas fa-users"></i> ${t.ageBracket}</span>` : '',
            t.grade ? `<span class="icon-stat"><i class="fas fa-graduation-cap"></i> Grade ${t.grade}</span>` : ''
        ].filter(Boolean).join('');

        // One row per branch that holds a copy of this title, with a Borrow
        // button when that specific branch has an available copy, or a
        // Reserve option (or current reservation status) when it doesn't.
        const branchRows = (t.copies || []).length === 0 ? '' : Object.entries(
            (t.copies || []).reduce((acc, c) => {
                if (!acc[c.branch]) acc[c.branch] = { available: 0, total: 0 };
                acc[c.branch].total += 1;
                if (c.status === 'AVAILABLE') acc[c.branch].available += 1;
                return acc;
            }, {})
        ).map(([branch, summary]) => {
            if (summary.available > 0) {
                return `
                    <div class="branch-copy-row">
                        <span class="branch-copy-label">${branch}: ${summary.available}/${summary.total} available</span>
                        <button onclick="processBorrowTransaction('${t.id}', '${branch}')" class="branch-borrow-btn">Borrow</button>
                    </div>
                `;
            }

            const myReservation = (AppState.reservations || []).find(r => r.title_id === t.id && r.branch === branch);
            let rightSide;
            if (myReservation && myReservation.status === 'READY') {
                rightSide = `<button onclick="processBorrowTransaction('${t.id}', '${branch}')" class="branch-borrow-btn">Claim Hold</button>`;
            } else if (myReservation) {
                rightSide = `<span class="branch-copy-none">On your waitlist</span>`;
            } else {
                rightSide = `<button onclick="processReserveTransaction('${t.id}', '${branch}')" class="branch-reserve-btn">Reserve</button>`;
            }
            return `
                <div class="branch-copy-row">
                    <span class="branch-copy-label">${branch}: 0/${summary.total} available</span>
                    ${rightSide}
                </div>
            `;
        }).join('');

        return `
            <div class="catalog-item-card">
                <div>
                    <h4 class="auth-title">${t.title}</h4>
                    <p class="text-xs text-secondary" style="margin-top: 0.15rem;">By ${t.author || 'Unknown author'}</p>
                    ${iconStats ? `<div class="icon-stat-row">${iconStats}</div>` : ''}
                    <span class="status-badge-node ${anyAvailable ? 'status-available' : 'status-loaned'}">
                        ${anyAvailable ? 'AVAILABLE' : 'ALL ON LOAN'}
                    </span>
                    <div class="branch-copy-list">${branchRows}</div>
                </div>
            </div>
        `;
    };

    const renderSubsection = (label, icon, items) => {
        const pageSize = catalogPageState[label] || CATALOG_PAGE_SIZE;
        const visible = items.slice(0, pageSize);
        const hasMore = items.length > visible.length;
        return `
            <div class="catalog-subsection">
                <div class="catalog-subsection-header">
                    <i class="fas ${icon} catalog-subsection-icon"></i>
                    <span class="catalog-subsection-title">${label}</span>
                    <span class="catalog-subsection-count">${items.length}</span>
                </div>
                ${items.length > 0
                    ? `<div class="catalog-subsection-grid">${visible.map(renderCard).join('')}</div>`
                    : `<p class="catalog-subsection-empty">No ${label.toLowerCase()} titles in this view.</p>`}
                ${hasMore ? `<div class="catalog-show-more-wrap"><button onclick="expandCatalogSubsection('${label}')" class="btn btn-uh-secondary">Show More (${items.length - visible.length} remaining)</button></div>` : ''}
            </div>
        `;
    };

    displayGrid.innerHTML = renderSubsection('Adults', 'fa-user', adults) + renderSubsection('Children', 'fa-child', children);
}

// Renders the stat-counter strip (books / active loans / estates) using the
// privacy-safe aggregate block from sync — no per-member data involved.
function compileStatsStrip() {
    const stripNode = document.getElementById('catalog-stats-strip');
    if (!stripNode) return;

    const safeTitles = AppState.titles || [];
    const stats = AppState.stats || { totalTitles: safeTitles.length, totalCopies: safeTitles.reduce((n, t) => n + (t.copies || []).length, 0), activeLoans: (AppState.loans || []).length, estatesCount: 3 };

    stripNode.innerHTML = `
        <div class="stat-item">
            <span class="stat-number">${stats.totalTitles}</span>
            <span class="stat-label">Titles in Catalog</span>
        </div>
        <div class="stat-item">
            <span class="stat-number">${stats.totalCopies}</span>
            <span class="stat-label">Physical Copies</span>
        </div>
        <div class="stat-item">
            <span class="stat-number">${stats.activeLoans}</span>
            <span class="stat-label">Active Loans</span>
        </div>
        <div class="stat-item">
            <span class="stat-number">${stats.estatesCount}</span>
            <span class="stat-label">Branches</span>
        </div>
    `;
}

// Renders the "What Residents Are Reading" highlight block from the
// all-time most-borrowed titles returned by sync.
function compileTrendingBlock() {
    const trendingNode = document.getElementById('top-books-strip');
    if (!trendingNode) return;

    const topBooks = (AppState.stats && AppState.stats.topBooks) || [];
    if (topBooks.length === 0) {
        trendingNode.closest('.trending-section')?.style.setProperty('display', 'none');
        return;
    }
    trendingNode.closest('.trending-section')?.style.setProperty('display', '');

    trendingNode.innerHTML = topBooks.map(b => `
        <div class="trending-card">
            <i class="fas fa-fire trending-icon"></i>
            <div>
                <p class="trending-title">${b.title}</p>
                <p class="text-xs text-secondary">${b.author ? `By ${b.author} · ` : ''}Borrowed ${b.timesBorrowed}× total</p>
            </div>
        </div>
    `).join('');
}

// Triggers search filtration routines during keydown sequences inside filter inputs
window.handleCatalogSearch = function(query) {
    activeCatalogQuery = query.toLowerCase().trim();
    catalogPageState = { Adults: CATALOG_PAGE_SIZE, Children: CATALOG_PAGE_SIZE };
    compileCatalogDisplayBlock();
    renderSearchSuggestions(query.trim());
};

// Renders a small dropdown of matching titles/authors as the user types,
// so they can jump straight to a book instead of scanning the whole grid.
function renderSearchSuggestions(rawQuery) {
    const box = document.getElementById('search-suggestions');
    if (!box) return;

    if (!rawQuery) {
        box.classList.remove('open');
        box.innerHTML = '';
        return;
    }

    const q = rawQuery.toLowerCase();
    const matches = (AppState.titles || [])
        .filter(t => (t.title || '').toLowerCase().includes(q) || (t.author || '').toLowerCase().includes(q))
        .slice(0, 6);

    if (matches.length === 0) {
        box.innerHTML = `<div class="search-suggestion-empty">No titles or authors match "${rawQuery}"</div>`;
    } else {
        box.innerHTML = matches.map(t => {
            const anyAvailable = (t.copies || []).some(c => c.status === 'AVAILABLE');
            return `
                <button type="button" class="search-suggestion-item" onclick="selectSearchSuggestion('${t.title.replace(/'/g, "\\'")}')">
                    <i class="fas ${anyAvailable ? 'fa-book-open' : 'fa-book'}"></i>
                    <div>
                        <div class="search-suggestion-title">${t.title}</div>
                        <div class="search-suggestion-meta">By ${t.author || 'Unknown author'} — ${anyAvailable ? 'Available' : 'All on loan'}</div>
                    </div>
                </button>
            `;
        }).join('');
    }
    box.classList.add('open');
}

// Clicking a suggestion fills the search box with that exact title and
// applies the filter immediately.
window.selectSearchSuggestion = function(title) {
    const input = document.getElementById('search-bar');
    if (input) input.value = title;
    activeCatalogQuery = title.toLowerCase().trim();
    compileCatalogDisplayBlock();
    const box = document.getElementById('search-suggestions');
    if (box) { box.classList.remove('open'); box.innerHTML = ''; }
};

// Close suggestions when clicking anywhere outside the search bar.
document.addEventListener('click', (e) => {
    const frame = document.querySelector('.search-bar-frame');
    const box = document.getElementById('search-suggestions');
    if (frame && box && !frame.contains(e.target)) {
        box.classList.remove('open');
    }
});

// Adjusts active pill highlights across selection switches
window.handleCatalogFilter = function(filterValue) {
    activeCatalogFilter = filterValue;
    catalogPageState = { Adults: CATALOG_PAGE_SIZE, Children: CATALOG_PAGE_SIZE };
    document.querySelectorAll('.filter-pill-btn').forEach(btn => btn.classList.remove('active'));
    const targetElement = document.getElementById(`filter-pill-${filterValue}`);
    if (targetElement) targetElement.classList.add('active');
    compileCatalogDisplayBlock();
};

// Reveals the next page of a catalog subsection (Adults/Children) without
// re-fetching — everything's already in memory from sync.
window.expandCatalogSubsection = function(label) {
    catalogPageState[label] = (catalogPageState[label] || CATALOG_PAGE_SIZE) + CATALOG_PAGE_SIZE;
    compileCatalogDisplayBlock();
};

// Keeps the "Active Loans" stat ticking up/down immediately after a
// borrow/return, instead of only refreshing on the next full sync — this
// is what makes the live catalogue numbers feel instantly responsive.
function bumpActiveLoansStat(delta) {
    if (AppState.stats) {
        AppState.stats.activeLoans = Math.max(0, (AppState.stats.activeLoans || 0) + delta);
    }
    compileStatsStrip();
}

// Handles clicking "Borrow" on a specific branch's copy of a title, and
// checks for unpaid fines first.
window.processBorrowTransaction = async function(titleId, branch) {
    const myLoans = AppState.loans.filter(l => l.user_id === AppState.currentUser.userId);
    if (myLoans.some(l => evaluateLoanMetrics(l.borrowed_at).lockAccount)) {
        showToast("❌ Account Locked: Please clear your overdue fine balances first.");
        return;
    }

    const title = AppState.titles.find(t => t.id === titleId);
    if (!title) return;

    // A copy is borrowable either because it's plain AVAILABLE, or
    // because it's RESERVED and this user is the one it's being held for.
    const myReadyReservation = (AppState.reservations || []).find(r => r.title_id === titleId && r.branch === branch && r.status === 'READY');
    let copy = title.copies.find(c => c.branch === branch && c.status === 'AVAILABLE');
    if (!copy && myReadyReservation) {
        copy = title.copies.find(c => c.branch === branch && c.status === 'RESERVED');
    }
    if (!copy) return;

    const originalStatus = copy.status;
    copy.status = 'ON_LOAN';
    const transactionObject = { id: 'l_' + Date.now(), copy_id: copy.copyId, title_id: title.id, book_title: title.title, branch, user_id: AppState.currentUser.userId, borrowed_at: new Date().toISOString() };
    AppState.loans.push(transactionObject);
    if (myReadyReservation && originalStatus === 'RESERVED') {
        AppState.reservations = AppState.reservations.filter(r => r.id !== myReadyReservation.id);
    }
    saveStateToStorage();
    compileCatalogDisplayBlock();
    bumpActiveLoansStat(1);

    const result = await transmitTransactionPayload('BOOK_BORROWED', { copyId: copy.copyId, titleId: title.id, title: title.title, branch, loanId: transactionObject.id, borrowedAt: transactionObject.borrowed_at });

    if (result.conflict) {
        // Someone else borrowed it first — undo our optimistic local update
        // rather than showing the user a loan that doesn't really exist.
        copy.status = originalStatus;
        AppState.loans = AppState.loans.filter(l => l.id !== transactionObject.id);
        saveStateToStorage();
        showToast(`❌ ${result.message}`);
        compileCatalogDisplayBlock();
        bumpActiveLoansStat(-1);
        return;
    }

    showToast(`Checked out: "${title.title}" from ${branch}.`);
    router.navigate('dashboard');
};

// Renders active borrow balances inside statement views
function compileDashboardDisplayBlock() {
    const listGrid = document.getElementById('loans-list');
    const dynamicBalanceBadge = document.getElementById('total-fines-badge');
    if (!listGrid || !dynamicBalanceBadge) return;

    const matchedLoans = AppState.loans.filter(l => l.user_id === AppState.currentUser.userId);
    let aggregateSystemFine = 0;

    if (matchedLoans.length === 0) {
        listGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; font-size: 0.85rem; color: var(--text-secondary); padding: 3rem 0; font-style: italic;">You do not have any borrowed books right now.</p>`;
        dynamicBalanceBadge.innerHTML = "Total Balance: <span style='color: var(--text-dark)'>KSH 0</span>";
        return;
    }

    listGrid.innerHTML = matchedLoans.map(loan => {
        const structuralMetrics = evaluateLoanMetrics(loan.borrowed_at);
        aggregateSystemFine += structuralMetrics.fine;

        let trackingBorderColor = '';
        let statusNoticeString = `<span class="status-badge-node status-available" style="border-color: transparent;">In Timeline</span>`;

        if (structuralMetrics.status === 'OVERDUE') {
            trackingBorderColor = 'border-color: var(--uh-red); background-color: rgba(214,35,39,0.02);';
            statusNoticeString = `<span class="status-badge-node status-available">Overdue</span>`;
        } else if (structuralMetrics.status === 'SUSPENDED') {
            trackingBorderColor = 'border-color: var(--uh-red); box-shadow: 0 0 0 1px var(--uh-red);';
            statusNoticeString = `<span class="status-badge-node" style="background-color: var(--uh-red); color: white;">Account Frozen</span>`;
        }

        return `
            <div class="auth-card" style="${trackingBorderColor}">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                    <div>
                        <h4 class="auth-title">${loan.book_title}</h4>
                        <p class="text-xs text-secondary" style="margin-top: 0.25rem;">${loan.branch ? `${loan.branch} · ` : ''}Borrowed for: <strong>${structuralMetrics.daysElapsed} days</strong></p>
                    </div>
                    ${statusNoticeString}
                </div>
                ${structuralMetrics.fine > 0 ? `<div style="margin-top: 0.75rem; font-size: 0.8rem; font-weight: 700; color: var(--uh-red);">Accrued Fine: KSH ${structuralMetrics.fine}</div>` : ''}
                <button onclick="processReturnTransaction('${loan.id}', '${loan.copy_id}')" class="btn btn-uh-secondary btn-w-full text-xs">Return Book</button>
            </div>
        `;
    }).join('');

    dynamicBalanceBadge.innerHTML = `Total Outstanding Balance: <span style="color: ${aggregateSystemFine > 0 ? 'var(--uh-red)' : 'var(--text-dark)'}; font-weight: 800;">KSH ${aggregateSystemFine}</span>`;
}

// Processes a book return transaction — finds the specific copy (by
// copyId) across all titles and flips it back to AVAILABLE.
window.processReturnTransaction = async function(loanId, copyId) {
    const returningLoan = AppState.loans.find(l => l.id === loanId);
    AppState.loans = AppState.loans.filter(l => l.id !== loanId);

    for (const title of AppState.titles) {
        const copy = title.copies.find(c => c.copyId === copyId);
        if (copy) { copy.status = 'AVAILABLE'; break; }
    }

    saveStateToStorage();
    showToast("Book returned successfully.");
    compileDashboardDisplayBlock();
    bumpActiveLoansStat(-1);

    await transmitTransactionPayload('BOOK_RETURNED', { copyId: copyId, titleId: returningLoan ? returningLoan.title_id : '', loanId: loanId, returnedAt: new Date().toISOString() });
};

// Handles clicking "Reserve" on a title with no available copies at a
// branch — joins the waitlist for that specific title+branch combo.
window.processReserveTransaction = async function(titleId, branch) {
    if (!AppState.authToken) {
        showToast("❌ Reservations require an active online session — please check your connection.");
        return;
    }
    try {
        const response = await fetch(CONFIG.N8N_RESERVE_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ userId: AppState.currentUser.userId, titleId, branch })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            showToast(`📌 ${result.message || "You're on the waitlist."}`);
            await fetchRemoteIndexData();
            compileCatalogDisplayBlock();
        } else {
            showToast(`❌ ${result.message || 'Could not reserve this title.'}`);
        }
    } catch (error) {
        showToast("❌ Network unavailable — reservations require a connection.");
    }
};

// Cancels one of the current user's own reservations from the dashboard.
window.processCancelReservation = async function(reservationId) {
    try {
        const response = await fetch(CONFIG.N8N_CANCEL_RESERVATION_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ userId: AppState.currentUser.userId, reservationId })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            showToast("Reservation cancelled.");
            await fetchRemoteIndexData();
            compileDashboardDisplayBlock();
        } else {
            showToast(`❌ ${result.message || 'Could not cancel this reservation.'}`);
        }
    } catch (error) {
        showToast("❌ Network unavailable — please try again once connected.");
    }
};

// Renders the "My Reservations" list on the dashboard — separate from
// active loans since a reservation isn't a loan yet.
function compileReservationsBlock() {
    const listNode = document.getElementById('reservations-list');
    const sectionNode = document.getElementById('reservations-section');
    if (!listNode || !sectionNode) return;

    const myReservations = AppState.reservations || [];
    if (myReservations.length === 0) {
        sectionNode.style.display = 'none';
        return;
    }
    sectionNode.style.display = '';

    listNode.innerHTML = myReservations.map(r => {
        const isReady = r.status === 'READY';
        return `
            <div class="auth-card reservation-card ${isReady ? 'reservation-ready' : ''}">
                <div>
                    <h4 class="auth-title">${r.book_title}</h4>
                    <p class="text-xs text-secondary" style="margin-top: 0.15rem;">${r.branch}</p>
                    <span class="status-badge-node ${isReady ? 'status-available' : 'status-loaned'}">
                        ${isReady ? 'READY FOR PICKUP' : 'WAITING IN QUEUE'}
                    </span>
                    ${isReady ? `<p class="text-xs text-secondary" style="margin-top: 0.4rem;">Held until ${new Date(r.expires_at).toLocaleString()}</p>` : ''}
                </div>
                <button onclick="processCancelReservation('${r.id}')" class="btn btn-uh-secondary btn-w-full text-xs">Cancel Reservation</button>
            </div>
        `;
    }).join('');
}

// Lets a Library Assistant mark any member's loan as returned from the
// admin desk view — kept separate from the resident-facing
// processReturnTransaction, which assumes the loan belongs to the
// currently logged-in user's own local state.
window.processAdminMarkReturned = async function(loanId, copyId) {
    try {
        const response = await fetch(CONFIG.N8N_TRANSACTION_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
                event: 'BOOK_RETURNED',
                timestamp: new Date().toISOString(),
                user: AppState.currentUser,
                data: { copyId, loanId, returnedAt: new Date().toISOString() },
            }),
        });
        const result = await response.json();
        if (response.ok && result.success) {
            showToast("Marked as returned.");
            compileAdminDisplayBlock();
        } else {
            showToast(`❌ ${result.message || 'Could not mark this loan as returned.'}`);
        }
    } catch (error) {
        showToast("❌ Network unavailable — please try again once connected.");
    }
};

// Fetches and renders the Library Assistant admin overview: all active
// loans and reservations across every member (a legitimate, role-gated
// exception to the per-user privacy scoping everywhere else).
async function compileAdminDisplayBlock() {
    const statsNode = document.getElementById('admin-stats-strip');
    const loansNode = document.getElementById('admin-loans-table');
    const reservationsNode = document.getElementById('admin-reservations-table');
    if (!statsNode || !loansNode || !reservationsNode) return;

    try {
        const response = await fetch(CONFIG.N8N_ADMIN_OVERVIEW_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
        });
        const result = await response.json();

        if (!response.ok) {
            showToast(`❌ ${result.message || 'Could not load admin overview.'}`);
            router.navigate('catalog');
            return;
        }

        statsNode.innerHTML = `
            <div class="stat-item"><span class="stat-number">${result.activeLoans.length}</span><span class="stat-label">Active Loans</span></div>
            <div class="stat-item"><span class="stat-number">${result.activeReservations.length}</span><span class="stat-label">Active Reservations</span></div>
            <div class="stat-item"><span class="stat-number">${result.totalMembers}</span><span class="stat-label">Total Members</span></div>
            <div class="stat-item"><span class="stat-number">${result.pendingVerifications}</span><span class="stat-label">Pending Verification</span></div>
        `;

        loansNode.innerHTML = result.activeLoans.length === 0
            ? `<p class="catalog-subsection-empty">No active loans right now.</p>`
            : `<table class="admin-table">
                <thead><tr><th>Book</th><th>Borrower</th><th>Branch</th><th>Days Out</th><th></th></tr></thead>
                <tbody>${result.activeLoans.map(l => `
                    <tr class="${l.overdue ? 'admin-row-overdue' : ''}">
                        <td>${l.book_title}</td>
                        <td>${l.borrowerName}<br><span class="text-xs text-secondary">${l.borrowerEstate}</span></td>
                        <td>${l.branch}</td>
                        <td>${l.daysElapsed}${l.overdue ? ' <span class="admin-overdue-tag">OVERDUE</span>' : ''}</td>
                        <td><button onclick="processAdminMarkReturned('${l.id}', '${l.copy_id}')" class="branch-borrow-btn">Mark Returned</button></td>
                    </tr>
                `).join('')}</tbody>
            </table>`;

        reservationsNode.innerHTML = result.activeReservations.length === 0
            ? `<p class="catalog-subsection-empty">No active reservations right now.</p>`
            : `<table class="admin-table">
                <thead><tr><th>Book</th><th>Requested By</th><th>Branch</th><th>Status</th></tr></thead>
                <tbody>${result.activeReservations.map(r => `
                    <tr>
                        <td>${r.book_title}</td>
                        <td>${r.requesterName}</td>
                        <td>${r.branch}</td>
                        <td><span class="status-badge-node ${r.status === 'READY' ? 'status-available' : 'status-loaned'}">${r.status}</span></td>
                    </tr>
                `).join('')}</tbody>
            </table>`;
    } catch (error) {
        showToast("❌ Could not reach the server for the admin overview.");
    }
}

// =========================================================================
// 8. NOTIFICATION POPUP ALERTS
// =========================================================================
function showToast(toastMessageString) {
    const toastNode = document.getElementById('app-toast');
    if (!toastNode) return;
    toastNode.textContent = toastMessageString;
    toastNode.classList.add('toast-visible');
    setTimeout(() => toastNode.classList.remove('toast-visible'), 3200);
}

// Initial engine trigger on window load sequence configurations
// =========================================================================
// 0b. AMBIENT BACKGROUND — cursor-reactive parallax for the drifting blobs
// =========================================================================

// Updates --mx/--my (normalized -1..1 cursor position) on the root element.
// CSS does the actual work via calc() on each blob's transform, so this
// only ever touches two custom properties per animation frame — cheap,
// and it composes with each blob's own autonomous drift animation because
// they live on separate nested elements (see .blob-parallax / .blob in
// styles.css) rather than fighting over one `transform`.
function initAmbientParallax() {
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    let targetX = 0, targetY = 0, targetPxX = null, targetPxY = null, ticking = false;
    const root = document.documentElement;

    const applyPosition = () => {
        root.style.setProperty('--mx', targetX.toFixed(3));
        root.style.setProperty('--my', targetY.toFixed(3));
        if (targetPxX !== null) {
            root.style.setProperty('--cursor-x', `${targetPxX}px`);
            root.style.setProperty('--cursor-y', `${targetPxY}px`);
        }
        ticking = false;
    };

    const handleMove = (clientX, clientY) => {
        targetX = (clientX / window.innerWidth) * 2 - 1;
        targetY = (clientY / window.innerHeight) * 2 - 1;
        targetPxX = clientX;
        targetPxY = clientY;
        if (!ticking) {
            requestAnimationFrame(applyPosition);
            ticking = true;
        }
    };

    window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY), { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
}

document.addEventListener('DOMContentLoaded', () => { initStorageEngine(); router.navigate('catalog'); initAmbientParallax(); });
window.router = router;
