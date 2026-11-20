/**
 * Code.gs — Web App entry points and the action router.
 *
 * Contract (docs/GAS-DESIGN.md §1): every call is POST with Content-Type text/plain (a "simple" CORS request) and a
 * JSON body { action, ...payload, session? }. Replies: { ok:true, data } or { ok:false, reason }.
 * `reason` is a short code mapped to Thai text in src/lib/api.js. Unexpected errors never leak details to visitors.
 */

const VERSION = 'g9';

function doGet() {
  return reply_({ ok: true, data: { service: 'sci-tech-registration', version: VERSION } });
}

function doPost(e) {
  let action = '';
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    action = typeof req.action === 'string' ? req.action : '';
    // Own keys only: 'constructor', 'toString', '__proto__' … are inherited from Object and must not be callable.
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (typeof handler !== 'function') return reply_({ ok: false, reason: 'unknown_action' });
    return reply_({ ok: true, data: handler(req) });
  } catch (err) {
    if (err && err.reason) return reply_(Object.assign({}, err.extra || {}, { ok: false, reason: err.reason }));
    console.error('action ' + action + ' failed: ' + (err && err.stack || err)); // visible in Apps Script > Executions only
    return reply_({ ok: false, reason: 'server_error' });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Every action the browser may call. Later stages add their actions here (never expose a helper by accident).
 * Handlers are wrapped in functions so they are looked up at call time — Apps Script loads files one by one and a
 * top-level reference to a function from a file that loads later would be undefined.
 */
const ACTIONS = {
  ping: function () { return { version: VERSION, serverTime: nowIso_() }; },
  public_site: function (req) { return publicSite_(req); },
  student_id_taken: function (req) { return studentIdTaken_(req); },
  submit_team: function (req) { return submitTeam_(req); },
  lookup_team: function (req) { return lookupTeam_(req); },
  prepare_upload: function (req) { return prepareUpload_(req); },
  confirm_upload: function (req) { return confirmUpload_(req); },
  send_message: function (req) { return sendMessage_(req); },
  public_gallery: function (req) { return publicGallery_(req); },
  public_album: function (req) { return publicAlbum_(req); },

  // ── admin (every one except admin_login needs req.session) ──
  admin_login: function (req) { return adminLogin_(req); },
  admin_logout: function (req) { return adminLogout_(req); },
  admin_me: function (req) { return adminMe_(req); },
  admin_change_password: function (req) { return adminChangePassword_(req); },
  admin_totp_begin: function (req) { return adminTotpBegin_(req); },
  admin_totp_confirm: function (req) { return adminTotpConfirm_(req); },
  admin_overview: function (req) { return adminOverview_(req); },
  admin_editions: function (req) { return adminEditions_(req); },
  admin_create_edition: function (req) { return adminCreateEdition_(req); },
  admin_set_current: function (req) { return adminSetCurrent_(req); },
  admin_save_edition: function (req) { return adminSaveEdition_(req); },
  admin_settings: function (req) { return adminSettings_(req); },
  admin_save_settings: function (req) { return adminSaveSettings_(req); },
  admin_prepare_asset: function (req) { return adminPrepareAsset_(req); },
  admin_confirm_asset: function (req) { return adminConfirmAsset_(req); },
  admin_clear_asset: function (req) { return adminClearAsset_(req); },
  admin_teams: function (req) { return adminTeams_(req); },
  admin_set_team_status: function (req) { return adminSetTeamStatus_(req); },
  admin_mark_read: function (req) { return adminMarkRead_(req); },
  admin_reset_pin: function (req) { return adminResetPin_(req); },
  admin_update_team: function (req) { return adminUpdateTeam_(req); },
  admin_delete_team: function (req) { return adminDeleteTeam_(req); },
  admin_slots: function (req) { return adminSlots_(req); },
  admin_save_slot: function (req) { return adminSaveSlot_(req); },
  admin_delete_slot: function (req) { return adminDeleteSlot_(req); },
  admin_albums: function (req) { return adminAlbums_(req); },
  admin_album: function (req) { return adminAlbum_(req); },
  admin_save_album: function (req) { return adminSaveAlbum_(req); },
  admin_reorder_albums: function (req) { return adminReorderAlbums_(req); },
  admin_delete_album: function (req) { return adminDeleteAlbum_(req); },
  admin_prepare_photo: function (req) { return adminPreparePhoto_(req); },
  admin_confirm_photo: function (req) { return adminConfirmPhoto_(req); },
  admin_update_photo: function (req) { return adminUpdatePhoto_(req); },
  admin_set_cover: function (req) { return adminSetCover_(req); },
  admin_reorder_photos: function (req) { return adminReorderPhotos_(req); },
  admin_delete_photo: function (req) { return adminDeletePhoto_(req); },
  admin_backups: function (req) { return adminBackups_(req); },
  admin_backup: function (req) { return adminBackup_(req); },
  admin_purge: function (req) { return adminPurge_(req); },
};

// ───────────── shared helpers used by every write action ─────────────

/** Run fn while holding the script-wide lock. ALL writes must go through this (unique IDs/names, counters). */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    throw fail_('busy');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Crude GLOBAL rate limit (Apps Script cannot see the caller's IP): at most `limit` calls per `windowSec` seconds
 * for this bucket across all visitors. Throws rate_limited. Counter lives in CacheService (best effort).
 */
function rateLimit_(bucket, limit, windowSec) {
  const cache = CacheService.getScriptCache();
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  const key = 'rl:' + bucket + ':' + slot;
  const n = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(n), windowSec + 5);
  if (n > limit) throw fail_('rate_limited');
}
