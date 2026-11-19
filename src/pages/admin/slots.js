// Tab 5 — ช่องส่งไฟล์: create / edit / open-close / delete upload slots of an edition. (Files are viewed in the teams tab.)
import { h } from '../../lib/dom.js';
import { formatThaiDateTime, toLocalInput, fromLocalInput } from '../../lib/format.js';
import { openModal } from '../../lib/modal.js';
import { textField, selectField, notice, runBusy, badge, confirmDialog } from '../../lib/ui.js';

export async function render(body, ctx) {
  const editions = (await ctx.call('admin_editions')).editions;
  let editionId = (editions.find((e) => e.is_current) ?? editions[0])?.id;
  let data = null;
  const banner = notice();
  const box = h('div', { class: 'admin-stack' });
  body.append(box);

  async function load() {
    data = await ctx.call('admin_slots', { edition_id: editionId });
    paint();
  }

  function ruleText(s) {
    const parts = [`ไฟล์ ${s.accept.map((x) => x.toUpperCase()).join('/')} ไม่เกิน ${s.max_mb} MB`];
    if (s.deadline) parts.push(`กำหนดส่ง ${formatThaiDateTime(s.deadline)}`);
    return parts.join(' · ');
  }

  function paint() {
    const picker = selectField({ label: 'ปี', options: editions.map((x) => ({ value: x.id, label: String(x.year) })), value: editionId });
    picker.input.addEventListener('change', async () => {
      editionId = picker.input.value;
      await load();
    });
    const rows = data.slots.map((s) => {
      const toggle = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, s.is_open ? 'ปิดช่องนี้' : 'เปิดช่องนี้');
      toggle.addEventListener('click', () =>
        runBusy(toggle, 'กำลังบันทึก…', async () => {
          await ctx.call('admin_save_slot', { id: s.id, title: s.title, description: s.description, accept: s.accept, max_mb: s.max_mb, deadline: s.deadline ?? '', is_open: !s.is_open, sort_order: s.sort_order });
          await load();
        }, banner),
      );
      return h(
        'div',
        { class: 'row-card' },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, s.title), s.description ? h('div', { class: 'slip-small' }, s.description) : null, h('div', { class: 'slip-small' }, ruleText(s))),
        h('div', { class: 'row-badges' }, s.is_open ? badge('เปิดรับไฟล์', 'badge-approved') : badge('ปิดอยู่', 'badge-grey'), h('span', { class: 'slip-small' }, `ส่งแล้ว ${s.uploads_count} ทีม`)),
        h('div', { class: 'row-actions' }, toggle, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => openForm(s) }, 'แก้ไข'), h('button', { type: 'button', class: 'btn btn-danger btn-sm', onClick: () => remove(s) }, 'ลบ')),
      );
    });
    box.replaceChildren(
      h('div', { class: 'admin-head' }, h('h2', `ช่องส่งไฟล์ — ปี ${data.edition?.year ?? ''}`), h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openForm(null) }, '+ เพิ่มช่องส่งไฟล์')),
      banner.el,
      h('div', { class: 'fields' }, picker.el),
      rows.length ? h('section', { class: 'panel' }, rows) : h('section', { class: 'panel' }, h('p', { class: 'empty-note' }, 'ยังไม่มีช่องส่งไฟล์ในปีนี้')),
      h('p', { class: 'panel-hint' }, 'ทีมจะเห็นเฉพาะช่องที่ “เปิด” และยังไม่เลยกำหนดส่ง (ในหน้าตรวจสอบการสมัคร) ส่งทับไฟล์เดิมได้จนถึงกำหนด · ดู/ดาวน์โหลดไฟล์ที่ทีมส่งได้ในแท็บ “รายชื่อทีม”'),
    );
  }

  async function remove(s) {
    const files = s.uploads_count;
    const ok = await confirmDialog({
      title: `ลบช่อง “${s.title}”?`,
      message: files ? `ช่องนี้มีไฟล์ที่ทีมส่งแล้ว ${files} ไฟล์ — ถ้าลบ ไฟล์เหล่านั้นจะถูกย้ายไปถังขยะของ Drive และทีมจะไม่เห็นไฟล์ในระบบอีก ย้อนกลับไม่ได้` : 'ลบช่องส่งไฟล์นี้ (ยังไม่มีทีมส่งไฟล์)',
      confirmLabel: files ? `ลบช่องและไฟล์ ${files} ไฟล์` : 'ลบช่อง',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.call('admin_delete_slot', { id: s.id, force: files > 0 });
      await load();
      banner.show('ok', 'ลบช่องส่งไฟล์แล้ว');
    } catch (err) {
      banner.error(err);
    }
  }

  function openForm(s) {
    const f = {
      title: textField({ label: 'ชื่อช่องส่งไฟล์', value: s?.title ?? '', maxlength: 120 }),
      description: textField({ label: 'คำอธิบาย (ไม่บังคับ)', value: s?.description ?? '', maxlength: 300 }),
      accept: textField({ label: 'ชนิดไฟล์ที่รับ (คั่นด้วยจุลภาค)', value: (s?.accept ?? ['pdf']).join(', '), help: 'เช่น pdf, jpg, png', maxlength: 60 }),
      max_mb: textField({ label: 'ขนาดสูงสุด (MB)', value: String(s?.max_mb ?? 10), inputmode: 'numeric', maxlength: 3, narrow: true }),
      deadline: textField({ label: 'กำหนดส่ง (เวลาไทย — เว้นว่างถ้าไม่มี)', type: 'datetime-local', value: toLocalInput(s?.deadline) }),
      sort_order: textField({ label: 'ลำดับการแสดง', value: String(s?.sort_order ?? data.slots.length + 1), inputmode: 'numeric', maxlength: 3, narrow: true }),
    };
    const open = h('input', { type: 'checkbox', class: 'chk', checked: s ? s.is_open : false });
    const note = notice();
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'บันทึก');
    save.addEventListener('click', () =>
      runBusy(save, 'กำลังบันทึก…', async () => {
        await ctx.call('admin_save_slot', {
          id: s?.id, edition_id: editionId, title: f.title.input.value, description: f.description.input.value,
          accept: f.accept.input.value.split(/[\s,]+/).filter(Boolean), max_mb: Number(f.max_mb.input.value),
          deadline: fromLocalInput(f.deadline.input.value), is_open: open.checked, sort_order: Number(f.sort_order.input.value) || 0,
        });
        modal.close();
        await load();
        banner.show('ok', 'บันทึกช่องส่งไฟล์แล้ว');
      }, note),
    );
    const modal = openModal({
      title: s ? 'แก้ไขช่องส่งไฟล์' : 'เพิ่มช่องส่งไฟล์',
      body: h('div', { class: 'admin-stack' }, f.title.el, f.description.el, f.accept.el, h('div', { class: 'fields' }, f.max_mb.el, f.sort_order.el), f.deadline.el, h('label', { class: 'chk-row' }, open, h('span', 'เปิดให้ทีมส่งไฟล์ตอนนี้')), note.el),
      actions: [h('button', { type: 'button', class: 'btn btn-outline', onClick: () => modal.close() }, 'ยกเลิก'), save],
    });
  }

  await load();
}
