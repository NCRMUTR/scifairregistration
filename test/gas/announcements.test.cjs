// Home-page announcements table: admin writes, public_site shows only the current edition's published items.
const assert = require('assert');
const h = require('./harness.cjs');
const { store, props, row, call, fns } = h;

row('editions', { id: 'ed1', year: 2026, title: 'T', max_members: 7, reg_mode: 'open', ref_prefix: 'ST26', ref_counter: 0, is_current: 'true', status: 'active', key_dates: '[]' });
row('editions', { id: 'ed0', year: 2025, title: 'T25', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST25', ref_counter: 0, is_current: 'false', status: 'archived', key_dates: '[]' });

props.NEW_ADMIN_ID = 'admin@test.ac.th';
props.NEW_ADMIN_PASSWORD = 'a-long-test-password-1';
fns.createAdmin();
const S = call('admin_login', { id: 'admin@test.ac.th', password: 'a-long-test-password-1' }).data.session;
const A = (a, r = {}) => call(a, { ...r, session: S });
const news = () => call('public_site', {}).data.announcements;

// sessions
['admin_announcements', 'admin_save_announcement', 'admin_delete_announcement'].forEach((a) => {
  assert.equal(call(a, {}).reason, 'unauthorized', a);
  assert.equal(call(a, { session: 'f'.repeat(64) }).reason, 'unauthorized', a);
});
assert.deepEqual(news(), [], 'empty at first');

// validation
const base = { edition_id: 'ed1', title: 'เปิดรับสมัครแล้ว', body: 'รายละเอียด **สำคัญ**', publish_date: '2026-12-01' };
assert.equal(A('admin_save_announcement', { ...base, title: '  ' }).reason, 'invalid_input');
assert.equal(A('admin_save_announcement', { ...base, title: 'x'.repeat(151) }).reason, 'invalid_input');
assert.equal(A('admin_save_announcement', { ...base, body: 'x'.repeat(1001) }).reason, 'invalid_input');
assert.equal(A('admin_save_announcement', { ...base, publish_date: '2026-13-40' }).reason, 'invalid_input');
assert.equal(A('admin_save_announcement', { ...base, publish_date: 'tomorrow' }).reason, 'invalid_input');
assert.equal(A('admin_save_announcement', { ...base, link_url: 'http://insecure.example/x' }).reason, 'invalid_url');
assert.equal(A('admin_save_announcement', { ...base, link_url: 'javascript:alert(1)' }).reason, 'invalid_url');
assert.equal(A('admin_save_announcement', { ...base, edition_id: 'nope' }).reason, 'not_found');
assert.equal(A('admin_save_announcement', { ...base, id: 'missing' }).reason, 'not_found');
assert.equal(store.announcements.length, 1, 'nothing written by refused requests');

// create: ordering = pinned first, then newest date first
const a1 = A('admin_save_announcement', { ...base, link_url: 'https://example.com/news/1', link_label: 'อ่านต่อ' }).data.id;
const a2 = A('admin_save_announcement', { ...base, title: 'ประกาศใหม่กว่า', publish_date: '2026-12-10' }).data.id;
const a3 = A('admin_save_announcement', { ...base, title: 'ปักหมุด', publish_date: '2026-11-01', is_pinned: true }).data.id;
const hidden = A('admin_save_announcement', { ...base, title: 'ร่าง (ซ่อน)', is_published: false }).data.id;
const other = A('admin_save_announcement', { ...base, edition_id: 'ed0', title: 'ปีเก่า' }).data.id;
assert.deepEqual(news().map((n) => n.title), ['ปักหมุด', 'ประกาศใหม่กว่า', 'เปิดรับสมัครแล้ว']);
let first = news().find((n) => n.id === a1);
assert.deepEqual(first, { id: a1, title: 'เปิดรับสมัครแล้ว', body: 'รายละเอียด **สำคัญ**', link_url: 'https://example.com/news/1', link_label: 'อ่านต่อ', date: '2026-12-01', pinned: false });
assert.ok(!news().some((n) => n.id === hidden || n.id === other), 'unpublished and other editions are not public');
assert.ok(!JSON.stringify(news()).includes('edition_id'));

// the admin sees everything of the chosen edition, in the same order
let list = A('admin_announcements', { edition_id: 'ed1' }).data;
assert.equal(list.announcements.length, 4);
assert.equal(list.announcements[0].title, 'ปักหมุด');
assert.equal(list.announcements.find((x) => x.id === hidden).is_published, false);
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(list.today));
assert.deepEqual(A('admin_announcements', { edition_id: 'ed0' }).data.announcements.map((x) => x.title), ['ปีเก่า']);

// default date = today (Bangkok); link label dropped without a link; plain-text hostile content is stored verbatim
const today = A('admin_save_announcement', { edition_id: 'ed1', title: '<img src=x onerror=alert(1)>', body: '=HYPERLINK("x")', link_label: 'ignored', publish_date: '' }).data.id;
const t = A('admin_announcements', { edition_id: 'ed1' }).data.announcements.find((x) => x.id === today);
assert.equal(t.publish_date, list.today);
assert.equal(t.link_label, '');
assert.equal(t.title, '<img src=x onerror=alert(1)>');

// edit: unpublish / pin / change, public view follows at once (cache is busted by the write)
assert.ok(A('admin_save_announcement', { ...base, id: a2, title: 'แก้ไขแล้ว', publish_date: '2026-12-10', is_published: false }).ok);
assert.ok(!news().some((n) => n.id === a2));
assert.ok(A('admin_save_announcement', { ...base, id: a2, title: 'แก้ไขแล้ว', publish_date: '2026-12-10', is_published: true, is_pinned: true }).ok);
assert.deepEqual(news().slice(0, 2).map((n) => n.title), ['แก้ไขแล้ว', 'ปักหมุด'], 'two pinned: newer date first');
assert.equal(store.announcements.length - 1, 6);

// delete
assert.equal(A('admin_delete_announcement', { id: a1 }).data.deleted, true);
assert.ok(!news().some((n) => n.id === a1));
assert.equal(A('admin_delete_announcement', { id: a1 }).reason, 'not_found');
assert.ok(store.audit_log.some((x) => x[2] === 'create_announcement') && store.audit_log.some((x) => x[2] === 'delete_announcement'));

// the public list is capped at 30; the per-edition cap protects the sheet
for (let i = 0; i < 40; i++) row('announcements', { id: 'bulk' + i, edition_id: 'ed1', title: 'b' + i, body: '', publish_date: '2026-01-01', is_pinned: 'false', is_published: 'true', created_at: 'z' + i });
h.cacheStore.public_data && delete h.cacheStore.public_data;
assert.equal(news().length, 30);
for (let i = 40; i < 200; i++) row('announcements', { id: 'bulk' + i, edition_id: 'ed1', title: 'b' + i, body: '', publish_date: '2026-01-01', is_pinned: 'false', is_published: 'true', created_at: 'z' + i });
assert.equal(A('admin_save_announcement', { ...base, title: 'one too many' }).reason, 'too_many_announcements');
console.log('ALL ANNOUNCEMENT TESTS PASSED');
