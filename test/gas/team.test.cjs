const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const root = require('path').join(__dirname, '..', '..', 'gas') + '/';
const code = ['Db.gs', 'Code.gs', 'Public.gs', 'Apply.gs', 'Team.gs', 'Admin.gs', 'AdminData.gs', 'Documents.gs', 'Announcements.gs'].map((f) => fs.readFileSync(root + f, 'utf8')).join('\n');

const store = {}; // sheet name -> 2D array (row 0 = header)
const props = { SHEET_ID: 'x', PEPPER: 'pepper-pepper', ALLOWED_ORIGINS: 'http://localhost:5173,https://ncrmutr.github.io', FOLDER_TEAM_FILES: 'F' };
const cacheStore = {};
function mkSheet(name) {
  const get = () => store[name];
  return {
    getLastRow: () => get().length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push((get()[r - 1 + i] || [])[c - 1 + j] ?? '');
            out.push(row);
          }
          return out;
        },
        setValues: (vals) => {
          vals.forEach((rv, i) => {
            get()[r - 1 + i] = get()[r - 1 + i] || [];
            rv.forEach((v, j) => { get()[r - 1 + i][c - 1 + j] = String(v); });
          });
        },
        setNumberFormat() {},
        clearContent() {
          for (let i = 0; i < nr; i++) get()[r - 1 + i] = undefined;
          store[name] = get().filter((x) => x !== undefined);
        },
      };
    },
    deleteRow: (n) => get().splice(n - 1, 1),
  };
}
const ctx = {
  console, Date, JSON, Math, parseInt, isFinite, Number, String, Object, Array, RegExp, Error,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = v) }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => (store[n] ? mkSheet(n) : null) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore[k] ?? null, put: (k, v) => (cacheStore[k] = v), remove: (k) => delete cacheStore[k] }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()].map((b) => (b > 127 ? b - 256 : b)),
    computeDigest: (a, v) => [...crypto.createHash('md5').update(v).digest()].map((b) => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 1 }, Charset: { UTF_8: 1 },
  },
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
};
vm.createContext(ctx);
vm.runInContext(code + '\nthis.__x = { SCHEMA, ACTIONS, doPost };', ctx);
const { SCHEMA, ACTIONS, doPost } = ctx.__x;
Object.keys(SCHEMA).forEach((n) => (store[n] = [SCHEMA[n].slice()]));
const row = (n, o) => store[n].push(SCHEMA[n].map((c) => String(o[c] ?? '')));

row('editions', { id: 'ed1', year: 2026, title: 'T', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST26', ref_counter: 1, is_current: 'true', status: 'active' });
const teamId = 'team-1';
const pinHash = crypto.createHmac('sha256', props.PEPPER).update(teamId + ':4821').digest('hex');
row('teams', { id: teamId, edition_id: 'ed1', ref_no: 'ST26-0001', name_th: 'ทีม', name_en: 'Sample Team', name_en_key: 'sample team', pin_hash: pinHash, status: 'pending', created_at: new Date().toISOString() });
row('members', { id: 'm1', team_id: teamId, edition_id: 'ed1', order_no: 1, student_id: '6401234567001', full_name: 'สมชาย', phone: '0812345678' });
row('advisors', { id: 'a1', team_id: teamId, full_name: 'อ.', department: 'ฟิสิกส์', faculty: 'วิทย์' });
row('upload_slots', { id: 's1', edition_id: 'ed1', title: 'doc', accept: 'pdf,jpg', max_mb: 5, is_open: 'true', sort_order: 1, created_at: 'a' });
row('upload_slots', { id: 's2', edition_id: 'ed1', title: 'closed', accept: 'pdf', max_mb: 5, is_open: 'false', sort_order: 2, created_at: 'b' });

const call = (a, r) => {
  try { return { ok: true, data: ACTIONS[a](r) }; } catch (e) { if (!e.reason) throw e; return { ok: false, reason: e.reason, extra: e.extra }; }
};
const out = (x) => JSON.parse(JSON.stringify(x));

// 1. success
let r = call('lookup_team', { name_en: '  SAMPLE   team ', pin: '4821' });
assert.equal(r.ok, true); assert.equal(r.data.team.ref_no, 'ST26-0001'); assert.equal(r.data.members.length, 1);
assert.equal(r.data.slots.length, 1); assert.equal(r.data.slots[0].id, 's1'); assert.deepEqual(out(r.data.slots[0].accept), ['pdf', 'jpg']);
assert.ok(!('pin_hash' in r.data.team));
console.log('ok: lookup success, closed slot hidden');

// 2. same reason for wrong pin / unknown team, both counted
const a = call('lookup_team', { name_en: 'Sample Team', pin: '0000' });
const b = call('lookup_team', { name_en: 'No Such Team', pin: '0000' });
assert.equal(a.reason, 'invalid_credentials'); assert.equal(b.reason, 'invalid_credentials');
assert.equal(a.extra.attempts_left, 4); assert.equal(b.extra.attempts_left, 4);
console.log('ok: wrong pin == unknown team, both count');

// 3. lock after 5 fails; correct pin refused while locked
for (let i = 0; i < 3; i++) call('lookup_team', { name_en: 'Sample Team', pin: '1111' });
assert.equal(call('lookup_team', { name_en: 'Sample Team', pin: '2222' }).reason, 'locked');
assert.equal(call('lookup_team', { name_en: 'Sample Team', pin: '4821' }).reason, 'locked');
assert.equal(call('send_message', { name_en: 'Sample Team', pin: '4821', body: 'hi' }).reason, 'locked');
assert.equal(call('prepare_upload', { name_en: 'Sample Team', pin: '4821', slot_id: 's1', file_name: 'a.pdf', size: 10, origin: 'http://localhost:5173' }).reason, 'locked');
console.log('ok: lock-out after 5, applies to every action');

// 4. lock expires; success clears the counter
const att = store.lookup_attempts.filter((x) => x[0] === '2026:sample team')[0];
att[3] = new Date(Date.now() - 1000).toISOString(); att[2] = new Date(Date.now() - 16 * 60000).toISOString();
r = call('lookup_team', { name_en: 'Sample Team', pin: '4821' }); assert.equal(r.ok, true);
assert.equal(store.lookup_attempts.filter((x) => x[0] === '2026:sample team').length, 0);
console.log('ok: lock expires, success clears counter');

// 5. messages
assert.equal(call('send_message', { name_en: 'Sample Team', pin: '4821', body: '   ' }).reason, 'invalid_input');
assert.equal(call('send_message', { name_en: 'Sample Team', pin: '4821', body: 'x'.repeat(2001) }).reason, 'invalid_input');
for (let i = 0; i < 5; i++) assert.equal(call('send_message', { name_en: 'Sample Team', pin: '4821', body: 'msg ' + i }).ok, true);
assert.equal(call('send_message', { name_en: 'Sample Team', pin: '4821', body: 'sixth' }).reason, 'rate_limited');
assert.equal(store.messages.length, 6);
console.log('ok: messages validated, 5/hour per team');

// 6. upload pre-checks (all fail before any Drive call)
const base = { name_en: 'Sample Team', pin: '4821', slot_id: 's1', file_name: 'doc.pdf', size: 1000, origin: 'http://localhost:5173' };
assert.equal(call('prepare_upload', { ...base, origin: 'https://evil.example' }).reason, 'origin_not_allowed');
assert.equal(call('prepare_upload', { ...base, slot_id: 's2' }).reason, 'slot_closed');
assert.equal(call('prepare_upload', { ...base, slot_id: 'nope' }).reason, 'slot_closed');
assert.equal(call('prepare_upload', { ...base, size: 6 * 1024 * 1024 }).reason, 'file_too_large');
assert.equal(call('prepare_upload', { ...base, size: 0 }).reason, 'file_too_large');
assert.equal(call('prepare_upload', { ...base, file_name: 'x.exe' }).reason, 'file_type_not_allowed');
assert.equal(call('prepare_upload', { ...base, file_name: 'noext' }).reason, 'file_type_not_allowed');
store.upload_slots[1][6] = new Date(Date.now() - 1000).toISOString(); // deadline in the past
assert.equal(call('prepare_upload', base).reason, 'deadline_passed');
console.log('ok: upload pre-checks');

// 7. attempts sheet stays small
for (let i = 0; i < 260; i++) call('lookup_team', { name_en: 'ghost ' + i, pin: '0000' });
console.log('attempt rows after 260 distinct guesses:', store.lookup_attempts.length);

for (const k of Object.keys(cacheStore)) delete cacheStore[k];
for (let i=0;i<250;i++) store.lookup_attempts.push(["2026:old"+i,"2",new Date(Date.now()-3600000).toISOString(),""]);
call("lookup_team",{name_en:"fresh guess",pin:"0000"});
console.log("rows after prune with 250 expired:", store.lookup_attempts.length);
assert.ok(store.lookup_attempts.length < 160);
// 8. the reply envelope carries attempts_left
const res = JSON.parse(doPost({ postData: { contents: JSON.stringify({ action: 'lookup_team', name_en: 'zzz', pin: '1234' }) } }).s);
assert.equal(res.ok, false); assert.equal(res.reason, 'invalid_credentials'); assert.equal(typeof res.attempts_left, 'number');
console.log('ok: envelope', JSON.stringify(res));
console.log('ALL PASSED');
