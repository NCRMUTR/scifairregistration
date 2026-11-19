const assert = require('assert');
const h = require('./harness.cjs');
const { store, props, row, call, fns, driveFiles, driveFolders, failDelete, advance, crypto } = h;
const NOW = () => Date.now() + h.clock();
const PW = 'a-long-test-password-1';
const IDX = (n, c) => h.SCHEMA[n].indexOf(c);

// ───────── data
const mkEd = (id, year, cur, st) => row('editions', { id, year, title: 'T' + year, max_members: 7, reg_mode: 'closed', ref_prefix: 'ST' + (year % 100), ref_counter: 3, is_current: cur, status: st, key_dates: '[]', ack_text: 'a', pdpa_text: 'p' });
mkEd('ed1', 2026, 'true', 'active');
mkEd('ed0', 2025, 'false', 'archived');
const pinHash = (id, pin) => crypto.createHmac('sha256', props.PEPPER).update(id + ':' + pin).digest('hex');
driveFolders.TEAMFILES = { name: 'team-files', parent: 'ROOT' };
driveFolders.YEAR2026FOLDER = { name: '2026', parent: 'TEAMFILES' };
driveFolders.YEAR2025FOLDER = { name: '2025', parent: 'TEAMFILES' };
driveFiles.x = { name: 'spreadsheet', parent: 'ROOT', size: 1, mime: 'sheet' }; // SHEET_ID is 'x'
let fileN = 0;
const mkFile = (parent, name, size) => { const id = 'DATAFILE' + String(++fileN).padStart(4, '0'); driveFiles[id] = { name, parent, size, mime: 'application/pdf' }; return id; };
const team = (id, ed, ref, en, th, pin, files) => {
  row('teams', { id, edition_id: ed, ref_no: ref, name_th: th, name_en: en, name_en_key: en.toLowerCase(), pin_hash: pinHash(id, pin), status: 'pending', created_at: '2026-01-01T00:00:00.000Z' });
  row('members', { id: 'm' + id, team_id: id, edition_id: ed, order_no: 1, student_id: '640123456' + ref.slice(-4), full_name: 'นศ. ' + id, phone: '0811111111' });
  row('members', { id: 'n' + id, team_id: id, edition_id: ed, order_no: 2, student_id: '650123456' + ref.slice(-4), full_name: 'นศ.2 ' + id, phone: '0822222222' });
  row('advisors', { id: 'a' + id, team_id: id, full_name: 'อ. ' + id, department: 'd', faculty: 'f' });
  row('consents', { team_id: id, ack_text_version: '1', pdpa_text_version: '1', accepted_at: '2026-01-01T00:00:00.000Z' });
  row('messages', { id: 'ms' + id, team_id: id, body: 'hello ' + id, created_at: '2026-01-02T00:00:00.000Z', read_at: '' });
  (files || []).forEach(([name, size], i) => {
    const fid = mkFile(ed === 'ed1' ? 'YEAR2026FOLDER' : 'YEAR2025FOLDER', name, size);
    row('uploads', { id: 'u' + id + i, team_id: id, slot_id: 's1', drive_file_id: fid, file_name: name, size_bytes: size, uploaded_at: '2026-01-03T00:00:00.000Z' });
  });
};
team('t1', 'ed1', 'ST26-0001', 'Alpha', 'อัลฟา', '4821', [['proposal.pdf', 1000], ['big1.pdf', 25 * 1024 * 1024]]);
team('t2', 'ed1', 'ST26-0002', '=cmd|calc', '=HYPERLINK("x")', '1111', [['big2.pdf', 25 * 1024 * 1024]]);
team('t3', 'ed1', 'ST26-0003', 'Gamma', 'แกมมา', '2222', []);
team('o1', 'ed0', 'ST25-0001', 'Old Team', 'ทีมเก่า', '9999', [['old.pdf', 2000]]);
row('upload_slots', { id: 's1', edition_id: 'ed1', title: 'doc', accept: 'pdf', max_mb: 10, is_open: 'true', sort_order: 1, created_at: 'a' });
row('gallery_albums', { id: 'al1', edition_id: 'ed1', title: 'งาน', sort_order: 1, is_published: 'true', created_at: 'a' });
row('gallery_photos', { id: 'ph1', album_id: 'al1', drive_file_id: 'GALLERYPHOTO1', sort_order: 1, created_at: 'a' });
row('lookup_attempts', { key: '2026:alpha', fails: 2, window_start: new Date(NOW()).toISOString(), locked_until: '' });
row('lookup_attempts', { key: '2025:old team', fails: 1, window_start: new Date(NOW()).toISOString(), locked_until: '' });
const protectedSheets = () => JSON.stringify(['upload_slots', 'gallery_albums', 'gallery_photos'].map((n) => store[n]));
const protectedBefore = protectedSheets();

// ───────── admin (TOTP not registered yet)
props.NEW_ADMIN_ID = 'admin@test.ac.th';
props.NEW_ADMIN_PASSWORD = PW;
fns.createAdmin();
const login = () => call('admin_login', { id: 'admin@test.ac.th', password: PW }).data.session;
let S = login();
const A = (a, r = {}) => call(a, { ...r, session: S });
const purge = (o = {}) => A('admin_purge', { edition_id: 'ed1', mode: 'anonymize', confirm: 'PURGE 2026', password: PW, totp: '000000', ...o });
const count = (n, f) => store[n].slice(1).filter(f || (() => true)).length;
const ed1Rows = () => count('teams', (x) => x[1] === 'ed1');

// ───────── 0. no session
assert.equal(call('admin_purge', { edition_id: 'ed1' }).reason, 'unauthorized');
assert.equal(call('admin_purge', { session: 'a'.repeat(64) }).reason, 'unauthorized');
assert.equal(call('admin_backup', { edition_id: 'ed1' }).reason, 'unauthorized');
assert.equal(call('admin_backups', { edition_id: 'ed1' }).reason, 'unauthorized');
console.log('ok: backup/purge need an admin session');

// ───────── 1. guards, cheapest first
assert.equal(purge({ mode: 'nuke' }).reason, 'invalid_input');
assert.equal(purge({ edition_id: 'nope' }).reason, 'not_found');
for (const bad of ['purge 2026', 'PURGE 2025', 'PURGE  2026', 'PURGE 2026 ', '', undefined, 2026]) assert.equal(purge({ confirm: bad }).reason, 'confirm_mismatch', String(bad));
assert.equal(purge().reason, 'backup_required', 'no backup yet');
assert.equal(ed1Rows(), 3);
advance(11 * 60 * 1000); // sign-in is now 11 minutes old
assert.equal(purge({ confirm: 'x' }).reason, 'login_too_old');
S = login();
console.log('ok: guards 1-3 (fresh sign-in, typed confirmation, backup required)');

// ───────── 2. backup
assert.equal(A('admin_backup', { edition_id: 'nope' }).reason, 'not_found');
const b = A('admin_backup', { edition_id: 'ed1' });
assert.ok(b.ok, JSON.stringify(b));
assert.deepEqual(b.data.counts, { teams: 3, members: 6, advisors: 3, consents: 3, messages: 3, uploads: 3 });
assert.equal(b.data.files.count, 3);
assert.equal(b.data.files.parts, 2, 'zipped in parts');
const folder = Object.entries(driveFolders).find(([, f]) => f.parent === 'BACKUPS' && /^2026_/.test(f.name));
assert.ok(folder, 'backup folder lives inside the private backups folder');
const inFolder = Object.values(driveFiles).filter((f) => f.parent === folder[0]);
const names = inFolder.map((f) => f.name);
for (const n of ['teams.csv', 'members.csv', 'advisors.csv', 'consents.csv', 'messages.csv', 'uploads.csv', 'files-part1.zip', 'files-part2.zip']) assert.ok(names.includes(n), n);
assert.ok(names.some((n) => n.startsWith('spreadsheet-copy')));
const teamsCsv = inFolder.find((f) => f.name === 'teams.csv').buf.toString('utf8');
assert.ok(teamsCsv.startsWith('﻿"id"'), 'UTF-8 BOM');
assert.ok(!teamsCsv.includes('pin_hash') && !teamsCsv.includes(pinHash('t1', '4821')), 'no PIN hashes in the CSV');
assert.ok(teamsCsv.includes('"\'=cmd|calc"') && teamsCsv.includes('"\'=HYPERLINK(""x"")"'), 'formula-safe');
assert.ok(teamsCsv.includes('อัลฟา'));
assert.ok(!teamsCsv.includes('Old Team'), 'other editions are not in this backup');
const zipNames = inFolder.filter((f) => f.name.endsWith('.zip')).flatMap((f) => f.entries);
assert.ok(zipNames.includes('ST26-0001/proposal.pdf') && zipNames.includes('ST26-0002/big2.pdf'));
assert.ok(!zipNames.some((n) => n.startsWith('ST25')));
assert.equal(store.backup_log.length, 2);
assert.ok(store.editions[1][IDX('editions', 'last_backup_at')]);
let st = A('admin_backups', { edition_id: 'ed1' }).data;
assert.equal(st.backup_is_current, true);
assert.equal(st.backups.length, 1);
assert.equal(st.counts.members, 6);
assert.equal(st.login_max_age_sec, 600);
assert.equal(st.totp, false);
console.log('ok: backup (CSV with BOM, formula-safe, no PIN hash, zip parts, log, status)');

// ───────── 3. data changed after the backup
row('messages', { id: 'late', team_id: 't3', body: 'late', created_at: new Date(NOW()).toISOString(), read_at: '' });
assert.equal(purge().reason, 'backup_outdated');
assert.equal(A('admin_backups', { edition_id: 'ed1' }).data.backup_is_current, false);
assert.ok(A('admin_backup', { edition_id: 'ed1' }).ok);
assert.equal(A('admin_backups', { edition_id: 'ed1' }).data.backup_is_current, true);
console.log('ok: guard 4 (the backup must match the data)');

// ───────── 4. password / TOTP
assert.equal(purge().reason, 'totp_not_registered', 'password is right, TOTP not registered');
let r = purge({ password: 'wrong-password' });
assert.equal(r.reason, 'admin_invalid');
assert.equal(r.extra.attempts_left, 4);
const tb = A('admin_totp_begin', { password: PW }).data;
assert.ok(A('admin_totp_confirm', { code: fns.totpCode_(tb.secret, Math.floor(NOW() / 30000)) }).ok);
const code = (d = 1) => fns.totpCode_(tb.secret, Math.floor(NOW() / 30000) + d);
assert.equal(purge({ totp: '123456' }).reason, 'totp_invalid');
assert.equal(ed1Rows(), 3, 'refused attempts remove nothing');
const good = code(1);
assert.equal(purge({ confirm: 'PURGE 2025', totp: good }).reason, 'confirm_mismatch');
assert.equal(purge({ totp: good, password: 'bad-bad-bad-bad' }).reason, 'admin_invalid');
console.log('ok: guards 5-6 (password, TOTP); a refused request does not burn the code');

// ───────── 5. backup older than 24 h
advance(25 * 3600 * 1000);
S = login();
assert.equal(purge({ totp: code(1) }).reason, 'backup_required');
assert.ok(A('admin_backup', { edition_id: 'ed1' }).ok);
console.log('ok: backup older than 24 h refused');

// ───────── 6. success: anonymize (one file cannot be deleted)
const filesOf = (inEd1) => store.uploads.slice(1).filter((u) => ['t1', 't2', 't3'].includes(u[1]) === inEd1).map((u) => u[3]);
const ed1Files = filesOf(true);
const oldFiles = filesOf(false);
failDelete.add(ed1Files[0]);
r = purge({ totp: good === null ? '' : code(1) });
assert.ok(r.ok, JSON.stringify(r));
let d = r.data;
assert.equal(d.mode, 'anonymize');
assert.equal(d.teams_anonymized, 3);
assert.deepEqual(d.rows, { members: 6, advisors: 3, consents: 3, messages: 4, uploads: 3, lookup_attempts: 1 });
assert.equal(d.files.removed, 2);
assert.equal(d.files.failed, 1);
assert.deepEqual(d.files.failed_ids, [ed1Files[0]]);
assert.equal(d.folder_removed, false, 'year folder stays while a file could not be deleted');
assert.equal(driveFiles[ed1Files[1]].deleted, true, 'deleted permanently, not trashed');
assert.equal(driveFiles[ed1Files[1]].trashed, undefined);
assert.equal(driveFiles[oldFiles[0]].deleted, undefined, 'other edition files untouched');
// rows
const teamRows = store.teams.slice(1);
for (const t of teamRows.filter((x) => x[1] === 'ed1')) {
  assert.equal(t[IDX('teams', 'pin_hash')], '', 'PIN unusable');
  assert.ok(t[IDX('teams', 'name_en')] && t[IDX('teams', 'ref_no')], 'name and ref_no kept');
}
assert.equal(teamRows.find((x) => x[0] === 't1')[IDX('teams', 'members_count_at_purge')], '2');
assert.equal(teamRows.find((x) => x[0] === 'o1')[IDX('teams', 'pin_hash')], pinHash('o1', '9999'), 'other edition untouched');
for (const n of ['members', 'advisors', 'consents', 'messages', 'uploads']) assert.equal(count(n, (x) => ['t1', 't2', 't3'].includes(x[n === 'members' ? 1 : n === 'consents' ? 0 : 1])), 0, n);
assert.equal(count('members'), 2); assert.equal(count('uploads'), 1); assert.equal(count('messages'), 1); // only the other edition is left
assert.equal(count('lookup_attempts', (x) => x[0] === '2025:old team'), 1);
assert.equal(protectedSheets(), protectedBefore, 'gallery + upload slots untouched');
const e1 = store.editions[1];
assert.ok(e1[IDX('editions', 'purged_at')]);
assert.equal(e1[IDX('editions', 'purge_mode')], 'anonymize');
assert.equal(e1[IDX('editions', 'title')], 'T2026');
assert.ok(store.audit_log.some((x) => x[2] === 'purge_start') && store.audit_log.some((x) => x[2] === 'purge_done'));
assert.ok(!JSON.stringify(store.audit_log).includes('นศ.'), 'no personal data in the audit log');
// anonymised teams stay unusable
assert.equal(call('lookup_team', { name_en: 'Alpha', pin: '4821' }).reason, 'invalid_credentials');
assert.equal(A('admin_reset_pin', { team_id: 't1', pin: '1234' }).reason, 'edition_purged');
assert.equal(purge({ totp: code(1) }).reason, 'already_purged');
console.log('ok: anonymize (rows, PIN, counts, files deleted permanently, failures reported, rest untouched)');

// ───────── 7. delete mode, replayed TOTP code
failDelete.clear();
assert.ok(A('admin_backup', { edition_id: 'ed1' }).ok); // the data changed (anonymised) -> new backup first
advance(65 * 1000);
r = purge({ mode: 'delete', totp: code(1) });
assert.ok(r.ok, JSON.stringify(r));
d = r.data;
assert.equal(d.mode, 'delete');
assert.equal(d.rows.teams, 3);
assert.equal(d.files.removed, 0, 'no upload rows are left after the anonymise step');
assert.equal(driveFiles[ed1Files[0]].deleted, true, 'the leftover file of the failed delete goes with the year folder');
assert.equal(d.files.failed, 0);
assert.equal(d.folder_removed, true);
assert.equal(driveFolders.YEAR2026FOLDER.deleted, true);
assert.equal(driveFolders.YEAR2025FOLDER.deleted, undefined, 'other edition folder untouched');
assert.equal(count('teams', (x) => x[1] === 'ed1'), 0);
assert.equal(count('teams', (x) => x[1] === 'ed0'), 1);
assert.equal(driveFiles[oldFiles[0]].deleted, undefined);
assert.equal(protectedSheets(), protectedBefore, 'gallery + upload slots untouched by delete mode too');
assert.equal(store.editions[1][IDX('editions', 'purge_mode')], 'delete');
assert.equal(purge({ mode: 'delete', totp: code(1) }).reason, 'already_purged');
assert.equal(purge({ mode: 'anonymize', totp: code(1) }).reason, 'already_purged');
console.log('ok: delete mode (teams removed, folder removed, other edition and gallery untouched)');

// replay: a code that was just used is refused, even for an otherwise valid request
const mkEmpty = (id, year) => row('editions', { id, year, title: 'T' + year, max_members: 7, reg_mode: 'closed', ref_prefix: 'ST' + (year % 100), ref_counter: 0, is_current: 'false', status: 'archived', key_dates: '[]' });
mkEmpty('ed2', 2024); mkEmpty('ed4', 2022);
assert.ok(A('admin_backup', { edition_id: 'ed2' }).ok, 'backup of an empty edition works');
assert.ok(A('admin_backup', { edition_id: 'ed4' }).ok);
advance(65 * 1000);
const once = code(1);
assert.equal(purge({ edition_id: 'ed2', confirm: 'PURGE 2024', totp: once }).ok, true);
assert.equal(purge({ edition_id: 'ed4', confirm: 'PURGE 2022', totp: once }).reason, 'totp_invalid', 'a used code cannot be used again');
assert.equal(store.editions.find((x) => x[0] === 'ed4')[IDX('editions', 'purged_at')], '');
console.log('ok: replayed TOTP code refused');

// ───────── 8. lock-out shared with the sign-in
row('editions', { id: 'ed3', year: 2023, title: 'T2023', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST23', ref_counter: 0, is_current: 'false', status: 'archived', key_dates: '[]' });
S = login();
assert.ok(A('admin_backup', { edition_id: 'ed3' }).ok);
let last;
for (let i = 0; i < 5; i++) last = purge({ edition_id: 'ed3', confirm: 'PURGE 2023', password: 'wrong-wrong-' + i, totp: code(1) });
assert.equal(last.reason, 'admin_locked');
assert.equal(call('admin_login', { id: 'admin@test.ac.th', password: PW }).reason, 'admin_locked', 'sign-in is locked as well');
assert.equal(purge({ edition_id: 'ed3', confirm: 'PURGE 2023', totp: code(1) }).reason, 'admin_locked', 'even the right password is refused while locked');
assert.equal(store.editions.find((x) => x[0] === 'ed3')[IDX('editions', 'purged_at')], '');
console.log('ok: wrong passwords lock the reset (and sign-in) for 15 minutes');

console.log('ALL PURGE TESTS PASSED');
