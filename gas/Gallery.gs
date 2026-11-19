/**
 * Gallery.gs — event photos (Stage G5).
 *
 * Albums belong to an edition but are permanent: purging participant data never touches them.
 * Photos live in the public Drive folder `gallery` (FOLDER_GALLERY). The browser shrinks every photo (long edge <= 2000 px,
 * JPEG, EXIF removed) and uploads it straight to Drive with the same resumable flow as the other uploads.
 * An album with `external_url` is just a link to an outside gallery and holds no photos here.
 *
 * Public actions: public_gallery, public_album.   Admin actions: admin_albums … (see Code.gs).
 */

const GALLERY_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const GALLERY_MAX_MB = 8; // after the in-browser resize a photo is normally < 1 MB; this is only a safety cap

// ───────────── shared helpers ─────────────

/** Only https links without spaces/quotes/angle brackets; the page shows them as plain links with rel=noopener. */
function cleanExternalUrl_(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (s.length > 500 || !/^https:\/\/[^\s"'<>\\]+$/i.test(s) || !/^https:\/\/[^\/?#]+\.[^\/?#]+/i.test(s)) throw fail_('invalid_url');
  return s;
}

function cleanDate_(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z').getTime())) throw fail_('invalid_input');
  return s;
}

function bySort_(a, b) { return int_(a.sort_order) - int_(b.sort_order) || (a.created_at < b.created_at ? -1 : 1); }

function photosOfAlbum_(albumId, allPhotos) {
  return (allPhotos || rows_('gallery_photos')).filter(function (p) { return p.album_id === albumId; }).sort(bySort_);
}

/** The cover is the chosen photo, else the first one. Returns the photo row or null. */
function coverOf_(album, photos) {
  const chosen = album.cover_photo_id ? photos.filter(function (p) { return p.id === album.cover_photo_id; })[0] : null;
  return chosen || photos[0] || null;
}

function photoPublicView_(p) {
  return {
    id: p.id, caption: p.caption,
    thumb_url: driveThumb_(p.drive_file_id, 480),
    url: driveThumb_(p.drive_file_id, 2000),
    width: int_(p.width) || null, height: int_(p.height) || null,
  };
}

// ───────────── public ─────────────

/** All published albums of non-draft editions (cached 60 s with the rest of the public data). */
function publicGalleryData_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('public_gallery');
  if (hit) return JSON.parse(hit);

  const editions = {};
  rows_('editions').forEach(function (e) { if (e.status !== 'draft') editions[e.id] = int_(e.year); });
  const photos = rows_('gallery_photos');
  const albums = rows_('gallery_albums')
    .filter(function (a) { return bool_(a.is_published) && editions[a.edition_id] !== undefined; })
    .map(function (a) {
      const ps = photosOfAlbum_(a.id, photos);
      const cover = a.external_url ? null : coverOf_(a, ps);
      return {
        id: a.id, edition_id: a.edition_id, year: editions[a.edition_id], title: a.title, description: a.description,
        event_date: a.event_date || null, external_url: a.external_url || null,
        cover_url: cover ? driveThumb_(cover.drive_file_id, 480) : null,
        photo_count: a.external_url ? 0 : ps.length, sort_order: int_(a.sort_order),
      };
    })
    .sort(function (a, b) { return b.year - a.year || a.sort_order - b.sort_order; });
  // An album with no photos and no link has nothing to show.
  const shown = albums.filter(function (a) { return a.external_url || a.photo_count > 0; });
  const data = { albums: shown };
  const text = JSON.stringify(data);
  if (text.length < 90000) cache.put('public_gallery', text, 60);
  return data;
}

function publicGallery_() {
  return publicGalleryData_();
}

/** req: { album_id } -> { album, photos } for one published album (not cached: it is only opened on demand). */
function publicAlbum_(req) {
  rateLimit_('public_album', 300, 60);
  const id = typeof req.album_id === 'string' ? req.album_id : '';
  const meta = publicGalleryData_().albums.filter(function (a) { return a.id === id; })[0];
  if (!meta) throw fail_('not_found');
  if (meta.external_url) return { album: meta, photos: [] };
  return { album: meta, photos: photosOfAlbum_(id).map(photoPublicView_) };
}

// ───────────── admin: albums ─────────────

function albumAdminView_(a, photos) {
  const ps = photosOfAlbum_(a.id, photos);
  const cover = a.external_url ? null : coverOf_(a, ps);
  return {
    id: a.id, edition_id: a.edition_id, title: a.title, description: a.description, event_date: a.event_date || '',
    external_url: a.external_url || '', is_published: bool_(a.is_published), sort_order: int_(a.sort_order),
    cover_photo_id: a.cover_photo_id || '', cover_url: cover ? driveThumb_(cover.drive_file_id, 480) : null, photo_count: ps.length,
  };
}

/** -> { albums: [...] } every album of every edition (admin sees unpublished ones too). */
function adminAlbums_(req) {
  return adminRead_(req, function () {
    const photos = rows_('gallery_photos');
    return { albums: rows_('gallery_albums').map(function (a) { return albumAdminView_(a, photos); }) };
  });
}

/** req: { album_id } -> { album, photos } */
function adminAlbum_(req) {
  return adminRead_(req, function (r) {
    const a = findRow_('gallery_albums', String(r.album_id || ''));
    const photos = rows_('gallery_photos');
    return {
      album: albumAdminView_(a, photos),
      photos: photosOfAlbum_(a.id, photos).map(function (p) {
        return { id: p.id, caption: p.caption, thumb_url: driveThumb_(p.drive_file_id, 480), width: int_(p.width) || null, height: int_(p.height) || null };
      }),
    };
  });
}

/** req: { id? (omit to create), edition_id, title, description, event_date, external_url, is_published } */
function adminSaveAlbum_(req) {
  return adminWrite_(req, function (r, s) {
    const edition = findRow_('editions', String(r.edition_id || ''));
    const patch = {
      edition_id: edition.id,
      title: str_(r.title, 200, true),
      description: str_(r.description, 1000, false),
      event_date: cleanDate_(r.event_date),
      external_url: cleanExternalUrl_(r.external_url),
      is_published: r.is_published === true ? 'true' : 'false',
    };
    let row;
    if (r.id) {
      row = findRow_('gallery_albums', String(r.id));
      // Turning an album into an external link while it still holds photos would hide them silently: refuse.
      if (patch.external_url && photosOfAlbum_(row.id).length) throw fail_('album_has_photos');
      update_('gallery_albums', row._row, patch);
      audit_(s, 'save_album', row.id, { title: patch.title, published: patch.is_published });
    } else {
      // New albums go to the top of their edition.
      const sameEdition = rows_('gallery_albums').filter(function (a) { return a.edition_id === edition.id; });
      const top = sameEdition.reduce(function (m, a) { return Math.min(m, int_(a.sort_order)); }, 1);
      row = { id: uuid_(), cover_photo_id: '', sort_order: top - 1, created_at: nowIso_() };
      append_('gallery_albums', Object.assign({}, row, patch));
      audit_(s, 'create_album', row.id, { title: patch.title });
    }
    bustPublicCache_();
    return { id: row.id };
  });
}

/** req: { ids: [album ids in the wanted order] } — only albums of one edition, order = position in the list. */
function adminReorderAlbums_(req) {
  return adminWrite_(req, function (r) {
    const ids = Array.isArray(r.ids) ? r.ids.map(String) : [];
    if (!ids.length || ids.length > 500) throw fail_('invalid_input');
    const byId = {};
    rows_('gallery_albums').forEach(function (a) { byId[a.id] = a; });
    ids.forEach(function (id) { if (!byId[id]) throw fail_('not_found'); });
    ids.forEach(function (id, i) {
      if (int_(byId[id].sort_order) !== i + 1) update_('gallery_albums', byId[id]._row, { sort_order: i + 1 });
    });
    bustPublicCache_();
    return { ok: true };
  });
}

/** req: { id } — removes the album, its photo rows and (to the Drive trash) its photo files. */
function adminDeleteAlbum_(req) {
  return adminWrite_(req, function (r, s) {
    const a = findRow_('gallery_albums', String(r.id || ''));
    const ps = photosOfAlbum_(a.id);
    let trashed = 0;
    ps.forEach(function (p) { if (trashFile_(p.drive_file_id)) trashed++; });
    deleteWhere_('gallery_photos', function (p) { return p.album_id === a.id; });
    deleteRow_('gallery_albums', findRow_('gallery_albums', a.id)._row);
    audit_(s, 'delete_album', a.id, { title: a.title, photos: ps.length });
    bustPublicCache_();
    return { photos_removed: ps.length, files_trashed: trashed };
  });
}

// ───────────── admin: photos ─────────────

function galleryFileExt_(name) { return fileExt_(name); }

/** req: { album_id, file_name, size, mime, origin } -> { upload_url } (resumable Drive session in the public gallery folder) */
function adminPreparePhoto_(req) {
  return adminRead_(req, function (r) {
    const album = findRow_('gallery_albums', String(r.album_id || ''));
    if (album.external_url) throw fail_('album_is_external');
    if (!allowedOrigin_(r.origin)) throw fail_('origin_not_allowed');
    const size = Number(r.size);
    const ext = galleryFileExt_(r.file_name);
    if (!isFinite(size) || size <= 0 || size > GALLERY_MAX_MB * 1024 * 1024) throw fail_('file_too_large');
    if (GALLERY_EXTS.indexOf(ext) === -1) throw fail_('file_type_not_allowed');
    const name = album.id + '_' + Date.now() + '_' + safeFileName_(r.file_name, ext);
    return { upload_url: resumableSession_(props_().getProperty('FOLDER_GALLERY'), name, r.mime, size, r.origin) };
  });
}

/** req: { album_id, file_id, width, height, caption? } — checks the file really is ours, then adds the photo row. */
function adminConfirmPhoto_(req) {
  return adminWrite_(req, function (r) {
    const album = findRow_('gallery_albums', String(r.album_id || ''));
    if (album.external_url) throw fail_('album_is_external');
    const fileId = typeof r.file_id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(r.file_id) ? r.file_id : '';
    if (!fileId) throw fail_('file_not_found');

    const existing = rows_('gallery_photos').filter(function (p) { return p.drive_file_id === fileId; })[0];
    if (existing) return { id: existing.id }; // the browser retried after a lost reply

    let file;
    try { file = DriveApp.getFileById(fileId); } catch (e) { throw fail_('file_not_found'); }
    const folderId = props_().getProperty('FOLDER_GALLERY');
    let inFolder = false;
    const parents = file.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === folderId) inFolder = true; }
    if (!inFolder || file.getName().indexOf(album.id + '_') !== 0) throw fail_('file_not_found');
    const size = file.getSize();
    if (size <= 0 || size > GALLERY_MAX_MB * 1024 * 1024) { file.setTrashed(true); throw fail_('file_too_large'); }
    if (GALLERY_EXTS.indexOf(galleryFileExt_(file.getName())) === -1 || String(file.getMimeType()).indexOf('image/') !== 0) {
      file.setTrashed(true);
      throw fail_('file_type_not_allowed');
    }

    const dim = function (v) { const n = int_(v); return n > 0 && n <= 20000 ? n : 0; };
    const ps = photosOfAlbum_(album.id);
    const last = ps.reduce(function (m, p) { return Math.max(m, int_(p.sort_order)); }, 0);
    const id = uuid_();
    append_('gallery_photos', {
      id: id, album_id: album.id, drive_file_id: fileId, caption: str_(r.caption, 200, false),
      width: dim(r.width) || '', height: dim(r.height) || '', sort_order: last + 1, created_at: nowIso_(),
    });
    bustPublicCache_();
    return { id: id };
  });
}

/** req: { id, caption } */
function adminUpdatePhoto_(req) {
  return adminWrite_(req, function (r) {
    const p = findRow_('gallery_photos', String(r.id || ''));
    update_('gallery_photos', p._row, { caption: str_(r.caption, 200, false) });
    bustPublicCache_();
    return { ok: true };
  });
}

/** req: { album_id, photo_id } — photo_id '' goes back to "first photo is the cover". */
function adminSetCover_(req) {
  return adminWrite_(req, function (r) {
    const a = findRow_('gallery_albums', String(r.album_id || ''));
    let photoId = '';
    if (r.photo_id) {
      const p = findRow_('gallery_photos', String(r.photo_id));
      if (p.album_id !== a.id) throw fail_('not_found');
      photoId = p.id;
    }
    update_('gallery_albums', a._row, { cover_photo_id: photoId });
    bustPublicCache_();
    return { ok: true };
  });
}

/** req: { album_id, ids: [photo ids in the wanted order] } */
function adminReorderPhotos_(req) {
  return adminWrite_(req, function (r) {
    const a = findRow_('gallery_albums', String(r.album_id || ''));
    const ids = Array.isArray(r.ids) ? r.ids.map(String) : [];
    if (!ids.length || ids.length > 2000) throw fail_('invalid_input');
    const byId = {};
    photosOfAlbum_(a.id).forEach(function (p) { byId[p.id] = p; });
    ids.forEach(function (id) { if (!byId[id]) throw fail_('not_found'); });
    ids.forEach(function (id, i) {
      if (int_(byId[id].sort_order) !== i + 1) update_('gallery_photos', byId[id]._row, { sort_order: i + 1 });
    });
    bustPublicCache_();
    return { ok: true };
  });
}

/** req: { id } — row removed, file to the Drive trash, cover reset when it was the cover. */
function adminDeletePhoto_(req) {
  return adminWrite_(req, function (r, s) {
    const p = findRow_('gallery_photos', String(r.id || ''));
    const a = rows_('gallery_albums').filter(function (x) { return x.id === p.album_id; })[0];
    const trashed = trashFile_(p.drive_file_id);
    deleteRow_('gallery_photos', p._row);
    if (a && a.cover_photo_id === p.id) update_('gallery_albums', findRow_('gallery_albums', a.id)._row, { cover_photo_id: '' });
    audit_(s, 'delete_photo', p.id, { album: p.album_id });
    bustPublicCache_();
    return { file_trashed: trashed };
  });
}
