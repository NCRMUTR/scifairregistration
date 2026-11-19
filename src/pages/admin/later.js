// Tabs built in later stages (docs/GAS-DESIGN.md §9).
import { h } from '../../lib/dom.js';

export function render(body, title, stage) {
  body.append(h('h2', title), h('div', { class: 'panel' }, h('p', { class: 'empty-note' }, `ส่วนนี้จะสร้างใน ${stage}`)));
}
