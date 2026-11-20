/**
 * Documents.gs — forms / documents that the committee provides for the teams to download (application forms,
 * templates …). Admin uploads them per edition; a team sees them on the status page ONLY after it has proven
 * (English team name + PIN) — lookup_team returns the list, no public action lists them.
 *
 * Files live in the Drive folder `public-assets` (anyone with the link can open a file, nobody can find a link without
 * the list above). Do not put confidential material here.
 */

const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'zip', 'jpg', 'jpeg', 'png'];
const DOC_MAX_MB = 20;
const DOC_MAX_PER_EDITION = 60;

function docsOfEdition_(editionId) {
  return rows_('documents')
    .filter(function (d) { return d.edition_id === editionId; })
    .sort(function (a, b) { return int_(a.sort_order) - int_(b.sort_order) || (a.uploaded_at < b.uploaded_at ? -1 : 1); });
}

function docView_(d) {
  const urls = driveViewUrls_(d.drive_file_id);
  return { id: d.id, title: d.title, file_name: d.file_name, size_bytes: int_(d.size_bytes), uploaded_at: d.uploaded_at, view_url: urls.view_url, download_url: urls.download_url };
}

/** For lookup_team (the team has been verified): the documents of ITS edition. */
function documentsForTeam_(team) {
  return docsOfEdition_(team.edition_id).map(docView_);
}

// ───────────── admin ─────────────

/** req: { edition_id } -> { documents: [...] } */
function adminDocuments_(req) {
  return adminRead_(req, function (r) {
    const ed = findRow_('editions', String(r.edition_id || ''));
    return { edition: { id: ed.id, year: int_(ed.year) }, documents: docsOfEdition_(ed.id).map(docView_), max: DOC_MAX_PER_EDITION };
  });
}

/** req: { file_name, size, mime, origin } -> { upload_url } (resumable Drive session in public-assets) */
function adminPrepareDocument_(req) {
  return adminRead_(req, function (r) {
    if (!allowedOrigin_(r.origin)) throw fail_('origin_not_allowed');
    const size = Number(r.size);
    const ext = fileExt_(r.file_name);
    if (!isFinite(size) || size <= 0 || size > DOC_MAX_MB * 1024 * 1024) throw fail_('file_too_large');
    if (DOC_EXTS.indexOf(ext) === -1) throw fail_('file_type_not_allowed');
    const name = 'doc_' + Date.now() + '_' + safeFileName_(r.file_name, ext);
    return { upload_url: resumableSession_(props_().getProperty('FOLDER_PUBLIC_ASSETS'), name, r.mime, size, r.origin) };
  });
}

/** req: { edition_id, title, file_id, file_name } — checks the file really is ours, then adds it to the list. */
function adminConfirmDocument_(req) {
  return adminWrite_(req, function (r, s) {
    const ed = findRow_('editions', String(r.edition_id || ''));
    const fileId = typeof r.file_id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(r.file_id) ? r.file_id : '';
    if (!fileId) throw fail_('file_not_found');
    const existing = rows_('documents').filter(function (d) { return d.drive_file_id === fileId; })[0];
    if (existing) return docView_(existing); // the browser retried after a lost reply

    let file;
    try { file = DriveApp.getFileById(fileId); } catch (e) { throw fail_('file_not_found'); }
    const folderId = props_().getProperty('FOLDER_PUBLIC_ASSETS');
    let inFolder = false;
    const parents = file.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === folderId) inFolder = true; }
    if (!inFolder || file.getName().indexOf('doc_') !== 0) throw fail_('file_not_found');
    const size = file.getSize();
    if (size <= 0 || size > DOC_MAX_MB * 1024 * 1024) { file.setTrashed(true); throw fail_('file_too_large'); }
    if (DOC_EXTS.indexOf(fileExt_(file.getName())) === -1) { file.setTrashed(true); throw fail_('file_type_not_allowed'); }

    const mine = docsOfEdition_(ed.id);
    if (mine.length >= DOC_MAX_PER_EDITION) { file.setTrashed(true); throw fail_('too_many_documents'); }
    const shownName = (typeof r.file_name === 'string' && r.file_name.trim() ? r.file_name.trim() : file.getName()).slice(0, 200);
    const title = str_(r.title, 120, false) || shownName.replace(/\.[A-Za-z0-9]{1,10}$/, '');
    const last = mine.reduce(function (m, d) { return Math.max(m, int_(d.sort_order)); }, 0);
    const row = { id: uuid_(), edition_id: ed.id, title: title, drive_file_id: fileId, file_name: shownName, size_bytes: size, sort_order: last + 1, uploaded_at: nowIso_() };
    append_('documents', row);
    audit_(s, 'add_document', row.id, { year: int_(ed.year), title: title });
    return docView_(row);
  });
}

/** req: { id, title } */
function adminUpdateDocument_(req) {
  return adminWrite_(req, function (r, s) {
    const d = findRow_('documents', String(r.id || ''));
    const title = str_(r.title, 120, true);
    update_('documents', d._row, { title: title });
    audit_(s, 'rename_document', d.id, { title: title });
    return { ok: true };
  });
}

/** req: { id } — removes it from the list and moves the file to the Drive trash. */
function adminDeleteDocument_(req) {
  return adminWrite_(req, function (r, s) {
    const d = findRow_('documents', String(r.id || ''));
    const trashed = trashFile_(d.drive_file_id);
    deleteRow_('documents', d._row);
    audit_(s, 'delete_document', d.id, { title: d.title });
    return { file_trashed: trashed };
  });
}
