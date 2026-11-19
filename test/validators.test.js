// Run with: npm test   (uses Node's built-in test runner — no extra dependency)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStudentId, isPhone, isPin, digitsOnly, nameKey, duplicateIds, validateForm, buildSubmitPayload } from '../src/lib/validators.js';

const member = (over = {}) => ({ id: '6401234567001', name: 'สมชาย', phone: '0812345678', ...over });
const form = (over = {}) => ({
  teamTh: 'ทีม', teamEn: 'Team', pin: '4821', pin2: '4821', ack: true, pdpa: true,
  members: [member()], advisors: [{ name: 'อ.ที่ปรึกษา', major: 'ฟิสิกส์', faculty: 'วิทยาศาสตร์' }], ...over,
});

test('student id: exactly 13 digits', () => {
  assert.equal(isStudentId('6401234567001'), true);
  assert.equal(isStudentId('640123456700'), false); // 12
  assert.equal(isStudentId('64012345670011'), false); // 14
  assert.equal(isStudentId('64012345670a1'), false);
  assert.equal(isStudentId(' 6401234567001'), false);
  assert.equal(isStudentId(''), false);
  assert.equal(isStudentId(undefined), false);
  assert.equal(isStudentId(6401234567001), true); // numbers are stringified (inputs always give strings)
});

test('phone: 10 digits starting with 0 (the SQL/GAS rule, not the looser mockup)', () => {
  assert.equal(isPhone('0812345678'), true);
  assert.equal(isPhone('812345678'), false);
  assert.equal(isPhone('081234567'), false); // 9 digits
  assert.equal(isPhone('1812345678'), false);
  assert.equal(isPhone('08123456789'), false);
  assert.equal(isPhone('081-234-5678'), false);
});

test('pin: exactly 4 digits', () => {
  assert.equal(isPin('4821'), true);
  assert.equal(isPin('0000'), true);
  assert.equal(isPin('482'), false);
  assert.equal(isPin('48210'), false);
  assert.equal(isPin('48a1'), false);
});

test('digitsOnly strips non-digits and cuts to max', () => {
  assert.equal(digitsOnly('08 1-234 5678x', 10), '0812345678');
  assert.equal(digitsOnly('64012345670019999', 13), '6401234567001');
  assert.equal(digitsOnly(null, 4), '');
});

test('nameKey: same key as the server (trim, collapse spaces, lower case)', () => {
  assert.equal(nameKey('  TEST   Team '), 'test team');
  assert.equal(nameKey('test team'), nameKey('Test  TEAM'));
  assert.notEqual(nameKey('Team A'), nameKey('Team B'));
  assert.equal(nameKey(undefined), '');
});

test('duplicateIds ignores incomplete ids', () => {
  const d = duplicateIds(['6401234567001', '6401234567002', '6401234567001', '123', '123']);
  assert.deepEqual([...d], ['6401234567001']);
});

test('a complete form can be submitted', () => {
  const v = validateForm(form());
  assert.equal(v.ok, true);
  assert.equal(v.blockMsg, '');
});

test('required fields block submit with a reason', () => {
  assert.match(validateForm(form({ teamTh: ' ' })).blockMsg, /ชื่อทีม/);
  assert.match(validateForm(form({ teamEn: '' })).blockMsg, /ชื่อทีม/);
  assert.match(validateForm(form({ members: [member({ name: '' })] })).blockMsg, /สมาชิก/);
  assert.match(validateForm(form({ members: [member({ phone: '812345678' })] })).blockMsg, /สมาชิก/);
  assert.match(validateForm(form({ advisors: [{ name: 'a', major: '', faculty: 'f' }] })).blockMsg, /อาจารย์/);
  assert.match(validateForm(form({ pin: '12' , pin2: '12' })).blockMsg, /PIN/);
  assert.match(validateForm(form({ pin2: '1111' })).blockMsg, /PIN/);
  assert.match(validateForm(form({ ack: false })).blockMsg, /PDPA/);
  assert.match(validateForm(form({ pdpa: false })).blockMsg, /PDPA/);
});

test('phone and id messages appear only for bad input', () => {
  const v = validateForm(form({ members: [member({ phone: '12345', id: '640' })] }));
  assert.match(v.members[0].phoneMsg, /10 หลัก/);
  assert.match(v.members[0].idMsg, /13 หลัก/);
  assert.match(v.members[0].idMsg, /3/); // typed so far
  const ok = validateForm(form());
  assert.equal(ok.members[0].phoneMsg, '');
  assert.equal(ok.members[0].idMsg, '');
  assert.equal(validateForm(form({ members: [member({ phone: '' })] })).members[0].phoneMsg, '', 'empty field: no red text yet');
});

test('duplicate id inside the form blocks both members', () => {
  const v = validateForm(form({ members: [member(), member({ name: 'อีกคน', phone: '0899999999' })] }));
  assert.equal(v.ok, false);
  assert.match(v.members[0].idMsg, /ซ้ำ/);
  assert.match(v.members[1].idMsg, /ซ้ำ/);
});

test('id taken by the server blocks submit and never names a team', () => {
  const v = validateForm(form(), { takenIds: new Set(['6401234567001']) });
  assert.equal(v.ok, false);
  assert.match(v.members[0].idMsg, /สมัครแล้ว/);
  assert.doesNotMatch(v.members[0].idMsg, /ทีม/);
  assert.equal(validateForm(form(), { takenIds: new Set(['6409999999999']) }).ok, true);
});

test('submit waits while an id check is pending', () => {
  const v = validateForm(form(), { pendingIds: new Set(['6401234567001']) });
  assert.equal(v.ok, false);
  assert.match(v.blockMsg, /กำลังตรวจ/);
});

test('submit payload is trimmed and shaped for the server', () => {
  const p = buildSubmitPayload(form({ teamTh: ' ทีม ', teamEn: ' Team  ', members: [member({ name: ' สมชาย ' })] }));
  assert.deepEqual(p, {
    name_th: 'ทีม', name_en: 'Team', pin: '4821',
    members: [{ student_id: '6401234567001', full_name: 'สมชาย', phone: '0812345678' }],
    advisors: [{ full_name: 'อ.ที่ปรึกษา', department: 'ฟิสิกส์', faculty: 'วิทยาศาสตร์' }],
    ack: true, pdpa: true,
  });
});
