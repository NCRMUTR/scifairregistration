// Tiny, safe formatting for admin-written texts: **bold**. Nothing else is interpreted (no HTML), and the result is
// only ever turned into text nodes and <strong> elements by dom.js, so admin text can never inject markup.

/** "a **b** c" -> [{ text: 'a ' }, { text: 'b', bold: true }, { text: ' c' }]. A lone ** (no closing pair) stays literal. */
export function parseBold(input) {
  const s = String(input ?? '');
  const parts = [];
  const re = /\*\*([^*\n][^\n]*?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index) });
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}
