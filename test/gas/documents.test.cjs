// Forms / documents for the teams: admin uploads, a team sees them only after name + PIN, other editions stay separate.
const assert = require('assert');
const h = require('./harness.cjs');
const { store, props, row, call, fns, driveFiles, crypto } = h;

row('editions', { id: 'ed1', year: 2026, title: 'T', max_members: 7, reg_mode: 'open', ref_prefix: 'ST26', ref_counter: 1, is_current: 'true', status: 'active', key_dates: '[]' });
row('editions', { id: 'ed0', year: 2025, title: 'T25', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST25', ref_counter: 0, is_current: 'false', status: 'archived', key_dates: '[]' });
row('teams', { id: 't1', edition_id: 'ed1', ref_no: 'ST26-0001', name_th: 'ทีม', name_en: 'Alpha', name_en_key: 'alpha', pin_hash: crypto.createHmac('sha256', props.PEPPER).update('t1:4821').digest('hex'), status: 'pending', created_at: 'a' });

props.NEW_ADMIN_ID = 'admin@test.ac.th';
props.NEW_ADMIN_PASSWORD = 'a-long-test-password-1';
fns.createAdmin();
const S = call('admin_login', { id: 'admin@test.ac.th', password: 'a-long-test-password-1' }).data.session;
const A = (a, r = {}) => call(a, { ...r, session: S });

// ── nothing is public: no action lists documents without a verified team; admin actions need a session
['admin_documents', 'admin_prepare_document', 'admin_confirm_document', 'admin_update_document', 'admin_delete_document'].forEach((a) => {
  assert.equal(call(a, {}).reason, 'unauthorized', a);
  assert.equal(call(a, { session: 'f'.repeat(64) }).reason, 'unauthorized', a);
});

// ── prepare: type, size, origin
const prep = { file_name: 'แบบฟอร์ม 1.docx', size: 50000, mime: 'application/msword', origin: 'https://ncrmutr.github.io' };
assert.ok(A('admin_prepare_document', prep).data.upload_url.startsWith('http'));
assert.equal(A('admin_prepare_document', { ...prep, origin: 'https://evil.example' }).reason, 'origin_not_allowed');
assert.equal(A('admin_prepare_document', { ...prep, size: 21 * 1024 * 1024 }).reason, 'file_too_large');
assert.equal(A('admin_prepare_document', { ...prep, file_name: 'run.exe' }).reason, 'file_type_not_allowed');
assert.equal(A('admin_prepare_document', { ...prep, file_name: 'page.html' }).reason, 'file_type_not_allowed');
assert.equal(A('admin_prepare_document', { ...prep, file_name: 'noext' }).reason, 'file_type_not_allowed');

// ── confirm
const f = (id, o = {}) => { driveFiles[id] = { name: 'doc_1_x.pdf', parent: 'PUBFOLDER', size: 90000, mime: 'application/pdf', ...o }; return id; };
let r = A('admin_confirm_document', { edition_id: 'ed1', title: 'แบบฟอร์มสมัคร', file_id: f('DOCFILE000001'), file_name: 'form1.pdf' });
assert.ok(r.ok, JSON.stringify(r));
assert.equal(r.data.title, 'แบบฟอร์มสมัคร');
assert.ok(r.data.download_url.includes('DOCFILE000001') && r.data.view_url.includes('DOCFILE000001'));
assert.equal(A('admin_confirm_document', { edition_id: 'ed1', title: 'x', file_id: 'DOCFILE000001' }).data.id, r.data.id, 'retry is idempotent');
assert.equal(store.documents.length, 2);
// title falls back to the file name
const r2 = A('admin_confirm_document', { edition_id: 'ed1', title: '  ', file_id: f('DOCFILE000002'), file_name: 'template.xlsx' });
assert.equal(r2.data.title, 'template');
// rejected files
assert.equal(A('admin_confirm_document', { edition_id: 'ed1', title: 't', file_id: f('WRONGFOLDER001', { parent: 'OTHER' }) }).reason, 'file_not_found');
assert.equal(A('admin_confirm_document', { edition_id: 'ed1', title: 't', file_id: f('NOTDOCPREFIX01', { name: 'logo_1_x.pdf' }) }).reason, 'file_not_found');
assert.equal(A('admin_confirm_document', { edition_id: 'ed1', title: 't', file_id: f('BADTYPE0000001', { name: 'doc_1_x.exe' }) }).reason, 'file_type_not_allowed');
assert.equal(driveFiles.BADTYPE0000001.trashed, true);
assert.equal(A('admin_confirm_document', { edition_id: 'ed1', title: 't', file_id: f('HUGEDOC0000001', { size: 30 * 1024 * 1024 }) }).reason, 'file_too_large');
assert.equal(A('admin_confirm_document', { edition_id: 'nope', title: 't', file_id: f('NOEDITION00001') }).reason, 'not_found');
assert.equal(A('admin_confirm_document', { edition_id: 'ed1', title: 'x'.repeat(121), file_id: f('LONGTITLE00001') }).reason, 'invalid_input');
assert.equal(store.documents.length, 3);

// another edition keeps its own list
A('admin_confirm_document', { edition_id: 'ed0', title: 'ปีเก่า', file_id: f('OLDDOC00000001'), file_name: 'old.pdf' });
assert.deepEqual(A('admin_documents', { edition_id: 'ed1' }).data.documents.map((d) => d.title), ['แบบฟอร์มสมัคร', 'template']);
assert.deepEqual(A('admin_documents', { edition_id: 'ed0' }).data.documents.map((d) => d.title), ['ปีเก่า']);

// ── a team sees ITS edition's documents only after name + PIN
const wrong = call('lookup_team', { name_en: 'Alpha', pin: '0000' });
assert.equal(wrong.reason, 'invalid_credentials');
assert.ok(!('documents' in wrong));
const ok = call('lookup_team', { name_en: 'Alpha', pin: '4821' });
assert.ok(ok.ok);
assert.deepEqual(ok.data.documents.map((d) => d.title), ['แบบฟอร์มสมัคร', 'template']);
assert.ok(ok.data.documents[0].download_url.startsWith('https://drive.google.com/uc?export=download&id='));
assert.ok(!JSON.stringify(ok.data.documents).includes('drive_file_id'));
assert.ok(!JSON.stringify(call('public_site', {}).data).includes('DOCFILE000001'), 'public_site never lists documents');
assert.equal(call('public_gallery', {}).ok, true);

// ── rename / delete
assert.equal(A('admin_update_document', { id: r.data.id, title: ' ' }).reason, 'invalid_input');
assert.ok(A('admin_update_document', { id: r.data.id, title: 'แบบฟอร์มที่ 1' }).ok);
assert.equal(call('lookup_team', { name_en: 'Alpha', pin: '4821' }).data.documents[0].title, 'แบบฟอร์มที่ 1');
assert.equal(A('admin_update_document', { id: 'missing', title: 'x' }).reason, 'not_found');
assert.equal(A('admin_delete_document', { id: r.data.id }).data.file_trashed, true);
assert.equal(driveFiles.DOCFILE000001.trashed, true);
assert.deepEqual(call('lookup_team', { name_en: 'Alpha', pin: '4821' }).data.documents.map((d) => d.title), ['template']);
assert.equal(A('admin_delete_document', { id: r.data.id }).reason, 'not_found');
assert.ok(store.audit_log.some((x) => x[2] === 'add_document') && store.audit_log.some((x) => x[2] === 'delete_document'));

// ── per-edition cap
for (let i = 0; i < 60; i++) row('documents', { id: 'bulk' + i, edition_id: 'ed1', title: 'b' + i, drive_file_id: 'BULKFILE' + String(i).padStart(6, '0'), file_name: 'b.pdf', size_bytes: 1, sort_order: 100 + i, uploaded_at: 'z' });
assert.equal(A('admin_confirm_document', { edition_id: 'ed1', title: 'one too many', file_id: f('CAPFILE0000001') }).reason, 'too_many_documents');
assert.equal(driveFiles.CAPFILE0000001.trashed, true);
console.log('ALL DOCUMENT TESTS PASSED');
