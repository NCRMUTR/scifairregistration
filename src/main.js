// Hash router: #/  #/dates  #/gallery  #/apply  #/status  #/admin   (GitHub Pages has no server-side routing)
// Each page module exports `render(root)` and may return a cleanup function.
// `#/dates` is the "กำหนดการ" menu link: it shows the home page and scrolls to its #dates section.
import './styles.css';
import { closeAllModals } from './lib/modal.js';
import { renderLoadError, syncNav } from './lib/layout.js';

const routes = {
  '/': () => import('./pages/home.js'),
  '/dates': () => import('./pages/home.js'),
  '/gallery': () => import('./pages/gallery.js'),
  '/apply': () => import('./pages/apply.js'),
  '/status': () => import('./pages/status.js'),
  '/admin': () => import('./pages/admin.js'),
};

const root = document.getElementById('app');
let cleanup = null;
let current = null; // route key of the page currently shown ('/dates' counts as '/')
let navId = 0;

function scrollToDates() {
  const el = document.getElementById('dates');
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

async function navigate() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const path = raw.split('?')[0] || '/';
  const key = routes[path] ? path : '/';
  const pageKey = key === '/dates' ? '/' : key;
  const id = ++navId;

  // Already on the home page: only scroll, do not rebuild it.
  if (key === '/dates' && current === '/' && document.getElementById('dates')) {
    syncNav();
    scrollToDates();
    return;
  }

  closeAllModals();
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  try {
    const page = await routes[key]();
    const nextCleanup = await page.render(root);
    if (id !== navId) {
      // The visitor navigated again while this page was loading.
      if (typeof nextCleanup === 'function') nextCleanup();
      return;
    }
    cleanup = nextCleanup;
    current = pageKey;
  } catch (err) {
    renderLoadError(root, err, navigate);
    return;
  }

  if (key === '/dates') scrollToDates();
  else window.scrollTo(0, 0);
}

// Clickjacking guard: GitHub Pages cannot send frame-ancestors, so the app simply refuses to run inside another site's frame.
let framed = false;
try {
  framed = window.top !== window.self;
} catch {
  framed = true; // reading window.top threw: we are inside a cross-origin frame
}

if (framed) {
  root.textContent = `เว็บนี้ไม่อนุญาตให้แสดงภายในเฟรมของเว็บอื่น โปรดเปิดโดยตรงที่ ${location.href}`;
} else {
  window.addEventListener('hashchange', navigate);
  navigate();
}
