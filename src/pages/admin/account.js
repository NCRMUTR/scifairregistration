// "บัญชีของฉัน": change password, register the authenticator app (2FA) that confirms the dangerous reset.
import { h } from '../../lib/dom.js';
import { textField, notice, runBusy } from '../../lib/ui.js';

export async function render(body, ctx) {
  let me = await ctx.call('admin_me');
  const wrap = h('div', { class: 'admin-stack' });
  body.append(h('h2', 'บัญชีของฉัน'), h('p', { class: 'panel-hint' }, `เข้าสู่ระบบในชื่อ ${me.id}`), wrap);

  // ── password ──
  const pw = {
    old: textField({ label: 'รหัสผ่านปัจจุบัน', type: 'password' }),
    next: textField({ label: 'รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)', type: 'password' }),
    again: textField({ label: 'ยืนยันรหัสผ่านใหม่', type: 'password' }),
  };
  const pwNote = notice();
  const pwBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'เปลี่ยนรหัสผ่าน');
  pwBtn.addEventListener('click', async () => {
    if (pw.next.input.value.length < 12) return pwNote.show('err', 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 12 ตัวอักษร');
    if (pw.next.input.value !== pw.again.input.value) return pwNote.show('err', 'รหัสผ่านใหม่สองช่องไม่ตรงกัน');
    await runBusy(
      pwBtn,
      'กำลังบันทึก…',
      async () => {
        await ctx.call('admin_change_password', { password: pw.old.input.value, new_password: pw.next.input.value });
        [pw.old, pw.next, pw.again].forEach((f) => (f.input.value = ''));
        pwNote.show('ok', 'เปลี่ยนรหัสผ่านแล้ว');
      },
      pwNote,
    );
  });

  // ── 2FA ──
  const twoFa = h('section', { class: 'panel' });
  function paintTwoFa() {
    twoFa.replaceChildren(h('h2', 'ยืนยันตัวตน 2 ขั้นตอน (Authenticator)'));
    twoFa.append(
      h('p', { class: me.totp ? 'ok-text' : 'warn-text', style: 'font-weight:600' }, me.totp ? 'ลงทะเบียนแล้ว' : 'ยังไม่ได้ลงทะเบียน — จำเป็นก่อนรีเซ็ตข้อมูล'),
      h('p', { class: 'panel-hint' }, 'ใช้ยืนยันเฉพาะการรีเซ็ตข้อมูลผู้เข้าร่วม (ไม่ต้องใช้ตอนเข้าสู่ระบบ) ใช้แอป Google Authenticator, Microsoft Authenticator หรือ Authy'),
    );
    const start = textField({
      label: me.totp ? 'รหัสผ่านปัจจุบัน (เพื่อลงทะเบียนใหม่ — ของเดิมจะใช้ไม่ได้หลังยืนยัน)' : 'รหัสผ่านปัจจุบัน (เพื่อเริ่มลงทะเบียน)',
      type: 'password',
    });
    const note = notice();
    const btn = h('button', { type: 'button', class: 'btn btn-outline btn-add' }, me.totp ? 'ลงทะเบียนใหม่' : 'เริ่มลงทะเบียน');
    const stage = h('div', { class: 'admin-stack' });
    btn.addEventListener('click', () =>
      runBusy(
        btn,
        'กำลังสร้างรหัส…',
        async () => {
          const { secret, uri } = await ctx.call('admin_totp_begin', { password: start.input.value });
          start.input.value = '';
          const code = textField({ label: 'รหัส 6 หลักจากแอป', inputmode: 'numeric', maxlength: 6, narrow: true });
          const confirmNote = notice();
          const confirmBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'ยืนยัน');
          confirmBtn.addEventListener('click', () =>
            runBusy(
              confirmBtn,
              'กำลังตรวจ…',
              async () => {
                await ctx.call('admin_totp_confirm', { code: code.input.value.replace(/\D/g, '') });
                me = { ...me, totp: true };
                paintTwoFa();
              },
              confirmNote,
            ),
          );
          stage.replaceChildren(
            h(
              'ol',
              { class: 'steps' },
              h('li', 'เปิดแอป Authenticator แล้วเลือก "เพิ่มบัญชี" → "ป้อนรหัสด้วยตนเอง"'),
              h('li', 'ตั้งชื่อบัญชีเป็นอะไรก็ได้ แล้วกรอกรหัสลับด้านล่าง (ประเภทตามเวลา / Time based)'),
            ),
            h('div', { class: 'secret-box', 'aria-label': 'รหัสลับสำหรับแอป Authenticator' }, secret.replace(/(.{4})/g, '$1 ').trim()),
            h('p', { class: 'slip-small' }, 'รหัสลับนี้แสดงครั้งเดียว อย่าเก็บในที่สาธารณะ — ใช้ได้ 10 นาที'),
            h('a', { href: uri, class: 'btn btn-ghost btn-sm' }, 'เปิดในแอป Authenticator (บนมือถือ)'),
            code.el,
            confirmNote.el,
            h('div', { class: 'action-row' }, confirmBtn),
          );
          code.input.focus();
        },
        note,
      ),
    );
    twoFa.append(start.el, note.el, h('div', { class: 'action-row' }, btn), stage);
  }
  paintTwoFa();

  wrap.append(h('section', { class: 'panel' }, h('h2', 'เปลี่ยนรหัสผ่าน'), pw.old.el, pw.next.el, pw.again.el, pwNote.el, h('div', { class: 'action-row' }, pwBtn)), twoFa);
}
