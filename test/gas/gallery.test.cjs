const assert = require('assert');
const { store, props, cacheStore, row, call, fns, driveFiles } = require('./harness.cjs');

row('editions', { id: 'ed1', year: 2026, title: 'T26', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST26', ref_counter: 0, is_current: 'true', status: 'active', key_dates: '[]' });
row('editions', { id: 'ed0', year: 2025, title: 'T25', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST25', ref_counter: 0, is_current: 'false', status: 'archived', key_dates: '[]' });
row('editions', { id: 'edD', year: 2027, title: 'T27', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST27', ref_counter: 0, is_current: 'false', status: 'draft', key_dates: '[]' });

props.NEW_ADMIN_ID = 'admin@test.ac.th';
props.NEW_ADMIN_PASSWORD = 'a-long-test-password-1';
fns.createAdmin();
const login = call('admin_login', { id: 'admin@test.ac.th', password: 'a-long-test-password-1' });
assert.ok(login.ok);
const S = login.data.session;
const A = (action, req = {}) => call(action, { ...req, session: S });

// ---- every admin gallery action refuses without a session
['admin_albums', 'admin_album', 'admin_save_album', 'admin_reorder_albums', 'admin_delete_album', 'admin_prepare_photo', 'admin_confirm_photo',
  'admin_update_photo', 'admin_set_cover', 'admin_reorder_photos', 'admin_delete_photo'].forEach((a) => {
  assert.equal(call(a, {}).reason, 'unauthorized', a);
  assert.equal(call(a, { session: 'f'.repeat(64) }).reason, 'unauthorized', a);
});
console.log('ok: gallery admin actions need a session');

// ---- create albums
let r = A('admin_save_album', { edition_id: 'ed1', title: '  ', is_published: true });
assert.equal(r.reason, 'invalid_input');
r = A('admin_save_album', { edition_id: 'nope', title: 'x' });
assert.equal(r.reason, 'not_found');
r = A('admin_save_album', { edition_id: 'ed1', title: 'x', external_url: 'http://evil.test/a' });
assert.equal(r.reason, 'invalid_url');
r = A('admin_save_album', { edition_id: 'ed1', title: 'x', external_url: 'javascript:alert(1)' });
assert.equal(r.reason, 'invalid_url');
r = A('admin_save_album', { edition_id: 'ed1', title: 'x', event_date: '2026-13-45x' });
assert.equal(r.reason, 'invalid_input');

const a1 = A('admin_save_album', { edition_id: 'ed1', title: 'งานวันแรก', description: 'd', event_date: '2026-12-01', is_published: true }).data.id;
const a2 = A('admin_save_album', { edition_id: 'ed1', title: 'งานวันที่สอง', is_published: true }).data.id;
const a3 = A('admin_save_album', { edition_id: 'ed1', title: 'ลิงก์ภายนอก', external_url: 'https://photos.example.com/album/1', is_published: true }).data.id;
const aOld = A('admin_save_album', { edition_id: 'ed0', title: 'ปี 2025', external_url: 'https://old.example.com/a', is_published: true }).data.id;
const aDraft = A('admin_save_album', { edition_id: 'edD', title: 'ปีร่าง', external_url: 'https://x.example.com/y', is_published: true }).data.id;
const aHidden = A('admin_save_album', { edition_id: 'ed1', title: 'ซ่อน', external_url: 'https://h.example.com/y', is_published: false }).data.id;
let list = A('admin_albums').data.albums;
assert.equal(list.length, 6);
// new albums go to the top of their edition
const ed1 = list.filter((a) => a.edition_id === 'ed1').sort((x, y) => x.sort_order - y.sort_order).map((a) => a.id);
assert.deepEqual(ed1, [aHidden, a3, a2, a1]);
console.log('ok: albums created, validated, new ones on top');

// ---- upload flow
const photo = (albumId, id, o = {}) => { driveFiles[id] = { name: `${albumId}_1_p.jpg`, parent: 'GALLERYFOLDER', size: 500000, mime: 'image/jpeg', ...o }; return id; };
const prep = { album_id: a1, file_name: 'ภาพ งาน.JPG', size: 400000, mime: 'image/jpeg', origin: 'https://ncrmutr.github.io' };
assert.ok(A('admin_prepare_photo', prep).data.upload_url.startsWith('https://'));
assert.equal(A('admin_prepare_photo', { ...prep, origin: 'https://evil.example' }).reason, 'origin_not_allowed');
assert.equal(A('admin_prepare_photo', { ...prep, size: 9 * 1024 * 1024 }).reason, 'file_too_large');
assert.equal(A('admin_prepare_photo', { ...prep, file_name: 'x.pdf' }).reason, 'file_type_not_allowed');
assert.equal(A('admin_prepare_photo', { ...prep, file_name: 'x.svg' }).reason, 'file_type_not_allowed');
assert.equal(A('admin_prepare_photo', { ...prep, album_id: a3 }).reason, 'album_is_external');
assert.equal(A('admin_prepare_photo', { ...prep, album_id: 'zzz' }).reason, 'not_found');

const P = ['PHOTOFILE0001', 'PHOTOFILE0002', 'PHOTOFILE0003'].map((id) => photo(a1, id));
const ids = P.map((fid, i) => A('admin_confirm_photo', { album_id: a1, file_id: fid, width: 2000, height: 1500, caption: 'c' + i }).data.id);
assert.equal(store.gallery_photos.length, 4);
assert.equal(A('admin_confirm_photo', { album_id: a1, file_id: P[0] }).data.id, ids[0], 'retry is idempotent');
assert.equal(store.gallery_photos.length, 4);
// rejected files
driveFiles.WRONGFOLDER01 = { name: `${a1}_1_p.jpg`, parent: 'OTHER', size: 1000, mime: 'image/jpeg' };
assert.equal(A('admin_confirm_photo', { album_id: a1, file_id: 'WRONGFOLDER01' }).reason, 'file_not_found');
driveFiles.WRONGALBUM001 = { name: `${a2}_1_p.jpg`, parent: 'GALLERYFOLDER', size: 1000, mime: 'image/jpeg' };
assert.equal(A('admin_confirm_photo', { album_id: a1, file_id: 'WRONGALBUM001' }).reason, 'file_not_found');
driveFiles.NOTIMAGE00001 = { name: `${a1}_1_p.jpg`, parent: 'GALLERYFOLDER', size: 1000, mime: 'application/pdf' };
assert.equal(A('admin_confirm_photo', { album_id: a1, file_id: 'NOTIMAGE00001' }).reason, 'file_type_not_allowed');
assert.equal(driveFiles.NOTIMAGE00001.trashed, true);
driveFiles.HUGEFILE00001 = { name: `${a1}_1_p.jpg`, parent: 'GALLERYFOLDER', size: 20 * 1024 * 1024, mime: 'image/jpeg' };
assert.equal(A('admin_confirm_photo', { album_id: a1, file_id: 'HUGEFILE00001' }).reason, 'file_too_large');
assert.equal(A('admin_confirm_photo', { album_id: a1, file_id: 'no/slash' }).reason, 'file_not_found');
assert.equal(A('admin_confirm_photo', { album_id: a3, file_id: 'PHOTOFILE0001' }).reason, 'album_is_external');
assert.equal(store.gallery_photos.length, 4);
console.log('ok: photo upload checks (folder, album prefix, type, size, idempotent)');

// ---- public view
let pub = call('public_gallery', {}).data;
const titles = pub.albums.map((x) => x.title);
assert.ok(titles.includes('งานวันแรก') && titles.includes('ลิงก์ภายนอก') && titles.includes('ปี 2025'));
assert.ok(!titles.includes('งานวันที่สอง'), 'album without photos is hidden');
assert.ok(!titles.includes('ซ่อน'), 'unpublished hidden');
assert.ok(!titles.includes('ปีร่าง'), 'draft edition hidden');
assert.equal(pub.albums[0].year, 2026);
assert.equal(pub.albums.find((x) => x.id === a1).photo_count, 3);
assert.ok(pub.albums.find((x) => x.id === a1).cover_url.includes('PHOTOFILE0001'));
assert.ok(!JSON.stringify(pub).includes('drive_file_id'));
const album = call('public_album', { album_id: a1 }).data;
assert.equal(album.photos.length, 3);
assert.deepEqual(album.photos.map((p) => p.caption), ['c0', 'c1', 'c2']);
assert.ok(album.photos[0].url.includes('sz=w2000') && album.photos[0].thumb_url.includes('sz=w480'));
assert.equal(call('public_album', { album_id: a2 }).reason, 'not_found');
assert.equal(call('public_album', { album_id: aHidden }).reason, 'not_found');
assert.equal(call('public_album', { album_id: aDraft }).reason, 'not_found');
assert.equal(call('public_album', { album_id: a3 }).data.album.external_url, 'https://photos.example.com/album/1');
assert.equal(call('public_album', {}).reason, 'not_found');
console.log('ok: public gallery shows only published albums of non-draft editions');

// ---- the home strip still works and shows the photos
const site = call('public_site', {}).data;
assert.equal(site.latest_photos.length, 3);

// ---- cover, reorder, caption, delete
assert.equal(A('admin_set_cover', { album_id: a1, photo_id: ids[2] }).ok, true);
cacheStore; // cache was busted by the write
assert.ok(call('public_gallery', {}).data.albums.find((x) => x.id === a1).cover_url.includes('PHOTOFILE0003'));
assert.equal(A('admin_set_cover', { album_id: a2, photo_id: ids[0] }).reason, 'not_found'); // photo of another album
assert.equal(A('admin_reorder_photos', { album_id: a1, ids: [ids[2], ids[0], ids[1]] }).ok, true);
assert.deepEqual(call('public_album', { album_id: a1 }).data.photos.map((p) => p.id), [ids[2], ids[0], ids[1]]);
assert.equal(A('admin_reorder_photos', { album_id: a1, ids: [ids[0], 'bogus'] }).reason, 'not_found');
assert.equal(A('admin_update_photo', { id: ids[0], caption: 'ใหม่' }).ok, true);
assert.equal(A('admin_update_photo', { id: ids[0], caption: 'x'.repeat(201) }).reason, 'invalid_input');
assert.equal(A('admin_reorder_albums', { ids: [a1, a2, a3] }).ok, true);
assert.deepEqual(A('admin_albums').data.albums.filter((a) => [a1, a2, a3].includes(a.id)).sort((x, y) => x.sort_order - y.sort_order).map((a) => a.id), [a1, a2, a3]);
// delete the cover photo -> cover falls back to the first photo, file trashed
assert.equal(A('admin_delete_photo', { id: ids[2] }).data.file_trashed, true);
assert.equal(driveFiles.PHOTOFILE0003.trashed, true);
assert.equal(A('admin_albums').data.albums.find((a) => a.id === a1).cover_photo_id, '');
assert.equal(A('admin_albums').data.albums.find((a) => a.id === a1).photo_count, 2);
// an album holding photos cannot silently become an external link
assert.equal(A('admin_save_album', { id: a1, edition_id: 'ed1', title: 'x', external_url: 'https://a.example.com/x' }).reason, 'album_has_photos');
// unpublish
assert.equal(A('admin_save_album', { id: a1, edition_id: 'ed1', title: 'งานวันแรก', is_published: false }).ok, true);
assert.ok(!call('public_gallery', {}).data.albums.some((x) => x.id === a1));
assert.equal(call('public_site', {}).data.latest_photos.length, 0);
// delete album removes rows and trashes the files
const del = A('admin_delete_album', { id: a1 }).data;
assert.equal(del.photos_removed, 2);
assert.equal(driveFiles.PHOTOFILE0001.trashed, true);
assert.equal(store.gallery_photos.length, 1);
assert.equal(A('admin_delete_album', { id: a1 }).reason, 'not_found');
console.log('ok: cover / reorder / caption / unpublish / delete');

// ---- purge-independence is checked in G6; audit entries exist
assert.ok(store.audit_log.some((x) => x[2] === 'delete_album'));
console.log('ALL GALLERY TESTS PASSED');
