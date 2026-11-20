// Tab — เอกสารให้ทีม: forms / documents the teams can download from the status page after they sign in with team name + PIN.
// Rows: [document name] [choose file] [upload] [delete], and a button to add another file row.
import { h, append } from '../../lib/dom.js';
import { putToDrive, messageFor } from '../../lib/api.js';
import { textField, selectField, notice, runBusy, confirmDialog } from '../../lib/ui.js';

const EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'zip', 'jpg', 'jpeg', 'png'];
const MAX_MB = 20;
const ext = (name) => (/\.([A-Za-z0-9]{1,10})$/.exec(name || '')?.[1] ?? '').toLowerCase();
const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export async function render(body, ctx) {
  const editions = (await ctx.call('admin_editions')).editions;
  let editionId = (editions.find((e) => e.is_current) ?? editions[0])?.id;
  if (!editionId) {
    body.append(h('h2', 'เอกสารให้ทีมดาวน์โหลด'), h('div', { class: 'panel' }, h('p', 'ยังไม่มีรอบการจัดงาน')));
    return;
  }
  let data = null;
  let seq = 0;
  const top = h('div', { class: 'admin-stack' });
  const listBox = h('section', { class: 'panel' });
  const draftsBox = h('div', { class: 'admin-stack' });
  const banner = notice();

  async function load() {
    data = await ctx.call('admin_documents', { edition_id: editionId });
    paintList();
  }

  // ───────── existing documents ─────────
  function paintList() {
    const yearLabel = editions.find((x) => x.id === editionId)?.year ?? '';
    const rows = data.documents.map((d) => {
      const name = textField({ label: 'ชื่อเอกสาร', value: d.title, maxlength: 120 });
      const save = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, 'บันทึกชื่อ');
      save.addEventListener('click', () =>
        runBusy(
          save,
          'กำลังบันทึก…',
          async () => {
            if (!name.input.value.trim()) return banner.show('err', 'กรอกชื่อเอกสาร');
            await ctx.call('admin_update_document', { id: d.id, title: name.input.value });
            d.title = name.input.value.trim();
            banner.show('ok', 'บันทึกชื่อเอกสารแล้ว');
          },
          banner,
        ),
      );
      const del = h('button', { type: 'button', class: 'btn btn-outline btn-sm btn-danger-outline' }, 'ลบ');
      del.addEventListener('click', async () => {
        const yes = await confirmDialog({ title: 'ลบเอกสาร', message: `ลบ “${d.title}” ใช่หรือไม่? ทีมจะโหลดไฟล์นี้ไม่ได้อีก และไฟล์จะถูกย้ายไปถังขยะของ Google Drive`, confirmLabel: 'ลบเอกสาร', danger: true });
        if (!yes) return;
        await runBusy(
          del,
          'กำลังลบ…',
          async () => {
            await ctx.call('admin_delete_document', { id: d.id });
            await load();
            banner.show('ok', 'ลบเอกสารแล้ว');
          },
          banner,
        );
      });
      return h(
        'div',
        { class: 'doc-row' },
        name.el,
        h('div', { class: 'doc-file' }, h('a', { href: d.view_url, target: '_blank', rel: 'noopener noreferrer' }, d.file_name), h('span', { class: 'slip-small' }, ` · ${formatSize(d.size_bytes)}`)),
        h('div', { class: 'row-actions' }, save, del),
      );
    });
    listBox.replaceChildren();
    append(listBox, [
      h('h3', `เอกสารที่ทีมโหลดได้ — ปี ${yearLabel} (${data.documents.length}/${data.max})`),
      rows.length ? h('div', { class: 'admin-stack' }, rows) : h('p', { class: 'empty-note' }, 'ยังไม่มีเอกสาร — เพิ่มไฟล์ด้านล่าง'),
    ]);
  }

  // ───────── draft rows: name + file + upload + delete ─────────
  function addDraft() {
    const key = ++seq;
    const name = textField({ label: 'ชื่อเอกสาร (ที่ทีมจะเห็น)', maxlength: 120, placeholder: 'เช่น แบบฟอร์มข้อเสนอโครงงาน' });
    const fileId = `doc-file-${key}`;
    const file = h('input', { class: 'inp file-inp', type: 'file', id: fileId, accept: EXTS.map((x) => `.${x}`).join(',') });
    const upload = h('button', { type: 'button', class: 'btn btn-primary' }, 'อัปโหลด');
    const remove = h('button', { type: 'button', class: 'btn btn-outline btn-danger-outline' }, 'ลบแถว');
    const bar = h('progress', { class: 'slot-progress', max: 1, value: 0, hidden: true, 'aria-label': 'ความคืบหน้าการอัปโหลด' });
    const note = notice();
    const row = h(
      'div',
      { class: 'doc-row doc-draft' },
      name.el,
      h('div', { class: 'field' }, h('label', { for: fileId }, 'ไฟล์'), file, h('span', { class: 'help' }, `${EXTS.join(', ').toUpperCase()} ไม่เกิน ${MAX_MB} MB`)),
      h('div', { class: 'row-actions' }, upload, remove),
      bar,
      note.el,
    );
    remove.addEventListener('click', () => {
      row.remove();
      if (!draftsBox.children.length) addDraft(); // there is always one empty row to start from
    });
    file.addEventListener('change', () => {
      // the file name becomes the document name unless one was typed
      const f = file.files?.[0];
      if (f && !name.input.value.trim()) name.input.value = f.name.replace(/\.[A-Za-z0-9]{1,10}$/, '');
    });
    upload.addEventListener('click', async () => {
      note.hide();
      const f = file.files?.[0];
      if (!f) return note.show('err', 'เลือกไฟล์ก่อน');
      if (!name.input.value.trim()) return note.show('err', 'กรอกชื่อเอกสาร');
      if (!EXTS.includes(ext(f.name))) return note.show('err', 'ชนิดไฟล์นี้ไม่รองรับ');
      if (f.size > MAX_MB * 1024 * 1024) return note.show('err', `ไฟล์ใหญ่เกิน ${MAX_MB} MB`);
      upload.disabled = remove.disabled = true;
      bar.value = 0;
      bar.hidden = false;
      const targetEdition = editionId;
      try {
        const { upload_url } = await ctx.call('admin_prepare_document', { file_name: f.name, size: f.size, mime: f.type || 'application/octet-stream', origin: location.origin });
        const driveId = await putToDrive(upload_url, f, (p) => { bar.value = p; });
        await ctx.call('admin_confirm_document', { edition_id: targetEdition, title: name.input.value, file_id: driveId, file_name: f.name });
        row.remove();
        if (!draftsBox.children.length) addDraft();
        await load();
        banner.show('ok', 'อัปโหลดเอกสารแล้ว — ทีมจะเห็นในหน้า "ตรวจสอบการสมัคร" หลังเข้าสู่ระบบด้วยชื่อทีมและ PIN');
      } catch (err) {
        console.error(err);
        note.show('err', err.message === 'network' || err.message?.startsWith('drive') ? messageFor({ reason: 'upload_failed' }) : messageFor(err));
        upload.disabled = remove.disabled = false;
        bar.hidden = true;
      }
    });
    draftsBox.append(row);
  }

  const addBtn = h('button', { type: 'button', class: 'btn btn-outline', onClick: () => addDraft() }, '+ เพิ่มไฟล์');
  const picker = selectField({ label: 'ปี', options: editions.map((x) => ({ value: x.id, label: `${x.year}${x.is_current ? ' (ปัจจุบัน)' : ''}` })), value: editionId });
  picker.input.addEventListener('change', async () => {
    editionId = picker.input.value;
    try {
      await load();
    } catch (err) {
      banner.error(err);
    }
  });

  addDraft();
  append(top, [
    h('p', { class: 'panel-hint' }, 'เอกสารและแบบฟอร์มที่ผู้จัดเตรียมไว้ให้ทีมดาวน์โหลด (เช่น แบบฟอร์มข้อเสนอโครงงาน) ทีมจะเห็นในหน้า "ตรวจสอบการสมัคร" หลังเข้าสู่ระบบด้วยชื่อทีมภาษาอังกฤษและ PIN เท่านั้น และใบสรุปการสมัครบอกทีมไว้แล้วว่าโหลดได้ที่ใด — แยกตามปี ไม่ถูกลบเมื่อรีเซ็ตข้อมูลผู้เข้าร่วม'),
    h('div', { class: 'banner-warn' }, 'ไฟล์เก็บในโฟลเดอร์ "public-assets" ของ Google Drive: ใครมีลิงก์ของไฟล์ก็เปิดได้ (ลิงก์แสดงให้เฉพาะทีมที่เข้าสู่ระบบ) อย่าอัปโหลดเอกสารที่เป็นความลับ'),
    h('section', { class: 'panel' }, picker.el),
    banner.el,
    listBox,
    h('section', { class: 'panel' }, h('h3', 'เพิ่มเอกสาร'), draftsBox, h('div', { class: 'action-row' }, addBtn)),
  ]);
  body.append(h('h2', 'เอกสารให้ทีมดาวน์โหลด'), top);
  await load();
}
