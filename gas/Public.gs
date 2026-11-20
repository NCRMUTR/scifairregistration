  /**
   * Public.gs — actions any visitor may call. Never return anything not meant for the public
   * (no student data, no PIN hashes, no Drive IDs of private folders).
   */
  
  const PUBLIC_SETTING_KEYS = ['site_name', 'details_button_label', 'apply_button_label', 'submit_label', 'footer_text', 'contact_info', 'gallery_intro'];
  
  // ───────────── Drive URL helpers (public folders only) ─────────────
  function driveThumb_(fileId, width) { return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w' + width; }
/** Like driveThumb_ but keeps PNG transparency (the plain thumbnail turns transparent areas BLACK; "-pp" = keep PNG + alpha). */
function driveLogo_(fileId, width) { return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId) + '=w' + width + '-pp'; }
  function drivePdf_(fileId) {
    const id = encodeURIComponent(fileId);
    return {
      preview_url: 'https://drive.google.com/file/d/' + id + '/preview',   // for <iframe>
      view_url: 'https://drive.google.com/file/d/' + id + '/view',          // open in a new tab
      download_url: 'https://drive.google.com/uc?export=download&id=' + id, // direct download
    };
  }
  
  /**
   * Is registration open for this edition RIGHT NOW? The Apps Script clock is the only clock that counts.
   * Same rule as the original SQL: status 'active' AND (mode 'open' OR (mode 'auto' AND opens_at <= now < closes_at)).
   * `e` uses the sheet's text fields. `nowMs` is injectable for tests.
   */
  function registrationOpen_(e, nowMs) {
    if (e.status !== 'active') return false;
    if (e.reg_mode === 'open') return true;
    if (e.reg_mode === 'closed') return false;
    const opens = time_(e.registration_opens_at);
    const closes = time_(e.registration_closes_at);
    return opens !== null && opens <= nowMs && (closes === null || nowMs < closes);
  }
  
  /**
   * The slow part (reading several sheets) is cached for 60 s. Time-dependent fields (server_time, registration_open)
   * are computed on every call, so the cache can never keep registration open/closed wrongly.
   */
  function publicData_() {
    const cache = CacheService.getScriptCache();
    const hit = cache.get('public_data');
    if (hit) return JSON.parse(hit);
  
    const raw = {};
    rows_('site_settings').forEach(function (r) { raw[r.key] = r.value; });
    const settings = {};
    PUBLIC_SETTING_KEYS.forEach(function (k) { if (raw[k]) settings[k] = raw[k]; });
  
    const editions = rows_('editions');
    const published = editions.filter(function (e) { return e.status !== 'draft'; });
    const current = editions.filter(function (e) { return bool_(e.is_current); })[0] || null;
  
    // Latest 4 photos of published albums that belong to non-draft editions.
    const okAlbums = {};
    rows_('gallery_albums').forEach(function (a) {
      const ed = editions.filter(function (e) { return e.id === a.edition_id; })[0];
      if (bool_(a.is_published) && ed && ed.status !== 'draft' && !a.external_url) okAlbums[a.id] = true;
    });
    const photos = rows_('gallery_photos')
      .filter(function (p) { return okAlbums[p.album_id] && p.drive_file_id; })
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })
      .slice(0, 4)
      .map(function (p) {
        return { id: p.id, caption: p.caption, thumb_url: driveThumb_(p.drive_file_id, 480), url: driveThumb_(p.drive_file_id, 2000) };
      });
  
    const data = {
      settings: settings,
      logo_url: raw.logo_file_id ? driveLogo_(raw.logo_file_id, 400) : null,
      edition: current && {
        id: current.id,
        year: int_(current.year),
        title: current.title,
        subtitle: current.subtitle,
        intro_text: current.intro_text,
        background_url: current.background_file_id ? driveThumb_(current.background_file_id, 2000) : null,
        rules_pdf: current.rules_pdf_file_id ? drivePdf_(current.rules_pdf_file_id) : null,
        ack_text: current.ack_text,
        pdpa_text: current.pdpa_text,
        key_dates: jsonParse_(current.key_dates, []),
        max_members: int_(current.max_members, 7),
        reg_mode: current.reg_mode,
        status: current.status,
        registration_opens_at: current.registration_opens_at || null,
        registration_closes_at: current.registration_closes_at || null,
      },
      years: published
        .sort(function (a, b) { return int_(b.year) - int_(a.year); })
        .map(function (e) { return { id: e.id, year: int_(e.year), title: e.title }; }),
      latest_photos: photos,
    };
    const text = JSON.stringify(data);
    if (text.length < 90000) cache.put('public_data', text, 60); // CacheService values are limited to 100 KB
    return data;
  }
  
  /** Everything the public pages need in one call (home, apply form, gallery year tabs). */
  function publicSite_() {
    const data = publicData_();
    const nowMs = Date.now();
    const ed = data.edition && Object.assign({}, data.edition, { registration_open: registrationOpen_(data.edition, nowMs) });
    if (ed) { delete ed.reg_mode; delete ed.status; } // internal fields stay on the server
    return {
      server_time: new Date(nowMs).toISOString(),
      settings: data.settings,
      logo_url: data.logo_url,
      edition: ed,
      years: data.years,
      latest_photos: data.latest_photos,
    };
  }
  
  /** Admin actions call this after changing content so visitors see it right away. */
  function bustPublicCache_() {
    CacheService.getScriptCache().removeAll(['public_data', 'public_gallery']);
  }
