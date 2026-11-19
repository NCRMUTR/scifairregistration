// Full-screen photo viewer: prev / next / close buttons, Esc and arrow keys, swipe, focus kept inside, page behind inert,
// focus returns to the thumbnail that opened it.
import { h } from './dom.js';

let openBox = null;

/**
 * openLightbox(photos, startIndex) — photos: [{ url, thumb_url, caption }]
 * Returns { close }. Only one lightbox can be open at a time.
 */
export function openLightbox(photos, startIndex = 0) {
  openBox?.close();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let index = Math.min(Math.max(startIndex, 0), photos.length - 1);
  let closed = false;

  const img = h('img', { class: 'lb-img', alt: '' });
  const caption = h('p', { class: 'lb-caption', id: 'lb-caption' });
  const counter = h('p', { class: 'lb-counter', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'lb-btn lb-prev', 'aria-label': 'ภาพก่อนหน้า', onClick: () => go(-1) }, '‹');
  const next = h('button', { type: 'button', class: 'lb-btn lb-next', 'aria-label': 'ภาพถัดไป', onClick: () => go(1) }, '›');
  const closeBtn = h('button', { type: 'button', class: 'lb-btn lb-close', 'aria-label': 'ปิด', onClick: () => api.close() }, '×');
  const overlay = h(
    'div',
    { class: 'lb-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ดูภาพขนาดใหญ่', tabindex: '-1' },
    h('div', { class: 'lb-stage' }, img),
    h('div', { class: 'lb-info' }, caption, counter),
    prev,
    next,
    closeBtn,
  );

  function show() {
    const p = photos[index];
    // The big version loads on top of the thumbnail the grid already has, so something is visible at once.
    img.onerror = () => {
      if (img.src !== p.thumb_url) img.src = p.thumb_url;
    };
    img.src = p.thumb_url;
    const big = new Image();
    big.onload = () => {
      if (photos[index] === p) img.src = p.url;
    };
    big.src = p.url;
    img.alt = p.caption || `ภาพที่ ${index + 1}`;
    caption.textContent = p.caption || '';
    caption.hidden = !p.caption;
    counter.textContent = `${index + 1} / ${photos.length}`;
    prev.hidden = next.hidden = photos.length < 2;
    // warm the neighbours
    [photos[index + 1], photos[index - 1]].forEach((n) => {
      if (n) new Image().src = n.url;
    });
  }

  function go(step) {
    if (photos.length < 2) return;
    index = (index + step + photos.length) % photos.length;
    show();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      api.close();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'Tab') {
      const items = [prev, next, closeBtn].filter((b) => !b.hidden);
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === overlay)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // swipe left / right on touch screens
  let startX = null;
  overlay.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') startX = e.clientX;
  });
  overlay.addEventListener('pointerup', (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  // clicking the dark area (not the picture or a button) closes
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('lb-stage')) api.close();
  });

  const api = {
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      document.getElementById('app')?.removeAttribute('inert');
      document.body.style.overflow = '';
      if (openBox === api) openBox = null;
      if (opener && opener.isConnected) opener.focus();
    },
  };
  openBox = api;

  document.getElementById('app')?.setAttribute('inert', '');
  document.body.style.overflow = 'hidden';
  document.body.append(overlay);
  document.addEventListener('keydown', onKeydown, true);
  show();
  closeBtn.focus();
  return api;
}

/** Used by the router so the viewer never survives a page change. */
export function closeLightbox() {
  openBox?.close();
}
