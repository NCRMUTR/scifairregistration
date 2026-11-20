// #/gallery  Permanent photo gallery, grouped by year:
//   year tabs -> album cards -> photo grid -> lightbox.   An album with an external link shows that link instead of a grid.
// The address keeps the place:  #/gallery?y=2026  (year)   #/gallery?y=2026&a=<album id>  (one album)
import { h, append, replace, richText } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { loadSite, setting } from '../lib/site.js';
import { mountShell, renderLoadError } from '../lib/layout.js';
import { openLightbox, closeLightbox } from '../lib/lightbox.js';

const TTL_MS = 30_000;
let cache = null; // { at, promise }

function loadGallery() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = api('public_gallery', {}, { retry: 1 });
  cache = { at: Date.now(), promise };
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}

function query() {
  const q = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q);
}

const thaiDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export async function render(root) {
  let site = null;
  let data;
  try {
    [site, data] = await Promise.all([loadSite().catch(() => null), loadGallery()]);
  } catch (err) {
    renderLoadError(root, err, () => {
      root.replaceChildren(h('p', { class: 'boot' }, 'กำลังโหลด…'));
      render(root);
    });
    return;
  }

  const siteName = setting(site, 'site_name', 'Sci-Tech Pitching');
  document.title = `ภาพกิจกรรม — ${siteName}`;
  const main = mountShell(root, { site });
  const page = h('div', { class: 'section gallery-page' });
  main.append(page);

  const albums = data.albums;
  const years = [...new Set(albums.map((a) => a.year))].sort((a, b) => b - a);
  const q = query();
  const albumId = q.get('a');
  const album = albumId ? albums.find((a) => a.id === albumId) : null;
  const year = album ? album.year : years.includes(Number(q.get('y'))) ? Number(q.get('y')) : years[0];

  const intro = setting(site, 'gallery_intro');
  const head = h('div', { class: 'section-head' }, h('h1', { class: 'page-h1' }, 'ภาพกิจกรรม'));
  append(page, [head, intro ? h('p', { class: 'intro-text gallery-intro' }, richText(intro)) : null]);

  if (!albums.length) {
    page.append(h('p', { class: 'empty-note' }, 'ยังไม่มีภาพกิจกรรมที่เผยแพร่ จะอัปเดตเร็วๆ นี้'));
    return;
  }

  // ───────────── year tabs ─────────────
  const tabs = h(
    'nav',
    { class: 'year-tabs', 'aria-label': 'เลือกปี' },
    years.map((y) => h('a', { class: 'year-tab', href: `#/gallery?y=${y}`, 'aria-current': y === year && !album ? 'page' : undefined }, `ปี ${y}`)),
  );

  // ───────────── albums of one year ─────────────
  if (!album) {
    const cards = albums
      .filter((a) => a.year === year)
      .map((a) =>
        h(
          'a',
          { class: 'album-card', href: `#/gallery?y=${a.year}&a=${encodeURIComponent(a.id)}` },
          h('div', { class: 'album-cover' }, a.cover_url ? h('img', { src: a.cover_url, alt: '', loading: 'lazy' }) : h('span', { class: 'album-ext' }, 'อัลบั้มภายนอก ↗')),
          h(
            'div',
            { class: 'album-meta' },
            h('h2', { class: 'album-title' }, a.title),
            h('p', { class: 'album-sub' }, [a.event_date ? thaiDate(a.event_date) : null, a.external_url ? 'ลิงก์ภายนอก' : `${a.photo_count} ภาพ`].filter(Boolean).join(' · ')),
          ),
        ),
      );
    append(page, [tabs, h('div', { class: 'album-grid' }, cards)]);
    return;
  }

  // ───────────── one album ─────────────
  const back = h('a', { class: 'back-link', href: `#/gallery?y=${album.year}` }, `← อัลบั้มทั้งหมดของปี ${album.year}`);
  const body = h('div', { class: 'album-body' }, h('p', { class: 'boot' }, 'กำลังโหลดภาพ…'));
  append(page, [
    tabs,
    back,
    h('header', { class: 'album-head' }, h('h2', { class: 'album-h2' }, album.title), album.event_date ? h('p', { class: 'album-sub' }, thaiDate(album.event_date)) : null, album.description ? h('p', { class: 'intro-text' }, richText(album.description)) : null),
    body,
  ]);

  if (album.external_url) {
    replace(
      body,
      h('p', { class: 'hint' }, 'อัลบั้มนี้เก็บไว้ที่เว็บภายนอก'),
      h('a', { class: 'btn btn-primary btn-lg', href: album.external_url, target: '_blank', rel: 'noopener noreferrer' }, 'เปิดอัลบั้มภายนอก ↗'),
    );
    return;
  }

  let alive = true;
  api('public_album', { album_id: album.id }, { retry: 1 })
    .then(({ photos }) => {
      if (!alive) return;
      if (!photos.length) return replace(body, h('p', { class: 'empty-note' }, 'อัลบั้มนี้ยังไม่มีภาพ'));
      replace(
        body,
        h(
          'div',
          { class: 'photo-grid' },
          photos.map((p, i) =>
            h(
              'button',
              { type: 'button', class: 'photo-tile', 'aria-label': p.caption ? `ดูภาพใหญ่: ${p.caption}` : `ดูภาพที่ ${i + 1} จาก ${photos.length} ภาพ`, onClick: () => openLightbox(photos, i) },
              h('img', { src: p.thumb_url, alt: p.caption || '', loading: 'lazy' }),
            ),
          ),
        ),
      );
    })
    .catch(() => {
      if (alive) replace(body, h('div', { class: 'banner-err', role: 'alert' }, 'โหลดภาพไม่สำเร็จ ', h('button', { type: 'button', class: 'btn btn-outline btn-sm', onClick: () => render(root) }, 'ลองอีกครั้ง')));
    });

  return () => {
    alive = false;
    closeLightbox();
  };
}
