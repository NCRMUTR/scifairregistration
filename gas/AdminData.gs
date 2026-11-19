/**
 * AdminData.gs — what an admin can read and change: editions, site content (+ logo/background/PDF uploads),
 * teams (status, edit on behalf, delete, PIN reset, messages) and upload slots.
 *
 * Every action needs a valid admin session (Admin.gs). Writes run inside the script lock and are audited.
 */

// ───────────── small helpers ─────────────

function findRow_(sheetName, id) {
  const row = rows_(sheetName).filter(function (r) { return r.id === id; })[0];
  if (!row) throw fail_('not_found');
  return row;
}

/** Delete every row of a sheet matching `pred(row)`, bottom-up so row numbers stay valid. Returns how many. */
function deleteWhere_(sheetName, pred) {
  const hits = rows_(sheetName).filter(pred).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  hits.forEach(function (n) { deleteRow_(sheetName, n); });
  return hits.length;
}

function str_(v, max, required) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw fail_('invalid_input');
  if (s.length > max) throw fail_('invalid_input');
  return s;
}

function isoOrBlank_(v) {
  if (v === '' || v === null || v === undefined) return '';
  const t = new Date(v).getTime();
  if (isNaN(t)) throw fail_('invalid_input');
  return new Date(t).toISOString();
}

function driveViewUrls_(fileId) {
  const id = encodeURIComponent(fileId);
  return { view_url: 'https://drive.google.com/file/d/' + id + '/view', download_url: 'https://drive.google.com/uc?export=download&id=' + id };
}

function trashFile_(fileId) {
  if (!fileId) return false;
  try { DriveApp.getFileById(fileId).setTrashed(true); return true; } catch (e) { console.error('could not trash ' + fileId); return false; }
}

// ───────────── editions ─────────────

function editionAdminView_(e, teamCount) {
  return {
    id: e.id, year: int_(e.year), title: e.title, subtitle: e.subtitle, intro_text: e.intro_text,
    ack_text: e.ack_text, pdpa_text: e.pdpa_text, key_dates: jsonParse_(e.key_dates, []),
    max_members: int_(e.max_members, 7), reg_mode: e.reg_mode,
    registration_opens_at: e.registration_opens_at || null, registration_closes_at: e.registration_closes_at || null,
    ref_prefix: e.ref_prefix, is_current: bool_(e.is_current), status: e.status,
    last_backup_at: e.last_backup_at || null, purged_at: e.purged_at || null, purge_mode: e.purge_mode || null,
    registration_open: registrationOpen_(e, Date.now()), teams_count: teamCount,
    background_url: e.background_file_id ? driveThumb_(e.background_file_id, 480) : null,
    rules_pdf: e.rules_pdf_file_id ? drivePdf_(e.rules_pdf_file_id) : null,
  };
}

function adminEditions_(req) {
  return adminRead_(req, function () {
    const counts = {};
    rowsLite_('teams', ['edition_id']).forEach(function (t) { counts[t.edition_id] = (counts[t.edition_id] || 0) + 1; });
    return {
      server_time: nowIso_(),
      editions: rows_('editions').sort(function (a, b) { return int_(b.year) - int_(a.year); })
        .map(function (e) { return editionAdminView_(e, counts[e.id] || 0); }),
    };
  });
}

/** req: { year, copy_from? } — a new edition starts as draft, registration closed, not current. */
function adminCreateEdition_(req) {
  return adminWrite_(req, function (r, s) {
    const year = int_(r.year, 0);
    if (year < 2000 || year > 2100) throw fail_('invalid_input');
    const all = rows_('editions');
    if (all.some(function (e) { return int_(e.year) === year; })) throw fail_('edition_exists');
    const src = r.copy_from ? all.filter(function (e) { return e.id === r.copy_from; })[0] : null;
    if (r.copy_from && !src) throw fail_('not_found');
    const id = uuid_();
    const now = nowIso_();
    append_('editions', {
      id: id, year: year,
      title: src ? String(src.title).split(String(src.year)).join(String(year)) : 'Sci-Tech Pitching ' + year,
      subtitle: src ? src.subtitle : '', intro_text: src ? src.intro_text : '',
      ack_text: src ? src.ack_text : '', pdpa_text: src ? src.pdpa_text : '',
      key_dates: '[]', max_members: src ? src.max_members : 7, reg_mode: 'closed',
      ref_prefix: 'ST' + String(year).slice(-2), ref_counter: 0, is_current: 'false', status: 'draft', created_at: now,
    });
    let slots = 0;
    if (src) {
      const copies = rows_('upload_slots').filter(function (x) { return x.edition_id === src.id; }).map(function (x) {
        return { id: uuid_(), edition_id: id, title: x.title, description: x.description, accept: x.accept, max_mb: x.max_mb,
                 deadline: '', is_open: 'false', sort_order: x.sort_order, created_at: now };
      });
      appendMany_('upload_slots', copies);
      slots = copies.length;
    }
    audit_(s, 'create_edition', id, { year: year, copied_from: src ? src.id : null, slots: slots });
    bustPublicCache_();
    return { id: id };
  });
}

/** req: { id } — visitors now register for this edition (swaps atomically under the lock). */
function adminSetCurrent_(req) {
  return adminWrite_(req, function (r, s) {
    const target = findRow_('editions', r.id);
    rows_('editions').forEach(function (e) {
      if (e.id !== target.id && bool_(e.is_current)) update_('editions', e._row, { is_current: 'false' });
    });
    update_('editions', target._row, { is_current: 'true', status: 'active' });
    audit_(s, 'set_current_edition', target.id, { year: target.year });
    bustPublicCache_();
    return { id: target.id };
  });
}

const REG_MODES = ['auto', 'open', 'closed'];

/** req: { id, <any of> title, subtitle, intro_text, ack_text, pdpa_text, key_dates, max_members, reg_mode, registration_opens_at, registration_closes_at } */
function adminSaveEdition_(req) {
  return adminWrite_(req, function (r, s) {
    const e = findRow_('editions', r.id);
    const patch = {};
    const has = function (k) { return Object.prototype.hasOwnProperty.call(r, k); };
    if (has('title')) patch.title = str_(r.title, 200, true);
    if (has('subtitle')) patch.subtitle = str_(r.subtitle, 300);
    if (has('intro_text')) patch.intro_text = str_(r.intro_text, 3000);
    if (has('ack_text')) patch.ack_text = str_(r.ack_text, 1000, true);
    if (has('pdpa_text')) patch.pdpa_text = str_(r.pdpa_text, 5000, true);
    if (has('key_dates')) {
      if (!Array.isArray(r.key_dates) || r.key_dates.length > 12) throw fail_('invalid_input');
      patch.key_dates = JSON.stringify(r.key_dates.map(function (d) {
        d = d || {};
        return { label: str_(d.label, 100), date: str_(d.date, 100) };
      }).filter(function (d) { return d.label || d.date; }));
    }
    if (has('max_members')) {
      const n = int_(r.max_members, 0);
      if (n < 1 || n > 50) throw fail_('invalid_input');
      patch.max_members = n;
    }
    if (has('reg_mode')) {
      if (REG_MODES.indexOf(r.reg_mode) === -1) throw fail_('invalid_input');
      patch.reg_mode = r.reg_mode;
    }
    if (has('registration_opens_at')) patch.registration_opens_at = isoOrBlank_(r.registration_opens_at);
    if (has('registration_closes_at')) patch.registration_closes_at = isoOrBlank_(r.registration_closes_at);
    const opens = has('registration_opens_at') ? patch.registration_opens_at : e.registration_opens_at;
    const closes = has('registration_closes_at') ? patch.registration_closes_at : e.registration_closes_at;
    if (opens && closes && time_(opens) >= time_(closes)) throw fail_('invalid_window');
    update_('editions', e._row, patch);
    audit_(s, 'save_edition', e.id, Object.keys(patch));
    bustPublicCache_();
    return { saved: Object.keys(patch) };
  });
}

// ───────────── site content ─────────────

function adminSettings_(req) {
  return adminRead_(req, function () {
    const raw = {};
    rows_('site_settings').forEach(function (r) { raw[r.key] = r.value; });
    const settings = {};
    PUBLIC_SETTING_KEYS.forEach(function (k) { settings[k] = raw[k] || ''; });
    return { settings: settings, logo_url: raw.logo_file_id ? driveThumb_(raw.logo_file_id, 400) : null };
  });
}

/** Upsert one site_settings row. Call inside the lock. */
function setSetting_(key, value) {
  const hit = rows_('site_settings').filter(function (r) { return r.key === key; })[0];
  if (hit) update_('site_settings', hit._row, { value: value, updated_at: nowIso_() });
  else append_('site_settings', { key: key, value: value, updated_at: nowIso_() });
}

/** req: { settings: { site_name, footer_text, … } } — only the public text keys are accepted. */
function adminSaveSettings_(req) {
  return adminWrite_(req, function (r, s) {
    const input = r.settings && typeof r.settings === 'object' ? r.settings : {};
    const saved = [];
    PUBLIC_SETTING_KEYS.forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(input, k)) return;
      const v = str_(input[k], 1000, k === 'site_name');
      setSetting_(k, v);
      saved.push(k);
    });
    audit_(s, 'save_settings', '', saved);
    bustPublicCache_();
    return { saved: saved };
  });
}

// ───── logo / background / project PDF: browser -> Drive folder public-assets (same resumable flow as team files) ─────

const ASSET_KINDS = {
  logo: { exts: ['png', 'jpg', 'jpeg', 'webp'], max_mb: 2 },
  background: { exts: ['png', 'jpg', 'jpeg', 'webp'], max_mb: 5 },
  rules_pdf: { exts: ['pdf'], max_mb: 15 },
};

/** req: { kind, file_name, size, mime, origin } -> { upload_url } */
function adminPrepareAsset_(req) {
  return adminRead_(req, function (r) {
    const kind = ASSET_KINDS[r.kind];
    if (!kind) throw fail_('invalid_input');
    if (!allowedOrigin_(r.origin)) throw fail_('origin_not_allowed');
    const size = Number(r.size);
    const ext = fileExt_(r.file_name);
    if (!isFinite(size) || size <= 0 || size > kind.max_mb * 1024 * 1024) throw fail_('file_too_large');
    if (kind.exts.indexOf(ext) === -1) throw fail_('file_type_not_allowed');
    const name = r.kind + '_' + Date.now() + '_' + safeFileName_(r.file_name, ext);
    return { upload_url: resumableSession_(props_().getProperty('FOLDER_PUBLIC_ASSETS'), name, r.mime, size, r.origin) };
  });
}

/** req: { kind, edition_id? (background / rules_pdf), file_id } — attach the uploaded file and trash the one it replaces. */
function adminConfirmAsset_(req) {
  return adminWrite_(req, function (r, s) {
    const kind = ASSET_KINDS[r.kind];
    if (!kind) throw fail_('invalid_input');
    const fileId = typeof r.file_id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(r.file_id) ? r.file_id : '';
    if (!fileId) throw fail_('file_not_found');
    let file;
    try { file = DriveApp.getFileById(fileId); } catch (e) { throw fail_('file_not_found'); }
    const folderId = props_().getProperty('FOLDER_PUBLIC_ASSETS');
    let inFolder = false;
    const parents = file.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === folderId) inFolder = true; }
    if (!inFolder || file.getName().indexOf(r.kind + '_') !== 0) throw fail_('file_not_found');
    const size = file.getSize();
    if (size <= 0 || size > kind.max_mb * 1024 * 1024) { file.setTrashed(true); throw fail_('file_too_large'); }
    if (kind.exts.indexOf(fileExt_(file.getName())) === -1) { file.setTrashed(true); throw fail_('file_type_not_allowed'); }

    let oldId = '';
    if (r.kind === 'logo') {
      const hit = rows_('site_settings').filter(function (x) { return x.key === 'logo_file_id'; })[0];
      oldId = hit ? hit.value : '';
      setSetting_('logo_file_id', fileId);
    } else {
      const e = findRow_('editions', r.edition_id);
      const col = r.kind === 'background' ? 'background_file_id' : 'rules_pdf_file_id';
      oldId = e[col];
      const patch = {};
      patch[col] = fileId;
      update_('editions', e._row, patch);
    }
    if (oldId && oldId !== fileId) trashFile_(oldId);
    audit_(s, 'set_asset', r.edition_id || '', { kind: r.kind });
    bustPublicCache_();
    return { kind: r.kind };
  });
}

// ───────────── teams ─────────────

function teamAdminView_(t, parts) {
  const slotsById = parts.slotsById;
  return {
    id: t.id, ref_no: t.ref_no, name_th: t.name_th, name_en: t.name_en, status: t.status, created_at: t.created_at,
    members_count_at_purge: t.members_count_at_purge ? int_(t.members_count_at_purge) : null,
    members: (parts.members[t.id] || []).sort(function (a, b) { return int_(a.order_no) - int_(b.order_no); })
      .map(function (m) { return { order_no: int_(m.order_no), student_id: m.student_id, full_name: m.full_name, phone: m.phone }; }),
    advisors: (parts.advisors[t.id] || []).map(function (a) { return { full_name: a.full_name, department: a.department, faculty: a.faculty }; }),
    uploads: (parts.uploads[t.id] || []).map(function (u) {
      const urls = driveViewUrls_(u.drive_file_id);
      return { slot_id: u.slot_id, slot_title: slotsById[u.slot_id] || '', file_name: u.file_name, size_bytes: int_(u.size_bytes), uploaded_at: u.uploaded_at, view_url: urls.view_url, download_url: urls.download_url };
    }),
    messages: (parts.messages[t.id] || []).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })
      .map(function (m) { return { id: m.id, body: m.body, created_at: m.created_at, read: !!m.read_at }; }),
  };
}

function groupBy_(rows, key) {
  const out = {};
  rows.forEach(function (r) { (out[r[key]] = out[r[key]] || []).push(r); });
  return out;
}

/** req: { edition_id? (default current) } -> every team of the edition with members, advisors, files and messages. */
function adminTeams_(req) {
  return adminRead_(req, function (r) {
    const ed = r.edition_id ? findRow_('editions', r.edition_id) : currentEditionFresh_();
    if (!ed) return { edition: null, teams: [], slots: [] };
    const teams = rows_('teams').filter(function (t) { return t.edition_id === ed.id; });
    const ids = {};
    teams.forEach(function (t) { ids[t.id] = true; });
    const slots = rows_('upload_slots').filter(function (x) { return x.edition_id === ed.id; });
    const slotsById = {};
    slots.forEach(function (x) { slotsById[x.id] = x.title; });
    const parts = {
      slotsById: slotsById,
      members: groupBy_(rows_('members').filter(function (m) { return ids[m.team_id]; }), 'team_id'),
      advisors: groupBy_(rows_('advisors').filter(function (a) { return ids[a.team_id]; }), 'team_id'),
      uploads: groupBy_(rows_('uploads').filter(function (u) { return ids[u.team_id]; }), 'team_id'),
      messages: groupBy_(rows_('messages').filter(function (m) { return ids[m.team_id]; }), 'team_id'),
    };
    return {
      edition: { id: ed.id, year: int_(ed.year), title: ed.title, max_members: int_(ed.max_members, 7), purged_at: ed.purged_at || null, purge_mode: ed.purge_mode || null },
      teams: teams.sort(function (a, b) { return a.ref_no < b.ref_no ? -1 : 1; }).map(function (t) { return teamAdminView_(t, parts); }),
      slots: slots.map(function (x) { return { id: x.id, title: x.title }; }),
    };
  });
}

/** req: { team_id, status: 'pending' | 'approved' } */
function adminSetTeamStatus_(req) {
  return adminWrite_(req, function (r, s) {
    if (['pending', 'approved'].indexOf(r.status) === -1) throw fail_('invalid_input');
    const t = findRow_('teams', r.team_id);
    update_('teams', t._row, { status: r.status });
    audit_(s, 'set_team_status', t.id, { ref_no: t.ref_no, status: r.status });
    return { status: r.status };
  });
}

/** req: { team_id } — mark every message of the team as read. */
function adminMarkRead_(req) {
  return adminWrite_(req, function (r, s) {
    const now = nowIso_();
    let n = 0;
    rows_('messages').forEach(function (m) {
      if (m.team_id === r.team_id && !m.read_at) { update_('messages', m._row, { read_at: now }); n++; }
    });
    return { marked: n };
  });
}

/** req: { team_id, pin } — admins can set a new PIN but never read one. Also clears the lock-out. */
function adminResetPin_(req) {
  return adminWrite_(req, function (r, s) {
    if (typeof r.pin !== 'string' || !RE_PIN.test(r.pin)) throw fail_('invalid_pin');
    const t = findRow_('teams', r.team_id);
    update_('teams', t._row, { pin_hash: pinHash_(t.id, r.pin) });
    const ed = findRow_('editions', t.edition_id);
    attemptClear_(attemptGet_(ed.year + ':' + t.name_en_key.slice(0, 120)));
    audit_(s, 'reset_pin', t.id, { ref_no: t.ref_no });
    return { reset: true };
  });
}

/** req: { team_id, name_th, name_en, members, advisors } — "edit on behalf" with the same rules as the public form. */
function adminUpdateTeam_(req) {
  return adminWrite_(req, function (r, s) {
    const t = findRow_('teams', r.team_id);
    const ed = findRow_('editions', t.edition_id);
    if (ed.purged_at) throw fail_('edition_purged');
    const clean = cleanApplication_(r, int_(ed.max_members, 7));

    const own = {};
    const oldMembers = rows_('members').filter(function (m) { return m.team_id === t.id; });
    oldMembers.forEach(function (m) { own[m.id] = true; });
    const seen = {};
    clean.members.forEach(function (m) {
      if (seen[m.student_id]) throw fail_('student_id_taken');
      seen[m.student_id] = true;
    });
    rowsLite_('members', ['id', 'edition_id', 'student_id']).forEach(function (m) {
      if (m.edition_id === ed.id && !own[m.id] && seen[m.student_id]) throw fail_('student_id_taken');
    });
    const key = nameKey_(clean.nameEn);
    rowsLite_('teams', ['id', 'edition_id', 'name_en_key']).forEach(function (x) {
      if (x.edition_id === ed.id && x.id !== t.id && x.name_en_key === key) throw fail_('team_name_taken');
    });

    // Append the new rows first, then remove the old ones (a failure never loses the team's data).
    const oldAdvisors = rows_('advisors').filter(function (a) { return a.team_id === t.id; });
    appendMany_('members', clean.members.map(function (m, i) {
      return { id: uuid_(), team_id: t.id, edition_id: ed.id, order_no: i + 1, student_id: m.student_id, full_name: m.full_name, phone: m.phone };
    }));
    appendMany_('advisors', clean.advisors.map(function (a) {
      return { id: uuid_(), team_id: t.id, full_name: a.full_name, department: a.department, faculty: a.faculty };
    }));
    oldMembers.map(function (m) { return m._row; }).sort(function (a, b) { return b - a; }).forEach(function (n) { deleteRow_('members', n); });
    oldAdvisors.map(function (a) { return a._row; }).sort(function (a, b) { return b - a; }).forEach(function (n) { deleteRow_('advisors', n); });
    update_('teams', findRow_('teams', t.id)._row, { name_th: clean.nameTh, name_en: clean.nameEn, name_en_key: key });
    audit_(s, 'update_team', t.id, { ref_no: t.ref_no });
    return { updated: true };
  });
}

/** req: { team_id } — removes the team and everything attached (files go to the Drive trash). */
function adminDeleteTeam_(req) {
  return adminWrite_(req, function (r, s) {
    const t = findRow_('teams', r.team_id);
    const ed = findRow_('editions', t.edition_id);
    const files = rows_('uploads').filter(function (u) { return u.team_id === t.id; });
    files.forEach(function (u) { trashFile_(u.drive_file_id); });
    try {
      const root = DriveApp.getFolderById(props_().getProperty('FOLDER_TEAM_FILES'));
      const editionFolders = root.getFoldersByName(String(ed.year));
      if (editionFolders.hasNext()) {
        const teamFolders = editionFolders.next().getFoldersByName(t.ref_no + '_' + t.id.slice(0, 8));
        while (teamFolders.hasNext()) teamFolders.next().setTrashed(true);
      }
    } catch (e) { console.error('team folder not trashed: ' + e); }
    ['uploads', 'messages', 'consents', 'advisors', 'members'].forEach(function (name) {
      deleteWhere_(name, function (x) { return x.team_id === t.id; });
    });
    attemptClear_(attemptGet_(ed.year + ':' + t.name_en_key.slice(0, 120)));
    deleteRow_('teams', findRow_('teams', t.id)._row);
    audit_(s, 'delete_team', t.id, { ref_no: t.ref_no, files: files.length });
    return { deleted: true };
  });
}

// ───────────── upload slots ─────────────

function slotAdminView_(x, uploads) {
  return {
    id: x.id, edition_id: x.edition_id, title: x.title, description: x.description, accept: acceptList_(x),
    max_mb: int_(x.max_mb, 5), deadline: x.deadline || null, is_open: bool_(x.is_open), sort_order: int_(x.sort_order), uploads_count: uploads,
  };
}

function adminSlots_(req) {
  return adminRead_(req, function (r) {
    const ed = r.edition_id ? findRow_('editions', r.edition_id) : currentEditionFresh_();
    if (!ed) return { edition: null, slots: [] };
    const counts = {};
    rowsLite_('uploads', ['slot_id']).forEach(function (u) { counts[u.slot_id] = (counts[u.slot_id] || 0) + 1; });
    return {
      edition: { id: ed.id, year: int_(ed.year), title: ed.title },
      slots: rows_('upload_slots').filter(function (x) { return x.edition_id === ed.id; })
        .sort(function (a, b) { return int_(a.sort_order) - int_(b.sort_order); })
        .map(function (x) { return slotAdminView_(x, counts[x.id] || 0); }),
    };
  });
}

/** req: { id? , edition_id (new), title, description, accept:[ext], max_mb, deadline, is_open, sort_order } */
function adminSaveSlot_(req) {
  return adminWrite_(req, function (r, s) {
    const accept = Array.isArray(r.accept) ? r.accept.map(function (x) { return String(x).toLowerCase().replace(/^\./, '').trim(); }).filter(function (x) { return x; }) : [];
    const unique = accept.filter(function (x, i) { return accept.indexOf(x) === i; });
    if (!unique.length || unique.length > 10 || unique.some(function (x) { return !/^[a-z0-9]{1,10}$/.test(x); })) throw fail_('invalid_input');
    const maxMb = int_(r.max_mb, 0);
    if (maxMb < 1 || maxMb > 100) throw fail_('invalid_input');
    const fields = {
      title: str_(r.title, 120, true), description: str_(r.description, 300), accept: unique.join(','), max_mb: maxMb,
      deadline: isoOrBlank_(r.deadline), is_open: r.is_open ? 'true' : 'false', sort_order: int_(r.sort_order, 0),
    };
    if (r.id) {
      const x = findRow_('upload_slots', r.id);
      update_('upload_slots', x._row, fields);
      audit_(s, 'save_slot', x.id, { title: fields.title });
      return { id: x.id };
    }
    findRow_('editions', r.edition_id);
    const id = uuid_();
    append_('upload_slots', Object.assign({ id: id, edition_id: r.edition_id, created_at: nowIso_() }, fields));
    audit_(s, 'create_slot', id, { title: fields.title });
    return { id: id };
  });
}

/** req: { id, force? } — refuses while files exist unless force:true (then the files go to the Drive trash). */
function adminDeleteSlot_(req) {
  return adminWrite_(req, function (r, s) {
    const x = findRow_('upload_slots', r.id);
    const ups = rows_('uploads').filter(function (u) { return u.slot_id === x.id; });
    if (ups.length && r.force !== true) throw fail_('slot_has_files', '', { uploads_count: ups.length });
    ups.forEach(function (u) { trashFile_(u.drive_file_id); });
    deleteWhere_('uploads', function (u) { return u.slot_id === x.id; });
    deleteRow_('upload_slots', findRow_('upload_slots', x.id)._row);
    audit_(s, 'delete_slot', x.id, { title: x.title, files: ups.length });
    return { deleted: true };
  });
}
