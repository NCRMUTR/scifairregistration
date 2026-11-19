/**
 * Backup.gs — backup of one edition's participant data, and the guarded reset (purge). Stage G6. SAFETY-CRITICAL.
 *
 * BACKUP (admin_backup) writes into the PRIVATE Drive folder `backups`:
 *   <year>_<date>_<time>/  spreadsheet-copy · teams.csv members.csv advisors.csv consents.csv messages.csv uploads.csv
 *                          files-part1.zip …  (the files the teams uploaded, ~40 MB per zip)
 * Nothing is sent anywhere. A backup counts only when everything succeeded: then editions.last_backup_at and a backup_log
 * row are written, with the row counts of the snapshot.
 *
 * RESET (admin_purge) — every guard is checked here on the server, in this order, inside ONE script lock:
 *   1 valid admin session that signed in <= 10 min ago      → login_too_old
 *   2 confirm text exactly "PURGE <year>"                    → confirm_mismatch
 *   3 a backup of this edition <= 24 h old                   → backup_required
 *   4 …and the data has not changed since that backup        → backup_outdated   (extra guard: counts must still match)
 *   5 the admin password again (shares the admin lock-out)   → admin_invalid / admin_locked
 *   6 a fresh TOTP code (replay-proof, own lock-out)         → totp_invalid / totp_not_registered / admin_locked
 * The cheap checks run first so a refused request never burns a TOTP code. Rows are removed first, then the Drive files
 * are deleted PERMANENTLY (not trashed) and failures are reported. The gallery, the edition's settings, its upload-slot
 * definitions and every other edition are never touched.
 */

const BACKUP_MAX_AGE_MS = 24 * 3600 * 1000;
const PURGE_MAX_LOGIN_MS = 10 * 60 * 1000;
const ZIP_PART_BYTES = 40 * 1024 * 1024;
const BACKUP_TIME_BUDGET_MS = 5 * 60 * 1000;     // a Web App call is killed at 6 minutes
const PURGE_CHILD_SHEETS = ['members', 'advisors', 'consents', 'messages', 'uploads']; // all keyed by team_id
const BACKUP_CSV_SHEETS = ['teams', 'members', 'advisors', 'consents', 'messages', 'uploads'];

// ───────────── bulk sheet helpers (one write per sheet instead of one per row) ─────────────

/** Keep only the rows for which keep(row) is true. One bulk write. Returns how many rows were removed. Inside the lock. */
function filterRows_(name, keep) {
  const cols = SCHEMA[name];
  const sh = sheet_(name);
  const all = rows_(name);
  const kept = all.filter(keep);
  const removed = all.length - kept.length;
  if (!removed) return 0;
  if (kept.length) {
    const range = sh.getRange(2, 1, kept.length, cols.length);
    range.setNumberFormat('@');
    range.setValues(kept.map(function (r) { return toCells_(name, r); }));
  }
  // The kept rows are written first, then the leftover tail is cleared: a crash in between leaves duplicates, never lost rows.
  sh.getRange(kept.length + 2, 1, removed, cols.length).clearContent();
  return removed;
}

/** Apply patchFn(row) -> {col: value} to every row matching pred(row), in one write. Returns the number of rows changed. */
function patchRows_(name, pred, patchFn) {
  const cols = SCHEMA[name];
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const range = sh.getRange(2, 1, last - 1, cols.length);
  const values = range.getValues().map(function (v) { return v.map(function (x) { return x === null || x === undefined ? '' : String(x); }); });
  let n = 0;
  values.forEach(function (v) {
    const o = {};
    cols.forEach(function (c, j) { o[c] = v[j]; });
    if (!pred(o)) return;
    const patch = patchFn(o);
    cols.forEach(function (c, j) { if (Object.prototype.hasOwnProperty.call(patch, c)) v[j] = patch[c] === null || patch[c] === undefined ? '' : String(patch[c]); });
    n++;
  });
  if (n) {
    range.setNumberFormat('@');
    range.setValues(values);
  }
  return n;
}

// ───────────── what belongs to an edition ─────────────

/** All participant rows of an edition: { teams, members, advisors, consents, messages, uploads } (arrays of row objects). */
function editionData_(ed) {
  const teams = rows_('teams').filter(function (t) { return t.edition_id === ed.id; });
  const ids = {};
  teams.forEach(function (t) { ids[t.id] = true; });
  const out = { teams: teams };
  PURGE_CHILD_SHEETS.forEach(function (name) {
    out[name] = rows_(name).filter(function (r) { return ids[r.team_id]; });
  });
  return out;
}

function countsOf_(data) {
  const c = {};
  BACKUP_CSV_SHEETS.forEach(function (name) { c[name] = data[name].length; });
  return c;
}

function latestBackup_(ed) {
  return rows_('backup_log')
    .filter(function (b) { return b.edition_id === ed.id; })
    .sort(function (a, b) { return a.at < b.at ? 1 : -1; })[0] || null;
}

function sameCounts_(a, b) {
  return BACKUP_CSV_SHEETS.every(function (k) { return int_(a && a[k], -1) === int_(b && b[k], -2); });
}

// ───────────── CSV (UTF-8 with BOM, formula-safe) ─────────────

function csvCell_(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a leading = + - @ would be run as a formula by Excel
  return '"' + s.replace(/"/g, '""') + '"';
}

function csvBlob_(name, rows) {
  const cols = SCHEMA[name].filter(function (c) { return c !== 'pin_hash'; }); // the PIN hash is useless in a CSV
  const lines = [cols.map(csvCell_).join(',')];
  rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell_(r[c]); }).join(',')); });
  return Utilities.newBlob('﻿' + lines.join('\r\n') + '\r\n', 'text/csv', name + '.csv');
}

function stamp_() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace('T', '_').replace(':', '-'); } // Bangkok time

// ───────────── Drive: permanent deletion ─────────────

/** Permanently delete Drive files/folders by id (NOT the trash). -> { removed, already_gone, failed: [ids] } */
function driveDeleteForever_(ids) {
  const out = { removed: 0, already_gone: 0, failed: [] };
  const list = ids.filter(function (id) { return /^[A-Za-z0-9_-]{10,100}$/.test(id); });
  ids.forEach(function (id) { if (list.indexOf(id) === -1 && id) out.failed.push(id); });
  const token = ScriptApp.getOAuthToken();
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    let res;
    try {
      res = UrlFetchApp.fetchAll(chunk.map(function (id) {
        return { url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true', method: 'delete', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
      }));
    } catch (e) {
      console.error('drive delete batch failed: ' + e);
      chunk.forEach(function (id) { out.failed.push(id); });
      continue;
    }
    res.forEach(function (r, k) {
      const code = r.getResponseCode();
      if (code === 204 || code === 200) out.removed++;
      else if (code === 404) out.already_gone++;
      else { out.failed.push(chunk[k]); console.error('drive delete ' + chunk[k] + ' -> ' + code); }
    });
  }
  return out;
}

// ───────────── admin: status of backups ─────────────

/** req: { edition_id } -> what the backup/reset tab shows */
function adminBackups_(req) {
  return adminRead_(req, function (r, s) {
    const ed = findRow_('editions', String(r.edition_id || ''));
    const data = editionData_(ed);
    const last = latestBackup_(ed);
    const lastCounts = last ? jsonParse_(last.counts, {}).rows : null;
    return {
      server_time: nowIso_(),
      logged_in_at: new Date(s.at).toISOString(),
      login_max_age_sec: PURGE_MAX_LOGIN_MS / 1000,
      totp: !!jsonParse_(props_().getProperty('ADMIN_TOTP'), {})[s.id],
      edition: {
        id: ed.id, year: int_(ed.year), title: ed.title, status: ed.status, is_current: bool_(ed.is_current),
        registration_open: registrationOpen_(ed, Date.now()),
        last_backup_at: ed.last_backup_at || null, purged_at: ed.purged_at || null, purge_mode: ed.purge_mode || null,
      },
      counts: countsOf_(data),
      files_bytes: data.uploads.reduce(function (sum, u) { return sum + int_(u.size_bytes); }, 0),
      backup_is_current: !!last && sameCounts_(lastCounts, countsOf_(data)),
      backups: rows_('backup_log').filter(function (b) { return b.edition_id === ed.id; })
        .sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 10)
        .map(function (b) {
          const c = jsonParse_(b.counts, {});
          return { at: b.at, admin: b.admin, counts: c.rows || {}, folder_url: c.folder_url || '', files: c.files || null };
        }),
    };
  });
}

// ───────────── admin: backup ─────────────

/**
 * req: { edition_id } -> { at, folder_url, counts, files: { count, bytes, parts, missing } }
 * Phase 1 (inside the lock, seconds): snapshot rows -> CSVs + a copy of the spreadsheet, so they all show the same moment.
 * Phase 2 (no lock, may take minutes): zip the uploaded files — other users are not blocked meanwhile.
 * Phase 3 (inside the lock): record last_backup_at + backup_log, only if phases 1–2 fully succeeded.
 */
function adminBackup_(req) {
  const s = adminSession_(req);
  rateLimit_('admin_backup', 30, 600);
  const started = Date.now();

  const snap = withLock_(function () {
    const ed = findRow_('editions', String(req.edition_id || ''));
    const data = editionData_(ed);
    const at = nowIso_();
    const folder = DriveApp.getFolderById(props_().getProperty('FOLDER_BACKUPS')).createFolder(int_(ed.year) + '_' + stamp_());
    BACKUP_CSV_SHEETS.forEach(function (name) { folder.createFile(csvBlob_(name, data[name])); });
    DriveApp.getFileById(props_().getProperty('SHEET_ID')).makeCopy('spreadsheet-copy (' + stamp_() + ')', folder);
    return { edId: ed.id, year: int_(ed.year), at: at, folderId: folder.getId(), folderUrl: folder.getUrl(), counts: countsOf_(data), uploads: data.uploads, teams: data.teams };
  });

  // Phase 2: the uploaded files, in ZIP parts.
  const refOf = {};
  snap.teams.forEach(function (t) { refOf[t.id] = t.ref_no; });
  const folder = DriveApp.getFolderById(snap.folderId);
  const stats = { count: 0, bytes: 0, parts: 0, missing: 0 };
  let blobs = [];
  let partBytes = 0;
  const flush = function () {
    if (!blobs.length) return;
    stats.parts++;
    folder.createFile(Utilities.zip(blobs, 'files-part' + stats.parts + '.zip'));
    blobs = [];
    partBytes = 0;
  };
  const used = {};
  snap.uploads.forEach(function (u) {
    if (Date.now() - started > BACKUP_TIME_BUDGET_MS) throw fail_('backup_failed', 'time budget exceeded');
    let blob;
    try { blob = DriveApp.getFileById(u.drive_file_id).getBlob(); } catch (e) { stats.missing++; return; }
    const base = String(u.file_name || 'file').replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'file';
    let path = (refOf[u.team_id] || 'team') + '/' + base;
    if (used[path]) path = (refOf[u.team_id] || 'team') + '/' + u.id.slice(0, 6) + '_' + base;
    used[path] = true;
    blob.setName(path);
    const size = blob.getBytes().length;
    if (partBytes > 0 && partBytes + size > ZIP_PART_BYTES) flush();
    blobs.push(blob);
    partBytes += size;
    stats.count++;
    stats.bytes += size;
  });
  flush();

  // Phase 3: only now does the backup "count".
  return withLock_(function () {
    const ed = findRow_('editions', snap.edId);
    const prev = time_(ed.last_backup_at);
    if (prev === null || prev < time_(snap.at)) update_('editions', ed._row, { last_backup_at: snap.at });
    append_('backup_log', {
      id: uuid_(), edition_id: ed.id, admin: s.id, at: snap.at,
      counts: JSON.stringify({ rows: snap.counts, files: stats, folder_url: snap.folderUrl }),
    });
    audit_(s, 'backup', ed.id, { year: snap.year, rows: snap.counts, files: stats });
    return { at: snap.at, folder_url: snap.folderUrl, counts: snap.counts, files: stats };
  });
}

// ───────────── admin: reset (purge) ─────────────

/** Check the admin password again; failures share the admin lock-out with the sign-in. Inside the lock. */
function requirePassword_(s, password) {
  const att = attemptGet_('admin');
  if (attemptLocked_(att)) throw fail_('admin_locked');
  if (!adminPasswordOk_(s.id, password)) {
    const fails = attemptFail_('admin', att);
    if (fails >= MAX_PIN_FAILS) throw fail_('admin_locked');
    throw fail_('admin_invalid', '', { attempts_left: MAX_PIN_FAILS - fails });
  }
  attemptClear_(att);
}

/**
 * req: { edition_id, mode: 'anonymize' | 'delete', confirm: 'PURGE <year>', password, totp }
 * -> { mode, year, rows: {…removed per sheet}, teams_anonymized, files: { removed, already_gone, failed, failed_ids }, folder_removed }
 */
function adminPurge_(req) {
  rateLimit_('admin_purge', 30, 600);
  return adminWrite_(req, function (r, s) {
    const now = Date.now();
    // 1 — fresh sign-in
    if (now - s.at > PURGE_MAX_LOGIN_MS) throw fail_('login_too_old');
    const mode = r.mode;
    if (mode !== 'anonymize' && mode !== 'delete') throw fail_('invalid_input');
    const ed = findRow_('editions', String(r.edition_id || ''));
    const year = int_(ed.year);
    // 2 — typed confirmation
    if (typeof r.confirm !== 'string' || r.confirm !== 'PURGE ' + year) throw fail_('confirm_mismatch');
    if (ed.purged_at && (ed.purge_mode === 'delete' || mode === 'anonymize')) throw fail_('already_purged');
    // 3 + 4 — a recent backup that still matches the data
    const lastAt = time_(ed.last_backup_at);
    if (lastAt === null || now - lastAt > BACKUP_MAX_AGE_MS) throw fail_('backup_required');
    const data = editionData_(ed);
    const counts = countsOf_(data);
    const last = latestBackup_(ed);
    if (!last || !sameCounts_(jsonParse_(last.counts, {}).rows, counts)) throw fail_('backup_outdated');
    // 5 + 6 — password and TOTP, last, so a refused request never uses up a code
    requirePassword_(s, r.password);
    totpVerify_(s.id, r.totp);

    audit_(s, 'purge_start', ed.id, { year: year, mode: mode, rows: counts });
    try {
      const ids = {};
      data.teams.forEach(function (t) { ids[t.id] = true; });
      const memberCount = {};
      data.members.forEach(function (m) { memberCount[m.team_id] = (memberCount[m.team_id] || 0) + 1; });
      const fileIds = data.uploads.map(function (u) { return u.drive_file_id; }).filter(function (x) { return x; });

      // rows first …
      let anonymized = 0;
      if (mode === 'anonymize') {
        anonymized = patchRows_('teams', function (t) { return t.edition_id === ed.id; }, function (t) {
          return { pin_hash: '', members_count_at_purge: memberCount[t.id] || 0 }; // PIN unusable, head-count kept
        });
      }
      const removed = {};
      PURGE_CHILD_SHEETS.forEach(function (name) { removed[name] = filterRows_(name, function (row) { return !ids[row.team_id]; }); });
      if (mode === 'delete') removed.teams = filterRows_('teams', function (t) { return t.edition_id !== ed.id; });
      removed.lookup_attempts = filterRows_('lookup_attempts', function (a) { return a.key.indexOf(year + ':') !== 0; });
      update_('editions', findRow_('editions', ed.id)._row, { purged_at: nowIso_(), purge_mode: mode });

      // … then the files, permanently
      const files = driveDeleteForever_(fileIds);
      // The year folder (team-files/<year>) also holds stray files of interrupted uploads, so it goes too — but only when
      // every tracked file was deleted, otherwise it stays so the admin can find the failed ones (their ids are reported).
      let folderRemoved = false;
      if (!files.failed.length) {
        try {
          const root = DriveApp.getFolderById(props_().getProperty('FOLDER_TEAM_FILES'));
          const it = root.getFoldersByName(String(year));
          while (it.hasNext()) {
            const res = driveDeleteForever_([it.next().getId()]);
            if (res.removed) folderRemoved = true;
            else if (res.failed.length) files.failed = files.failed.concat(res.failed);
          }
        } catch (e) { console.error('year folder not removed: ' + e); }
      }

      const result = {
        mode: mode, year: year, teams_anonymized: anonymized, rows: removed,
        files: { removed: files.removed, already_gone: files.already_gone, failed: files.failed.length, failed_ids: files.failed.slice(0, 50) },
        folder_removed: folderRemoved,
      };
      audit_(s, 'purge_done', ed.id, { year: year, mode: mode, rows: removed, files: { removed: files.removed, failed: files.failed.length }, failed_ids: files.failed.slice(0, 50) });
      bustPublicCache_();
      return result;
    } catch (e) {
      audit_(s, 'purge_failed', ed.id, { year: year, mode: mode, error: String(e && e.message || e).slice(0, 300) });
      throw e && e.reason ? e : fail_('purge_failed');
    }
  });
}
