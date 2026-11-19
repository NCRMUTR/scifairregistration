/**
 * Team.gs — what a team can do after applying, proven with (English team name + PIN):
 * lookup_team (status page), prepare_upload + confirm_upload (files to Drive), send_message (to the committee).
 *
 * Every one of them goes through verifyTeam_(), which runs INSIDE the script lock so the 5-failures/15-minute
 * lock-out cannot be beaten by firing many guesses in parallel. "Team does not exist" and "wrong PIN" are
 * indistinguishable (same reason code, same counting).
 */

const MAX_PIN_FAILS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const MAX_MESSAGE_CHARS = 2000;
const MAX_MESSAGES_PER_TEAM_PER_HOUR = 5;

// ───────────── PIN check with lock-out ─────────────

/** Drop attempt rows whose window ended and that are not locked any more (keeps the sheet small). Call inside the lock. */
function pruneAttempts_() {
  const sh = sheet_('lookup_attempts');
  const last = sh.getLastRow();
  if (last < 202) return;
  const now = Date.now();
  const keep = rows_('lookup_attempts').filter(function (r) {
    const locked = time_(r.locked_until);
    const start = time_(r.window_start);
    return (locked !== null && locked > now) || (start !== null && now - start < PIN_LOCK_MS);
  });
  const cols = SCHEMA.lookup_attempts.length;
  sh.getRange(2, 1, last - 1, cols).clearContent();
  if (keep.length) {
    const range = sh.getRange(2, 1, keep.length, cols);
    range.setNumberFormat('@');
    range.setValues(keep.map(function (r) { return toCells_('lookup_attempts', r); }));
  }
}

/**
 * Check (team name, PIN) for the CURRENT edition. MUST be called inside withLock_().
 * Returns { ed, team } or throws fail_('locked') / fail_('invalid_credentials', …, { attempts_left }).
 */
function verifyTeam_(nameEn, pin) {
  const ed = currentEditionFresh_();
  if (!ed) throw fail_('no_current_edition');
  const key = nameKey_(nameEn);
  if (!key) throw fail_('invalid_credentials'); // nothing to look up (and nothing worth counting)
  const attemptKey = ed.year + ':' + key.slice(0, 120);
  const now = Date.now();

  const att = rows_('lookup_attempts').filter(function (r) { return r.key === attemptKey; })[0] || null;
  if (att) {
    const until = time_(att.locked_until);
    if (until !== null && until > now) throw fail_('locked');
  }

  const team = rows_('teams').filter(function (t) { return t.edition_id === ed.id && t.name_en_key === key; })[0] || null;
  const pinOk = !!team && !!team.pin_hash && typeof pin === 'string' && RE_PIN.test(pin) && pinHash_(team.id, pin) === team.pin_hash;
  if (pinOk) {
    if (att) deleteRow_('lookup_attempts', att._row);
    return { ed: ed, team: team };
  }

  // Same path whether the team exists or not.
  const start = att ? time_(att.window_start) : null;
  const fresh = !att || start === null || now - start > PIN_LOCK_MS;
  const fails = fresh ? 1 : int_(att.fails, 0) + 1;
  const row = {
    key: attemptKey,
    fails: fails,
    window_start: fresh ? new Date(now).toISOString() : att.window_start,
    locked_until: fails >= MAX_PIN_FAILS ? new Date(now + PIN_LOCK_MS).toISOString() : '',
  };
  if (att) update_('lookup_attempts', att._row, row);
  else append_('lookup_attempts', row);
  pruneAttempts_();
  if (fails >= MAX_PIN_FAILS) throw fail_('locked');
  throw fail_('invalid_credentials', '', { attempts_left: MAX_PIN_FAILS - fails });
}

// ───────────── status page ─────────────

function acceptList_(slot) {
  return String(slot.accept || '').toLowerCase().split(/[\s,]+/).filter(function (x) { return x; }).map(function (x) { return x.replace(/^\./, ''); });
}

function fileExt_(name) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Open upload slots of the team's edition, each with what this team already uploaded. */
function slotsForTeam_(team) {
  const now = Date.now();
  const uploads = rows_('uploads').filter(function (u) { return u.team_id === team.id; });
  return rows_('upload_slots')
    .filter(function (s) { return s.edition_id === team.edition_id && bool_(s.is_open); })
    .sort(function (a, b) { return int_(a.sort_order) - int_(b.sort_order) || (a.created_at < b.created_at ? -1 : 1); })
    .map(function (s) {
      const up = uploads.filter(function (u) { return u.slot_id === s.id; })[0] || null;
      const deadline = time_(s.deadline);
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        accept: acceptList_(s),
        max_mb: int_(s.max_mb, 5),
        deadline: s.deadline || null,
        deadline_passed: deadline !== null && deadline < now,
        uploaded: up && { file_name: up.file_name, size_bytes: int_(up.size_bytes), uploaded_at: up.uploaded_at },
      };
    });
}

/** req: { name_en, pin } -> team summary, members, advisors, open upload slots. Read-only for the team. */
function lookupTeam_(req) {
  rateLimit_('lookup_team', 150, 60);
  const ok = withLock_(function () { return verifyTeam_(req.name_en, req.pin); });
  const team = ok.team;
  const members = rows_('members').filter(function (m) { return m.team_id === team.id; })
    .sort(function (a, b) { return int_(a.order_no) - int_(b.order_no); })
    .map(function (m) { return { order_no: int_(m.order_no), student_id: m.student_id, full_name: m.full_name, phone: m.phone }; });
  const advisors = rows_('advisors').filter(function (a) { return a.team_id === team.id; })
    .map(function (a) { return { full_name: a.full_name, department: a.department, faculty: a.faculty }; });
  return {
    server_time: nowIso_(),
    team: { ref_no: team.ref_no, name_th: team.name_th, name_en: team.name_en, status: team.status, created_at: team.created_at },
    edition: { year: int_(ok.ed.year), title: ok.ed.title },
    members: members,
    advisors: advisors,
    slots: slotsForTeam_(team),
  };
}

// ───────────── messages to the committee ─────────────

/** req: { name_en, pin, body } */
function sendMessage_(req) {
  rateLimit_('send_message', 60, 600);
  return withLock_(function () {
    const ok = verifyTeam_(req.name_en, req.pin);
    const body = typeof req.body === 'string' ? req.body.trim() : '';
    if (!body || body.length > MAX_MESSAGE_CHARS) throw fail_('invalid_input');
    const since = Date.now() - 3600 * 1000;
    const recent = rowsLite_('messages', ['team_id', 'created_at']).filter(function (m) {
      return m.team_id === ok.team.id && (time_(m.created_at) || 0) > since;
    }).length;
    if (recent >= MAX_MESSAGES_PER_TEAM_PER_HOUR) throw fail_('rate_limited');
    append_('messages', { id: uuid_(), team_id: ok.team.id, body: body, created_at: nowIso_(), read_at: '' });
    return { sent: true };
  });
}

// ───────────── file uploads (browser -> Drive directly) ─────────────

/** Open slot of the team's edition that still accepts files, or throws slot_closed / deadline_passed. */
function openSlot_(team, slotId) {
  const slot = rows_('upload_slots').filter(function (s) { return s.id === slotId && s.edition_id === team.edition_id && bool_(s.is_open); })[0];
  if (!slot) throw fail_('slot_closed');
  const deadline = time_(slot.deadline);
  if (deadline !== null && deadline < Date.now()) throw fail_('deadline_passed');
  return slot;
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** team-files/<year>/<ref_no>_<team id prefix> — one folder per team, so a whole edition can be removed by folder. */
function teamFolder_(ed, team) {
  const root = DriveApp.getFolderById(props_().getProperty('FOLDER_TEAM_FILES'));
  const editionFolder = getOrCreateFolder_(root, String(ed.year));
  return getOrCreateFolder_(editionFolder, team.ref_no + '_' + team.id.slice(0, 8));
}

function safeFileName_(name, ext) {
  let base = String(name || '').replace(/\.[A-Za-z0-9]{1,10}$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  if (!base) base = 'file';
  return base + '.' + ext;
}

function allowedOrigin_(origin) {
  const list = String(props_().getProperty('ALLOWED_ORIGINS') || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  return typeof origin === 'string' && list.indexOf(origin) !== -1;
}

/**
 * Step 1. req: { name_en, pin, slot_id, file_name, size, mime, origin }
 * Checks team, slot, deadline, type and size, then asks Drive for a resumable upload session whose URL the browser
 * PUTs the file to directly. Returns { upload_url }.
 */
function prepareUpload_(req) {
  rateLimit_('prepare_upload', 150, 600);
  if (!allowedOrigin_(req.origin)) throw fail_('origin_not_allowed');
  const size = Number(req.size);
  const fileName = typeof req.file_name === 'string' ? req.file_name : '';
  const ext = fileExt_(fileName);

  const ctx = withLock_(function () {
    const ok = verifyTeam_(req.name_en, req.pin);
    const slot = openSlot_(ok.team, String(req.slot_id || ''));
    if (!isFinite(size) || size <= 0 || size > int_(slot.max_mb, 5) * 1024 * 1024) throw fail_('file_too_large');
    if (!ext || acceptList_(slot).indexOf(ext) === -1) throw fail_('file_type_not_allowed');
    return { folderId: teamFolder_(ok.ed, ok.team).getId(), slotId: slot.id };
  });

  const storedName = ctx.slotId + '_' + Date.now() + '_' + safeFileName_(fileName, ext);
  const mime = typeof req.mime === 'string' && /^[A-Za-z0-9.+\/-]{1,100}$/.test(req.mime) ? req.mime : 'application/octet-stream';
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(Math.floor(size)),
      Origin: req.origin, // makes Google answer the browser's PUT with CORS headers for this origin
    },
    payload: JSON.stringify({ name: storedName, parents: [ctx.folderId] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.error('drive session failed ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
    throw fail_('upload_failed');
  }
  const headers = res.getAllHeaders();
  const location = headers['Location'] || headers['location'];
  if (!location) throw fail_('upload_failed');
  return { upload_url: location };
}

/**
 * Step 3 (after the browser's PUT finished). req: { name_en, pin, slot_id, file_id, file_name }
 * Accepts the file only if it really is in THIS team's folder, was created for THIS slot, has an allowed type and a
 * legal size. Replacing an earlier upload moves the old file to the trash.
 */
function confirmUpload_(req) {
  rateLimit_('confirm_upload', 150, 600);
  return withLock_(function () {
    const ok = verifyTeam_(req.name_en, req.pin);
    const slot = openSlot_(ok.team, String(req.slot_id || ''));
    const fileId = typeof req.file_id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(req.file_id) ? req.file_id : '';
    if (!fileId) throw fail_('file_not_found');

    let file;
    try { file = DriveApp.getFileById(fileId); } catch (e) { throw fail_('file_not_found'); }
    const folderId = teamFolder_(ok.ed, ok.team).getId();
    let inFolder = false;
    const parents = file.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === folderId) inFolder = true; }
    if (!inFolder || file.getName().indexOf(slot.id + '_') !== 0) throw fail_('file_not_found');

    const size = file.getSize();
    const ext = fileExt_(file.getName());
    if (size <= 0 || size > int_(slot.max_mb, 5) * 1024 * 1024) { file.setTrashed(true); throw fail_('file_too_large'); }
    if (!ext || acceptList_(slot).indexOf(ext) === -1) { file.setTrashed(true); throw fail_('file_type_not_allowed'); }

    const shownName = (typeof req.file_name === 'string' && req.file_name.trim() ? req.file_name.trim() : file.getName()).slice(0, 200);
    const now = nowIso_();
    const prev = rows_('uploads').filter(function (u) { return u.team_id === ok.team.id && u.slot_id === slot.id; })[0];
    if (prev) {
      update_('uploads', prev._row, { drive_file_id: fileId, file_name: shownName, size_bytes: size, uploaded_at: now });
      if (prev.drive_file_id && prev.drive_file_id !== fileId) {
        try { DriveApp.getFileById(prev.drive_file_id).setTrashed(true); } catch (e) { console.error('could not trash replaced file ' + prev.drive_file_id); }
      }
    } else {
      append_('uploads', { id: uuid_(), team_id: ok.team.id, slot_id: slot.id, drive_file_id: fileId, file_name: shownName, size_bytes: size, uploaded_at: now });
    }
    return { file_name: shownName, size_bytes: size, uploaded_at: now };
  });
}
