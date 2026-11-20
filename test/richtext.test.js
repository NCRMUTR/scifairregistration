import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBold } from '../src/lib/richtext.js';

test('plain text is one part', () => assert.deepEqual(parseBold('สวัสดี'), [{ text: 'สวัสดี' }]));
test('**bold** in the middle', () =>
  assert.deepEqual(parseBold('เปิดรับ **สมัครทีม** วันนี้'), [{ text: 'เปิดรับ ' }, { text: 'สมัครทีม', bold: true }, { text: ' วันนี้' }]));
test('several bold parts and line breaks are kept', () =>
  assert.deepEqual(parseBold('**a**\nb **c**'), [{ text: 'a', bold: true }, { text: '\nb ' }, { text: 'c', bold: true }]));
test('an unclosed ** stays literal', () => assert.deepEqual(parseBold('a ** b'), [{ text: 'a ** b' }]));
test('a bold part never spans lines', () => assert.deepEqual(parseBold('**a\nb**'), [{ text: '**a\nb**' }]));
test('empty pair and single stars are literal', () => {
  assert.deepEqual(parseBold('****'), [{ text: '****' }]);
  assert.deepEqual(parseBold('2*3*4'), [{ text: '2*3*4' }]);
});
test('HTML is not interpreted: it stays text', () =>
  assert.deepEqual(parseBold('**<b onclick=x>hi</b>**'), [{ text: '<b onclick=x>hi</b>', bold: true }]));
test('null / undefined give nothing', () => {
  assert.deepEqual(parseBold(null), []);
  assert.deepEqual(parseBold(undefined), []);
});
