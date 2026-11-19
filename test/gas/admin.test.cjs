const assert = require('assert');
const { store, props, cacheStore, row, call, fns, crypto } = require('./harness.cjs');
const out = (x) => JSON.parse(JSON.stringify(x));

// TOTP: RFC 6238 test vectors (SHA-1, secret "12345678901234567890")
const rfcSecret = fns.base32Encode_([...Buffer.from('12345678901234567890')]);
assert.equal(rfcSecret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
assert.equal(fns.totpCode_(rfcSecret, 1), '287082'); // T=59
assert.equal(fns.totpCode_(rfcSecret, 37037036), '081804'); // T=1111111109
console.log('ok: TOTP matches RFC 6238 vectors');

// ---- data
const ed1 = { id: 'ed1', year: 2026, title: 'Sci-Tech Pitching 2026', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST26', ref_counter: 2, is_current: 'true', status: 'active', ack_text: 'ack', pdpa_text: 'pdpa', key_dates: '[]' };
row('editions', ed1);
const mkTeam = (id, ref, en, pin) => row('teams', { id, edition_id: 'ed1', ref_no: ref, name_th: 'ทีม ' + en, name_en: en, name_en_key: en.toLowerCase(), pin_hash: crypto.createHmac('sha256', props.PEPPER).update(id + ':' + pin).digest('hex'), status: 'pending', created_at: new Date().toISOString() });
mkTeam('t1', 'ST26-0001', 'Alpha', '4821');
mkTeam('t2', 'ST26-0002', 'Beta', '1111');
row('members', { id: 'm1', team_id: 't1', edition_id: 'ed1', order_no: 1, student_id: '6401234567001', full_name: 'A', phone: '0811111111' });
row('members', { id: 'm2', team_id: 't2', edition_id: 'ed1', order_no: 1, student_id: '6401234567002', full_name: 'B', phone: '0822222222' });
row('advisors', { id: 'a1', team_id: 't1', full_name: 'อ.A', department: 'd', faculty: 'f' });
row('advisors', { id: 'a2', team_id: 't2', full_name: 'อ.B', department: 'd', faculty: 'f' });
row('upload_slots', { id: 's1', edition_id: 'ed1', title: 'doc', accept: 'pdf', max_mb: 10, is_open: 'false', sort_order: 1, created_at: 'a' });
row('uploads', { id: 'u1', team_id: 't1', slot_id: 's1', drive_file_id: 'FILEID1234567', file_name: 'x.pdf', size_bytes: 1000, uploaded_at: 'now' });
row('messages', { id: 'ms1', team_id: 't1', body: 'hello', created_at: new Date().toISOString(), read_at: '' });

// ---- createAdmin
props.NEW_ADMIN_ID = '  Admin@Test.AC.th ';
props.NEW_ADMIN_PASSWORD = 'short';
assert.throws(() => fns.createAdmin(), /at least 12/);
props.NEW_ADMIN_PASSWORD = 'a-long-test-password-1';
fns.createAdmin();
assert.ok(!('NEW_ADMIN_PASSWORD' in props) && !('NEW_ADMIN_ID' in props), 'temporary properties removed');
assert.deepEqual(Object.keys(JSON.parse(props.ADMIN_USERS)), ['admin@test.ac.th']);
assert.ok(!JSON.stringify(props).includes('a-long-test-password-1'), 'password never stored in clear');
console.log('ok: createAdmin hashes the password and removes the temporary properties');

// ---- login
const PW = 'a-long-test-password-1';
let r = call('admin_login', { id: 'admin@test.ac.th', password: 'wrong' });
assert.equal(r.reason, 'admin_invalid'); assert.equal(r.extra.attempts_left, 4);
assert.equal(call('admin_login', { id: 'nobody@x', password: 'wrong' }).reason, 'admin_invalid');
r = call('admin_login', { id: 'ADMIN@test.ac.th ', password: PW });
assert.equal(r.ok, true); const S = r.data.session; assert.match(S, /^[0-9a-f]{64}$/); assert.equal(r.data.totp, false);
assert.equal(store.lookup_attempts.filter((x) => x[0] === 'admin').length, 0, 'success clears the counter');
for (let i = 0; i < 4; i++) call('admin_login', { id: 'admin@test.ac.th', password: 'bad' + i });
assert.equal(call('admin_login', { id: 'admin@test.ac.th', password: 'bad5' }).reason, 'admin_locked');
assert.equal(call('admin_login', { id: 'admin@test.ac.th', password: PW }).reason, 'admin_locked');
const att = store.lookup_attempts.filter((x) => x[0] === 'admin')[0];
att[3] = new Date(Date.now() - 1000).toISOString();
att[2] = new Date(Date.now() - 20 * 60000).toISOString();
assert.equal(call('admin_login', { id: 'admin@test.ac.th', password: PW }).ok, true);
console.log('ok: login, global lock-out, recovery after the lock');

// ---- sessions
assert.equal(call('admin_overview', {}).reason, 'unauthorized');
assert.equal(call('admin_overview', { session: 'x' }).reason, 'unauthorized');
assert.equal(call('admin_overview', { session: 'a'.repeat(64) }).reason, 'unauthorized');
const adminActions = ['admin_me', 'admin_overview', 'admin_teams', 'admin_editions', 'admin_settings', 'admin_slots', 'admin_reset_pin', 'admin_delete_team', 'admin_update_team',
  'admin_save_edition', 'admin_set_current', 'admin_create_edition', 'admin_save_slot', 'admin_delete_slot', 'admin_set_team_status', 'admin_save_settings',
  'admin_confirm_asset', 'admin_prepare_asset', 'admin_totp_begin', 'admin_totp_confirm', 'admin_change_password', 'admin_mark_read'];
for (const a of adminActions) assert.equal(call(a, {}).reason, 'unauthorized', a + ' must require a session');
assert.equal(call('admin_me', { session: S }).data.id, 'admin@test.ac.th');
const key = 'sess:' + S;
const sess = JSON.parse(cacheStore[key]);
sess.last = Date.now() - 3 * 3600 * 1000;
cacheStore[key] = JSON.stringify(sess);
assert.equal(call('admin_me', { session: S }).reason, 'unauthorized', 'idle for 3 h');
const S2 = call('admin_login', { id: 'admin@test.ac.th', password: PW }).data.session;
call('admin_logout', { session: S2 });
assert.equal(call('admin_me', { session: S2 }).reason, 'unauthorized', 'logged out');
const s = call('admin_login', { id: 'admin@test.ac.th', password: PW }).data.session;
console.log('ok: every admin action refuses without a session; idle expiry; logout');

// ---- overview / editions
r = call('admin_overview', { session: s }).data;
assert.deepEqual(out(r.teams), { total: 2, pending: 2, approved: 0 }); assert.equal(r.unread_messages, 1); assert.equal(r.edition.registration_open, false);
assert.equal(call('admin_create_edition', { session: s, year: 2026 }).reason, 'edition_exists');
assert.equal(call('admin_create_edition', { session: s, year: 1999 }).reason, 'invalid_input');
r = call('admin_create_edition', { session: s, year: 2027, copy_from: 'ed1' });
assert.equal(r.ok, true);
const ed2 = r.data.id;
let list = call('admin_editions', { session: s }).data.editions;
assert.equal(list[0].year, 2027); assert.equal(list[0].title, 'Sci-Tech Pitching 2027'); assert.equal(list[0].status, 'draft');
assert.equal(list[0].reg_mode, 'closed'); assert.equal(list[0].is_current, false); assert.equal(list[0].ref_prefix, 'ST27');
assert.equal(store.upload_slots.filter((x) => x[1] === ed2).length, 1, 'slot copied');
assert.equal(store.upload_slots.filter((x) => x[1] === ed2)[0][7], 'false', 'copied slot is closed');
assert.equal(call('admin_save_edition', { session: s, id: ed2, reg_mode: 'maybe' }).reason, 'invalid_input');
assert.equal(call('admin_save_edition', { session: s, id: ed2, registration_opens_at: '2027-02-01T00:00:00Z', registration_closes_at: '2027-01-01T00:00:00Z' }).reason, 'invalid_window');
assert.equal(call('admin_save_edition', { session: s, id: ed2, max_members: 0 }).reason, 'invalid_input');
assert.equal(call('admin_save_edition', { session: s, id: 'nope', title: 'x' }).reason, 'not_found');
r = call('admin_save_edition', { session: s, id: ed2, title: '  New  ', reg_mode: 'auto', registration_opens_at: '2027-01-01T00:00:00Z', registration_closes_at: '2027-02-01T00:00:00Z', max_members: 5, key_dates: [{ label: 'a', date: '2027-01-01' }, { label: '', date: '' }] });
assert.equal(r.ok, true);
const e2 = call('admin_editions', { session: s }).data.editions[0];
assert.equal(e2.title, 'New'); assert.equal(e2.max_members, 5); assert.equal(e2.key_dates.length, 1);
console.log('ok: create/save edition validations');

call('admin_set_current', { session: s, id: ed2 });
list = call('admin_editions', { session: s }).data.editions;
assert.equal(list.filter((e) => e.is_current).length, 1); assert.equal(list[0].is_current, true); assert.equal(list[0].status, 'active');
call('admin_set_current', { session: s, id: 'ed1' });
assert.equal(call('admin_editions', { session: s }).data.editions.filter((e) => e.is_current)[0].year, 2026);
console.log('ok: exactly one current edition');

// ---- teams
r = call('admin_teams', { session: s, edition_id: 'ed1' }).data;
assert.equal(r.teams.length, 2); assert.ok(r.teams[0].uploads[0].view_url.includes('FILEID1234567')); assert.equal(r.teams[0].messages.length, 1);
assert.ok(!('pin_hash' in r.teams[0]));
assert.equal(call('admin_set_team_status', { session: s, team_id: 't1', status: 'bogus' }).reason, 'invalid_input');
call('admin_set_team_status', { session: s, team_id: 't1', status: 'approved' });
assert.equal(call('admin_overview', { session: s }).data.teams.approved, 1);
call('admin_mark_read', { session: s, team_id: 't1' });
assert.equal(call('admin_overview', { session: s }).data.unread_messages, 0);

for (let i = 0; i < 5; i++) call('lookup_team', { name_en: 'Beta', pin: '0000' });
assert.equal(call('lookup_team', { name_en: 'Beta', pin: '1111' }).reason, 'locked');
assert.equal(call('admin_reset_pin', { session: s, team_id: 't2', pin: '12' }).reason, 'invalid_pin');
call('admin_reset_pin', { session: s, team_id: 't2', pin: '9876' });
assert.equal(call('lookup_team', { name_en: 'Beta', pin: '1111' }).reason, 'invalid_credentials');
assert.equal(call('lookup_team', { name_en: 'Beta', pin: '9876' }).ok, true);
console.log('ok: status, messages read, PIN reset clears the lock');

const upd = (o) => call('admin_update_team', Object.assign({
  session: s, team_id: 't1', name_th: 'ใหม่', name_en: 'Alpha 2',
  members: [{ student_id: '6401234567001', full_name: 'A2', phone: '0811111112' }, { student_id: '6401234567003', full_name: 'C', phone: '0833333333' }],
  advisors: [{ full_name: 'อ.', department: 'd', faculty: 'f' }],
}, o));
assert.equal(upd({ members: [{ student_id: '6401234567002', full_name: 'X', phone: '0811111111' }] }).reason, 'student_id_taken');
assert.equal(upd({ name_en: ' BETA ' }).reason, 'team_name_taken');
assert.equal(upd({ members: [] }).reason, 'invalid_members');
assert.equal(upd({ members: Array(8).fill({ student_id: '6401234567009', full_name: 'x', phone: '0811111111' }) }).reason, 'invalid_members');
assert.equal(upd({}).ok, true);
r = call('admin_teams', { session: s, edition_id: 'ed1' }).data.teams.filter((t) => t.id === 't1')[0];
assert.equal(r.name_en, 'Alpha 2'); assert.equal(r.members.length, 2); assert.equal(r.members[0].full_name, 'A2'); assert.equal(r.members[1].order_no, 2);
assert.equal(store.members.length, 4, 'header + 2 (Alpha) + 1 (Beta), nothing left behind');
assert.equal(call('lookup_team', { name_en: 'alpha  2', pin: '4821' }).ok, true, 'name key updated, PIN kept');
console.log('ok: edit on behalf (uniqueness excluding itself, rows replaced)');

assert.equal(call('admin_delete_team', { session: s, team_id: 'nope' }).reason, 'not_found');
assert.equal(call('admin_delete_team', { session: s, team_id: 't1' }).ok, true);
assert.equal(store.teams.length, 2); assert.equal(store.members.length, 2); assert.equal(store.advisors.length, 2);
assert.equal(store.uploads.length, 1); assert.equal(store.messages.length, 1);
console.log('ok: delete removes everything attached');

// ---- slots
row('uploads', { id: 'u2', team_id: 't2', slot_id: 's1', drive_file_id: 'FILEID7654321', file_name: 'y.pdf', size_bytes: 10, uploaded_at: 'now' });
r = call('admin_save_slot', { session: s, edition_id: 'ed1', title: 'New slot', description: '', accept: ['PDF', '.jpg'], max_mb: 5, deadline: '', is_open: true, sort_order: 2 });
assert.equal(r.ok, true);
const sid = r.data.id;
assert.equal(call('admin_save_slot', { session: s, edition_id: 'ed1', title: 'x', accept: [], max_mb: 5 }).reason, 'invalid_input');
assert.equal(call('admin_save_slot', { session: s, edition_id: 'ed1', title: 'x', accept: ['p df'], max_mb: 5 }).reason, 'invalid_input');
assert.equal(call('admin_save_slot', { session: s, edition_id: 'ed1', title: 'x', accept: ['pdf'], max_mb: 0 }).reason, 'invalid_input');
const sl = call('admin_slots', { session: s, edition_id: 'ed1' }).data.slots;
assert.deepEqual(out(sl.filter((x) => x.id === sid)[0].accept), ['pdf', 'jpg']);
assert.equal(call('lookup_team', { name_en: 'Beta', pin: '9876' }).data.slots.length, 1, 'open slot visible to teams');
r = call('admin_delete_slot', { session: s, id: 's1' });
assert.equal(r.reason, 'slot_has_files'); assert.equal(r.extra.uploads_count, 1);
assert.equal(call('admin_delete_slot', { session: s, id: 's1', force: true }).ok, true);
assert.equal(call('admin_delete_slot', { session: s, id: sid }).ok, true);
assert.equal(store.upload_slots.filter((x) => x[1] === 'ed1').length, 0);
console.log('ok: slots CRUD');

// ---- settings
assert.equal(call('admin_save_settings', { session: s, settings: { site_name: '' } }).reason, 'invalid_input');
call('admin_save_settings', { session: s, settings: { site_name: 'X', footer_text: 'F', evil_key: 'zzz' } });
assert.equal(call('admin_settings', { session: s }).data.settings.site_name, 'X');
assert.ok(!store.site_settings.some((x) => x[0] === 'evil_key'), 'unknown keys are ignored');
console.log('ok: settings only accept known keys');

// ---- password change
const PW2 = 'another-long-password';
assert.equal(call('admin_change_password', { session: s, password: 'nope', new_password: PW2 }).reason, 'admin_invalid');
assert.equal(call('admin_change_password', { session: s, password: PW, new_password: 'short' }).reason, 'password_too_short');
assert.equal(call('admin_change_password', { session: s, password: PW, new_password: PW }).reason, 'password_same');
assert.equal(call('admin_change_password', { session: s, password: PW, new_password: PW2 }).ok, true);
assert.equal(call('admin_login', { id: 'admin@test.ac.th', password: PW }).reason, 'admin_invalid');
const s3 = call('admin_login', { id: 'admin@test.ac.th', password: PW2 }).data.session;
console.log('ok: change password');

// ---- TOTP registration, one-time use
assert.equal(call('admin_totp_begin', { session: s3, password: 'bad' }).reason, 'admin_invalid');
const tb = call('admin_totp_begin', { session: s3, password: PW2 }).data;
assert.match(tb.secret, /^[A-Z2-7]{32}$/); assert.ok(tb.uri.startsWith('otpauth://totp/'));
assert.equal(call('admin_totp_confirm', { session: s3, code: '000000' }).reason, 'totp_invalid');
const step = Math.floor(Date.now() / 30000);
assert.equal(call('admin_totp_confirm', { session: s3, code: fns.totpCode_(tb.secret, step) }).ok, true);
assert.equal(call('admin_me', { session: s3 }).data.totp, true);
const verify = (c) => { try { return fns.withLock_(() => fns.totpVerify_('admin@test.ac.th', c)); } catch (e) { if (!e.reason) console.log('ERR', e.stack); return e.reason; } };
assert.equal(verify(fns.totpCode_(tb.secret, step)), 'totp_invalid', 'the confirmation code cannot be reused');
const next = fns.totpCode_(tb.secret, step + 1);
assert.equal(verify(next), true);
assert.equal(verify(next), 'totp_invalid', 'replay refused');
for (let i = 0; i < 5; i++) verify('123456');
assert.equal(verify(fns.totpCode_(tb.secret, step + 1)), 'admin_locked');
assert.ok(!JSON.stringify(call('admin_me', { session: s3 })).includes(tb.secret));
console.log('ok: TOTP register, verify once, replay refused, lock-out');
console.log('ALL ADMIN TESTS PASSED');
