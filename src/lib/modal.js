// Accessible modal dialog: role="dialog", aria-modal, focus moves in, Tab/Shift+Tab stay inside,
// Esc or backdrop click closes, focus returns to the element that opened it, page behind is inert.
import { h } from './dom.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const stack = [];
let seq = 0;

function setBackgroundInert(on) {
  const app = document.getElementById('app');
  if (app) app.toggleAttribute('inert', on);
  document.body.style.overflow = on ? 'hidden' : '';
}

/**
 * openModal({ title, body, actions, onClose }) -> { close, element }
 *   body    : Node | string | array of them
 *   actions : array of Nodes (buttons / links) shown in the footer row
 *   onClose : called once after the modal is removed (Esc, ×, backdrop or close())
 */
export function openModal({ title, body, actions = [], onClose } = {}) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleId = `modal-title-${++seq}`;
  let closed = false;

  const closeButton = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'ปิด', onClick: () => api.close() }, '×');
  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'modal-head' }, h('h2', { class: 'modal-title', id: titleId }, title), closeButton),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-actions' }, actions) : null,
  );
  const overlay = h('div', { class: 'modal-overlay' }, dialog);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) api.close();
  });

  const api = {
    element: dialog,
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      stack.splice(stack.indexOf(api), 1);
      overlay.remove();
      if (!stack.length) setBackgroundInert(false);
      if (opener && opener.isConnected) opener.focus();
      onClose?.();
    },
  };

  function onKeydown(e) {
    if (stack[stack.length - 1] !== api) return; // only the top-most modal reacts
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      api.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  stack.push(api);
  setBackgroundInert(true);
  document.body.append(overlay);
  document.addEventListener('keydown', onKeydown, true);
  closeButton.focus();
  return api;
}

/** Used by the router so a modal never survives a page change. */
export function closeAllModals() {
  for (const m of [...stack].reverse()) m.close();
}
