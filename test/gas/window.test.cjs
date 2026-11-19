// Registration window: the SERVER clock decides (status + mode + times), for display (public_site) and for submit_team.
const assert = require('assert');
const h = require('./harness.cjs');
const { store, row, call, advance } = h;
const IDX = (c) => h.SCHEMA.editions.indexOf(c);
const NOW = () => Date.now() + h.clock();
const iso = (ms) => new Date(ms).toISOString();

row('editions', { id: 'ed1', year: 2026, title: 'T', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST26', ref_counter: 0, is_current: 'true', status: 'active', key_dates: '[]', ack_text: 'a', pdpa_text: 'p' });
const setEd = (patch) => { Object.entries(patch).forEach(([k, v]) => { store.editions[1][IDX(k)] = String(v); }); delete h.cacheStore.public_data; }; // admin actions bust the cache the same way
let n = 0;
const app = () => ({
  name_th: 'ทีม', name_en: 'Team ' + ++n, pin: '1234', ack: true, pdpa: true,
  members: [{ student_id: String(1000000000000 + n), full_name: 'A', phone: '0811111111' }],
  advisors: [{ full_name: 'B', department: 'd', faculty: 'f' }],
});
const shown = () => call('public_site', {}).data.edition.registration_open;
const submit = () => call('submit_team', app());
const expectState = (label, open) => {
  assert.equal(shown(), open, label + ' (display)');
  const r = submit();
  if (open) assert.ok(r.ok, label + ' submit ' + JSON.stringify(r));
  else assert.equal(r.reason, 'registration_closed', label + ' submit');
};

// new editions start closed
expectState('closed mode', false);
// forced open
setEd({ reg_mode: 'open' });
expectState('open mode', true);
// draft / archived editions are never open, whatever the mode
setEd({ status: 'draft' }); expectState('open but draft', false);
setEd({ status: 'archived' }); expectState('open but archived', false);
setEd({ status: 'active', reg_mode: 'closed', registration_opens_at: iso(NOW() - 3600e3), registration_closes_at: iso(NOW() + 3600e3) });
expectState('closed mode ignores a running window', false);

// auto mode: window decides, server clock moves it
setEd({ reg_mode: 'auto', registration_opens_at: iso(NOW() + 60e3), registration_closes_at: iso(NOW() + 120e3) });
expectState('auto: before opening', false);
advance(61e3);
expectState('auto: inside the window', true);
advance(60e3);
expectState('auto: after closing', false);
// no open time -> closed; no close time -> stays open
setEd({ registration_opens_at: '', registration_closes_at: '' });
expectState('auto without times', false);
setEd({ registration_opens_at: iso(NOW() - 1000), registration_closes_at: '' });
expectState('auto, opened, never closes', true);
// the browser cannot change anything: sending a client time / mode is ignored
setEd({ reg_mode: 'closed' });
const r = call('submit_team', { ...app(), server_time: iso(NOW()), reg_mode: 'open', registration_open: true, now: Date.now() });
assert.equal(r.reason, 'registration_closed');
console.log('ALL WINDOW TESTS PASSED');
