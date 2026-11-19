/**
 * Apply.gs — the application form: student_id_taken (live duplicate check) and submit_team.
 *
 * The rules that used to live in Postgres constraints are enforced HERE, inside ONE script lock, using fresh sheet
 * reads (never the cache): unique (edition, student_id), unique (edition, name_en_key), member/advisor limits,
 * PIN stored only as HMAC(pepper, teamId:pin). Nothing is written unless everything is valid; if a write fails
 * half-way the rows already written are removed again.
 */

const RE_STUDENT_ID = /^[0-9]{13}$/;
const RE_PHONE = /^0[0-9]{9}$/;
const RE_PIN = /^[0-9]{4}$/;

function nameKey_(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** HMAC-SHA256(pepper, teamId + ':' + pin). The pepper lives only in Script Properties, never in the sheet. */
function pinHash_(teamId, pin) {
  const pepper = props_().getProperty('PEPPER');
  if (!pepper) throw fail_('not_setup', 'PEPPER missing — run setup()');
  return hex_(Utilities.computeHmacSha256Signature(teamId + ':' + pin, pepper));
}

function md5Hex_(text) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text || ''), Utilities.Charset.UTF_8));
}

function currentEditionFresh_() {
  const list = rows_('editions').filter(function (e) { return bool_(e.is_current); });
  return list[0] || null;
}

function text_(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Live duplicate check for the form (current edition only). Returns ONLY true/false — never says WHICH team.
 * Rate limited as a whole (Apps Script cannot see the caller's IP).
 */
function studentIdTaken_(req) {
  rateLimit_('student_id_taken', 240, 60);
  const id = typeof req.id === 'string' ? req.id : '';
  if (!RE_STUDENT_ID.test(id)) return { taken: false };
  const ed = currentEditionFresh_();
  if (!ed) return { taken: false };
  const taken = rowsLite_('members', ['edition_id', 'student_id']).some(function (m) { return m.edition_id === ed.id && m.student_id === id; });
  return { taken: taken };
}

/**
 * Validate and trim the team data shared by submit_team and the admin's "edit on behalf".
 * Throws invalid_members / invalid_advisors / invalid_input. Returns { nameTh, nameEn, members, advisors }.
 */
function cleanApplication_(req, maxMembers) {
  if (!Array.isArray(req.members) || req.members.length < 1 || req.members.length > maxMembers) throw fail_('invalid_members');
  if (!Array.isArray(req.advisors) || req.advisors.length < 1 || req.advisors.length > 50) throw fail_('invalid_advisors');

  const nameTh = text_(req.name_th, 120);
  const nameEn = text_(req.name_en, 120);
  if (!nameTh || !nameEn) throw fail_('invalid_input');

  const members = req.members.map(function (m) {
    m = m || {};
    return { student_id: typeof m.student_id === 'string' ? m.student_id : '', full_name: text_(m.full_name, 120), phone: typeof m.phone === 'string' ? m.phone : '' };
  });
  const advisors = req.advisors.map(function (a) {
    a = a || {};
    return { full_name: text_(a.full_name, 120), department: text_(a.department, 120), faculty: text_(a.faculty, 120) };
  });
  members.forEach(function (m) {
    if (!RE_STUDENT_ID.test(m.student_id) || !m.full_name || !RE_PHONE.test(m.phone)) throw fail_('invalid_input');
  });
  advisors.forEach(function (a) {
    if (!a.full_name || !a.department || !a.faculty) throw fail_('invalid_input');
  });
  return { nameTh: nameTh, nameEn: nameEn, members: members, advisors: advisors };
}

/**
 * Create the whole application. req: { name_th, name_en, pin, members:[{student_id,full_name,phone}],
 * advisors:[{full_name,department,faculty}], ack:true, pdpa:true }  ->  { ref_no, created_at }
 */
function submitTeam_(req) {
  rateLimit_('submit_team', 200, 600);

  return withLock_(function () {
    const ed = currentEditionFresh_();
    if (!ed) throw fail_('no_current_edition');
    if (!registrationOpen_(ed, Date.now())) throw fail_('registration_closed');

    if (req.ack !== true || req.pdpa !== true) throw fail_('consent_required');
    if (typeof req.pin !== 'string' || !RE_PIN.test(req.pin)) throw fail_('invalid_pin');

    const clean = cleanApplication_(req, int_(ed.max_members, 7));
    const nameTh = clean.nameTh;
    const nameEn = clean.nameEn;
    const members = clean.members;
    const advisors = clean.advisors;

    // Uniqueness — inside the lock, from fresh reads.
    const seen = {};
    members.forEach(function (m) {
      if (seen[m.student_id]) throw fail_('student_id_taken');
      seen[m.student_id] = true;
    });
    rowsLite_('members', ['edition_id', 'student_id']).forEach(function (m) {
      if (m.edition_id === ed.id && seen[m.student_id]) throw fail_('student_id_taken');
    });
    const key = nameKey_(nameEn);
    rowsLite_('teams', ['edition_id', 'name_en_key']).forEach(function (t) {
      if (t.edition_id === ed.id && t.name_en_key === key) throw fail_('team_name_taken');
    });

    // Write everything; undo on any failure.
    const teamId = uuid_();
    const counter = int_(ed.ref_counter, 0) + 1;
    const refNo = ed.ref_prefix + '-' + ('0000' + counter).slice(-4);
    const createdAt = nowIso_();
    const written = []; // [sheetName, firstRow, count]
    try {
      written.push(['teams', append_('teams', {
        id: teamId, edition_id: ed.id, ref_no: refNo, name_th: nameTh, name_en: nameEn, name_en_key: key,
        pin_hash: pinHash_(teamId, req.pin), status: 'pending', members_count_at_purge: '', created_at: createdAt }), 1]);
      written.push(['members', appendMany_('members', members.map(function (m, i) {
        return { id: uuid_(), team_id: teamId, edition_id: ed.id, order_no: i + 1, student_id: m.student_id, full_name: m.full_name, phone: m.phone };
      })), members.length]);
      written.push(['advisors', appendMany_('advisors', advisors.map(function (a) {
        return { id: uuid_(), team_id: teamId, full_name: a.full_name, department: a.department, faculty: a.faculty };
      })), advisors.length]);
      written.push(['consents', append_('consents', {
        team_id: teamId, ack_text_version: md5Hex_(ed.ack_text), pdpa_text_version: md5Hex_(ed.pdpa_text), accepted_at: createdAt }), 1]);
      update_('editions', ed._row, { ref_counter: counter }); // last: a failed write leaves no gap in the numbering
    } catch (err) {
      for (let i = written.length - 1; i >= 0; i--) {
        const w = written[i];
        if (w[1] === null || w[1] === undefined) continue;
        for (let k = w[2] - 1; k >= 0; k--) {
          try { deleteRow_(w[0], w[1] + k); } catch (e2) { console.error('rollback failed ' + w[0] + ' row ' + (w[1] + k)); }
        }
      }
      console.error('submit_team write failed: ' + (err && err.stack || err));
      throw fail_('submit_failed');
    }
    return { ref_no: refNo, created_at: createdAt };
  });
}
