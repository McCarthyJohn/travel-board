/*
 * Tests for custom kinds (the Kinds manager). Run with:  node test-kinds.js
 * No dependencies. Exits with a non-zero code if any check fails.
 */
'use strict';
var assert = require('assert');
var TB = require('./model.js');

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

test('a custom kind is registered, addable and saves in the trip document', function () {
  var s = TB.createState('Italy');
  var r = TB.addCustomKind(s, { label: 'Car hire', colour: 'blue', holds: 'booking', prompt: 'To be booked' });
  assert.ok(r, 'addCustomKind returned nothing');
  assert.strictEqual(r.key, 'car-hire');
  assert.strictEqual(TB.kindOf('car-hire').label, 'Car hire');
  assert.ok(TB.addableKinds().indexOf('car-hire') !== -1, 'custom kind not addable');
  var n = TB.addNote(s, { parentId: s.rootId, kind: 'car-hire', title: 'Sigma rental' });
  assert.strictEqual(n.kind, 'car-hire');
  assert.strictEqual(n.status, 'placeholder'); // has a prompt → starts placeholder
  TB.updateNote(s, n.id, { reference: 'SIG-1', startDate: '2027-04-10', endDate: '2027-04-14' });
  assert.strictEqual(TB.getNote(s, n.id).status, 'confirmed'); // booking kind confirms on reference
  var doc = JSON.parse(TB.exportJSON(s));
  assert.strictEqual(doc.customKinds.length, 1);
  assert.strictEqual(doc.customKinds[0].label, 'Car hire');
});

test('holds decide the edit fields a custom kind gets', function () {
  var s = TB.createState('T');
  var b = TB.addCustomKind(s, { label: 'BookingK', holds: 'booking' });
  var l = TB.addCustomKind(s, { label: 'ListingK', holds: 'listing' });
  var t = TB.addCustomKind(s, { label: 'TickK', holds: 'tick' });
  var p = TB.addCustomKind(s, { label: 'SimpleK', holds: 'simple' });
  assert.deepStrictEqual(TB.kindOf(b.key).fields, ['dates', 'times', 'reference']);
  assert.deepStrictEqual(TB.kindOf(l.key).fields, ['dates', 'times']);
  assert.deepStrictEqual(TB.kindOf(t.key).fields, ['checked']);
  assert.deepStrictEqual(TB.kindOf(p.key).fields, []);
  assert.deepStrictEqual(TB.kindOf(b.key).starters, []);
});

test('starter notes with a valid kind are created inside a new note of a custom kind', function () {
  var s = TB.createState('T');
  var r = TB.addCustomKind(s, { label: 'Car hire', holds: 'booking',
    starters: [{ kind: 'payment', title: 'Payment' }, { kind: 'other', title: 'Pick-up details' }] });
  var n = TB.addNote(s, { parentId: s.rootId, kind: r.key });
  assert.deepStrictEqual(TB.children(s, n.id).map(function (c) { return c.title; }), ['Payment', 'Pick-up details']);
});

test('an invalid colour or name cannot break the kind list', function () {
  var s = TB.createState('T');
  var bad = TB.addCustomKind(s, { label: '', colour: 'neon' });
  assert.strictEqual(bad, null, 'blank label was accepted');
  var odd = TB.addCustomKind(s, { label: 'Weird Colour', colour: 'neon' });
  assert.strictEqual(TB.kindOf(odd.key).colour, 'purple'); // falls back safely
});

test('duplicate names get unique keys, both stay usable', function () {
  var s = TB.createState('T');
  var a = TB.addCustomKind(s, { label: 'Car hire' });
  var b = TB.addCustomKind(s, { label: 'Car hire' });
  assert.notStrictEqual(a.key, b.key);
  assert.strictEqual(TB.kindOf(a.key).label, 'Car hire');
  assert.strictEqual(TB.kindOf(b.key).label, 'Car hire');
});

test('removing a custom kind turns its notes into Other and deletes nothing', function () {
  delete require.cache[require.resolve('./model.js')];
  var T = require('./model.js'); // fresh module: no customs left over from other tests
  var s = T.createState('T');
  var r = T.addCustomKind(s, { label: 'Ferry', holds: 'booking', prompt: 'To be booked' });
  var n = T.addNote(s, { parentId: s.rootId, kind: r.key, title: 'BsB ferry' });
  var before = s.notes.length;
  assert.strictEqual(T.removeCustomKind(s, r.key), true);
  assert.strictEqual(T.removeCustomKind(s, r.key), false); // already gone
  var note = T.getNote(s, n.id);
  assert.ok(note, 'note was deleted — must never happen');
  assert.strictEqual(note.kind, 'other');
  assert.strictEqual(note.title, 'BsB ferry'); // details kept
  assert.strictEqual(s.notes.length, before);
  assert.ok(T.addableKinds().indexOf(r.key) === -1, 'removed kind still offered');
  assert.strictEqual(T.customRecipes().length, 0);
  assert.strictEqual((s.customKinds || []).length, 0, 'recipe not removed from document');
});

test('built-in kinds can never be removed', function () {
  var s = TB.createState('T');
  assert.strictEqual(TB.removeCustomKind(s, 'flight'), false);
  assert.strictEqual(TB.removeCustomKind(s, 'place'), false);
  assert.ok(TB.KINDS.flight, 'flight kind was removed!');
});

test('restoring a backup merges unknown custom kinds, so notes keep their kind', function () {
  var s = TB.createState('Italy');
  var r = TB.addCustomKind(s, { label: 'Car hire', colour: 'blue', holds: 'booking' });
  var rental = TB.addNote(s, { parentId: s.rootId, kind: r.key, title: 'Sigma rental' });
  var backup = TB.exportJSON(s);

  // A fresh module (another device / cleared session) knows no custom kinds.
  delete require.cache[require.resolve('./model.js')];
  var TB2 = require('./model.js');
  // Without merge the notes would fall back to other.
  var noMerge = TB2.importJSON(backup);
  var noMergeNote = TB2.getNote(noMerge, rental.id);
  assert.strictEqual(noMergeNote.kind, 'other', 'expected fallback without merge');

  // Fresh module again, now WITH merge.
  delete require.cache[require.resolve('./model.js')];
  var TB3 = require('./model.js');
  var merged = TB3.importJSON(backup, true);
  var note = TB3.getNote(merged, rental.id);
  assert.strictEqual(TB3.kindOf(note.kind).label, 'Car hire', 'merge lost the custom kind');
  assert.deepStrictEqual(TB3.kindOf(note.kind).fields, ['dates', 'times', 'reference']);
});

test('an old backup (no customKinds at all) still restores cleanly', function () {
  var legacy = {
    version: 1, rootId: 'a',
    notes: [
      { id: 'a', parentId: null, kind: 'trip', title: 'Old trip', position: 0 },
      { id: 'b', parentId: 'a', kind: 'other', title: 'Planning', position: 0 }
    ]
  };
  var s = TB.importJSON(JSON.stringify(legacy), true);
  assert.strictEqual(TB.getNote(s, 'a').title, 'Old trip');
  assert.strictEqual((s.customKinds || []).length, 0);
});

test('every kind including customs passes the completeness audit', function () {
  var s = TB.createState('T');
  TB.addCustomKind(s, { label: 'Car hire', colour: 'green', holds: 'booking',
    starters: [{ kind: 'payment', title: 'Payment' }] });
  Object.keys(TB.KINDS).forEach(function (k) {
    var def = TB.KINDS[k];
    ['label', 'colour', 'prompt', 'fields', 'starters'].forEach(function (key) {
      assert.ok(def[key] !== undefined, k + ' is missing ' + key);
    });
    def.starters.forEach(function (st) {
      assert.ok(TB.KINDS[st.kind], k + ' has a starter with unknown kind ' + st.kind);
    });
  });
});

console.log('\n' + passed + ' kinds checks passed' + (process.exitCode ? ', with failures' : ''));