/**
 * Db.gs — Google Sheets as the database.
 * Rules (docs/GAS-DESIGN.md §2):
 *  - every cell is stored as TEXT: numbers/booleans/dates are written as strings ('7', 'true', ISO timestamps),
 *    so values starting with = + - @ are never treated as formulas and leading zeros survive;
 *  - the spreadsheet is private to the owner; the browser can only reach it through the actions in Public.gs / Admin.gs;
 *  - every write must be done while holding withLock_() (Code.gs).
 */

const SCHEMA = {
  site_settings: ['key', 'value', 'updated_at'],
  editions: ['id', 'year', 'title', 'subtitle', 'intro_text', 'background_file_id', 'rules_pdf_file_id', 'ack_text', 'pdpa_text',
             'key_dates', 'max_members', 'reg_mode', 'registration_opens_at', 'registration_closes_at', 'ref_prefix', 'ref_counter',
             'is_current', 'status', 'last_backup_at', 'purged_at', 'purge_mode', 'created_at'],
  teams: ['id', 'edition_id', 'ref_no', 'name_th', 'name_en', 'name_en_key', 'pin_hash', 'status', 'members_count_at_purge', 'created_at'],
  members: ['id', 'team_id', 'edition_id', 'order_no', 'student_id', 'full_name', 'phone'],
  advisors: ['id', 'team_id', 'full_name', 'department', 'faculty'],
  consents: ['team_id', 'ack_text_version', 'pdpa_text_version', 'accepted_at'],
  upload_slots: ['id', 'edition_id', 'title', 'description', 'accept', 'max_mb', 'deadline', 'is_open', 'sort_order', 'created_at'],
  uploads: ['id', 'team_id', 'slot_id', 'drive_file_id', 'file_name', 'size_bytes', 'uploaded_at'],
  messages: ['id', 'team_id', 'body', 'created_at', 'read_at'],
  gallery_albums: ['id', 'edition_id', 'title', 'description', 'event_date', 'external_url', 'cover_photo_id', 'sort_order', 'is_published', 'created_at'],
  gallery_photos: ['id', 'album_id', 'drive_file_id', 'caption', 'width', 'height', 'sort_order', 'created_at'],
  lookup_attempts: ['key', 'fails', 'window_start', 'locked_until'],
  backup_log: ['id', 'edition_id', 'admin', 'counts', 'at'],
  audit_log: ['id', 'admin', 'action', 'target', 'detail', 'at'],
};

let spreadsheetCache_ = null; // per execution

function props_() {
  return PropertiesService.getScriptProperties();
}

/** An Error carrying a machine-readable reason code (mapped to Thai text in src/lib/api.js). */
function fail_(reason, detail, extra) {
  const err = new Error(detail ? reason + ': ' + detail : reason);
  err.reason = reason;
  if (extra) err.extra = extra; // small public fields sent next to `reason` (e.g. attempts_left)
  return err;
}

function spreadsheet_() {
  if (spreadsheetCache_) return spreadsheetCache_;
  const id = props_().getProperty('SHEET_ID');
  if (!id) throw fail_('not_setup', 'run setup() once from the Apps Script editor');
  spreadsheetCache_ = SpreadsheetApp.openById(id);
  return spreadsheetCache_;
}

function sheet_(name) {
  const sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw fail_('not_setup', 'missing sheet ' + name);
  return sh;
}

/** All data rows of a sheet as plain objects of strings, plus `_row` (1-based sheet row number). */
function rows_(name) {
  const cols = SCHEMA[name];
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.map(function (v, i) {
    const o = { _row: i + 2 };
    for (let j = 0; j < cols.length; j++) o[cols[j]] = v[j] === null || v[j] === undefined ? '' : String(v[j]);
    return o;
  });
}

function toCells_(name, obj) {
  return SCHEMA[name].map(function (c) {
    const v = obj[c];
    return v === null || v === undefined ? '' : String(v);
  });
}

/** Append one row (text-formatted). Returns the new row number. Call inside withLock_(). */
function append_(name, obj) {
  const sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, 1, SCHEMA[name].length);
  range.setNumberFormat('@');
  range.setValues([toCells_(name, obj)]);
  return row;
}

/** Overwrite the given fields of an existing row. Call inside withLock_(). */
function update_(name, rowNumber, patch) {
  const cols = SCHEMA[name];
  const sh = sheet_(name);
  const range = sh.getRange(rowNumber, 1, 1, cols.length);
  const current = range.getValues()[0].map(function (v) { return v === null || v === undefined ? '' : String(v); });
  cols.forEach(function (c, j) {
    if (Object.prototype.hasOwnProperty.call(patch, c)) current[j] = patch[c] === null || patch[c] === undefined ? '' : String(patch[c]);
  });
  range.setNumberFormat('@');
  range.setValues([current]);
}

/** Append several rows in one write (text-formatted). Returns the first new row number. Call inside withLock_(). */
function appendMany_(name, objs) {
  if (!objs.length) return null;
  const sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, objs.length, SCHEMA[name].length);
  range.setNumberFormat('@');
  range.setValues(objs.map(function (o) { return toCells_(name, o); }));
  return row;
}

/** Delete a sheet row (used only to roll back a half-written application, always from the bottom up). */
function deleteRow_(name, rowNumber) {
  sheet_(name).deleteRow(rowNumber);
}

/** Like rows_ but reads only the listed columns (faster for big sheets). */
function rowsLite_(name, wanted) {
  const cols = SCHEMA[name];
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const data = {};
  wanted.forEach(function (c) { data[c] = sh.getRange(2, cols.indexOf(c) + 1, last - 1, 1).getValues(); });
  const out = [];
  for (let i = 0; i < last - 1; i++) {
    const o = { _row: i + 2 };
    wanted.forEach(function (c) { const v = data[c][i][0]; o[c] = v === null || v === undefined ? '' : String(v); });
    out.push(o);
  }
  return out;
}

function bool_(v) { return String(v) === 'true'; }
function int_(v, fallback) { const n = parseInt(v, 10); return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n; }
function jsonParse_(v, fallback) {
  try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function time_(v) { // ISO string -> ms since epoch, or null
  if (!v) return null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}
function nowIso_() { return new Date().toISOString(); }
function uuid_() { return Utilities.getUuid(); }
