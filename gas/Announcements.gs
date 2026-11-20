/**
 * Announcements.gs — the news / announcements table on the home page (below the key dates).
 * Written by the admin per edition; the home page shows the CURRENT edition's published items (pinned first, then
 * newest date first). Text only: bodies may use **bold** (turned into <strong> by the browser, never HTML), links must be https.
 */

const ANNOUNCE_MAX_PER_EDITION = 200;
const ANNOUNCE_PUBLIC_LIMIT = 30; // the home page keeps the public_site answer (cached 60 s) small

function bangkokToday_() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); }

function announcementSort_(a, b) {
  const pin = (bool_(b.is_pinned) ? 1 : 0) - (bool_(a.is_pinned) ? 1 : 0);
  if (pin) return pin;
  if (a.publish_date !== b.publish_date) return a.publish_date < b.publish_date ? 1 : -1;
  return a.created_at < b.created_at ? 1 : -1;
}

/** Published announcements of an edition, in display order — for public_site. */
function announcementsPublic_(editionId) {
  return rows_('announcements')
    .filter(function (a) { return a.edition_id === editionId && bool_(a.is_published); })
    .sort(announcementSort_)
    .slice(0, ANNOUNCE_PUBLIC_LIMIT)
    .map(function (a) {
      return { id: a.id, title: a.title, body: a.body, link_url: a.link_url || null, link_label: a.link_label || null, date: a.publish_date, pinned: bool_(a.is_pinned) };
    });
}

function announcementAdminView_(a) {
  return {
    id: a.id, edition_id: a.edition_id, title: a.title, body: a.body, link_url: a.link_url || '', link_label: a.link_label || '',
    publish_date: a.publish_date, is_pinned: bool_(a.is_pinned), is_published: bool_(a.is_published), created_at: a.created_at, updated_at: a.updated_at || '',
  };
}

/** req: { edition_id } -> { announcements: [...] } every item (published or not) in display order */
function adminAnnouncements_(req) {
  return adminRead_(req, function (r) {
    const ed = findRow_('editions', String(r.edition_id || ''));
    return {
      edition: { id: ed.id, year: int_(ed.year) },
      announcements: rows_('announcements').filter(function (a) { return a.edition_id === ed.id; }).sort(announcementSort_).map(announcementAdminView_),
      max: ANNOUNCE_MAX_PER_EDITION,
      today: bangkokToday_(),
    };
  });
}

/** req: { id? (omit to create), edition_id, title, body, link_url, link_label, publish_date, is_pinned, is_published } */
function adminSaveAnnouncement_(req) {
  return adminWrite_(req, function (r, s) {
    const ed = findRow_('editions', String(r.edition_id || ''));
    const link = cleanExternalUrl_(r.link_url);
    const patch = {
      edition_id: ed.id,
      title: str_(r.title, 150, true),
      body: str_(r.body, 1000, false),
      link_url: link,
      link_label: link ? str_(r.link_label, 40, false) : '',
      publish_date: cleanDate_(r.publish_date) || bangkokToday_(),
      is_pinned: r.is_pinned === true ? 'true' : 'false',
      is_published: r.is_published === false ? 'false' : 'true',
      updated_at: nowIso_(),
    };
    let id;
    if (r.id) {
      const row = findRow_('announcements', String(r.id));
      update_('announcements', row._row, patch);
      id = row.id;
      audit_(s, 'save_announcement', id, { title: patch.title, published: patch.is_published });
    } else {
      const count = rows_('announcements').filter(function (a) { return a.edition_id === ed.id; }).length;
      if (count >= ANNOUNCE_MAX_PER_EDITION) throw fail_('too_many_announcements');
      id = uuid_();
      append_('announcements', Object.assign({ id: id, created_at: nowIso_() }, patch));
      audit_(s, 'create_announcement', id, { title: patch.title });
    }
    bustPublicCache_();
    return { id: id };
  });
}

/** req: { id } */
function adminDeleteAnnouncement_(req) {
  return adminWrite_(req, function (r, s) {
    const a = findRow_('announcements', String(r.id || ''));
    deleteRow_('announcements', a._row);
    audit_(s, 'delete_announcement', a.id, { title: a.title });
    bustPublicCache_();
    return { deleted: true };
  });
}
