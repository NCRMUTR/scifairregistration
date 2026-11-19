// Tab 1 — ภาพรวม: counts, registration status, last backup, unread messages.
import { h, append } from '../../lib/dom.js';
import { formatThaiDateTime } from '../../lib/format.js';

const MODE_TEXT = {
  auto: (e) =>
    `ตามช่วงเวลา: เปิด ${e.registration_opens_at ? formatThaiDateTime(e.registration_opens_at) : '(ยังไม่ตั้ง — ปิดอยู่)'}${e.registration_closes_at ? ` · ปิด ${formatThaiDateTime(e.registration_closes_at)}` : ''}`,
  open: () => 'เปิดบังคับ (ไม่ดูเวลา)',
  closed: () => 'ปิดบังคับ',
};

export async function render(body, ctx) {
  const data = await ctx.call('admin_overview');
  const e = data.edition;
  ctx.setYear(e?.year);

  if (!e) {
    body.append(
      h('h2', 'ภาพรวม'),
      h('div', { class: 'panel' }, h('p', 'ยังไม่มีรอบการจัดงานที่เป็นปีปัจจุบัน'), h('button', { type: 'button', class: 'btn btn-primary', onClick: () => ctx.go('editions') }, 'ไปที่ปี/รอบการจัดงาน')),
    );
    return;
  }

  const stat = (label, value, cls) => h('div', { class: `stat ${cls}` }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, String(value)));
  const open = e.registration_open;
  const notLive = e.status !== 'active' ? 'รอบนี้ยังเป็นฉบับร่าง/ไม่ใช้งาน — ยังไม่เปิดรับสมัคร' : null;

  const backupAge = e.last_backup_at ? Date.now() - new Date(e.last_backup_at).getTime() : null;
  const backupText = e.last_backup_at ? `สำรองล่าสุด ${formatThaiDateTime(e.last_backup_at)}` : 'ยังไม่เคยสำรองข้อมูลของปีนี้';
  const backupCls = backupAge !== null && backupAge < 24 * 3600 * 1000 ? 'ok-text' : 'warn-text';

  append(body, [
    h('h2', `ภาพรวม ปี ${e.year}`),
    h('div', { class: 'stats' }, stat('ทีมที่สมัครแล้ว', data.teams.total, 'stat-plain'), stat('รอตรวจสอบ', data.teams.pending, 'stat-pending'), stat('การสมัครสำเร็จ', data.teams.approved, 'stat-ok')),
    data.unread_messages
      ? h(
          'div',
          { class: 'banner-warn' },
          `มีข้อความถึงคณะกรรมการที่ยังไม่ได้อ่าน ${data.unread_messages} ข้อความ `,
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onClick: () => ctx.go('teams') }, 'ดูที่รายชื่อทีม'),
        )
      : null,
    h(
      'section',
      { class: 'panel' },
      h('h3', 'การรับสมัคร'),
      h('div', { class: open ? 'big ok-text' : 'big err-text' }, open ? 'เปิดรับสมัครอยู่' : 'ปิดรับสมัคร'),
      h('p', { class: 'panel-hint' }, notLive ?? MODE_TEXT[e.reg_mode]?.(e) ?? ''),
      h('button', { type: 'button', class: 'btn btn-outline btn-add', onClick: () => ctx.go('editions') }, 'ตั้งช่วงเวลารับสมัคร'),
    ),
    h(
      'section',
      { class: 'panel' },
      h('h3', 'การสำรองข้อมูล'),
      h('div', { class: backupCls, style: 'font-weight:600' }, backupText),
      e.purged_at ? h('p', { class: 'panel-hint' }, `ข้อมูลผู้เข้าร่วมถูกรีเซ็ตเมื่อ ${formatThaiDateTime(e.purged_at)} (${e.purge_mode})`) : null,
      h('button', { type: 'button', class: 'btn btn-outline btn-add', onClick: () => ctx.go('backup') }, 'ไปที่สำรอง/รีเซ็ต'),
    ),
  ]);
}
