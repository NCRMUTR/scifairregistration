// Tab 4 — รายชื่อทีม: search/filter, detail, change status, edit on behalf, delete, reset PIN, messages, CSV export.
import { h, replace } from '../../lib/dom.js';
import { formatThaiDateTime } from '../../lib/format.js';
import { openModal } from '../../lib/modal.js';
import { isStudentId, isPhone, isPin, digitsOnly, nameKey } from '../../lib/validators.js';
import { textField, selectField, notice, runBusy, badge, confirmDialog, csvCell, downloadText } from '../../lib/ui.js';

const STATUS = {
  pending: { text: 'รอ admin ตรวจสอบ', cls: 'badge-pending' },
  approved: { text: 'การสมัครสำเร็จ', cls: 'badge-approved' },
};

function sizeText(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function render(body, ctx) {
  const editions = (await ctx.call('admin_editions')).editions;
  let editionId = (editions.find((e) => e.is_current) ?? editions[0])?.id;
  let data = null;
  let query = '';
  let statusFilter = 'all';
  const banner = notice();
  const box = h('div', { class: 'admin-stack' });
  body.append(box);

  async function load() {
    data = await ctx.call('admin_teams', { edition_id: editionId });
    paint();
  }

  const unreadOf = (t) => t.messages.filter((m) => !m.read).length;

  function filtered() {
    const q = query.trim().toLowerCase();
    return data.teams.filter((t) => {
      if (statusFilter === 'unread' ? !unreadOf(t) : statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      const hay = [t.ref_no, t.name_th, t.name_en, ...t.members.flatMap((m) => [m.student_id, m.full_name]), ...t.advisors.map((a) => a.full_name)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function exportCsv() {
    const head = ['เลขที่ใบสมัคร', 'ชื่อทีม (ไทย)', 'ชื่อทีม (อังกฤษ)', 'สถานะ', 'วันที่สมัคร', 'ลำดับสมาชิก', 'รหัสนักศึกษา', 'ชื่อสมาชิก', 'เบอร์โทร', 'อาจารย์ที่ปรึกษา'];
    const lines = [head.map(csvCell).join(',')];
    data.teams.forEach((t) => {
      const advisors = t.advisors.map((a) => `${a.full_name} (${a.department}/${a.faculty})`).join(' ; ');
      const common = [t.ref_no, t.name_th, t.name_en, STATUS[t.status]?.text ?? t.status, t.created_at];
      const members = t.members.length ? t.members : [{ order_no: '', student_id: '', full_name: '', phone: '' }];
      members.forEach((m) => lines.push([...common, m.order_no, m.student_id, m.full_name, m.phone, advisors].map(csvCell).join(',')));
    });
    downloadText(`teams-${data.edition.year}.csv`, lines.join('\r\n'));
  }

  function paint() {
    const e = data.edition;
    const list = filtered();
    const search = textField({ label: 'ค้นหา (ชื่อทีม / รหัสนักศึกษา / ชื่อสมาชิก / เลขที่)', value: query, maxlength: 100 });
    search.input.addEventListener('input', () => {
      query = search.input.value;
      paintRows();
    });
    const filter = selectField({
      label: 'สถานะ',
      options: [
        { value: 'all', label: 'ทั้งหมด' },
        { value: 'pending', label: 'รอตรวจสอบ' },
        { value: 'approved', label: 'การสมัครสำเร็จ' },
        { value: 'unread', label: 'มีข้อความที่ยังไม่อ่าน' },
      ],
      value: statusFilter,
    });
    filter.input.addEventListener('change', () => {
      statusFilter = filter.input.value;
      paintRows();
    });
    const picker = selectField({ label: 'ปี', options: editions.map((x) => ({ value: x.id, label: String(x.year) })), value: editionId });
    picker.input.addEventListener('change', async () => {
      editionId = picker.input.value;
      await load();
    });

    const rowsBox = h('div', { class: 'team-list' });
    const count = h('p', { class: 'slip-small', role: 'status' });
    function paintRows() {
      const rows = filtered();
      count.textContent = `แสดง ${rows.length} จาก ${data.teams.length} ทีม`;
      rowsBox.replaceChildren(
        ...(rows.length
          ? rows.map(teamRow)
          : [h('p', { class: 'empty-note' }, e.purged_at && !data.teams.length ? 'ไม่มีข้อมูลทีมในปีนี้ (ถูกรีเซ็ตแล้ว)' : 'ไม่พบทีมที่ตรงกับเงื่อนไข')]),
      );
    }

    replace(
      box,
      h('div', { class: 'admin-head' }, h('h2', `รายชื่อทีม ปี ${e.year}`), h('button', { type: 'button', class: 'btn btn-outline', onClick: exportCsv, disabled: !data.teams.length || undefined }, 'ส่งออก CSV')),
      e.purged_at ? h('div', { class: 'banner-warn' }, `ข้อมูลของปีนี้ถูกรีเซ็ตแล้ว (${e.purge_mode})`) : null,
      banner.el,
      h('section', { class: 'panel' }, h('div', { class: 'fields' }, picker.el, filter.el, search.el), count, rowsBox),
    );
    paintRows();
    void list;
  }

  function teamRow(t) {
    const unread = unreadOf(t);
    const st = STATUS[t.status] ?? STATUS.pending;
    return h(
      'div',
      { class: 'team-row' },
      h('div', { class: 'team-id' }, h('strong', t.ref_no)),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, t.name_th), h('div', { class: 'slip-small' }, t.name_en)),
      h('div', { class: 'team-meta' }, `${t.members.length || t.members_count_at_purge || 0} คน`, t.uploads.length ? ` · ไฟล์ ${t.uploads.length}` : ''),
      h('div', { class: 'row-badges' }, badge(st.text, st.cls), unread ? badge(`ข้อความใหม่ ${unread}`, 'badge-pending') : null),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn-outline btn-sm', onClick: () => openDetail(t) }, 'ดูรายละเอียด')),
    );
  }

  // ───────────── detail modal ─────────────
  function openDetail(t) {
    const note = notice();
    const done = async (message) => {
      modal.close();
      await load();
      banner.show('ok', message);
    };
    const st = STATUS[t.status] ?? STATUS.pending;
    const purged = Boolean(data.edition.purged_at);

    const statusBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, t.status === 'approved' ? 'เปลี่ยนกลับเป็น รอตรวจสอบ' : 'อนุมัติ (การสมัครสำเร็จ)');
    statusBtn.addEventListener('click', () =>
      runBusy(statusBtn, 'กำลังบันทึก…', async () => {
        await ctx.call('admin_set_team_status', { team_id: t.id, status: t.status === 'approved' ? 'pending' : 'approved' });
        await done(`เปลี่ยนสถานะทีม ${t.ref_no} แล้ว`);
      }, note),
    );
    const pinField = textField({ label: 'PIN ใหม่ 4 หลัก (ผู้จัดไม่สามารถดู PIN เดิมได้)', inputmode: 'numeric', maxlength: 4, narrow: true });
    pinField.input.addEventListener('input', () => { pinField.input.value = digitsOnly(pinField.input.value, 4); });
    const pinBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, 'ตั้ง PIN ใหม่');
    pinBtn.addEventListener('click', () => {
      if (!isPin(pinField.input.value)) return note.show('err', 'PIN ต้องเป็นตัวเลข 4 หลัก');
      return runBusy(pinBtn, 'กำลังบันทึก…', async () => {
        await ctx.call('admin_reset_pin', { team_id: t.id, pin: pinField.input.value });
        pinField.input.value = '';
        note.show('ok', 'ตั้ง PIN ใหม่แล้ว (และปลดล็อกการเดา PIN ของทีมนี้) — แจ้งทีมผ่านช่องทางที่ปลอดภัย');
      }, note);
    });
    const editBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', disabled: purged || undefined, onClick: () => { modal.close(); openEdit(t); } }, 'แก้ไขข้อมูลแทนทีม');
    const delBtn = h('button', { type: 'button', class: 'btn btn-danger btn-sm' }, 'ลบทีม');
    delBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `ลบทีม ${t.ref_no}?`,
        message: `จะลบ “${t.name_th}” พร้อมสมาชิก อาจารย์ที่ปรึกษา ข้อความ และไฟล์ที่ส่งทั้งหมด (ไฟล์ย้ายไปถังขยะของ Drive) — ย้อนกลับไม่ได้ แนะนำให้สำรองข้อมูลก่อน`,
        confirmLabel: 'ลบทีมนี้',
        danger: true,
      });
      if (!ok) return;
      await runBusy(delBtn, 'กำลังลบ…', async () => {
        await ctx.call('admin_delete_team', { team_id: t.id });
        await done(`ลบทีม ${t.ref_no} แล้ว`);
      }, note);
    });

    const files = t.uploads.length
      ? t.uploads.map((u) =>
          h(
            'div',
            { class: 'person-line' },
            h('strong', u.slot_title || 'ไฟล์'),
            h('span', `${u.file_name} (${sizeText(u.size_bytes)}) · ${formatThaiDateTime(u.uploaded_at)}`),
            h('a', { href: u.view_url, target: '_blank', rel: 'noopener' }, 'เปิดดู'),
            h('a', { href: u.download_url, target: '_blank', rel: 'noopener' }, 'ดาวน์โหลด'),
          ),
        )
      : [h('p', { class: 'empty-note' }, 'ยังไม่มีไฟล์ที่ทีมส่ง')];
    const msgs = t.messages.length
      ? t.messages.map((m) => h('div', { class: `msg-item${m.read ? '' : ' is-new'}` }, h('div', { class: 'slip-small' }, `${formatThaiDateTime(m.created_at)}${m.read ? '' : ' · ยังไม่อ่าน'}`), h('div', { class: 'msg-body' }, m.body)))
      : [h('p', { class: 'empty-note' }, 'ไม่มีข้อความ')];
    const markBtn = unreadOf(t)
      ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: async () => { await ctx.call('admin_mark_read', { team_id: t.id }); await done('ทำเครื่องหมายว่าอ่านแล้ว'); } }, 'ทำเครื่องหมายว่าอ่านแล้ว')
      : null;

    const modal = openModal({
      title: `${t.ref_no} · ${t.name_th}`,
      body: h(
        'div',
        { class: 'admin-stack' },
        h('div', { class: 'status-top' }, h('div', null, h('div', { class: 'team-th' }, t.name_th), h('div', { class: 'team-en' }, t.name_en)), badge(st.text, st.cls)),
        h('p', { class: 'slip-small' }, `สมัครเมื่อ ${formatThaiDateTime(t.created_at)}`),
        h('h4', { class: 'sub-h' }, `สมาชิก ${t.members.length || t.members_count_at_purge || 0} คน`),
        t.members.map((m) => h('div', { class: 'person-line' }, h('strong', `${m.order_no}. ${m.full_name}`), h('span', m.student_id), h('span', m.phone))),
        h('h4', { class: 'sub-h' }, 'อาจารย์ที่ปรึกษา'),
        t.advisors.map((a) => h('div', { class: 'person-line' }, `${a.full_name} · ${a.department} · ${a.faculty}`)),
        h('h4', { class: 'sub-h' }, 'ไฟล์ที่ทีมส่ง'),
        files,
        h('h4', { class: 'sub-h' }, 'ข้อความถึงคณะกรรมการ'),
        msgs,
        markBtn,
        h('h4', { class: 'sub-h' }, 'การจัดการ'),
        note.el,
        h('div', { class: 'action-row' }, statusBtn, editBtn, delBtn),
        pinField.el,
        h('div', { class: 'action-row' }, pinBtn),
      ),
    });
  }

  // ───────────── edit on behalf ─────────────
  function openEdit(t) {
    const max = data.edition.max_members;
    const state = {
      nameTh: t.name_th,
      nameEn: t.name_en,
      members: t.members.map((m) => ({ ...m })),
      advisors: t.advisors.map((a) => ({ ...a })),
    };
    const note = notice();
    const th = textField({ label: 'ชื่อทีม (ภาษาไทย)', value: state.nameTh, maxlength: 120 });
    const en = textField({ label: 'ชื่อทีม (ภาษาอังกฤษ)', value: state.nameEn, maxlength: 120 });
    th.input.addEventListener('input', () => { state.nameTh = th.input.value; });
    en.input.addEventListener('input', () => { state.nameEn = en.input.value; });
    const membersBox = h('div', { class: 'admin-stack' });
    const advisorsBox = h('div', { class: 'admin-stack' });

    function paintMembers() {
      membersBox.replaceChildren(
        ...state.members.map((m, i) => {
          const id = textField({ label: `รหัสนักศึกษา ${i + 1}`, value: m.student_id, inputmode: 'numeric', maxlength: 13 });
          const name = textField({ label: 'ชื่อ-นามสกุล', value: m.full_name, maxlength: 120 });
          const phone = textField({ label: 'เบอร์โทร', value: m.phone, inputmode: 'numeric', maxlength: 10 });
          id.input.addEventListener('input', () => { id.input.value = digitsOnly(id.input.value, 13); m.student_id = id.input.value; });
          phone.input.addEventListener('input', () => { phone.input.value = digitsOnly(phone.input.value, 10); m.phone = phone.input.value; });
          name.input.addEventListener('input', () => { m.full_name = name.input.value; });
          const del = state.members.length > 1 ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { state.members.splice(i, 1); paintMembers(); } }, 'ลบสมาชิกคนนี้') : null;
          return h('div', { class: 'item-card' }, h('div', { class: 'fields' }, id.el, name.el, phone.el), del);
        }),
        state.members.length < max ? h('button', { type: 'button', class: 'btn btn-outline btn-add btn-sm', onClick: () => { state.members.push({ student_id: '', full_name: '', phone: '' }); paintMembers(); } }, `+ เพิ่มสมาชิก (สูงสุด ${max})`) : null,
      );
    }
    function paintAdvisors() {
      advisorsBox.replaceChildren(
        ...state.advisors.map((a, i) => {
          const name = textField({ label: `อาจารย์ที่ปรึกษา ${i + 1}`, value: a.full_name, maxlength: 120 });
          const dep = textField({ label: 'สาขา/ภาควิชา', value: a.department, maxlength: 120 });
          const fac = textField({ label: 'คณะ', value: a.faculty, maxlength: 120 });
          name.input.addEventListener('input', () => { a.full_name = name.input.value; });
          dep.input.addEventListener('input', () => { a.department = dep.input.value; });
          fac.input.addEventListener('input', () => { a.faculty = fac.input.value; });
          const del = state.advisors.length > 1 ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { state.advisors.splice(i, 1); paintAdvisors(); } }, 'ลบท่านนี้') : null;
          return h('div', { class: 'item-card' }, h('div', { class: 'fields' }, name.el, dep.el, fac.el), del);
        }),
        h('button', { type: 'button', class: 'btn btn-outline btn-add btn-sm', onClick: () => { state.advisors.push({ full_name: '', department: '', faculty: '' }); paintAdvisors(); } }, '+ เพิ่มอาจารย์ที่ปรึกษา'),
      );
    }
    paintMembers();
    paintAdvisors();

    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'บันทึกการแก้ไข');
    save.addEventListener('click', () => {
      const ids = state.members.map((m) => m.student_id);
      if (!state.nameTh.trim() || !nameKey(state.nameEn)) return note.show('err', 'กรอกชื่อทีมทั้งภาษาไทยและอังกฤษ');
      if (state.members.some((m) => !isStudentId(m.student_id) || !m.full_name.trim() || !isPhone(m.phone))) return note.show('err', 'ข้อมูลสมาชิกไม่ครบ/ไม่ถูกต้อง (รหัส 13 หลัก, เบอร์ 10 หลักขึ้นต้น 0)');
      if (new Set(ids).size !== ids.length) return note.show('err', 'มีรหัสนักศึกษาซ้ำกันในทีม');
      if (state.advisors.some((a) => !a.full_name.trim() || !a.department.trim() || !a.faculty.trim())) return note.show('err', 'ข้อมูลอาจารย์ที่ปรึกษาไม่ครบ');
      return runBusy(save, 'กำลังบันทึก…', async () => {
        await ctx.call('admin_update_team', {
          team_id: t.id, name_th: state.nameTh, name_en: state.nameEn,
          members: state.members.map((m) => ({ student_id: m.student_id, full_name: m.full_name, phone: m.phone })),
          advisors: state.advisors.map((a) => ({ full_name: a.full_name, department: a.department, faculty: a.faculty })),
        });
        modal.close();
        await load();
        banner.show('ok', `แก้ไขข้อมูลทีม ${t.ref_no} แล้ว`);
      }, note);
    });
    const cancel = h('button', { type: 'button', class: 'btn btn-outline', onClick: () => modal.close() }, 'ยกเลิก');
    const modal = openModal({
      title: `แก้ไขข้อมูลทีม ${t.ref_no}`,
      body: h('div', { class: 'admin-stack' }, h('div', { class: 'fields' }, th.el, en.el), h('h4', { class: 'sub-h' }, 'สมาชิก'), membersBox, h('h4', { class: 'sub-h' }, 'อาจารย์ที่ปรึกษา'), advisorsBox, note.el),
      actions: [cancel, save],
    });
  }

  await load();
}
