/**
 * Admin.gs — admin sign-in, sessions, TOTP, audit log, overview.
 *
 * Sign-in = ID + password (docs/GAS-DESIGN.md §4). Script Properties hold ONLY hashes:
 *   ADMIN_USERS  JSON { "<id>": "<HMAC-SHA256 hex of the password>" }
 *   ADMIN_TOTP   JSON { "<id>": "<base32 secret>" }          (used for the dangerous reset, Stage G6)
 * No ID or password is ever written in code, docs or the repo.
 *
 * First admin (or a forgotten password): in Project Settings > Script properties add NEW_ADMIN_ID and
 * NEW_ADMIN_PASSWORD (12+ characters), then run createAdmin() from the editor. It hashes the password and deletes
 * both temporary properties.
 *
 * A session is a random token in CacheService (2 hours of inactivity). Every admin action needs it (req.session).
 */

const ADMIN_SESSION_SEC = 2 * 3600;
const ADMIN_MIN_PASSWORD = 12;

// ───────────── hashes, users ─────────────

function adminId_(v) {
  return String(v || '').trim().toLowerCase().slice(0, 120);
}

function adminHash_(id, password) {
  const pepper = props_().getProperty('PEPPER');
  if (!pepper) throw fail_('not_setup', 'PEPPER missing — run setup()');
  return hex_(Utilities.computeHmacSha256Signature('admin:' + id + ':' + password, pepper));
}

function adminUsers_() { return jsonParse_(props_().getProperty('ADMIN_USERS'), {}); }

function adminPasswordOk_(id, password) {
  const users = adminUsers_();
  return Object.prototype.hasOwnProperty.call(users, id) && typeof password === 'string' && adminHash_(id, password) === users[id];
}

/**
 * RUN FROM THE EDITOR. Reads the temporary Script properties NEW_ADMIN_ID and NEW_ADMIN_PASSWORD, stores the
 * password hash, then deletes both properties. Running it again for the same ID sets a new password.
 */
function createAdmin() {
  const p = props_();
  const id = adminId_(p.getProperty('NEW_ADMIN_ID'));
  const password = p.getProperty('NEW_ADMIN_PASSWORD') || '';
  if (!id) throw new Error('Add the Script property NEW_ADMIN_ID first (the sign-in ID, e.g. an organisation e-mail).');
  if (password.length < ADMIN_MIN_PASSWORD) throw new Error('NEW_ADMIN_PASSWORD must be at least ' + ADMIN_MIN_PASSWORD + ' characters.');
  const users = adminUsers_();
  users[id] = adminHash_(id, password);
  p.setProperty('ADMIN_USERS', JSON.stringify(users));
  p.deleteProperty('NEW_ADMIN_PASSWORD');
  p.deleteProperty('NEW_ADMIN_ID');
  console.log('Admin "' + id + '" saved. Temporary properties removed. Admins now: ' + Object.keys(users).length);
}

/** RUN FROM THE EDITOR (emergency): remove the TOTP registration of the ID in Script property NEW_ADMIN_ID. */
function resetAdminTotp() {
  const p = props_();
  const id = adminId_(p.getProperty('NEW_ADMIN_ID'));
  const t = jsonParse_(p.getProperty('ADMIN_TOTP'), {});
  delete t[id];
  p.setProperty('ADMIN_TOTP', JSON.stringify(t));
  p.deleteProperty('NEW_ADMIN_ID');
  console.log('TOTP of "' + id + '" removed. Register again in the admin page.');
}

// ───────────── sessions ─────────────

function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); } // 64 hex chars

function sessionKey_(token) { return 'sess:' + token; }

/** Returns the live session for req.session (and slides its expiry) or throws unauthorized. */
function adminSession_(req) {
  const token = typeof req.session === 'string' ? req.session : '';
  if (!/^[0-9a-f]{64}$/.test(token)) throw fail_('unauthorized');
  const cache = CacheService.getScriptCache();
  const raw = cache.get(sessionKey_(token));
  const s = raw ? jsonParse_(raw, null) : null;
  const now = Date.now();
  if (!s || !adminUsers_()[s.id] || now - s.last > ADMIN_SESSION_SEC * 1000) throw fail_('unauthorized');
  s.last = now;
  s.token = token;
  cache.put(sessionKey_(token), JSON.stringify({ id: s.id, at: s.at, last: s.last }), ADMIN_SESSION_SEC);
  return s;
}

/** Run an admin READ action: needs a valid session. */
function adminRead_(req, fn) {
  const s = adminSession_(req);
  return fn(req, s);
}

/** Run an admin WRITE action: valid session + the script lock. fn gets (req, session). */
function adminWrite_(req, fn) {
  const s = adminSession_(req);
  return withLock_(function () { return fn(req, s); });
}

function audit_(session, action, target, detail) {
  append_('audit_log', { id: uuid_(), admin: session.id, action: action, target: target || '', detail: detail ? JSON.stringify(detail).slice(0, 2000) : '', at: nowIso_() });
}

// ───────────── login / logout ─────────────

/** req: { id, password } -> { session, id, totp } */
function adminLogin_(req) {
  rateLimit_('admin_login', 60, 600);
  return withLock_(function () {
    const att = attemptGet_('admin');
    if (attemptLocked_(att)) throw fail_('admin_locked');
    const id = adminId_(req.id);
    if (!id || !adminPasswordOk_(id, req.password)) {
      const fails = attemptFail_('admin', att);
      if (fails >= MAX_PIN_FAILS) throw fail_('admin_locked');
      throw fail_('admin_invalid', '', { attempts_left: MAX_PIN_FAILS - fails });
    }
    attemptClear_(att);
    const token = newToken_();
    const now = Date.now();
    CacheService.getScriptCache().put(sessionKey_(token), JSON.stringify({ id: id, at: now, last: now }), ADMIN_SESSION_SEC);
    audit_({ id: id }, 'login', '', null);
    return { session: token, id: id, totp: !!jsonParse_(props_().getProperty('ADMIN_TOTP'), {})[id] };
  });
}

function adminLogout_(req) {
  const token = typeof req.session === 'string' ? req.session : '';
  if (/^[0-9a-f]{64}$/.test(token)) CacheService.getScriptCache().remove(sessionKey_(token));
  return { ok: true };
}

/** Validates the session (used when the page reloads). */
function adminMe_(req) {
  return adminRead_(req, function (r, s) {
    return { id: s.id, totp: !!jsonParse_(props_().getProperty('ADMIN_TOTP'), {})[s.id], logged_in_at: new Date(s.at).toISOString() };
  });
}

/** req: { password, new_password } */
function adminChangePassword_(req) {
  return adminWrite_(req, function (r, s) {
    const att = attemptGet_('admin');
    if (attemptLocked_(att)) throw fail_('admin_locked');
    if (!adminPasswordOk_(s.id, r.password)) {
      const fails = attemptFail_('admin', att);
      if (fails >= MAX_PIN_FAILS) throw fail_('admin_locked');
      throw fail_('admin_invalid', '', { attempts_left: MAX_PIN_FAILS - fails });
    }
    attemptClear_(att);
    const next = typeof r.new_password === 'string' ? r.new_password : '';
    if (next.length < ADMIN_MIN_PASSWORD || next.length > 200) throw fail_('password_too_short');
    if (next === r.password) throw fail_('password_same');
    const users = adminUsers_();
    users[s.id] = adminHash_(s.id, next);
    props_().setProperty('ADMIN_USERS', JSON.stringify(users));
    audit_(s, 'change_password', s.id, null);
    return { changed: true };
  });
}

// ───────────── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ─────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode_(bytes) {
  let bits = '';
  bytes.forEach(function (b) { bits += ('00000000' + (b & 0xff).toString(2)).slice(-8); });
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt((bits.slice(i, i + 5) + '0000').slice(0, 5), 2)];
  return out;
}

function base32Decode_(text) {
  let bits = '';
  String(text).replace(/=+$/, '').toUpperCase().split('').forEach(function (c) {
    const v = B32.indexOf(c);
    if (v >= 0) bits += ('00000' + v.toString(2)).slice(-5);
  });
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const b = parseInt(bits.slice(i, i + 8), 2);
    out.push(b > 127 ? b - 256 : b); // Apps Script wants signed bytes
  }
  return out;
}

function newTotpSecret_() {
  const hexChars = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40); // 20 random bytes
  const bytes = [];
  for (let i = 0; i < hexChars.length; i += 2) bytes.push(parseInt(hexChars.slice(i, i + 2), 16));
  return base32Encode_(bytes);
}

/** The 6-digit code of `secret` for 30-second step number `step`. */
function totpCode_(secret, step) {
  const msg = [];
  let n = step;
  for (let i = 7; i >= 0; i--) { msg[i] = n % 256; n = Math.floor(n / 256); }
  const signed = msg.map(function (b) { return b > 127 ? b - 256 : b; });
  const sig = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, signed, base32Decode_(secret)).map(function (b) { return b & 0xff; });
  const off = sig[19] & 0xf;
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return ('000000' + (bin % 1000000)).slice(-6);
}

/** Step number whose code matches (accepts the previous/next step for clock drift), or null. */
function totpMatch_(secret, code, nowMs) {
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return null;
  const step = Math.floor(nowMs / 30000);
  for (let d = -1; d <= 1; d++) if (totpCode_(secret, step + d) === code) return step + d;
  return null;
}

/**
 * Check a TOTP code for admin `id`. MUST be inside withLock_(). A code can be used once (replay-proof), and 5 wrong
 * codes in 15 minutes lock TOTP checks. Throws totp_not_registered / admin_locked / totp_invalid.
 */
function totpVerify_(id, code) {
  const secret = jsonParse_(props_().getProperty('ADMIN_TOTP'), {})[id];
  if (!secret) throw fail_('totp_not_registered');
  const att = attemptGet_('totp');
  if (attemptLocked_(att)) throw fail_('admin_locked');
  const step = totpMatch_(secret, code, Date.now());
  const last = jsonParse_(props_().getProperty('ADMIN_TOTP_LAST'), {});
  if (step === null || (last[id] !== undefined && step <= last[id])) {
    const fails = attemptFail_('totp', att);
    if (fails >= MAX_PIN_FAILS) throw fail_('admin_locked');
    throw fail_('totp_invalid', '', { attempts_left: MAX_PIN_FAILS - fails });
  }
  attemptClear_(att);
  last[id] = step;
  props_().setProperty('ADMIN_TOTP_LAST', JSON.stringify(last));
  return true;
}

/** req: { password } -> { secret, uri }. Secret is parked in the cache for 10 minutes until confirmed. */
function adminTotpBegin_(req) {
  return adminWrite_(req, function (r, s) {
    if (!adminPasswordOk_(s.id, r.password)) throw fail_('admin_invalid');
    const secret = newTotpSecret_();
    CacheService.getScriptCache().put('totp_pending:' + s.id, secret, 600);
    const uri = 'otpauth://totp/' + encodeURIComponent('Sci-Tech Pitching:' + s.id) + '?secret=' + secret + '&issuer=' + encodeURIComponent('Sci-Tech Pitching');
    return { secret: secret, uri: uri };
  });
}

/** req: { code } — activates the pending secret if the code from the authenticator app is right. */
function adminTotpConfirm_(req) {
  return adminWrite_(req, function (r, s) {
    const secret = CacheService.getScriptCache().get('totp_pending:' + s.id);
    if (!secret) throw fail_('totp_expired');
    const step = totpMatch_(secret, r.code, Date.now());
    if (step === null) throw fail_('totp_invalid');
    const all = jsonParse_(props_().getProperty('ADMIN_TOTP'), {});
    all[s.id] = secret;
    props_().setProperty('ADMIN_TOTP', JSON.stringify(all));
    const last = jsonParse_(props_().getProperty('ADMIN_TOTP_LAST'), {});
    last[s.id] = step; // the code just used cannot be reused
    props_().setProperty('ADMIN_TOTP_LAST', JSON.stringify(last));
    CacheService.getScriptCache().remove('totp_pending:' + s.id);
    audit_(s, 'totp_registered', s.id, null);
    return { totp: true };
  });
}

// ───────────── overview ─────────────

/** What the admin sees on the first tab. */
function adminOverview_(req) {
  return adminRead_(req, function () {
    const ed = currentEditionFresh_();
    const unread = rowsLite_('messages', ['team_id', 'read_at']);
    if (!ed) return { edition: null, unread_messages: unread.filter(function (m) { return !m.read_at; }).length };
    const teams = rowsLite_('teams', ['edition_id', 'status']).filter(function (t) { return t.edition_id === ed.id; });
    const teamIds = {};
    rowsLite_('teams', ['id', 'edition_id']).forEach(function (t) { if (t.edition_id === ed.id) teamIds[t.id] = true; });
    return {
      server_time: nowIso_(),
      edition: {
        id: ed.id, year: int_(ed.year), title: ed.title, status: ed.status, reg_mode: ed.reg_mode,
        registration_opens_at: ed.registration_opens_at || null, registration_closes_at: ed.registration_closes_at || null,
        registration_open: registrationOpen_(ed, Date.now()), last_backup_at: ed.last_backup_at || null,
        purged_at: ed.purged_at || null, purge_mode: ed.purge_mode || null,
      },
      teams: { total: teams.length, pending: teams.filter(function (t) { return t.status === 'pending'; }).length, approved: teams.filter(function (t) { return t.status === 'approved'; }).length },
      unread_messages: unread.filter(function (m) { return !m.read_at && teamIds[m.team_id]; }).length,
    };
  });
}
