/**
 * Code.gs — Web App entry points and the action router.
 *
 * Contract (docs/GAS-DESIGN.md §1): every call is POST with Content-Type text/plain (a "simple" CORS request) and a
 * JSON body { action, ...payload, session? }. Replies: { ok:true, data } or { ok:false, reason }.
 * `reason` is a short code mapped to Thai text in src/lib/api.js. Unexpected errors never leak details to visitors.
 */

const VERSION = 'g1';

function doGet() {
  return reply_({ ok: true, data: { service: 'sci-tech-registration', version: VERSION } });
}

function doPost(e) {
  let action = '';
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    action = typeof req.action === 'string' ? req.action : '';
    const handler = ACTIONS[action];
    if (!handler) return reply_({ ok: false, reason: 'unknown_action' });
    return reply_({ ok: true, data: handler(req) });
  } catch (err) {
    if (err && err.reason) return reply_({ ok: false, reason: err.reason });
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
