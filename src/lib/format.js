// Date formatting for the Thai UI. All times are shown in Asia/Bangkok (th-TH uses the Buddhist year).
const TZ = 'Asia/Bangkok';

const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** timestamptz string -> "15 ธันวาคม 2569 17:00 น." ('' if invalid) */
export function formatThaiDateTime(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : `${dateTimeFmt.format(d)} น.`;
}

/**
 * Key-date values are typed by the admin: "2026-12-15" (formatted), an ISO timestamp (formatted),
 * or free text such as "ธันวาคม 2569" (shown as typed).
 */
export function formatKeyDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00+07:00`);
    return Number.isNaN(d.getTime()) ? raw : dateFmt.format(d);
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(raw)) {
    const formatted = formatThaiDateTime(raw);
    return formatted || raw;
  }
  return raw;
}
