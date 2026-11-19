// Tab 6 — ภาพกิจกรรม: albums per year (create, publish/hide, reorder, delete) and photos per album
// (multi-file upload with in-browser resize, caption, cover, reorder, delete).
// Albums and photos are permanent: resetting participant data (tab 7) never touches them.
import { h, append } from '../../lib/dom.js';
import { putToDrive, messageFor } from '../../lib/api.js';
import { shrinkImage } from '../../lib/image.js';
import { invalidateSite } from '../../lib/site.js';
import { textField, selectField, notice, runBusy, badge, confirmDialog } from '../../lib/ui.js';

const MAX_INPUT_MB = 40;
const MAX_PER_BATCH = 100;
const ACCEPT = 'image/jpeg,image/png,image/webp';
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function render(body, ctx) {
  const editions = (await ctx.call('admin_editions')).editions;
  let albums = (await ctx.call('admin_albums')).albums;
  let editionId = (editions.find((e) => e.is_current) ?? editions[0])?.id;

  const root = h('div', { class: 'admin-stack' });
  body.append(h('h2', 'ภาพกิจกรรม'), root);

  const yearOf = (id) => editions.find((e) => e.id === id)?.year ?? '';
  const refreshAlbums = async () => {
    albums = (await ctx.call('admin_albums')).albums;
    invalidateSite();
  };

  // ───────────── album form (create + edit) ─────────────
  function albumForm({ album, onSaved, onCancel }) {
    const f = {
      edition: selectField({ label: 'ปี', options: editions.map((e) => ({ value: e.id, label: String(e.year) })), value: album?.edition_id ?? editionId }),
      title: textField({ label: 'ชื่ออัลบั้ม', value: album?.title ?? '', maxlength: 200 }),
      description: textField({ label: 'คำอธิบาย (ไม่บังคับ)', value: album?.description ?? '', rows: 2, maxlength: 1000 }),
      date: textField({ label: 'วันที่จัดกิจกรรม (ไม่บังคับ)', value: album?.event_date ?? '', type: 'date', narrow: true }),
      url: textField({
        label: 'ลิงก์อัลบั้มภายนอก (ไม่บังคับ)',
        value: album?.external_url ?? '',
        placeholder: 'https://…',
        maxlength: 500,
        help: 'ถ้าใส่ลิงก์ (เช่น Google Photos / Facebook) หน้าเว็บจะแสดงปุ่มไปยังลิงก์นั้นแทนรูป — เหมาะกับอัลบั้มขนาดใหญ่เพื่อไม่ให้พื้นที่ Drive เต็ม',
      }),
    };
    const pub = h('input', { type: 'checkbox', class: 'chk', id: 'alb-pub', checked: album ? album.is_published : true });
    const note = notice();
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, album ? 'บันทึกอัลบั้ม' : 'สร้างอัลบั้ม');
    save.addEventListener('click', () =>
      runBusy(
        save,
        'กำลังบันทึก…',
        async () => {
          if (!f.title.input.value.trim()) return note.show('err', 'กรอกชื่ออัลบั้ม');
          const res = await ctx.call('admin_save_album', {
            id: album?.id,
            edition_id: f.edition.input.value,
            title: f.title.input.value,
            description: f.description.input.value,
            event_date: f.date.input.value,
            external_url: f.url.input.value,
            is_published: pub.checked,
          });
          editionId = f.edition.input.value;
          await refreshAlbums();
          onSaved(res.id);
        },
        note,
      ),
    );
    const cancel = onCancel ? h('button', { type: 'button', class: 'btn btn-outline', onClick: onCancel }, 'ยกเลิก') : null;
    return h(
      'section',
      { class: 'panel' },
      h('h3', album ? 'ข้อมูลอัลบั้ม' : 'สร้างอัลบั้มใหม่'),
      f.edition.el,
      f.title.el,
      f.description.el,
      f.date.el,
      f.url.el,
      h('label', { class: 'chk-row', for: 'alb-pub' }, pub, h('span', 'เผยแพร่บนหน้าภาพกิจกรรม (อัลบั้มที่ยังไม่มีรูปและไม่มีลิงก์จะยังไม่แสดงบนเว็บ)')),
      note.el,
      h('div', { class: 'action-row' }, save, cancel),
    );
  }

  // ───────────── list of albums of one year ─────────────
  function paintList(creating = false) {
    const picker = selectField({ label: 'ปี', options: editions.map((e) => ({ value: e.id, label: `${e.year}${e.is_current ? ' (ปัจจุบัน)' : ''}` })), value: editionId });
    picker.input.addEventListener('change', () => {
      editionId = picker.input.value;
      paintList();
    });
    const note = notice();
    const mine = albums.filter((a) => a.edition_id === editionId).sort((a, b) => a.sort_order - b.sort_order);

    const move = (a, delta) => async () => {
      const ids = mine.map((x) => x.id);
      const i = ids.indexOf(a.id);
      const j = i + delta;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try {
        await ctx.call('admin_reorder_albums', { ids });
        await refreshAlbums();
        paintList();
      } catch (err) {
        note.error(err);
      }
    };

    const rows = mine.map((a, i) => {
      const toggle = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, a.is_published ? 'ซ่อน' : 'เผยแพร่');
      toggle.addEventListener('click', () =>
        runBusy(
          toggle,
          'กำลังบันทึก…',
          async () => {
            await ctx.call('admin_save_album', { id: a.id, edition_id: a.edition_id, title: a.title, description: a.description, event_date: a.event_date, external_url: a.external_url, is_published: !a.is_published });
            await refreshAlbums();
            paintList();
          },
          note,
        ),
      );
      const del = h('button', { type: 'button', class: 'btn btn-outline btn-sm btn-danger-outline' }, 'ลบ');
      del.addEventListener('click', async () => {
        const yes = await confirmDialog({
          title: 'ลบอัลบั้ม',
          message: `ลบอัลบั้ม "${a.title}" และรูปทั้งหมดในอัลบั้ม (${a.photo_count} รูป) ใช่หรือไม่? รูปจะถูกย้ายไปถังขยะของ Google Drive`,
          confirmLabel: 'ลบอัลบั้ม',
          danger: true,
        });
        if (!yes) return;
        await runBusy(
          del,
          'กำลังลบ…',
          async () => {
            await ctx.call('admin_delete_album', { id: a.id });
            await refreshAlbums();
            paintList();
          },
          note,
        );
      });
      const empty = !a.external_url && a.photo_count === 0;
      return h(
        'div',
        { class: 'alb-row' },
        h('div', { class: 'alb-thumb' }, a.cover_url ? h('img', { src: a.cover_url, alt: '' }) : h('span', a.external_url ? 'ลิงก์ภายนอก' : 'ยังไม่มีรูป')),
        h(
          'div',
          { class: 'alb-main' },
          h('strong', { class: 'row-title' }, a.title),
          h(
            'div',
            { class: 'row-badges' },
            badge(a.is_published ? 'เผยแพร่' : 'ซ่อนอยู่', a.is_published ? 'badge-approved' : 'badge-grey'),
            a.external_url ? badge('ลิงก์ภายนอก', 'badge-grey') : badge(`${a.photo_count} รูป`, 'badge-grey'),
            a.is_published && empty ? badge('ยังไม่แสดงบนเว็บ (ไม่มีรูป)', 'badge-pending') : null,
          ),
        ),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `เลื่อน ${a.title} ขึ้น`, disabled: i === 0, onClick: move(a, -1) }, '↑'),
          h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `เลื่อน ${a.title} ลง`, disabled: i === mine.length - 1, onClick: move(a, 1) }, '↓'),
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => paintAlbum(a.id) }, a.external_url ? 'แก้ไข' : 'จัดการรูป'),
          toggle,
          del,
        ),
      );
    });

    const newBtn = h('button', { type: 'button', class: 'btn btn-primary', onClick: () => paintList(true) }, '+ สร้างอัลบั้มใหม่');
    root.replaceChildren();
    append(root, [
      h('p', { class: 'panel-hint' }, 'อัลบั้มและรูปเก็บถาวร — การรีเซ็ตข้อมูลผู้เข้าร่วมไม่ลบภาพกิจกรรม รูปที่อัปโหลดจะถูกย่อในเบราว์เซอร์ (ด้านยาวไม่เกิน 2000 พิกเซล) และตัดข้อมูลตำแหน่ง/กล้องออกก่อนส่ง'),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', `อัลบั้มของปี ${yearOf(editionId)}`), newBtn), picker.el, note.el, rows.length ? h('div', { class: 'team-list' }, rows) : h('p', { class: 'empty-note' }, 'ยังไม่มีอัลบั้มในปีนี้')),
      creating
        ? albumForm({
            onSaved: (id) => paintAlbum(id),
            onCancel: () => paintList(),
          })
        : null,
    ]);
  }

  // ───────────── one album: form + upload + photos ─────────────
  async function paintAlbum(id) {
    root.replaceChildren(h('p', { class: 'boot' }, 'กำลังโหลดรูป…'));
    let detail;
    try {
      detail = await ctx.call('admin_album', { album_id: id });
    } catch (err) {
      if (err.reason === 'unauthorized') return;
      root.replaceChildren(h('div', { class: 'banner-err', role: 'alert' }, 'โหลดอัลบั้มไม่สำเร็จ ', h('button', { type: 'button', class: 'btn btn-outline btn-sm', onClick: () => paintList() }, 'กลับ')));
      return;
    }
    const { album } = detail;
    let photos = detail.photos;
    let coverId = album.cover_photo_id;

    const back = h('button', { type: 'button', class: 'btn btn-outline' }, `← อัลบั้มของปี ${yearOf(album.edition_id)}`);
    back.addEventListener('click', () =>
      runBusy(
        back,
        'กำลังโหลด…',
        async () => {
          await refreshAlbums(); // photo counts / cover may have changed
          paintList();
        },
        note,
      ),
    );
    const form = albumForm({ album, onSaved: () => paintAlbum(id) });
    const photoBox = h('section', { class: 'panel' });
    const note = notice();

    // ── photos grid ──
    function paintPhotos() {
      const shownCover = coverId || photos[0]?.id;
      const move = (i, delta) => async () => {
        const ids = photos.map((p) => p.id);
        const j = i + delta;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        const before = photos;
        photos = ids.map((x) => before.find((p) => p.id === x));
        paintPhotos();
        try {
          await ctx.call('admin_reorder_photos', { album_id: id, ids });
          invalidateSite();
        } catch (err) {
          photos = before;
          paintPhotos();
          note.error(err);
        }
      };
      const cards = photos.map((p, i) => {
        const cap = h('input', { class: 'inp', type: 'text', maxlength: 200, value: p.caption ?? '', placeholder: 'คำบรรยาย (ไม่บังคับ)', 'aria-label': `คำบรรยายภาพที่ ${i + 1}` });
        const state = h('span', { class: 'help', role: 'status' });
        cap.addEventListener('change', async () => {
          state.textContent = 'กำลังบันทึก…';
          try {
            await ctx.call('admin_update_photo', { id: p.id, caption: cap.value });
            p.caption = cap.value;
            state.textContent = 'บันทึกแล้ว';
            invalidateSite();
          } catch (err) {
            state.textContent = '';
            note.error(err);
          }
        });
        const isCover = p.id === shownCover;
        const coverBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', disabled: isCover }, isCover ? '★ ภาพปก' : 'ตั้งเป็นปก');
        coverBtn.addEventListener('click', () =>
          runBusy(
            coverBtn,
            '…',
            async () => {
              await ctx.call('admin_set_cover', { album_id: id, photo_id: p.id });
              coverId = p.id;
              invalidateSite();
              paintPhotos();
            },
            note,
          ),
        );
        const del = h('button', { type: 'button', class: 'btn btn-outline btn-sm btn-danger-outline', 'aria-label': `ลบภาพที่ ${i + 1}` }, 'ลบ');
        del.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: 'ลบรูป', message: 'ลบรูปนี้ใช่หรือไม่? ไฟล์จะถูกย้ายไปถังขยะของ Google Drive', confirmLabel: 'ลบรูป', danger: true }))) return;
          await runBusy(
            del,
            '…',
            async () => {
              await ctx.call('admin_delete_photo', { id: p.id });
              photos = photos.filter((x) => x.id !== p.id);
              if (coverId === p.id) coverId = '';
              invalidateSite();
              paintPhotos();
            },
            note,
          );
        });
        return h(
          'div',
          { class: `adm-photo${isCover ? ' is-cover' : ''}` },
          h('img', { src: p.thumb_url, alt: p.caption || `ภาพที่ ${i + 1}`, loading: 'lazy' }),
          cap,
          state,
          h(
            'div',
            { class: 'adm-photo-actions' },
            h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `เลื่อนภาพที่ ${i + 1} ไปก่อนหน้า`, disabled: i === 0, onClick: move(i, -1) }, '←'),
            h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `เลื่อนภาพที่ ${i + 1} ไปถัดไป`, disabled: i === photos.length - 1, onClick: move(i, 1) }, '→'),
            coverBtn,
            del,
          ),
        );
      });
      photoBox.replaceChildren();
      append(photoBox, [h('h3', `รูปในอัลบั้ม (${photos.length})`), photos.length ? h('div', { class: 'adm-photos' }, cards) : h('p', { class: 'empty-note' }, 'ยังไม่มีรูป — อัปโหลดด้านบน')]);
    }

    // ── upload ──
    const list = h('ul', { class: 'up-list', 'aria-label': 'ความคืบหน้าการอัปโหลด' });
    const input = h('input', { type: 'file', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', accept: ACCEPT, multiple: true });
    const pick = h('button', { type: 'button', class: 'btn btn-primary', onClick: () => input.click() }, 'เลือกรูป (เลือกได้หลายไฟล์)');
    const upNote = notice();

    async function uploadOne(file, item) {
      const set = (text, cls = '') => {
        item.status.textContent = text;
        item.el.className = `up-item ${cls}`;
      };
      try {
        if (!OK_TYPES.includes(file.type)) throw Object.assign(new Error('type'), { text: 'รองรับเฉพาะ JPG / PNG / WebP (ไฟล์ HEIC ให้แปลงเป็น JPG ก่อน)' });
        if (file.size > MAX_INPUT_MB * 1024 * 1024) throw Object.assign(new Error('size'), { text: `ไฟล์ใหญ่เกิน ${MAX_INPUT_MB} MB` });
        set('กำลังย่อรูป…');
        const small = await shrinkImage(file).catch(() => {
          throw Object.assign(new Error('decode'), { text: 'เปิดรูปนี้ไม่ได้' });
        });
        set('กำลังอัปโหลด 0%');
        const { upload_url } = await ctx.call('admin_prepare_photo', { album_id: id, file_name: small.name, size: small.blob.size, mime: 'image/jpeg', origin: location.origin });
        const fileId = await putToDrive(upload_url, small.blob, (p) => set(`กำลังอัปโหลด ${Math.round(p * 100)}%`));
        set('กำลังบันทึก…');
        await ctx.call('admin_confirm_photo', { album_id: id, file_id: fileId, width: small.width, height: small.height });
        set('เสร็จแล้ว', 'is-ok');
        return true;
      } catch (err) {
        console.error(err);
        const text = err.text ?? (err.message === 'network' || err.message?.startsWith('drive') ? 'อัปโหลดไม่สำเร็จ (การเชื่อมต่อกับ Google Drive ขัดข้อง)' : null);
        set(text ?? (err.reason ? messageFor(err) : 'ไม่สำเร็จ'), 'is-err');
        return false;
      }
    }

    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      if (!files.length) return;
      upNote.hide();
      if (files.length > MAX_PER_BATCH) {
        upNote.show('err', `เลือกได้ครั้งละไม่เกิน ${MAX_PER_BATCH} ไฟล์`);
        return;
      }
      pick.disabled = true;
      list.replaceChildren();
      const items = files.map((file) => {
        const status = h('span', 'รอคิว…');
        const el = h('li', { class: 'up-item' }, h('span', { class: 'up-name' }, file.name), status);
        list.append(el);
        return { file, status, el };
      });
      // two at a time: fast enough, and the sheet lock handles the saves one by one
      let next = 0;
      let okCount = 0;
      await Promise.all(
        [0, 1].map(async () => {
          while (next < items.length) {
            const it = items[next++];
            if (await uploadOne(it.file, it)) okCount++;
          }
        }),
      );
      pick.disabled = false;
      upNote.show(okCount === items.length ? 'ok' : okCount ? 'warn' : 'err', `อัปโหลดสำเร็จ ${okCount} จาก ${items.length} ไฟล์`);
      try {
        const fresh = await ctx.call('admin_album', { album_id: id });
        photos = fresh.photos;
        coverId = fresh.album.cover_photo_id;
        invalidateSite();
        paintPhotos();
      } catch (err) {
        upNote.error(err);
      }
    });

    const uploadPanel = album.external_url
      ? h('section', { class: 'panel' }, h('h3', 'อัลบั้มลิงก์ภายนอก'), h('p', { class: 'panel-hint' }, 'อัลบั้มนี้ใช้ลิงก์ภายนอก จึงไม่มีรูปในระบบ — เปิดลิงก์: '), h('a', { href: album.external_url, target: '_blank', rel: 'noopener noreferrer' }, album.external_url))
      : h(
          'section',
          { class: 'panel' },
          h('h3', 'อัปโหลดรูป'),
          h('p', { class: 'panel-hint' }, 'รูปจะถูกย่อในเบราว์เซอร์ก่อนส่ง (ด้านยาวไม่เกิน 2000 พิกเซล, JPEG) รองรับ JPG / PNG / WebP ไฟล์ละไม่เกิน 40 MB'),
          h('div', { class: 'action-row' }, pick, input),
          upNote.el,
          list,
        );

    root.replaceChildren();
    append(root, [h('div', { class: 'action-row' }, back), form, uploadPanel, album.external_url ? null : photoBox, note.el]);
    if (!album.external_url) paintPhotos();
  }

  paintList();
}
