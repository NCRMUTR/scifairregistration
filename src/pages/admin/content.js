// Tab 3 — เนื้อหาหน้าเว็บ: site-wide texts + logo, and per-edition title/intro/background/PDF/ack/PDPA.
import { h } from '../../lib/dom.js';
import { putToDrive } from '../../lib/api.js';
import { textField, selectField, notice, runBusy, filePicker, confirmDialog } from '../../lib/ui.js';

const KINDS = {
  logo: { exts: ['png', 'jpg', 'jpeg', 'webp'], mb: 2, label: 'PNG / JPG / WebP ไม่เกิน 2 MB — PNG พื้นโปร่งใสจะแสดงเป็นพื้นโปร่งใส' },
  background: { exts: ['png', 'jpg', 'jpeg', 'webp'], mb: 5, label: 'PNG / JPG / WebP ไม่เกิน 5 MB (แนะนำภาพแนวนอน ≥ 1600 px)' },
  rules_pdf: { exts: ['pdf'], mb: 15, label: 'PDF ไม่เกิน 15 MB' },
};

const BOLD = 'ตัวหนา: พิมพ์ **ข้อความ** (ดอกจัน 2 ตัวหน้าและหลัง) ขึ้นบรรทัดใหม่ได้ตามปกติ';
const ext = (name) => (/\.([A-Za-z0-9]{1,10})$/.exec(name || '')?.[1] ?? '').toLowerCase();

export async function render(body, ctx) {
  const [settingsData, editionsData] = await Promise.all([ctx.call('admin_settings'), ctx.call('admin_editions')]);
  let logoUrl = settingsData.logo_url;
  let editions = editionsData.editions;
  let selectedId = (editions.find((e) => e.is_current) ?? editions[0])?.id;
  const globalBox = h('div');
  const editionBox = h('div');
  body.append(h('h2', 'เนื้อหาหน้าเว็บ'), h('div', { class: 'admin-stack' }, globalBox, editionBox));

  /** Pick -> prepare_asset -> PUT to Drive -> confirm_asset. Shows progress inside `slot`. */
  function assetUploader({ kind, editionId, buttonLabel, onDone, hasFile, removeLabel, removeMessage }) {
    const rule = KINDS[kind];
    const note = notice();
    const bar = h('progress', { class: 'slot-progress', max: 1, value: 0, hidden: true, 'aria-label': 'ความคืบหน้าการอัปโหลด' });
    const picker = filePicker(buttonLabel, rule.exts.map((x) => `.${x}`).join(','), async (file) => {
      note.hide();
      if (!rule.exts.includes(ext(file.name))) return note.show('err', `ชนิดไฟล์ไม่ถูกต้อง (${rule.label})`);
      if (file.size > rule.mb * 1024 * 1024) return note.show('err', `ไฟล์ใหญ่เกิน ${rule.mb} MB`);
      picker.button.disabled = true;
      bar.value = 0;
      bar.hidden = false;
      try {
        const { upload_url } = await ctx.call('admin_prepare_asset', { kind, file_name: file.name, size: file.size, mime: file.type || 'application/octet-stream', origin: location.origin });
        const fileId = await putToDrive(upload_url, file, (p) => { bar.value = p; });
        await ctx.call('admin_confirm_asset', { kind, edition_id: editionId, file_id: fileId });
        note.show('ok', 'อัปโหลดแล้ว — หน้าเว็บจะแสดงภายในประมาณ 1 นาที');
        await onDone();
      } catch (err) {
        console.error(err);
        note.error(err.message === 'network' || err.message?.startsWith('drive') ? { reason: 'upload_failed' } : err);
      } finally {
        bar.hidden = true;
        picker.button.disabled = false;
      }
    });
    // Remove: detach the file from the site (the Drive file goes to the Drive trash).
    const remove = hasFile ? h('button', { type: 'button', class: 'btn btn-outline btn-danger-outline' }, removeLabel) : null;
    remove?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: removeLabel, message: removeMessage, confirmLabel: 'ลบ', danger: true }))) return;
      await runBusy(
        remove,
        'กำลังลบ…',
        async () => {
          await ctx.call('admin_clear_asset', { kind, edition_id: editionId });
          await onDone();
        },
        note,
      );
    });
    return { nodes: [h('div', { class: 'action-row' }, picker.button, remove), picker.input, bar, note.el], hint: h('span', { class: 'help' }, rule.label) };
  }

  // ───────── site-wide ─────────
  function paintGlobal() {
    const s = settingsData.settings;
    const f = {
      site_name: textField({ label: 'ชื่อเว็บ', value: s.site_name, maxlength: 200 }),
      footer_text: textField({ label: 'ข้อความท้ายหน้า (Footer)', value: s.footer_text, rows: 2, maxlength: 1000, help: BOLD }),
      contact_info: textField({ label: 'ช่องทางติดต่อ (แสดงท้ายหน้าและหน้าตรวจสอบการสมัคร)', value: s.contact_info, rows: 2, maxlength: 1000, help: BOLD }),
      details_button_label: textField({ label: 'ปุ่มรายละเอียดโครงการ', value: s.details_button_label, maxlength: 100 }),
      apply_button_label: textField({ label: 'ปุ่มสมัคร', value: s.apply_button_label, maxlength: 100 }),
      submit_label: textField({ label: 'ปุ่ม Submit', value: s.submit_label, maxlength: 100 }),
      gallery_intro: textField({ label: 'ข้อความแนะนำหน้าภาพกิจกรรม', value: s.gallery_intro, maxlength: 300, help: BOLD }),
    };
    const up = assetUploader({ kind: 'logo', buttonLabel: logoUrl ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้', hasFile: Boolean(logoUrl), removeLabel: 'ลบโลโก้', removeMessage: 'ลบโลโก้ใช่หรือไม่? หน้าเว็บจะกลับไปแสดงตัวอักษร ST แทน และไฟล์ถูกย้ายไปถังขยะของ Google Drive', onDone: async () => { logoUrl = (await ctx.call('admin_settings')).logo_url; paintGlobal(); } });
    const note = notice();
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'บันทึก');
    save.addEventListener('click', () =>
      runBusy(
        save,
        'กำลังบันทึก…',
        async () => {
          const settings = {};
          Object.entries(f).forEach(([k, v]) => { settings[k] = v.input.value; });
          await ctx.call('admin_save_settings', { settings });
          Object.assign(settingsData.settings, settings);
          note.show('ok', 'บันทึกแล้ว');
        },
        note,
      ),
    );
    globalBox.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('h3', 'ทั้งเว็บ (ใช้ทุกปี)'),
        h('div', { class: 'asset-row' }, h('div', { class: 'asset-preview' }, logoUrl ? h('img', { src: logoUrl, alt: 'โลโก้ปัจจุบัน' }) : h('span', 'ยังไม่มีโลโก้')), h('div', { class: 'admin-stack' }, up.nodes, up.hint)),
        Object.values(f).map((x) => x.el),
        note.el,
        h('div', { class: 'action-row' }, save),
      ),
    );
  }

  // ───────── per edition ─────────
  function paintEdition() {
    const e = editions.find((x) => x.id === selectedId);
    if (!e) {
      editionBox.replaceChildren(h('section', { class: 'panel' }, h('p', 'ยังไม่มีรอบการจัดงาน')));
      return;
    }
    const picker = selectField({ label: 'ปีที่แก้ไข', options: editions.map((x) => ({ value: x.id, label: `${x.year}${x.is_current ? ' (ปัจจุบัน)' : ''}` })), value: e.id });
    picker.input.addEventListener('change', () => { selectedId = picker.input.value; paintEdition(); });
    const reloadEditions = async () => { editions = (await ctx.call('admin_editions')).editions; paintEdition(); };

    const f = {
      title: textField({ label: 'ชื่อโครงการประจำปี', value: e.title, maxlength: 200 }),
      subtitle: textField({ label: 'คำบรรยายใต้ชื่อ (ไม่บังคับ)', value: e.subtitle, maxlength: 300, help: BOLD }),
      intro_text: textField({ label: 'รายละเอียดโครงการโดยย่อ', value: e.intro_text, rows: 4, maxlength: 3000, help: BOLD }),
      ack_text: textField({ label: 'ข้อความช่องรับทราบ', value: e.ack_text, rows: 2, maxlength: 1000, help: BOLD }),
      pdpa_text: textField({ label: 'ข้อความช่อง PDPA (ต้องให้ฝ่ายกฎหมาย/DPO ตรวจก่อนใช้จริง)', value: e.pdpa_text, rows: 4, maxlength: 5000, help: BOLD }),
    };
    const bg = assetUploader({ kind: 'background', editionId: e.id, buttonLabel: e.background_url ? 'เปลี่ยนภาพพื้นหลัง' : 'อัปโหลดภาพพื้นหลัง', hasFile: Boolean(e.background_url), removeLabel: 'ลบภาพพื้นหลัง', removeMessage: `ลบภาพพื้นหลังของปี ${e.year} ใช่หรือไม่? หน้าแรกจะกลับไปใช้พื้นสีกรมท่า และไฟล์ถูกย้ายไปถังขยะของ Google Drive`, onDone: reloadEditions });
    const pdf = assetUploader({ kind: 'rules_pdf', editionId: e.id, buttonLabel: e.rules_pdf ? 'อัปโหลด PDF ใหม่' : 'อัปโหลด PDF', hasFile: Boolean(e.rules_pdf), removeLabel: 'ลบ PDF คำชี้แจงโครงการ', removeMessage: `ลบ PDF คำชี้แจงโครงการของปี ${e.year} ใช่หรือไม่? ปุ่ม "รายละเอียดโครงการ" จะแจ้งว่ายังไม่มีไฟล์ และไฟล์ถูกย้ายไปถังขยะของ Google Drive`, onDone: reloadEditions });
    const note = notice();
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'บันทึกการเปลี่ยนแปลง');
    save.addEventListener('click', () =>
      runBusy(
        save,
        'กำลังบันทึก…',
        async () => {
          const patch = {};
          Object.entries(f).forEach(([k, v]) => { patch[k] = v.input.value; });
          await ctx.call('admin_save_edition', { id: e.id, ...patch });
          Object.assign(e, patch);
          note.show('ok', 'บันทึกแล้ว');
        },
        note,
      ),
    );
    editionBox.replaceChildren(
      h(
        'section',
        { class: 'panel' },
        h('h3', `เฉพาะปี ${e.year}`),
        picker.el,
        h(
          'div',
          { class: 'asset-row' },
          h('div', { class: 'asset-preview' }, e.background_url ? h('img', { src: e.background_url, alt: 'ภาพพื้นหลังปัจจุบัน' }) : h('span', 'ยังไม่ได้อัปโหลด')),
          h('div', { class: 'admin-stack' }, h('strong', 'ภาพพื้นหลังหน้าหลัก'), bg.nodes, bg.hint),
        ),
        h(
          'div',
          { class: 'asset-row' },
          h('div', { class: 'asset-preview' }, e.rules_pdf ? h('a', { href: e.rules_pdf.view_url, target: '_blank', rel: 'noopener' }, 'เปิดดู PDF ปัจจุบัน') : h('span', 'ยังไม่มีไฟล์')),
          h('div', { class: 'admin-stack' }, h('strong', 'PDF คำชี้แจงโครงการ (หน้าต่างรายละเอียด)'), pdf.nodes, pdf.hint),
        ),
        Object.values(f).map((x) => x.el),
        note.el,
        h('div', { class: 'action-row' }, save),
      ),
    );
  }

  paintGlobal();
  paintEdition();
}
