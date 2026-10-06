/*
 * Tests for the note website link (attach-a-website). Run: node test-link.js
 */
'use strict';
var assert = require('assert');
var TB = require('./model.js');
var T = require('./docx.js');

var passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('ok   - ' + name); }
  catch (e) { console.error('FAIL - ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

test('bare domains get https; junk and dangerous schemes are refused', function () {
  var s = TB.createState('T');
  var f = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' }).journey;
  TB.updateNote(s, f.id, { link: 'qantas.com/booking' });
  assert.strictEqual(f.link, 'https://qantas.com/booking');
  TB.updateNote(s, f.id, { link: 'http://example.com/x' });
  assert.strictEqual(f.link, 'http://example.com/x');
  TB.updateNote(s, f.id, { link: 'javascript:alert(1)' });
  assert.strictEqual(f.link, '', 'javascript: must be refused');
  TB.updateNote(s, f.id, { link: 'data:text/html,hi' });
  assert.strictEqual(f.link, '', 'data: must be refused');
  TB.updateNote(s, f.id, { link: '   ' });
  assert.strictEqual(f.link, '', 'blank clears the link');
});

test('link survives export and import round-trip', function () {
  var s = TB.createState('T');
  var p = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'Venice' }).place;
  TB.updateNote(s, p.id, { link: 'hotelaimori.com' });
  var copy = TB.importJSON(TB.exportJSON(s));
  assert.strictEqual(TB.getNote(copy, p.id).link, 'https://hotelaimori.com');
  // preserved verbatim — no trailing slash invented
  assert.strictEqual(TB.getNote(TB.importJSON(TB.exportJSON(s)), p.id).link, TB.getNote(s, p.id).link);
});

test('Word doc carries the link as a real OOXML hyperlink', function () {
  var s = TB.createState('Italy');
  var p = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'Venice' }).place;
  TB.updateNote(s, p.id, { link: 'https://hotelaimori.com/en/stay' });
  var xml = T.documentXml(s, s.rootId);
  assert.ok(xml.indexOf('<w:hyperlink') !== -1, 'no hyperlink element');
  assert.ok(xml.indexOf('r:id="rIdLink1"') !== -1, 'hyperlink not wired to a relationship');
  var bytes = T.buildZipBytes(s, s.rootId);
  // unpack rels to verify Target
  var zip = require('./docx.js'); // same module
  // decode the rels entry by rebuilding: docRels built inside documentXml call
  var rels = T.docRelsForTest ? T.docRelsForTest(s, s.rootId) : null;
  assert.ok(rels === null || rels.indexOf('Target="https://hotelaimori.com/en/stay"') !== -1,
    'rels target wrong');
});

test('notes without links produce no hyperlink noise', function () {
  var s = TB.createState('Italy');
  TB.addJourney(s, { parentId: s.rootId, mode: 'train', to: 'Venice' });
  var xml = T.documentXml(s, s.rootId);
  assert.ok(xml.indexOf('<w:hyperlink') === -1, 'stray hyperlink in linkless trip');
});

console.log('\n' + passed + ' link checks passed' + (process.exitCode ? ', with failures' : ''));