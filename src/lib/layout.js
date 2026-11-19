// Shared page frame: skip link, top navigation, <main>, footer (with the small admin link).
import { h } from './dom.js';
import { setting, loadSite } from './site.js';
import { apiConfigured, messageFor } from './api.js';

const NAV = [
  { key: 'home', label: 'หน้าหลัก', href: '#/' },
  { key: 'dates', label: 'กำหนดการ', href: '#/dates' }, // anchor on the home page (router scrolls to #dates)
  { key: 'gallery', label: 'ภาพกิจกรรม', href: '#/gallery' },
  { key: 'status', label: 'ตรวจสอบการสมัคร', href: '#/status' },
];

function currentKey() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  if (path === '/') return 'home';
  return path.slice(1);
}

/** Marks the nav link of the current route (also used when only scrolling to #dates). */
export function syncNav() {
  document.querySelectorAll('.nav a[data-nav]').forEach((a) => {
    if (a.dataset.nav === currentKey()) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function renderFooter(site) {
  const siteName = setting(site, 'site_name', 'Sci-Tech Pitching');
  return h(
    'footer',
    { class: 'site-footer on-dark' },
    h(
      'div',
      { class: 'footer-text' },
      h('strong', siteName),
      setting(site, 'footer_text') ? h('p', setting(site, 'footer_text')) : null,
      setting(site, 'contact_info') ? h('p', setting(site, 'contact_info')) : null,
    ),
    h('a', { href: '#/admin' }, 'เข้าสู่ระบบ Admin'),
  );
}

/**
 * Replaces the contents of `root` with the page frame and returns the <main> element to fill.
 * `site` (from loadSite) may be null when it could not be loaded. `hero` is placed inside the navy band under the nav.
 */
export function mountShell(root, { site = null, hero = null } = {}) {
  const main = h('main', { id: 'main', tabindex: '-1' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'เมนูหลัก' }, NAV.map((n) => h('a', { href: n.href, 'data-nav': n.key }, n.label)));
  const skip = h(
    'a',
    {
      class: 'skip-link',
      href: '#main',
      onClick: (e) => {
        e.preventDefault(); // a real #main hash would be treated as a route change
        main.focus();
      },
    },
    'ข้ามไปยังเนื้อหา',
  );
  root.replaceChildren(h('div', { class: 'page' }, skip, h('div', { class: 'topband on-dark' }, nav, hero), main, renderFooter(site)));
  syncNav();
  return main;
}

/** Friendly error screen with a retry button (network down, wrong .env values, project paused …). */
export function renderLoadError(root, error, retry) {
  console.error(error);
  const main = mountShell(root);
  main.append(
    h(
      'div',
      { class: 'notice' },
      h(
        'div',
        { class: 'card', role: 'alert' },
        h('h1', 'โหลดข้อมูลไม่สำเร็จ'),
        h('p', apiConfigured ? messageFor(error) : 'ยังไม่ได้ตั้งค่า VITE_GAS_URL (คัดลอก .env.example เป็น .env.local แล้วใส่ URL ของ Web App)'),
        retry ? h('button', { type: 'button', class: 'btn btn-primary', onClick: retry }, 'ลองอีกครั้ง') : null,
      ),
    ),
  );
}

/** Placeholder for pages that later stages will build. */
export async function renderStub(root, { title, stage }) {
  let site = null;
  try {
    site = await loadSite();
  } catch {
    /* footer falls back to defaults */
  }
  const main = mountShell(root, { site });
  main.append(
    h('div', { class: 'notice' }, h('div', { class: 'card' }, h('h1', title), h('p', `หน้านี้จะสร้างใน ${stage}`))),
  );
  document.title = `${title} — ${setting(site, 'site_name', 'Sci-Tech Pitching')}`;
}
