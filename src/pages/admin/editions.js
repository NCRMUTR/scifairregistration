// Tab 2 — ปี/รอบการจัด: list, create a new year, set current, registration mode + window, max members, key dates.
import { h } from '../../lib/dom.js';
import { formatThaiDateTime, toLocalInput, fromLocalInput } from '../../lib/format.js';
import { textField, selectField, notice, runBusy, badge, confirmDialog } from '../../lib/ui.js';

const MODES = [
  { value: 'auto', title: 'ตามช่วงเวลา', desc: 'เปิดอัตโนมัติตั้งแต่วัน-เวลาเปิด จนถึงวัน-เวลาปิด (ถ้ายังไม่ใส่วันเปิด = ปิดอยู่)' },
  { value: 'open', title: 'เปิดบังคับ', desc: 'เปิดรับสมัครทันที ไม่ดูวัน-เวลา' },
  { value: 'closed', title: 'ปิดบังคับ', desc: 'ปิดรับสมัครทันที' },
];

export async function render(body, ctx) {
  let data = await ctx.call('admin_editions');
  let selectedId = (data.editions.find((e) => e.is_current) ?? data.editions[0])?.id;
  const top = h('div');
  const listNote = notice();
  let savedMessage = ''; // shown in the settings box after it is rebuilt
  body.append(top);

  async function reload() {
    data = await ctx.call('admin_editions');
    const cur = data.editions.find((e) => e.is_current);
    ctx.setYear(cur?.year);
    paint();
  }

  function paint() {
    const sel = data.editions.find((e) => e.id === selectedId) ?? data.editions[0];
    top.replaceChildren(h('div', { class: 'admin-stack' }, header(), createBox(), listBox(), sel ? settingsBox(sel) : null, howTo()));
  }

  // ── header + create ──
  let showCreate = false;
  function header() {
    return h(
      'div',
      { class: 'admin-head' },
      h('h2', 'ปี/รอบการจัด'),
      h('button', { type: 'button', class: 'btn btn-primary', onClick: () => { showCreate = !showCreate; paint(); } }, showCreate ? 'ปิดฟอร์ม' : '+ สร้างปีใหม่'),
    );
  }

  function createBox() {
    if (!showCreate) return null;
    const latest = data.editions[0];
    const year = textField({ label: 'ปี (ค.ศ.)', value: String((latest?.year ?? new Date().getFullYear()) + 1), inputmode: 'numeric', maxlength: 4, narrow: true });
    const copy = h('input', { type: 'checkbox', class: 'chk', checked: Boolean(latest) });
    const note = notice();
    const btn = h('button', { type: 'button', class: 'btn btn-primary' }, 'สร้าง');
    btn.addEventListener('click', () =>
      runBusy(
        btn,
        'กำลังสร้าง…',
        async () => {
          const res = await ctx.call('admin_create_edition', { year: Number(year.input.value), copy_from: copy.checked && latest ? latest.id : undefined });
          selectedId = res.id;
          showCreate = false;
          await reload();
        },
        note,
      ),
    );
    return h(
      'section',
      { class: 'panel panel-accent' },
      h('h3', 'สร้างรอบการจัดปีใหม่'),
      year.el,
      h('label', { class: 'chk-row' }, copy, h('span', `คัดลอกข้อความและช่องส่งไฟล์จากปีล่าสุด${latest ? ` (${latest.year})` : ''}`)),
      h('p', { class: 'panel-hint' }, 'ปีใหม่เริ่มเป็น “ร่าง” (ยังไม่แสดงในเว็บ) และ “ปิดรับสมัคร” ไว้ก่อน จนกว่าจะตั้งช่วงเวลาและกด “ตั้งเป็นปีปัจจุบัน” — ข้อมูลทีมของปีเก่าไม่ถูกแตะ'),
      note.el,
      h('div', { class: 'action-row' }, btn),
    );
  }

  // ── list ──
  function listBox() {
    const rows = data.editions.map((e) => {
      const statusBadges = [
        e.is_current ? badge('ปีปัจจุบัน', 'badge-approved') : null,
        e.status === 'draft' ? badge('ร่าง', 'badge-pending') : null,
        e.registration_open ? badge('เปิดรับสมัคร', 'badge-approved') : null,
        e.purged_at ? badge('รีเซ็ตข้อมูลแล้ว', 'badge-grey') : null,
      ];
      const actions = [h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { selectedId = e.id; paint(); document.getElementById('ed-settings')?.scrollIntoView({ behavior: 'smooth' }); } }, 'แก้ไขค่า')];
      if (!e.is_current) {
        actions.push(
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-outline btn-sm',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `ตั้งปี ${e.year} เป็นปีปัจจุบัน?`,
                  message: `หน้าหลักและฟอร์มสมัครจะเปลี่ยนไปใช้ข้อมูลของปี ${e.year} ทันที (การเปิด/ปิดรับสมัครยังเป็นไปตามที่ตั้งไว้ของปีนั้น)`,
                  confirmLabel: 'ตั้งเป็นปีปัจจุบัน',
                });
                if (!ok) return;
                try {
                  await ctx.call('admin_set_current', { id: e.id });
                  await reload();
                } catch (err) {
                  listNote.error(err);
                }
              },
            },
            'ตั้งเป็นปีปัจจุบัน',
          ),
        );
      }
      return h(
        'div',
        { class: 'row-card' },
        h('div', { class: 'row-year' }, String(e.year)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, e.title), h('div', { class: 'slip-small' }, `ทีมที่สมัคร ${e.teams_count} ทีม`)),
        h('div', { class: 'row-badges' }, statusBadges),
        h('div', { class: 'row-actions' }, actions),
      );
    });
    return h('section', { class: 'panel' }, h('h3', 'รอบทั้งหมด'), listNote.el, rows.length ? rows : h('p', { class: 'empty-note' }, 'ยังไม่มีรอบการจัดงาน'));
  }

  // ── settings of one edition ──
  function settingsBox(e) {
    const picker = selectField({ label: 'แก้ไขค่าของปี', options: data.editions.map((x) => ({ value: x.id, label: `${x.year}${x.is_current ? ' (ปัจจุบัน)' : ''}` })), value: e.id });
    picker.input.addEventListener('change', () => {
      selectedId = picker.input.value;
      paint();
    });

    let mode = e.reg_mode;
    const radios = MODES.map((m) => {
      const input = h('input', { type: 'radio', name: 'regmode', class: 'chk', value: m.value, checked: m.value === mode });
      input.addEventListener('change', () => { mode = m.value; });
      return h('label', { class: 'chk-row' }, input, h('span', null, h('b', m.title), h('br'), h('span', { class: 'panel-hint' }, m.desc)));
    });
    const opens = textField({ label: 'เปิดรับสมัคร', type: 'datetime-local', value: toLocalInput(e.registration_opens_at) });
    const closes = textField({ label: 'ปิดรับสมัคร', type: 'datetime-local', value: toLocalInput(e.registration_closes_at) });
    const max = textField({ label: 'จำนวนสมาชิกสูงสุดต่อทีม', value: String(e.max_members), inputmode: 'numeric', maxlength: 2, narrow: true });

    const dateRows = h('div', { class: 'admin-stack' });
    const dates = e.key_dates.map((d) => ({ label: d.label ?? '', date: d.date ?? '' }));
    function paintDates() {
      dateRows.replaceChildren(
        ...dates.map((d, i) => {
          const l = textField({ label: `หัวข้อกำหนดการ ${i + 1}`, value: d.label, maxlength: 100 });
          const v = textField({ label: `วันที่ ${i + 1}`, value: d.date, maxlength: 100, placeholder: '2026-12-01' });
          l.input.addEventListener('input', () => { d.label = l.input.value; });
          v.input.addEventListener('input', () => { d.date = v.input.value; });
          const del = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `ลบกำหนดการ ${i + 1}`, onClick: () => { dates.splice(i, 1); paintDates(); } }, 'ลบ');
          return h('div', { class: 'date-row' }, l.el, v.el, del);
        }),
        dates.length < 12 ? h('button', { type: 'button', class: 'btn btn-outline btn-add btn-sm', onClick: () => { dates.push({ label: '', date: '' }); paintDates(); } }, '+ เพิ่มกำหนดการ') : null,
      );
    }
    paintDates();

    const note = notice();
    if (savedMessage) {
      note.show('ok', savedMessage);
      savedMessage = '';
    }
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'บันทึก');
    save.addEventListener('click', () =>
      runBusy(
        save,
        'กำลังบันทึก…',
        async () => {
          await ctx.call('admin_save_edition', {
            id: e.id,
            reg_mode: mode,
            registration_opens_at: fromLocalInput(opens.input.value),
            registration_closes_at: fromLocalInput(closes.input.value),
            max_members: Number(max.input.value),
            key_dates: dates,
          });
          savedMessage = 'บันทึกแล้ว';
          await reload();
        },
        note,
      ),
    );

    return h(
      'section',
      { class: 'panel', id: 'ed-settings' },
      h('h3', `ช่วงเวลารับสมัครและกำหนดการ — ปี ${e.year}`),
      picker.el,
      h('div', { class: 'admin-stack' }, radios),
      h('div', { class: 'fields' }, opens.el, closes.el),
      h('p', { class: 'panel-hint' }, 'เวลาประเทศไทย (UTC+7) · เซิร์ฟเวอร์ตัดสินด้วยนาฬิกาของเซิร์ฟเวอร์เอง ไม่ใช่เวลาในเครื่องผู้สมัคร'),
      e.status === 'draft' ? h('div', { class: 'banner-warn' }, 'ปีนี้ยังเป็นฉบับร่าง — จะรับสมัครไม่ได้จนกว่าจะกด “ตั้งเป็นปีปัจจุบัน”') : null,
      max.el,
      h('h4', { class: 'sub-h' }, 'กำหนดการสำคัญที่แสดงบนหน้าหลัก'),
      h('p', { class: 'panel-hint' }, 'ช่องวันที่พิมพ์เป็น 2026-12-01 (แสดงเป็นวันที่ไทย) หรือพิมพ์ข้อความเอง เช่น “ธันวาคม 2569”'),
      dateRows,
      note.el,
      h('div', { class: 'action-row' }, save),
      e.last_backup_at ? h('p', { class: 'slip-small' }, `สำรองข้อมูลล่าสุด ${formatThaiDateTime(e.last_backup_at)}`) : null,
    );
  }

  function howTo() {
    return h(
      'section',
      { class: 'panel panel-dashed' },
      h('h3', 'ขั้นตอนเริ่มปีใหม่ (ใช้เว็บเดิมต่อทุกปี)'),
      h(
        'ol',
        { class: 'steps' },
        h('li', 'จบงาน → ไปแท็บ “สำรอง/รีเซ็ต” แล้วสำรองข้อมูลปีเก่า'),
        h('li', 'รีเซ็ตข้อมูลผู้เข้าร่วมปีเก่า (ตามนโยบาย PDPA) — ภาพกิจกรรมยังอยู่'),
        h('li', 'กด “สร้างปีใหม่” (คัดลอกข้อความจากปีเดิม)'),
        h('li', 'ตั้งช่วงรับสมัครและกำหนดการ แก้ PDF/พื้นหลังของปีใหม่ในแท็บเนื้อหา'),
        h('li', 'กด “ตั้งเป็นปีปัจจุบัน” → หน้าหลักและฟอร์มสมัครเปลี่ยนเป็นปีใหม่ทันที'),
      ),
    );
  }

  ctx.setYear(data.editions.find((e) => e.is_current)?.year);
  paint();
}
