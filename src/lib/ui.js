// Small building blocks shared by the admin tabs (text is always inserted as text nodes via h()).
import { h } from './dom.js';
import { messageFor } from './api.js';
import { openModal } from './modal.js';

let uid = 0;
export const nextId = (prefix = 'f') => `${prefix}-${++uid}`;

/**
 * A labelled text control. Returns { el, input } — put `el` in the page, read/write `input.value`.
 *   textField({ label, value, type, rows, maxlength, help, inputmode, placeholder, narrow })
 */
export function textField({ label, value = '', type = 'text', rows = 0, maxlength, help, inputmode, placeholder, narrow = false, min, max } = {}) {
  const id = nextId();
  const input = rows
    ? h('textarea', { class: 'inp msg-area', id, rows, maxlength, placeholder })
    : h('input', { class: 'inp', id, type, maxlength, inputmode, placeholder, min, max, autocomplete: 'off' });
  input.value = value ?? '';
  const el = h('div', { class: `field${narrow ? ' narrow' : ''}` }, h('label', { for: id }, label), input, help ? h('span', { class: 'help' }, help) : null);
  return { el, input };
}

export function selectField({ label, options, value, help }) {
  const id = nextId();
  const input = h('select', { class: 'inp', id }, options.map((o) => h('option', { value: o.value }, o.label)));
  input.value = value ?? options[0]?.value ?? '';
  return { el: h('div', { class: 'field' }, h('label', { for: id }, label), input, help ? h('span', { class: 'help' }, help) : null), input };
}

/** Status line that is announced to screen readers. kind: 'ok' | 'err' | 'warn' */
export function notice() {
  const el = h('div', { role: 'status', hidden: true });
  return {
    el,
    show(kind, text) {
      el.className = kind === 'ok' ? 'banner-ok' : kind === 'warn' ? 'banner-warn' : 'banner-err';
      el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
      el.textContent = text;
      el.hidden = false;
    },
    error(err) {
      this.show('err', messageFor(err));
    },
    hide() {
      el.hidden = true;
    },
  };
}

/** Disable `button` and show `busyText` while `fn` runs; always restores it. Errors go to notice.error(). */
export async function runBusy(button, busyText, fn, note) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  note?.hide();
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    if (note) note.error(err);
    else throw err;
    return undefined;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

export function badge(text, cls) {
  return h('span', { class: `badge ${cls}` }, text);
}

/** Yes/no dialog. Resolves true only when the confirm button is pressed. */
export function confirmDialog({ title, message, confirmLabel = 'ยืนยัน', danger = false, extra = null }) {
  return new Promise((resolve) => {
    let answer = false;
    const ok = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onClick: () => { answer = true; modal.close(); } }, confirmLabel);
    const cancel = h('button', { type: 'button', class: 'btn btn-outline', onClick: () => modal.close() }, 'ยกเลิก');
    const modal = openModal({
      title,
      body: [h('p', { class: 'dlg-text' }, message), extra],
      actions: [cancel, ok],
      onClose: () => resolve(answer),
    });
  });
}

export function sectionCard(title, ...children) {
  return h('section', { class: 'panel' }, title ? h('h2', title) : null, ...children);
}

/** Make a file picker that calls onPick(file). Returns { button, input }. */
export function filePicker(label, accept, onPick, cls = 'btn btn-outline') {
  const input = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', accept });
  const button = h('button', { type: 'button', class: cls, onClick: () => input.click() }, label);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onPick(file);
  });
  return { button, input };
}

/** CSV cell: quotes + doubles quotes, and defuses spreadsheet formulas (= + - @ tab CR at the start). */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Download text as a file (UTF-8 with BOM so Excel reads Thai correctly). */
export function downloadText(fileName, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: fileName });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
