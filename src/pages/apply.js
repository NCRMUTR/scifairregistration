// #/apply — application form -> summary modal -> Confirm (action submit_team) -> success view + slip PNG.
// Business rules are enforced by the server (gas/Apply.gs); everything here only helps the user early.
import { h } from '../lib/dom.js';
import { api, messageFor } from '../lib/api.js';
import { loadSite, setting, invalidateSite } from '../lib/site.js';
import { mountShell, renderLoadError } from '../lib/layout.js';
import { openModal } from '../lib/modal.js';
import { formatThaiDateTime } from '../lib/format.js';
import { digitsOnly, isStudentId, validateForm, buildSubmitPayload } from '../lib/validators.js';

let keySeq = 0;
const newMember = () => ({ key: ++keySeq, id: '', name: '', phone: '' });
const newAdvisor = () => ({ key: ++keySeq, name: '', major: '', faculty: '' });

function setMsg(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function field(id, label, input, ...extra) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, ...extra);
}

// ───────────── slip (summary in the modal AND the picture that is saved as PNG) ─────────────
function buildSlip(form, edition, result) {
  const members = form.members;
  return h(
    'div',
    { class: 'slip' },
    h(
      'div',
      { class: 'slip-top' },
      h(
        'div',
        h('div', { class: 'slip-small' }, `ใบสรุปการสมัคร · ${edition.title}`),
        result ? h('div', { class: 'slip-ref' }, `เลขที่ใบสมัคร ${result.ref_no} · ${formatThaiDateTime(result.created_at)}`) : null,
        h('div', { class: 'slip-title' }, form.teamTh.trim()),
        h('div', { class: 'slip-sub' }, form.teamEn.trim()),
      ),
      h('div', { class: 'slip-badge' }, 'รอ admin ตรวจสอบ'),
    ),
    h('div', { class: 'slip-label' }, `สมาชิก ${members.length} คน`),
    members.map((m, i) => h('div', { class: 'slip-line' }, h('span', { class: 'slip-label' }, `${i + 1}. ${m.name.trim()}`), h('span', m.id), h('span', m.phone))),
    h('div', { class: 'slip-label' }, 'อาจารย์ที่ปรึกษา'),
    form.advisors.map((a) => h('div', { class: 'slip-line' }, `${a.name.trim()} · สาขา${a.major.trim()} · คณะ${a.faculty.trim()}`)),
    h(
      'div',
      { class: 'slip-pin' },
      h('div', { class: 'slip-small' }, 'PIN ของทีม'),
      h('div', { class: 'slip-pin-value' }, form.pin),
      h('div', { class: 'slip-small' }, 'เก็บภาพนี้เป็นความลับ — ใช้ตรวจสอบการสมัครคู่กับชื่อทีมภาษาอังกฤษ'),
    ),
  );
}

async function slipToPng(slipEl, fileName) {
  const { default: html2canvas } = await import('html2canvas'); // loaded only when needed
  await document.fonts?.ready;
  const canvas = await html2canvas(slipEl, { scale: 2, backgroundColor: '#ffffff' });
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

const safeName = (s) => s.trim().replace(/[^A-Za-z0-9ก-๙_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';

// ───────────── page ─────────────
export async function render(root) {
  let site;
  try {
    site = await loadSite({ force: true }); // always fresh: registration may have just opened or closed
  } catch (err) {
    renderLoadError(root, err, () => render(root));
    return;
  }

  const ed = site.edition;
  const siteName = setting(site, 'site_name', 'Sci-Tech Pitching');
  document.title = `สมัครเข้าร่วมประกวด — ${ed?.title ?? siteName}`;
  const main = mountShell(root, { site });

  if (!ed || !ed.registration_open) {
    main.append(
      h(
        'div',
        { class: 'notice' },
        h(
          'div',
          { class: 'card' },
          h('h1', 'สมัครเข้าร่วมประกวด'),
          h('p', { role: 'status' }, ed ? 'ปิดรับสมัครแล้ว' : 'ยังไม่มีรอบการจัดงานที่เปิดใช้งาน'),
          h('a', { class: 'btn btn-outline', href: '#/' }, 'กลับหน้าหลัก'),
        ),
      ),
    );
    return;
  }

  const maxMembers = ed.max_members;
  const state = { teamTh: '', teamEn: '', members: [newMember()], advisors: [newAdvisor()], pin: '', pin2: '', ack: false, pdpa: false };

  // live duplicate check: id -> 'pending' | 'free' | 'taken' | 'error'
  const idStatus = new Map();
  const inflight = new Set();
  const timers = new Map();
  const memberRefs = new Map();
  let submitting = false;
  let maybeSubmitted = false; // a previous Confirm ended with an unknown result (connection lost)

  const sets = () => ({
    takenIds: new Set([...idStatus].filter(([, s]) => s === 'taken').map(([id]) => id)),
    pendingIds: new Set([...idStatus].filter(([, s]) => s === 'pending').map(([id]) => id)),
  });

  // static elements
  const countEl = h('div', { class: 'panel-hint' });
  const membersBox = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const advisorsBox = h('div', { style: 'display:flex;flex-direction:column;gap:12px' });
  const pinMsg = h('p', { class: 'msg-err', id: 'pin-msg', hidden: true, 'aria-live': 'polite' });
  const blockMsg = h('p', { class: 'block-msg', 'aria-live': 'polite', hidden: true });
  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', disabled: true, onClick: () => openSummary() }, setting(site, 'submit_label', 'Submit'));
  const addMemberBtn = h('button', { type: 'button', class: 'btn btn-outline btn-add', onClick: () => addMember() }, '+ เพิ่มสมาชิก');

  function refresh() {
    const v = validateForm(state, sets());
    state.members.forEach((m, i) => {
      const r = memberRefs.get(m.key);
      if (!r) return;
      const mv = v.members[i];
      setMsg(r.idMsg, mv.idMsg);
      r.idInput.setAttribute('aria-invalid', mv.idMsg ? 'true' : 'false');
      r.idOk.hidden = !(isStudentId(m.id) && !mv.idMsg && idStatus.get(m.id) === 'free');
      setMsg(r.phoneMsg, mv.phoneMsg);
      r.phoneInput.setAttribute('aria-invalid', mv.phoneMsg ? 'true' : 'false');
    });
    setMsg(pinMsg, v.pinMsg);
    setMsg(blockMsg, v.blockMsg ? `ยังส่งไม่ได้: ${v.blockMsg}` : '');
    submitBtn.disabled = !v.ok;
    countEl.textContent = `ไม่เกิน ${maxMembers} คน — ตอนนี้ ${state.members.length} คน`;
    addMemberBtn.hidden = state.members.length >= maxMembers;
  }

  // ── live duplicate check (debounced) ──
  async function checkId(id) {
    inflight.add(id);
    try {
      const res = await api('student_id_taken', { id }, { retry: 1 });
      idStatus.set(id, res.taken ? 'taken' : 'free');
    } catch {
      idStatus.set(id, 'error'); // unknown: do not block; the server decides at Confirm
    } finally {
      inflight.delete(id);
    }
    refresh();
  }

  function onIdChanged(m) {
    clearTimeout(timers.get(m.key));
    const prev = m.pendingId;
    if (prev && !inflight.has(prev) && idStatus.get(prev) === 'pending') idStatus.delete(prev);
    m.pendingId = null;
    if (!isStudentId(m.id)) return refresh();
    const known = idStatus.get(m.id);
    if (known === 'free' || known === 'taken' || known === 'pending') return refresh();
    idStatus.set(m.id, 'pending');
    m.pendingId = m.id;
    timers.set(m.key, setTimeout(() => checkId(m.id), 400));
    refresh();
  }

  function recheckAll() {
    for (const m of state.members) {
      if (isStudentId(m.id)) idStatus.delete(m.id);
    }
    for (const m of state.members) {
      if (isStudentId(m.id) && !idStatus.has(m.id)) {
        idStatus.set(m.id, 'pending');
        checkId(m.id);
      }
    }
    refresh();
  }

  // ── members ──
  function memberCard(m, i) {
    const idId = `m${m.key}-id`;
    const phoneId = `m${m.key}-phone`;
    const idInput = h('input', { class: 'inp', id: idId, type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 13, value: m.id, 'aria-describedby': `${idId}-msg ${idId}-ok` });
    const idMsg = h('p', { class: 'msg-err', id: `${idId}-msg`, hidden: true, 'aria-live': 'polite' });
    const idOk = h('p', { class: 'msg-ok', id: `${idId}-ok`, hidden: true }, 'รหัสนี้ใช้สมัครได้');
    const nameInput = h('input', { class: 'inp', id: `m${m.key}-name`, type: 'text', autocomplete: 'off', maxlength: 120, value: m.name });
    const phoneInput = h('input', { class: 'inp', id: phoneId, type: 'tel', inputmode: 'numeric', autocomplete: 'off', maxlength: 10, value: m.phone, 'aria-describedby': `${phoneId}-msg` });
    const phoneMsg = h('p', { class: 'msg-err', id: `${phoneId}-msg`, hidden: true });

    idInput.addEventListener('input', () => {
      const v = digitsOnly(idInput.value, 13);
      if (v !== idInput.value) idInput.value = v;
      m.id = v;
      onIdChanged(m);
    });
    nameInput.addEventListener('input', () => {
      m.name = nameInput.value;
      refresh();
    });
    phoneInput.addEventListener('input', () => {
      const v = digitsOnly(phoneInput.value, 10);
      if (v !== phoneInput.value) phoneInput.value = v;
      m.phone = v;
      refresh();
    });

    memberRefs.set(m.key, { idInput, idMsg, idOk, phoneInput, phoneMsg });
    return h(
      'div',
      { class: 'item-card', role: 'group', 'aria-label': `สมาชิกคนที่ ${i + 1}` },
      h(
        'div',
        { class: 'item-head' },
        h('span', `สมาชิกคนที่ ${i + 1}`),
        state.members.length > 1
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `ลบสมาชิกคนที่ ${i + 1}`, onClick: () => removeMember(i) }, 'ลบ')
          : null,
      ),
      h(
        'div',
        { class: 'fields' },
        field(idId, 'รหัสนักศึกษา (13 หลัก)', idInput, idMsg, idOk),
        field(`m${m.key}-name`, 'ชื่อ-สกุล', nameInput),
        field(phoneId, 'เบอร์โทรติดต่อ', phoneInput, phoneMsg),
      ),
    );
  }

  function renderMembers() {
    memberRefs.clear();
    membersBox.replaceChildren(...state.members.map(memberCard));
    refresh();
  }

  function addMember() {
    if (state.members.length >= maxMembers) return;
    const m = newMember();
    state.members.push(m);
    renderMembers();
    memberRefs.get(m.key).idInput.focus();
  }

  function removeMember(i) {
    const [gone] = state.members.splice(i, 1);
    clearTimeout(timers.get(gone.key));
    renderMembers();
    (membersBox.querySelectorAll('input')[0] ?? addMemberBtn).focus();
  }

  // ── advisors ──
  function advisorCard(a, i) {
    const mk = (key, label, max = 120) => {
      const id = `a${a.key}-${key}`;
      const input = h('input', { class: 'inp', id, type: 'text', autocomplete: 'off', maxlength: max, value: a[key] });
      input.addEventListener('input', () => {
        a[key] = input.value;
        refresh();
      });
      return field(id, label, input);
    };
    return h(
      'div',
      { class: 'item-card', role: 'group', 'aria-label': `อาจารย์ที่ปรึกษาท่านที่ ${i + 1}` },
      h(
        'div',
        { class: 'item-head' },
        h('span', `อาจารย์ท่านที่ ${i + 1}`),
        state.advisors.length > 1
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `ลบอาจารย์ท่านที่ ${i + 1}`, onClick: () => removeAdvisor(i) }, 'ลบ')
          : null,
      ),
      h('div', { class: 'fields' }, mk('name', 'ชื่อ-สกุล'), mk('major', 'สาขา'), mk('faculty', 'คณะ')),
    );
  }

  function renderAdvisors() {
    advisorsBox.replaceChildren(...state.advisors.map(advisorCard));
    refresh();
  }

  function removeAdvisor(i) {
    state.advisors.splice(i, 1);
    renderAdvisors();
    (advisorsBox.querySelector('input') ?? addAdvisorBtn).focus();
  }

  const addAdvisorBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-outline btn-add',
      onClick: () => {
        const a = newAdvisor();
        state.advisors.push(a);
        renderAdvisors();
        document.getElementById(`a${a.key}-name`).focus();
      },
    },
    '+ เพิ่มอาจารย์ที่ปรึกษา',
  );

  // ── team / PIN / consent inputs ──
  const bindText = (id, label, key, help) => {
    const input = h('input', { class: 'inp', id, type: 'text', autocomplete: 'off', maxlength: 120 });
    input.addEventListener('input', () => {
      state[key] = input.value;
      refresh();
    });
    return field(id, label, input, help ? h('span', { class: 'help' }, help) : null);
  };
  const pinField = (id, label, key) => {
    const input = h('input', { class: 'inp pin', id, type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 4, 'aria-describedby': 'pin-msg' });
    input.addEventListener('input', () => {
      const v = digitsOnly(input.value, 4);
      if (v !== input.value) input.value = v;
      state[key] = v;
      refresh();
    });
    return h('div', { class: 'field narrow' }, h('label', { for: id }, label), input);
  };
  const checkbox = (key, text) => {
    const input = h('input', { class: 'chk', type: 'checkbox' });
    input.addEventListener('change', () => {
      state[key] = input.checked;
      refresh();
    });
    return h('label', { class: 'chk-row' }, input, h('span', text));
  };

  // ── summary modal -> Confirm ──
  function openSummary() {
    if (submitting) return;
    if (!validateForm(state, sets()).ok) return;
    const slip = buildSlip(state, ed, null);
    const errBox = h('div', { class: 'banner-err', role: 'alert', hidden: true });
    const editBtn = h('button', { type: 'button', class: 'btn btn-outline', onClick: () => modal.close() }, 'กลับไปแก้ไข');
    const confirmBtn = h('button', { type: 'button', class: 'btn btn-primary', onClick: () => confirm() }, 'Confirm');
    const modal = openModal({
      title: 'ตรวจสอบใบสรุปก่อนยืนยัน',
      body: [slip, errBox, h('p', { class: 'hint' }, 'กด Confirm แล้วระบบบันทึกใบสมัครและดาวน์โหลดภาพใบสรุปทันที')],
      actions: [editBtn, confirmBtn],
    });

    async function confirm() {
      if (submitting) return;
      submitting = true;
      editBtn.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'กำลังบันทึก…';
      errBox.hidden = true;
      try {
        // Never retried automatically: a lost reply must not create a second application.
        const result = await api('submit_team', buildSubmitPayload(state));
        submitting = false;
        invalidateSite();
        modal.close();
        showSuccess(result);
      } catch (err) {
        submitting = false;
        editBtn.disabled = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm';
        const unknown = err.reason === 'network' || err.reason === 'bad_response';
        if (unknown) maybeSubmitted = true;
        const note =
          unknown || (maybeSubmitted && (err.reason === 'student_id_taken' || err.reason === 'team_name_taken'))
            ? ' ใบสมัครอาจถูกบันทึกไปแล้ว (เช่น เน็ตหลุดหลังกด Confirm) ก่อนส่งซ้ำให้ตรวจสอบที่หน้า '
            : '';
        errBox.replaceChildren(messageFor(err));
        if (note) errBox.append(note, h('a', { href: '#/status' }, 'ตรวจสอบการสมัคร'), ' ด้วยชื่อทีมภาษาอังกฤษและ PIN');
        errBox.hidden = false;
        if (err.reason === 'student_id_taken') recheckAll();
        if (err.reason === 'registration_closed') invalidateSite();
      }
    }
  }

  // ── success view (replaces the form; the slip is saved as PNG) ──
  function showSuccess(result) {
    const fileName = `ใบสมัคร-${result.ref_no}-${safeName(state.teamEn)}.png`;
    const slip = buildSlip(state, ed, result);
    const banner = h('div', { class: 'banner-ok', role: 'status' }, 'ส่งใบสมัครเรียบร้อย — กำลังสร้างภาพใบสรุป…');
    const saveBtn = h('button', { type: 'button', class: 'btn btn-outline', onClick: () => save(true) }, 'บันทึกภาพอีกครั้ง');

    async function save(manual) {
      saveBtn.disabled = true;
      try {
        await new Promise((r) => setTimeout(r, 150)); // let the slip paint first (a timer, not rAF: rAF never fires in a background tab)
        await slipToPng(slip, fileName);
        banner.className = 'banner-ok';
        banner.textContent = `ส่งใบสมัครเรียบร้อย — ดาวน์โหลดใบสรุปลงอุปกรณ์แล้ว (${fileName})`;
      } catch (err) {
        console.error(err);
        banner.className = 'banner-warn';
        banner.textContent = 'ส่งใบสมัครเรียบร้อยแล้ว แต่ยังดาวน์โหลดภาพอัตโนมัติไม่ได้ (พบบน iPhone/Safari) — กดปุ่ม "บันทึกภาพอีกครั้ง" หรือแคปหน้าจอใบสรุปนี้ไว้';
      } finally {
        saveBtn.disabled = false;
        if (manual) saveBtn.focus();
      }
    }

    main.replaceChildren(
      h(
        'div',
        { class: 'form-page' },
        h('h1', { tabindex: '-1', id: 'success-title' }, 'ส่งใบสมัครเรียบร้อย'),
        banner,
        slip,
        h('div', { class: 'action-row' }, saveBtn, h('a', { class: 'btn btn-primary', href: '#/status' }, 'ไปหน้าตรวจสอบการสมัคร')),
        h('p', { class: 'panel-hint' }, 'เก็บ PIN ไว้เป็นความลับ ใช้ตรวจสอบสถานะและส่งเอกสารเพิ่มเติมคู่กับชื่อทีมภาษาอังกฤษ'),
      ),
    );
    window.scrollTo(0, 0);
    document.getElementById('success-title')?.focus();
    save(false);
  }

  // ── assemble the form ──
  main.append(
    h(
      'div',
      { class: 'form-page' },
      h('h1', 'สมัครเข้าร่วมประกวด'),
      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-team' },
        h('h2', { id: 'sec-team' }, '1. ข้อมูลทีม'),
        h(
          'div',
          { class: 'fields' },
          bindText('team-th', 'ชื่อทีม (ภาษาไทย)', 'teamTh'),
          bindText('team-en', 'ชื่อทีม (ภาษาอังกฤษ)', 'teamEn', 'ใช้ชื่อนี้ตรวจสอบการสมัครภายหลัง — ห้ามซ้ำกับทีมอื่น'),
        ),
      ),
      h('section', { class: 'panel', 'aria-labelledby': 'sec-members' }, h('div', { class: 'panel-head' }, h('h2', { id: 'sec-members' }, '2. สมาชิกทีม'), countEl), membersBox, addMemberBtn),
      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-advisors' },
        h('div', { class: 'panel-head' }, h('h2', { id: 'sec-advisors' }, '3. อาจารย์ที่ปรึกษา'), h('div', { class: 'panel-hint' }, 'ไม่จำกัดจำนวน — อย่างน้อย 1 ท่าน')),
        advisorsBox,
        addAdvisorBtn,
      ),
      h(
        'section',
        { class: 'panel', 'aria-labelledby': 'sec-pin' },
        h('h2', { id: 'sec-pin' }, '4. รหัส PIN 4 หลัก'),
        h('div', { class: 'panel-hint' }, 'ใช้คู่กับชื่อทีมภาษาอังกฤษเพื่อตรวจสอบการสมัคร ส่งเอกสารเพิ่มเติม และติดต่อคณะกรรมการ — โปรดจำไว้ หากลืมต้องติดต่อ admin เพื่อรีเซ็ต'),
        h('div', { class: 'fields' }, pinField('pin', 'PIN', 'pin'), pinField('pin2', 'ยืนยัน PIN อีกครั้ง', 'pin2')),
        pinMsg,
      ),
      h(
        'section',
        { class: 'panel', 'aria-label': 'การรับทราบและความยินยอม' },
        checkbox('ack', ed.ack_text || 'ข้าพเจ้าได้อ่านรายละเอียดโครงการและเงื่อนไขการประกวดแล้ว และเข้าใจครบถ้วน'),
        checkbox('pdpa', ed.pdpa_text || 'ข้าพเจ้ายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลของทีมเพื่อการคัดเลือก ติดต่อ และดำเนินการประกวดนี้'),
      ),
      h('div', { class: 'submit-area' }, blockMsg, submitBtn),
    ),
  );
  renderMembers();
  renderAdvisors();

  return () => {
    for (const t of timers.values()) clearTimeout(t);
  };
}
