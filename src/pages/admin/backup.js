// Tab 7 — สำรอง/รีเซ็ต: back up one year's participant data to the private Drive folder, then (optionally) reset it.
// Every guard is enforced by the server (gas/Backup.gs). The checklist here only mirrors them so the button stays
// disabled until they look satisfied — it never replaces them.
import { h, append } from '../../lib/dom.js';
import { adminApi, setSession } from '../../lib/adminApi.js';
import { formatThaiDateTime } from '../../lib/format.js';
import { selectField, notice, runBusy, badge, confirmDialog } from '../../lib/ui.js';

const DAY_MS = 24 * 3600 * 1000;

const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB`);
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export async function render(body, ctx) {
  const editions = (await ctx.call('admin_editions')).editions;
  let editionId = (editions.find((e) => e.is_current) ?? editions[0])?.id;
  if (!editionId) {
    body.append(h('h2', 'สำรอง/รีเซ็ตข้อมูล'), h('div', { class: 'panel' }, h('p', 'ยังไม่มีรอบการจัดงาน')));
    return;
  }
  const root = h('div', { class: 'admin-stack' });
  body.append(h('h2', 'สำรอง/รีเซ็ตข้อมูล'), root);
  let timer = null;
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  async function load() {
    stopTimer();
    const data = await ctx.call('admin_backups', { edition_id: editionId });
    paint(data, Date.now());
  }

  function paint(data, fetchedAt) {
    const e = data.edition;
    const serverNow = () => new Date(data.server_time).getTime() + (Date.now() - fetchedAt);
    const loginAge = () => serverNow() - new Date(data.logged_in_at).getTime();
    const loginLimit = data.login_max_age_sec * 1000;
    const backupAt = e.last_backup_at ? new Date(e.last_backup_at).getTime() : null;

    const picker = selectField({ label: 'ปีที่ต้องการสำรอง/รีเซ็ต', options: editions.map((x) => ({ value: x.id, label: `${x.year}${x.is_current ? ' (ปัจจุบัน)' : ''}${x.purged_at ? ' — รีเซ็ตแล้ว' : ''}` })), value: editionId });
    picker.input.addEventListener('change', async () => {
      editionId = picker.input.value;
      try {
        await load();
      } catch (err) {
        root.replaceChildren(h('div', { class: 'banner-err', role: 'alert' }, 'โหลดไม่สำเร็จ'));
      }
    });

    // ───────── status ─────────
    const c = data.counts;
    const statusPanel = h(
      'section',
      { class: 'panel' },
      h('h3', `ข้อมูลของปี ${e.year}`),
      picker.el,
      h('div', { class: 'stats' }, ...[['ทีม', c.teams], ['สมาชิก', c.members], ['อาจารย์ที่ปรึกษา', c.advisors], ['ข้อความถึงกรรมการ', c.messages], ['ไฟล์ที่ทีมส่ง', c.uploads]].map(([l, v]) => h('div', { class: 'stat stat-plain' }, h('div', { class: 'stat-label' }, l), h('div', { class: 'stat-value' }, String(v))))),
      c.uploads ? h('p', { class: 'panel-hint' }, `ไฟล์รวมประมาณ ${formatSize(data.files_bytes)}`) : null,
      e.purged_at ? h('div', { class: 'banner-warn' }, `ข้อมูลผู้เข้าร่วมของปีนี้ถูกรีเซ็ตแล้วเมื่อ ${formatThaiDateTime(e.purged_at)} (${e.purge_mode === 'delete' ? 'ลบทั้งหมด' : 'ทำให้ไม่ระบุตัวตน'})`) : null,
    );

    // ───────── backup ─────────
    const backupNote = notice();
    const backupResult = h('div');
    const backupBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'สำรองข้อมูลตอนนี้');
    backupBtn.addEventListener('click', () =>
      runBusy(
        backupBtn,
        'กำลังสำรอง… (ห้ามปิดหน้านี้ อาจใช้เวลาหลายนาทีถ้ามีไฟล์มาก)',
        async () => {
          const res = await ctx.call('admin_backup', { edition_id: editionId });
          await load();
          // load() rebuilt the page; show the result on the fresh one
          const box = root.querySelector('[data-backup-result]');
          box?.replaceChildren(
            h(
              'div',
              { class: 'banner-ok', role: 'status' },
              `สำรองข้อมูลสำเร็จ — ${res.counts.teams} ทีม, ${res.counts.members} สมาชิก, ไฟล์ ${res.files.count} ไฟล์ (${formatSize(res.files.bytes)}, ${res.files.parts} ZIP)`,
              res.files.missing ? ` · ไม่พบไฟล์ใน Drive ${res.files.missing} ไฟล์` : '',
              ' ',
              h('a', { href: res.folder_url, target: '_blank', rel: 'noopener noreferrer' }, 'เปิดโฟลเดอร์สำรองใน Google Drive'),
            ),
          );
        },
        backupNote,
      ),
    );
    const backupState = !backupAt
      ? badge('ยังไม่เคยสำรอง', 'badge-pending')
      : data.backup_is_current && serverNow() - backupAt <= DAY_MS
        ? badge('สำรองแล้ว ตรงกับข้อมูลปัจจุบัน', 'badge-approved')
        : data.backup_is_current
          ? badge('สำรองเกิน 24 ชั่วโมงแล้ว', 'badge-pending')
          : badge('มีข้อมูลเปลี่ยนหลังการสำรอง', 'badge-pending');
    const backupPanel = h(
      'section',
      { class: 'panel' },
      h('h3', 'สำรองข้อมูล'),
      h('p', { class: 'panel-hint' }, 'สร้างโฟลเดอร์ในโฟลเดอร์ส่วนตัว "backups" บน Google Drive ของเจ้าของระบบ ประกอบด้วย สำเนา Spreadsheet, ไฟล์ CSV ของทีม/สมาชิก/อาจารย์/ความยินยอม/ข้อความ/ไฟล์ที่ส่ง และ ZIP ของไฟล์ที่ทีมส่ง ระบบไม่ส่งไฟล์สำรองไปที่อื่นเอง และไม่รวมภาพกิจกรรม'),
      h('div', { class: 'row-badges' }, backupState, backupAt ? h('span', { class: 'panel-hint' }, `ครั้งล่าสุด ${formatThaiDateTime(e.last_backup_at)}`) : null),
      h('div', { class: 'action-row' }, backupBtn),
      backupNote.el,
      h('div', { 'data-backup-result': '' }, backupResult),
      data.backups.length
        ? h(
            'details',
            h('summary', `ประวัติการสำรอง (${data.backups.length} ครั้งล่าสุด)`),
            h(
              'ul',
              { class: 'up-list' },
              data.backups.map((b) =>
                h(
                  'li',
                  { class: 'up-item' },
                  h('span', { class: 'up-name' }, `${formatThaiDateTime(b.at)} · ${b.admin}`),
                  h('span', `${b.counts.teams ?? 0} ทีม · ${b.counts.members ?? 0} สมาชิก${b.files ? ` · ไฟล์ ${b.files.count}` : ''}`),
                  b.folder_url ? h('a', { href: b.folder_url, target: '_blank', rel: 'noopener noreferrer' }, 'เปิดโฟลเดอร์') : null,
                ),
              ),
            ),
          )
        : null,
    );

    // ───────── reset ─────────
    const resetNote = notice();
    const resultBox = h('div');
    const mode = { value: 'anonymize' };
    const modeRadio = (value, title, text) => {
      const input = h('input', { type: 'radio', name: 'purge-mode', class: 'chk', value, checked: value === mode.value });
      input.addEventListener('change', () => {
        mode.value = value;
        refresh();
      });
      return h('label', { class: 'chk-row' }, input, h('span', h('strong', title), h('br'), text));
    };
    const confirmInput = h('input', { class: 'inp', type: 'text', id: 'purge-confirm', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: `PURGE ${e.year}` });
    const pwInput = h('input', { class: 'inp', type: 'password', id: 'purge-pw', autocomplete: 'current-password' });
    const totpInput = h('input', { class: 'inp pin', type: 'text', id: 'purge-totp', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, disabled: !data.totp });
    totpInput.addEventListener('input', () => {
      totpInput.value = totpInput.value.replace(/\D/g, '').slice(0, 6);
      refresh();
    });
    [confirmInput, pwInput].forEach((i) => i.addEventListener('input', () => refresh()));

    let running = false; // true while the purge request is in flight (the 1-second refresh must not re-enable the button)
    const resetBtn = h('button', { type: 'button', class: 'btn btn-danger btn-lg' }, 'รีเซ็ตข้อมูลของปี ' + e.year);
    const checklist = h('ul', { class: 'guard-list', 'aria-label': 'เงื่อนไขก่อนรีเซ็ต' });
    const timerText = h('span', { class: 'panel-hint', 'aria-live': 'off' });

    const guards = () => {
      const age = loginAge();
      const already = e.purged_at && (e.purge_mode === 'delete' || mode.value === 'anonymize');
      return [
        { ok: !already, text: already ? 'ปีนี้ถูกรีเซ็ตด้วยวิธีนี้แล้ว' : 'ยังไม่ได้รีเซ็ตด้วยวิธีนี้' },
        { ok: age <= loginLimit, text: age <= loginLimit ? `เข้าสู่ระบบภายใน ${loginLimit / 60000} นาที (เหลือ ${mmss(loginLimit - age)})` : `ต้องเข้าสู่ระบบใหม่ (ล็อกอินเกิน ${loginLimit / 60000} นาทีแล้ว)` },
        { ok: !!backupAt && serverNow() - backupAt <= DAY_MS, text: 'มีการสำรองข้อมูลภายใน 24 ชั่วโมง' },
        { ok: data.backup_is_current, text: 'ข้อมูลไม่เปลี่ยนไปหลังการสำรองครั้งล่าสุด' },
        { ok: confirmInput.value === `PURGE ${e.year}`, text: `พิมพ์ข้อความยืนยัน PURGE ${e.year}` },
        { ok: pwInput.value.length > 0, text: 'กรอกรหัสผ่านอีกครั้ง' },
        { ok: data.totp && /^\d{6}$/.test(totpInput.value), text: data.totp ? 'กรอกรหัส 6 หลักจากแอป Authenticator' : 'ยังไม่ได้ลงทะเบียน Authenticator' },
      ];
    };
    function refresh() {
      const gs = guards();
      checklist.replaceChildren(...gs.map((g) => h('li', { class: g.ok ? 'guard-ok' : 'guard-no' }, h('span', { 'aria-hidden': 'true' }, g.ok ? '✓ ' : '✗ '), g.text)));
      resetBtn.disabled = running || !gs.every((g) => g.ok);
      const age = loginAge();
      timerText.textContent = '';
      if (age > loginLimit) timerText.textContent = 'หมดเวลาแล้ว — ออกจากระบบและเข้าสู่ระบบใหม่เพื่อรีเซ็ต';
    }

    const relogin = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, 'ออกจากระบบเพื่อเข้าสู่ระบบใหม่');
    relogin.addEventListener('click', async () => {
      try {
        await adminApi('admin_logout');
      } catch {
        /* dropped locally anyway */
      }
      setSession(null);
      location.reload();
    });

    resetBtn.addEventListener('click', async () => {
      resultBox.replaceChildren();
      const label = mode.value === 'delete' ? 'ลบข้อมูลทั้งหมดของปีนี้ (ทีมและทุกอย่างหายไป)' : 'ทำให้ข้อมูลของปีนี้ไม่ระบุตัวตน (เก็บชื่อทีม เลขที่ใบสมัคร และสถานะ)';
      const yes = await confirmDialog({
        title: `ยืนยันรีเซ็ตปี ${e.year}`,
        message: `${label} ไฟล์ที่ทีมส่งจะถูกลบถาวร ไม่ผ่านถังขยะ และกู้คืนไม่ได้นอกจากจากไฟล์สำรอง ภาพกิจกรรมและการตั้งค่าของปีไม่ถูกแตะ`,
        confirmLabel: 'รีเซ็ตเดี๋ยวนี้',
        danger: true,
      });
      if (!yes) return;
      const payload = { edition_id: editionId, mode: mode.value, confirm: confirmInput.value, password: pwInput.value, totp: totpInput.value };
      pwInput.value = '';
      totpInput.value = ''; // a TOTP code is single-use: never leave it in the form
      running = true;
      await runBusy(
        resetBtn,
        'กำลังรีเซ็ต… (ห้ามปิดหน้านี้)',
        async () => {
          const res = await ctx.call('admin_purge', payload);
          await load();
          const box = root.querySelector('[data-purge-result]');
          const f = res.files;
          box?.replaceChildren(
            h(
              'div',
              { class: f.failed ? 'banner-warn' : 'banner-ok', role: 'status' },
              h('strong', 'รีเซ็ตเสร็จแล้ว'),
              h(
                'ul',
                { class: 'result-list' },
                res.mode === 'delete' ? h('li', `ลบทีม ${res.rows.teams ?? 0} ทีม`) : h('li', `ทำให้ไม่ระบุตัวตน ${res.teams_anonymized} ทีม`),
                h('li', `ลบสมาชิก ${res.rows.members} · อาจารย์ ${res.rows.advisors} · ความยินยอม ${res.rows.consents} · ข้อความ ${res.rows.messages} · รายการไฟล์ ${res.rows.uploads}`),
                h('li', `ลบไฟล์ใน Drive ถาวร ${f.removed} ไฟล์${f.already_gone ? ` (หายไปก่อนแล้ว ${f.already_gone})` : ''}${res.folder_removed ? ' และลบโฟลเดอร์ของปีนั้นแล้ว' : ''}`),
                f.failed ? h('li', { class: 'err-text' }, `ลบไฟล์ไม่สำเร็จ ${f.failed} รายการ — โฟลเดอร์ของปีนี้ยังอยู่ใน Drive ให้ลบด้วยมือ รหัสไฟล์: ${f.failed_ids.join(', ')}`) : null,
              ),
            ),
          );
        },
        resetNote,
      );
      running = false;
      refresh(); // the single-use code is gone: the guard list shows it again
    });

    const dangerPanel = h(
      'section',
      { class: 'panel panel-danger' },
      h('h3', `รีเซ็ตข้อมูลผู้เข้าร่วมของปี ${e.year}`),
      h('p', { class: 'panel-hint' }, 'ใช้เมื่อสิ้นสุดการประกวด เพื่อลบข้อมูลส่วนบุคคลตามนโยบาย PDPA ภาพกิจกรรม การตั้งค่าของปี นิยามช่องส่งไฟล์ และปีอื่นจะไม่ถูกแตะ — ถ้าข้อมูลเปลี่ยนหลังการสำรอง (เช่น มีทีมส่งไฟล์เพิ่ม) ต้องสำรองใหม่ก่อนรีเซ็ต'),
      e.registration_open ? h('div', { class: 'banner-warn' }, 'ปีนี้ยังเปิดรับสมัครอยู่ — ควรปิดรับสมัครที่แท็บ "ปี/รอบการจัด" ก่อนรีเซ็ต') : null,
      !data.totp
        ? h('div', { class: 'banner-warn' }, 'ต้องลงทะเบียนแอป Authenticator ก่อนจึงจะรีเซ็ตได้ ', h('button', { type: 'button', class: 'btn btn-outline btn-sm', onClick: () => ctx.go('account') }, 'ไปที่บัญชีของฉัน'))
        : null,
      h('h4', { class: 'step-h' }, 'ขั้นที่ 1 — เลือกวิธีรีเซ็ต'),
      h(
        'div',
        { class: 'admin-stack' },
        modeRadio('anonymize', 'ทำให้ไม่ระบุตัวตน (แนะนำ)', 'เก็บชื่อทีม เลขที่ใบสมัคร สถานะ และจำนวนสมาชิก ลบรหัสนักศึกษา ชื่อ เบอร์โทร อาจารย์ที่ปรึกษา ความยินยอม ข้อความ และไฟล์ที่ทีมส่ง PIN ใช้ไม่ได้อีก'),
        modeRadio('delete', 'ลบทั้งหมด', 'ลบทีมและข้อมูล/ไฟล์ทั้งหมดของปีนี้ — เลขที่ใบสมัครของปีนี้ไม่หลงเหลืออยู่ในระบบ'),
      ),
      h('h4', { class: 'step-h' }, 'ขั้นที่ 2 — พิมพ์ข้อความยืนยัน'),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'purge-confirm' }, 'พิมพ์ข้อความนี้ลงในช่องด้านล่างให้ตรงทุกตัวอักษร (ตัวพิมพ์ใหญ่ มีช่องว่าง 1 ช่อง):'),
        h('code', { class: 'confirm-code' }, `PURGE ${e.year}`),
        confirmInput,
      ),
      h('h4', { class: 'step-h' }, 'ขั้นที่ 3 — ยืนยันตัวตน'),
      h('div', { class: 'field' }, h('label', { for: 'purge-pw' }, 'รหัสผ่านของคุณ (กรอกซ้ำ)'), pwInput),
      h('div', { class: 'field narrow' }, h('label', { for: 'purge-totp' }, 'รหัส 6 หลักจากแอป Authenticator'), totpInput),
      h('h4', { class: 'step-h' }, 'ขั้นที่ 4 — ตรวจเงื่อนไขแล้วกดปุ่ม'),
      h('div', { class: 'guard-box' }, h('strong', 'เงื่อนไขที่ต้องผ่าน (ครบทุกข้อปุ่มจึงจะกดได้)'), checklist, timerText),
      resetNote.el,
      h('div', { class: 'action-row' }, resetBtn, relogin),
      h('div', { 'data-purge-result': '' }, resultBox),
    );

    root.replaceChildren();
    append(root, [statusPanel, backupPanel, dangerPanel]);
    refresh();
    // keep the login countdown honest
    timer = setInterval(() => {
      if (!root.isConnected || !document.body.contains(root)) return stopTimer();
      refresh();
    }, 1000);
  }

  await load();
}
