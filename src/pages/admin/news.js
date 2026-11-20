// Tab — ประกาศข่าว: the announcements table shown on the home page under "กำหนดการสำคัญ".
// Per edition; pinned first, then newest date first (same order as the public page).
import { h, append } from '../../lib/dom.js';
import { formatKeyDate } from '../../lib/format.js';
import { openModal } from '../../lib/modal.js';
import { invalidateSite } from '../../lib/site.js';
import { textField, selectField, notice, runBusy, badge, confirmDialog } from '../../lib/ui.js';

const BOLD = 'ตัวหนา: พิมพ์ **ข้อความ** (ดอกจัน 2 ตัวหน้าและหลัง) ขึ้นบรรทัดใหม่ได้ตามปกติ';

export async function render(body, ctx) {
  const editions = (await ctx.call('admin_editions')).editions;
  let editionId = (editions.find((e) => e.is_current) ?? editions[0])?.id;
  if (!editionId) {
    body.append(h('h2', 'ประกาศข่าว'), h('div', { class: 'panel' }, h('p', 'ยังไม่มีรอบการจัดงาน')));
    return;
  }
  let data = null;
  const banner = notice();
  const box = h('div', { class: 'admin-stack' });
  body.append(h('h2', 'ประกาศข่าว'), box);

  async function load() {
    data = await ctx.call('admin_announcements', { edition_id: editionId });
    invalidateSite();
    paint();
  }

  const preview = (s, n = 90) => {
    const t = String(s || '').replace(/\s+/g, ' ').replace(/\*\*/g, '').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };

  function paint() {
    const e = editions.find((x) => x.id === editionId);
    const picker = selectField({ label: 'ปี', options: editions.map((x) => ({ value: x.id, label: `${x.year}${x.is_current ? ' (ปัจจุบัน)' : ''}` })), value: editionId });
    picker.input.addEventListener('change', async () => {
      editionId = picker.input.value;
      try {
        await load();
      } catch (err) {
        banner.error(err);
      }
    });

    const rows = data.announcements.map((a) => {
      const toggle = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, a.is_published ? 'ซ่อน' : 'เผยแพร่');
      toggle.addEventListener('click', () =>
        runBusy(
          toggle,
          'กำลังบันทึก…',
          async () => {
            await ctx.call('admin_save_announcement', { ...a, is_published: !a.is_published });
            await load();
            banner.show('ok', a.is_published ? 'ซ่อนประกาศแล้ว (ไม่แสดงในหน้าแรก)' : 'เผยแพร่ประกาศแล้ว');
          },
          banner,
        ),
      );
      const del = h('button', { type: 'button', class: 'btn btn-outline btn-sm btn-danger-outline' }, 'ลบ');
      del.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'ลบประกาศ', message: `ลบประกาศ “${a.title}” ใช่หรือไม่? ลบแล้วกู้คืนไม่ได้ (ถ้าแค่ไม่อยากให้แสดง ใช้ปุ่ม “ซ่อน” แทน)`, confirmLabel: 'ลบประกาศ', danger: true }))) return;
        await runBusy(
          del,
          'กำลังลบ…',
          async () => {
            await ctx.call('admin_delete_announcement', { id: a.id });
            await load();
            banner.show('ok', 'ลบประกาศแล้ว');
          },
          banner,
        );
      });
      return h(
        'div',
        { class: 'row-card news-admin-row' },
        h('div', { class: 'row-year news-admin-date' }, formatKeyDate(a.publish_date)),
        h(
          'div',
          { class: 'row-main' },
          h('div', { class: 'row-title' }, a.title),
          a.body ? h('div', { class: 'team-meta' }, preview(a.body)) : null,
          h('div', { class: 'row-badges' }, a.is_published ? badge('เผยแพร่', 'badge-approved') : badge('ซ่อนอยู่', 'badge-grey'), a.is_pinned ? badge('ปักหมุด', 'badge-pending') : null, a.link_url ? badge('มีลิงก์', 'badge-grey') : null),
        ),
        h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => openForm(a) }, 'แก้ไข'), toggle, del),
      );
    });

    box.replaceChildren();
    append(box, [
      h('p', { class: 'panel-hint' }, 'ตารางประกาศ/ข่าวสารที่แสดงในหน้าแรก ใต้ "กำหนดการสำคัญ" — เรียงให้เองโดยประกาศที่ปักหมุดอยู่บนสุด รองลงมาคือวันที่ใหม่สุด หน้าแรกแสดง 5 รายการแรก ที่เหลือผู้เข้าชมกดดูเพิ่มได้ (สูงสุด 30 รายการล่าสุดที่เผยแพร่) แยกตามปี และไม่ถูกลบเมื่อรีเซ็ตข้อมูลผู้เข้าร่วม'),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', `ประกาศของปี ${e?.year ?? ''} (${data.announcements.length}/${data.max})`), h('button', { type: 'button', class: 'btn btn-primary', onClick: () => openForm(null) }, '+ เพิ่มประกาศ')), picker.el, banner.el, rows.length ? h('div', { class: 'team-list' }, rows) : h('p', { class: 'empty-note' }, 'ยังไม่มีประกาศ — กด "+ เพิ่มประกาศ"')),
    ]);
  }

  function openForm(a) {
    const f = {
      title: textField({ label: 'หัวข้อประกาศ', value: a?.title ?? '', maxlength: 150 }),
      body: textField({ label: 'รายละเอียด (ไม่บังคับ)', value: a?.body ?? '', rows: 5, maxlength: 1000, help: BOLD }),
      date: textField({ label: 'วันที่ประกาศ', value: a?.publish_date ?? data.today, type: 'date', narrow: true, help: 'ใช้เรียงลำดับและแสดงในตาราง' }),
      url: textField({ label: 'ลิงก์เพิ่มเติม (ไม่บังคับ)', value: a?.link_url ?? '', placeholder: 'https://…', maxlength: 500, help: 'ต้องขึ้นต้นด้วย https:// — จะแสดงเป็นปุ่มใต้ประกาศ' }),
      label: textField({ label: 'ข้อความบนปุ่มลิงก์', value: a?.link_label ?? '', placeholder: 'ดูเพิ่มเติม', maxlength: 40 }),
    };
    const pin = h('input', { type: 'checkbox', class: 'chk', id: 'news-pin', checked: a ? a.is_pinned : false });
    const pub = h('input', { type: 'checkbox', class: 'chk', id: 'news-pub', checked: a ? a.is_published : true });
    const note = notice();
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, a ? 'บันทึก' : 'เพิ่มประกาศ');
    save.addEventListener('click', () =>
      runBusy(
        save,
        'กำลังบันทึก…',
        async () => {
          if (!f.title.input.value.trim()) return note.show('err', 'กรอกหัวข้อประกาศ');
          await ctx.call('admin_save_announcement', {
            id: a?.id,
            edition_id: editionId,
            title: f.title.input.value,
            body: f.body.input.value,
            publish_date: f.date.input.value,
            link_url: f.url.input.value,
            link_label: f.label.input.value,
            is_pinned: pin.checked,
            is_published: pub.checked,
          });
          modal.close();
          await load();
          banner.show('ok', a ? 'บันทึกประกาศแล้ว' : 'เพิ่มประกาศแล้ว — หน้าแรกจะแสดงภายในประมาณ 1 นาที');
        },
        note,
      ),
    );
    const modal = openModal({
      title: a ? 'แก้ไขประกาศ' : 'เพิ่มประกาศ',
      body: h(
        'div',
        { class: 'admin-stack' },
        f.title.el,
        f.body.el,
        f.date.el,
        f.url.el,
        f.label.el,
        h('label', { class: 'chk-row', for: 'news-pin' }, pin, h('span', 'ปักหมุด — ให้อยู่บนสุดของตารางเสมอ')),
        h('label', { class: 'chk-row', for: 'news-pub' }, pub, h('span', 'เผยแพร่ในหน้าแรก (ถ้าไม่ติ๊ก จะเก็บเป็นฉบับร่าง ผู้เข้าชมไม่เห็น)')),
        note.el,
      ),
      actions: [h('button', { type: 'button', class: 'btn btn-outline', onClick: () => modal.close() }, 'ยกเลิก'), save],
    });
  }

  await load();
}
