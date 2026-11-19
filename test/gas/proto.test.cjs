const { doPost } = require('./harness.cjs');
for (const a of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'nope', 'ping']) {
  const r = JSON.parse(doPost({ postData: { contents: JSON.stringify({ action: a, secret: 'x' }) } }).s);
  const expected = a === 'ping' ? r.ok === true : r.reason === 'unknown_action';
  console.log((expected ? 'ok   ' : 'FAIL ') + a + ' -> ' + JSON.stringify(r).slice(0, 80));
  if (!expected) process.exitCode = 1;
}
