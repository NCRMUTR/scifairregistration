// Tiny DOM helpers. Text is always inserted as text nodes (never innerHTML), so admin-authored
// strings coming from the database cannot inject markup.

import { parseBold } from './richtext.js';

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'indeterminate']);

/**
 * h('a', { class: 'btn', href: '#/apply', onClick: fn }, 'text', otherNode, [more, children])
 * - attrs may be omitted: h('p', 'text')
 * - null / undefined / false attrs and children are skipped
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (PROPS.has(key)) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Admin-written text with **bold** -> array of text nodes and <strong> elements (never HTML). */
export function richText(text) {
  return parseBold(text).map((p) => (p.bold ? h('strong', p.text) : p.text));
}

/** Replace everything inside `parent`. Unlike parent.replaceChildren(...), null/undefined/false children are skipped (not printed). */
export function replace(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}
