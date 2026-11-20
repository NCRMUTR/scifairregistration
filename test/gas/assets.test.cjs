// Logo / background / project PDF: transparent logo URL, and removing each asset (admin_clear_asset).
const assert = require('assert');
const { store, props, row, call, fns, driveFiles } = require('./harness.cjs');
const IDX = (n, c) => require('./harness.cjs').SCHEMA[n].indexOf(c);

const LOGO = 'LOGOFILE00001', BG = 'BGFILE0000001', PDF = 'PDFFILE0000001';
[LOGO, BG, PDF].forEach((id) => { driveFiles[id] = { name: id, parent: 'PUBFOLDER', size: 1000, mime: 'image/png' }; });
row('site_settings', { key: 'site_name', value: 'X', updated_at: 'a' });
row('site_settings', { key: 'logo_file_id', value: LOGO, updated_at: 'a' });
row('editions', { id: 'ed1', year: 2026, title: 'T', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST26', ref_counter: 0, is_current: 'true', status: 'active', key_dates: '[]', background_file_id: BG, rules_pdf_file_id: PDF });
row('editions', { id: 'ed0', year: 2025, title: 'T25', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST25', ref_counter: 0, is_current: 'false', status: 'archived', key_dates: '[]', background_file_id: 'OTHERBG000001', rules_pdf_file_id: 'OTHERPDF00001' });

props.NEW_ADMIN_ID = 'admin@test.ac.th';
props.NEW_ADMIN_PASSWORD = 'a-long-test-password-1';
fns.createAdmin();
const S = call('admin_login', { id: 'admin@test.ac.th', password: 'a-long-test-password-1' }).data.session;
const A = (a, r = {}) => call(a, { ...r, session: S });

// the logo keeps its transparency: the "-pp" flag, not the plain Drive thumbnail (which turns transparent areas black)
let site = call('public_site', {}).data;
assert.ok(site.logo_url.startsWith('https://lh3.googleusercontent.com/d/' + LOGO) && site.logo_url.endsWith('=w400-pp'), site.logo_url);
assert.ok(site.edition.background_url && site.edition.rules_pdf);
assert.ok(A('admin_settings').data.logo_url.endsWith('=w400-pp'));

// needs a session; validates input
assert.equal(call('admin_clear_asset', { kind: 'logo' }).reason, 'unauthorized');
assert.equal(A('admin_clear_asset', { kind: 'nope' }).reason, 'invalid_input');
assert.equal(A('admin_clear_asset', { kind: 'background', edition_id: 'missing' }).reason, 'not_found');

// background: only that edition, file goes to the trash
let r = A('admin_clear_asset', { kind: 'background', edition_id: 'ed1' });
assert.deepEqual(r.data, { kind: 'background', removed: true });
assert.equal(driveFiles[BG].trashed, true);
assert.equal(store.editions[1][IDX('editions', 'background_file_id')], '');
assert.equal(store.editions[1][IDX('editions', 'rules_pdf_file_id')], PDF, 'the PDF is untouched');
assert.equal(store.editions[2][IDX('editions', 'background_file_id')], 'OTHERBG000001', 'other edition untouched');
site = call('public_site', {}).data;
assert.equal(site.edition.background_url, null);
assert.ok(site.edition.rules_pdf);

// PDF
r = A('admin_clear_asset', { kind: 'rules_pdf', edition_id: 'ed1' });
assert.equal(r.data.removed, true);
assert.equal(driveFiles[PDF].trashed, true);
assert.equal(call('public_site', {}).data.edition.rules_pdf, null);

// logo (site-wide)
r = A('admin_clear_asset', { kind: 'logo' });
assert.equal(r.data.removed, true);
assert.equal(driveFiles[LOGO].trashed, true);
assert.equal(call('public_site', {}).data.logo_url, null);

// nothing left: harmless, reports removed:false
assert.deepEqual(A('admin_clear_asset', { kind: 'logo' }).data, { kind: 'logo', removed: false });
assert.deepEqual(A('admin_clear_asset', { kind: 'background', edition_id: 'ed1' }).data, { kind: 'background', removed: false });
assert.ok(store.audit_log.some((x) => x[2] === 'clear_asset'));
console.log('ALL ASSET TESTS PASSED');
