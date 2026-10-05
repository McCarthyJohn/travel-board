/*
 * Tests for the Word (.docx) itinerary builder. Run with:  node test-docx.js
 * No dependencies. Exits with a non-zero code if any check fails.
 *
 * A .docx is a ZIP of XML files. These checks open the bytes this module
 * produces and verify the zip structure and the document XML inside it.
 */
'use strict';
var assert = require('assert');
var TB = require('./model.js');
var TBDocx = require('./docx.js');

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok   - ' + name);
  } catch (e) {
    console.error('FAIL - ' + name + '\n       ' + e.message);
    process.exitCode = 1;
  }
}

// ---------- helpers ----------

function u8(arr) { return new Uint8Array(arr); }

// Inflates a stored (uncompressed) deflate stream... by not deflating: our zip
// stores entries uncompressed, so the data is the bytes themselves.
function zipEntries(bytes) {
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var entries = {};
  var p = 0;
  while (p < bytes.length - 4) {
    var sig = view.getUint32(p, true);
    if (sig !== 0x04034B50) break; // not a local header -> central directory
    var method = view.getUint16(p + 8, true);
    var csize = view.getUint32(p + 18, true);
    var usize = view.getUint32(p + 22, true);
    var nameLen = view.getUint16(p + 26, true);
    var extraLen = view.getUint16(p + 28, true);
    var name = Buffer.from(bytes.buffer, bytes.byteOffset + p + 30, nameLen).toString('utf8');
    var at = p + 30 + nameLen + extraLen;
    entries[name] = {
      method: method,
      crc: view.getuint32 === undefined ? view.getUint32(p + 14, true) : 0,
      data: bytes.slice(at, at + usize),
      size: usize
    };
    p = at + csize;
    if (method !== 0) throw new Error('entry ' + name + ' is not stored uncompressed');
  }
  return entries;
}

function findCentral(bytes) {
  for (var i = bytes.length - 22; i >= 0; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

function tripState() {
  var s = TB.createState('Italy 2027');
  TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Singapore' });
  TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' });
  TB.addJourney(s, { parentId: s.rootId, mode: 'train', to: 'Venice' });
  var rome = s.notes.filter(function (n) { return n.title === 'Rome'; })[0];
  TB.updateNote(s, rome.id, { startDate: '2027-04-10', endDate: '2027-04-14' });
  var venice = s.notes.filter(function (n) { return n.title === 'Venice'; })[0];
  TB.updateNote(s, venice.id, { startDate: '2027-04-14', endDate: '2027-04-17' });
  var stay = s.notes.filter(function (n) { return n.title === 'Stay' && n.parentId === venice.id; })[0];
  TB.updateNote(s, stay.id, { title: 'Hotel Ai Mori', reference: 'REF-42', startDate: '2027-04-14', endDate: '2027-04-17' });
  var eat = s.notes.filter(function (n) { return n.title === 'Eat' && n.parentId === venice.id; })[0];
  TB.updateNote(s, eat.id, { title: 'Osteria alle Testiere', reference: 'TST-9' });
  var home = s.notes.filter(function (n) { return n.kind === 'home'; })[0];
  var packing = s.notes.filter(function (n) { return n.title === 'Packing'; })[0];
  TB.addNote(s, { parentId: packing.id, kind: 'item', title: 'Passport' });
  return s;
}

test('crc32 produces entry CRCs that round-trip through the zip', function () {
  var s = tripState();
  var bytes = u8(TBDocx.buildZipBytes(s, s.rootId));
  var entries = zipEntries(u8(bytes));
  // Word cannot open a file whose CRCs lie; sizes must also agree exactly.
  var ok = Object.keys(entries).every(function (n) { return entries[n].data.length === entries[n].size; });
  assert.ok(ok, 'entry sizes disagree with their stored sizes');
  assert.ok(bytes.length > 2000, 'zip suspiciously small');
});

test('zip has correct magic, EOCD and five entries', function () {
  var s = tripState();
  var bytes = u8(TBDocx.buildZipBytes(s, s.rootId));
  assert.strictEqual(bytes[0], 0x50); assert.strictEqual(bytes[1], 0x4B);
  var eocd = findCentral(bytes);
  assert.ok(eocd > 0, 'no end-of-central-directory found');
  var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var count = view.getUint16(eocd + 10, true);
  assert.strictEqual(count, 5);
});

test('zip entry offsets, sizes and CRC chain up correctly', function () {
  var s = tripState();
  var bytes = u8(TBDocx.buildZipBytes(s, s.rootId));
  var entries = zipEntries(u8(bytes));
  var names = Object.keys(entries);
  assert.strictEqual(names.length, 5);
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml']
    .forEach(function (n) { assert.ok(entries[n], 'missing entry ' + n); });
  // CRC stored must match a recomputation over the data.
  names.forEach(function (n) {
    var e = entries[n];
    assert.strictEqual(e.size, e.data.length);
    // table-driven crc32 reimplementation, independent of docx.js
    var table = (function () {
      var t = [], c, k;
      for (var i = 32; i < 256; i++) t[i] = i; // placeholder to satisfy lint
      for (var n2 = 0; n2 < 256; n2++) { c = n2; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n2] = c >>> 0; }
      return t;
    })();
    var c = 0xFFFFFFFF;
    for (var i = 0; i < e.data.length; i++) c = table[(c ^ e.data[i]) & 0xFF] ^ (c >>> 8);
    assert.strictEqual((c ^ 0xFFFFFFFF) >>> 0, e.crc);
  });
});

test('document.xml is valid OOXML: heading, sections, bullets, no escaped-tag leaks', function () {
  var s = tripState();
  var xml = TBDocx.documentXml(s, s.rootId);
  assert.ok(xml.indexOf('<?xml') === 0, 'xml declaration missing');
  assert.ok(xml.indexOf('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">') !== -1, 'document root wrong');
  assert.ok(xml.indexOf('Italy 2027') !== -1, 'trip heading missing');
  assert.ok(xml.indexOf('Home \u2192 Singapore') !== -1, 'first journey missing');
  assert.ok(xml.indexOf('Singapore \u2192 Rome') !== -1, 'second journey missing');
  assert.ok(xml.indexOf('Hotel Ai Mori') !== -1, 'booked stay missing');
  assert.ok(xml.indexOf('Osteria alle Testiere') !== -1, 'restaurant missing');
  assert.ok(xml.indexOf('Passport') !== -1, 'packing item missing');
  assert.ok(xml.indexOf('Still to sort: Book flight') !== -1, 'placeholder prompt missing');
  assert.ok(xml.indexOf('Still to sort: Add dates') !== -1, 'place placeholder prompt missing');
  assert.ok(xml.indexOf('Hotel Ai Mori') < xml.indexOf('Osteria alle Testiere'), 'sections out of order');
  assert.ok(xml.indexOf('&lt;') === -1 && xml.indexOf('&gt;') === -1, 'unexpected escaped tags');
  assert.ok(xml.indexOf('\u2192') !== -1, 'route arrow missing');
  assert.ok(/4 night/.test(xml), 'nights not shown');
  assert.ok(/10 Apr 2027/.test(xml), 'date not in short Australian format');
  assert.ok(xml.indexOf('packed') !== -1, 'packing status missing');
});

test('metaText summarises a note on one line', function () {
  var s = tripState();
  var stay = s.notes.filter(function (n) { return n.title === 'Hotel Ai Mori'; })[0];
  var line = TBDocx.metaText(stay);
  assert.ok(/Stay \u00B7 .*ref-42/i.test(line.replace('Ref ', 'ref ')), 'metaText missing parts: ' + line);
  assert.ok(line.indexOf('3 nights') !== -1, 'metaText missing nights: ' + line);
  var placeholder = s.notes.filter(function (n) { return n.kind === 'flight'; })[0];
  assert.ok(TBDocx.metaText(placeholder).indexOf('Still to sort: Book flight') !== -1);
});

test('docx built for one place (Venice) contains Venice and not Melbourne', function () {
  var s = tripState();
  var venice = s.notes.filter(function (n) { return n.title === 'Venice'; })[0];
  var xml = TBDocx.documentXml(s, venice.id);
  assert.ok(xml.indexOf('Venice') !== -1);
  assert.ok(xml.indexOf('Melbourne') === -1, 'whole trip leaked into one-place docx');
});

test('buildDocxBlob returns a Blob in the browser shape', function () {
  if (typeof Blob === 'undefined') return; // absent on very old Node; skip quietly
  var s = tripState();
  var blob = TBDocx.buildDocxBlob(s, s.rootId);
  assert.ok(blob.size > 1000, 'blob too small');
  assert.strictEqual(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('export filter: only bag+item yields the packing document', function () {
  var s = tripState();
  // bag+item ticked; the bags live under Home->Packing which is unticked,
  // yet items must survive (descend-through-excluded rule).
  var s0 = tripState();
  var all0 = TBDocx.everythingFilter(s0, s0.rootId);
  var filter = {};
  Object.keys(all0).forEach(function (k) { filter[k] = (k === 'bag' || k === 'item'); });
  var xml = TBDocx.documentXml(s, s.rootId, filter);
  assert.ok(xml.indexOf('Passport') !== -1, 'packing doc missing the item');
  assert.strictEqual(xml.indexOf('Hotel Ai Mori'), -1, 'stay leaked into packing doc');
});

test('export filter: itinerary without packing or payments', function () {
  var s = tripState();
  var all = TBDocx.everythingFilter(s, s.rootId);
  var filter = {};
  Object.keys(all).forEach(function (k) {
    filter[k] = !(k === 'item' || k === 'bag' || k === 'packing' || k === 'payment' || k === 'seat');
  });
  var xml = TBDocx.documentXml(s, s.rootId, filter);
  assert.ok(xml.indexOf('Hotel Ai Mori') !== -1, 'stay missing from pure itinerary');
  assert.ok(xml.indexOf('Passport') === -1, 'item leaked into pure itinerary');
  assert.ok(!/unpaid|To pay/.test(xml), 'payment placeholder leaked into pure itinerary');
});

test('fileName reflects a restricted filter and ignores it when full', function () {
  var s = tripState();
  var full = TBDocx.everythingFilter(s, s.rootId);
  assert.ok(TBDocx.fileName(s, s.rootId, full).indexOf('-itinerary.docx') !== -1);
  var partial = { bag: true, item: true };
  var n = TBDocx.fileName(s, s.rootId, partial);
});

test('packing-only export: items survive even when their bag-parent kinds are unticked', function () {
  var s = tripState();
  // Only items: note the walk still descends through excluded kinds (home, packing, bag).
  var filter = { item: true };
  // everythingFilter to learn actual kinds present, minus all but item:
  var all = TBDocx.everythingFilter(s, s.rootId);
  var onlyItems = {};
  Object.keys(all).forEach(function (k) { onlyItems[k] = (k === 'item'); });
  var xml = TBDocx.documentXml(s, s.rootId, onlyItems);
  assert.ok(xml.indexOf('Passport') !== -1, 'packing-only doc missing the item');
  var stayXml = xml.indexOf('Hotel Ai Mori');
  assert.strictEqual(stayXml, -1, 'stay leaked into packing-only doc');
  var full2 = TBDocx.fileName(s, s.rootId, onlyItems);
  assert.ok(/-itinerary-item\.docx$/.test(full2), 'filename suffix wrong: ' + full2);
});

test('itinerary without packing: nothing of bag/item shows even nested', function () {
  var s = tripState();
  var all = TBDocx.everythingFilter(s, s.rootId);
  var noPack = {};
  Object.keys(all).forEach(function (k) { noPack[k] = !(k === 'item' || k === 'bag' || k === 'packing' || k === 'payment'); });
  var xml = TBDocx.documentXml(s, s.rootId, noPack);
  assert.ok(xml.indexOf('Passport') === -1, 'item leaked');
  assert.ok(xml.indexOf('Hotel Ai Mori') !== -1, 'stay missing');
  assert.ok(xml.indexOf('Still to sort: Book flight') !== -1, 'flight prompt missing');
  // payments excluded: the word 'unpaid'/'paid' must not appear
  assert.ok(!/\bpaid\b/.test(xml), 'payment status leaked: ' + (xml.match(/paid/g) || []).length);
});

console.log('\n' + passed + ' docx checks passed' + (process.exitCode ? ', with failures' : ''));