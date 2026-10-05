/*
 * Tests for the note model. Run with:  node test.js
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

function titles(state, id) {
  return TB.children(state, id).map(function (n) { return n.title; });
}

test('a new trip has Planning, Documents, Money and Home, and Home has its starters', function () {
  var s = TB.createState('Italy');
  var root = TB.getNote(s, s.rootId);
  assert.strictEqual(root.kind, 'trip');
  assert.strictEqual(root.parentId, null);
  assert.deepStrictEqual(titles(s, s.rootId), ['Planning', 'Documents', 'Money', 'Home']);
  var home = TB.children(s, s.rootId)[3];
  assert.deepStrictEqual(titles(s, home.id), ['Packing', 'Getting to the airport']);
  var packingList = TB.children(s, home.id)[0];
  assert.strictEqual(packingList.kind, 'packing');
  assert.deepStrictEqual(titles(s, packingList.id), ['Suitcase', 'Carry-on', 'Toiletries', 'Document pouch']);
});

test('structural kinds start confirmed, kinds with prompts start as placeholders', function () {
  var s = TB.createState('T');
  var home = TB.children(s, s.rootId)[3];
  assert.strictEqual(home.status, 'confirmed');
  var j = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Singapore' });
  assert.strictEqual(j.journey.status, 'placeholder');
  assert.strictEqual(TB.promptFor(j.journey), 'Book flight');
  assert.strictEqual(j.place.status, 'placeholder');
  assert.strictEqual(TB.promptFor(j.place), 'Add dates');
});

test('Where next creates a journey and a place with starter notes', function () {
  var s = TB.createState('T');
  var r = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Singapore' });
  assert.strictEqual(r.journey.kind, 'flight');
  assert.strictEqual(r.journey.title, 'Home → Singapore');
  assert.strictEqual(r.journey.from, 'Home');
  assert.strictEqual(r.journey.to, 'Singapore');
  assert.strictEqual(r.place.kind, 'place');
  assert.deepStrictEqual(titles(s, r.place.id), ['Stay', 'Things to do', 'Eat']);
  assert.deepStrictEqual(titles(s, s.rootId), ['Planning', 'Documents', 'Money', 'Home', 'Home → Singapore', 'Singapore']);
  // A new flight carries its booking detail kit.
  var kits = titles(s, r.journey.id);
  assert.deepStrictEqual(kits, ['Payment', 'Seats & bags']);
  var stay = s.notes.filter(function (n) { return n.kind === 'stay'; })[0];
  assert.deepStrictEqual(titles(s, stay.id), ['Payment', 'Address & contact']);
});

test('the Italy route builds in four taps', function () {
  var s = TB.createState('Italy');
  TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Singapore' });
  TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' });
  TB.addJourney(s, { parentId: s.rootId, mode: 'train', to: 'Venice' });
  var t = titles(s, s.rootId);
  assert.deepStrictEqual(t.slice(4), [
    'Home → Singapore', 'Singapore',
    'Singapore → Rome', 'Rome',
    'Rome → Venice', 'Venice'
  ]);
});

test('mode "none" adds only a place; blank destination gets a default', function () {
  var s = TB.createState('T');
  var r = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: '  ' });
  assert.strictEqual(r.journey, null);
  assert.strictEqual(r.place.title, 'New place');
});

test('inserting at an index puts the pair in the middle and keeps order', function () {
  var s = TB.createState('T');
  TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' });
  TB.addJourney(s, { parentId: s.rootId, mode: 'train', to: 'Venice' });
  TB.addJourney(s, { parentId: s.rootId, mode: 'train', to: 'Florence', index: 6 });
  var t = titles(s, s.rootId);
  assert.deepStrictEqual(t.slice(4), [
    'Home → Rome', 'Rome', 'Rome → Florence', 'Florence', 'Rome → Venice', 'Venice'
  ]);
  var pos = TB.children(s, s.rootId).map(function (n) { return n.position; });
  assert.deepStrictEqual(pos, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('nights are derived only from two valid, ordered dates', function () {
  assert.strictEqual(TB.nights({ startDate: '2027-03-10', endDate: '2027-03-13' }), 3);
  assert.strictEqual(TB.nights({ startDate: '2027-03-10', endDate: '2027-03-10' }), 0);
  assert.strictEqual(TB.nights({ startDate: '2027-03-10', endDate: '' }), null);
  assert.strictEqual(TB.nights({ startDate: '2027-03-13', endDate: '2027-03-10' }), null);
  assert.strictEqual(TB.nights({ startDate: '2027-02-30', endDate: '2027-03-10' }), null);
  assert.strictEqual(TB.nights({ startDate: '2028-02-28', endDate: '2028-03-01' }), 2);
});

test('a place is confirmed once both dates are valid', function () {
  var s = TB.createState('T');
  var p = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'Venice' }).place;
  TB.updateNote(s, p.id, { startDate: '2027-03-10' });
  assert.strictEqual(p.status, 'placeholder');
  TB.updateNote(s, p.id, { endDate: '2027-03-13' });
  assert.strictEqual(p.status, 'confirmed');
});

test('adding a reference to a booking confirms it; explicit status wins', function () {
  var s = TB.createState('T');
  var f = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' }).journey;
  TB.updateNote(s, f.id, { reference: 'ABC123' });
  assert.strictEqual(f.status, 'confirmed');
  TB.updateNote(s, f.id, { status: 'placeholder' });
  assert.strictEqual(f.status, 'placeholder');
});

test('only id and kind are required; blank titles fall back to the kind label', function () {
  var s = TB.createState('T');
  var n = TB.addNote(s, { parentId: s.rootId, kind: 'restaurant' });
  assert.strictEqual(n.title, 'Restaurant');
  var bad = TB.addNote(s, { parentId: s.rootId, kind: 'not-a-kind', title: 'x' });
  assert.strictEqual(bad.kind, 'other');
  TB.updateNote(s, n.id, { title: '   ' });
  assert.strictEqual(n.title, 'Restaurant');
});

test('invalid dates and statuses are ignored', function () {
  var s = TB.createState('T');
  var n = TB.addNote(s, { parentId: s.rootId, kind: 'stay', title: 'Hotel' });
  TB.updateNote(s, n.id, { startDate: 'tomorrow', status: 'maybe' });
  assert.strictEqual(n.startDate, '');
  assert.strictEqual(n.status, 'placeholder');
});

test('the trip kind cannot be assigned to another note', function () {
  var s = TB.createState('T');
  var n = TB.addNote(s, { parentId: s.rootId, kind: 'other', title: 'x' });
  TB.updateNote(s, n.id, { kind: 'trip' });
  assert.strictEqual(n.kind, 'other');
});

test('deleting a note removes everything inside it and renumbers siblings', function () {
  var s = TB.createState('T');
  var r = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' });
  var before = s.notes.length;
  // everything under the place: starters, their kits, kits' contents
  var inside = (function countDeep(id) {
    var n = TB.children(s, id).length;
    TB.children(s, id).forEach(function (c) { n += countDeep(c.id); });
    return n;
  })(r.place.id);
  assert.strictEqual(TB.deleteNote(s, r.place.id), true);
  assert.strictEqual(s.notes.length, before - 1 - inside);
  assert.strictEqual(TB.getNote(s, r.place.id), null);
  var pos = TB.children(s, s.rootId).map(function (n) { return n.position; });
  assert.deepStrictEqual(pos, [0, 1, 2, 3, 4]);
});

test('the trip itself cannot be deleted', function () {
  var s = TB.createState('T');
  assert.strictEqual(TB.deleteNote(s, s.rootId), false);
});

test('moving swaps position only and never touches dates', function () {
  var s = TB.createState('T');
  var a = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'A' }).place;
  var b = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'B' }).place;
  TB.updateNote(s, a.id, { startDate: '2027-01-01', endDate: '2027-01-03' });
  assert.strictEqual(TB.moveNote(s, b.id, -1), true);
  assert.deepStrictEqual(titles(s, s.rootId), ['Planning', 'Documents', 'Money', 'Home', 'B', 'A']);
  assert.strictEqual(a.startDate, '2027-01-01');
  assert.strictEqual(TB.moveNote(s, TB.children(s, s.rootId)[0].id, -1), false);
});

test('date clashes flag a place that starts before the previous one ends', function () {
  var s = TB.createState('T');
  var a = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'A' }).place;
  var b = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'B' }).place;
  TB.updateNote(s, a.id, { startDate: '2027-01-01', endDate: '2027-01-05' });
  TB.updateNote(s, b.id, { startDate: '2027-01-04', endDate: '2027-01-08' });
  var flagged = TB.dateClashes(s, s.rootId);
  assert.strictEqual(!!flagged[b.id], true);
  assert.strictEqual(!!flagged[a.id], false);
  TB.updateNote(s, b.id, { startDate: '2027-01-05' });
  assert.strictEqual(Object.keys(TB.dateClashes(s, s.rootId)).length, 0);
});

test('export then import gives back the same trip', function () {
  var s = TB.createState('Italy');
  TB.addJourney(s, { parentId: s.rootId, mode: 'train', to: 'Venice' });
  var home = TB.children(s, s.rootId)[3];
  var packing = TB.children(s, home.id)[0];
  var item = TB.addNote(s, { parentId: packing.id, kind: 'item', title: 'Passport' });
  TB.updateNote(s, item.id, { checked: true });
  var copy = TB.importJSON(TB.exportJSON(s));
  assert.strictEqual(copy.rootId, s.rootId);
  assert.strictEqual(copy.notes.length, s.notes.length);
  assert.strictEqual(TB.getNote(copy, item.id).checked, true);
  assert.deepStrictEqual(titles(copy, copy.rootId), titles(s, s.rootId));
});

test('times follow the rules: optional, validated, never shift dates', function () {
  var s = TB.createState('T');
  var f = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' }).journey;
  TB.updateNote(s, f.id, { startTime: '06:45', endTime: '14:20' });
  assert.strictEqual(f.startTime, '06:45');
  assert.strictEqual(f.endTime, '14:20');
  TB.updateNote(s, f.id, { startTime: '6:45am', endTime: '25:99' });
  assert.strictEqual(f.startTime, '');
  assert.strictEqual(f.endTime, '');
  // times live alongside dates, never replace them
  var a = TB.addJourney(s, { parentId: s.rootId, mode: 'none', to: 'A' }).place;
  TB.updateNote(s, a.id, { startDate: '2027-05-01', endDate: '2027-05-04', startTime: '09:00' });
  assert.deepStrictEqual([a.startDate, a.endDate], ['2027-05-01', '2027-05-04']);
  assert.strictEqual(TB.nights(a), 3);
});

test('a flight starter kit has payment and seats, payment can be ticked paid', function () {
  var s = TB.createState('T');
  var f = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' }).journey;
  var pay = TB.children(s, f.id).filter(function (n) { return n.kind === 'payment'; })[0];
  var seats = TB.children(s, f.id).filter(function (n) { return n.kind === 'seat'; })[0];
  assert.ok(pay && seats);
  assert.strictEqual(pay.status, 'placeholder');
  TB.updateNote(s, pay.id, { title: 'Visa ...4417 $412 paid', checked: true });
  assert.strictEqual(TB.getNote(s, pay.id).checked, true);
  TB.updateNote(s, pay.id, { checked: true });
  assert.strictEqual(TB.getNote(s, pay.id).status, 'confirmed');
});

test('import rejects bad data with a plain message', function () {
  assert.throws(function () { TB.importJSON('not json'); }, /not valid/);
  assert.throws(function () { TB.importJSON('{"notes":[]}'); }, /no notes/);
  assert.throws(function () {
    TB.importJSON(JSON.stringify({ notes: [{ id: 'a', parentId: null }, { id: 'b', parentId: null }] }));
  }, /exactly one trip/);
  assert.throws(function () {
    TB.importJSON(JSON.stringify({ notes: [{ id: 'a', parentId: null }, { id: 'b', parentId: 'zzz' }] }));
  }, /missing parent/);
  assert.throws(function () {
    TB.importJSON(JSON.stringify({ notes: [{ id: 'a', parentId: null }, { id: 'b', parentId: 'c' }, { id: 'c', parentId: 'b' }] }));
  }, /loop/);
  assert.throws(function () {
    TB.importJSON(JSON.stringify({ notes: [{ id: 'a', parentId: null }, { id: 'a', parentId: null }] }));
  }, /same id/);
});

test('nesting has no limit in the data', function () {
  var s = TB.createState('T');
  var parent = s.rootId;
  for (var i = 0; i < 8; i++) {
    parent = TB.addNote(s, { parentId: parent, kind: 'other', title: 'level ' + i }).id;
  }
  assert.strictEqual(TB.pathTo(s, parent).length, 9);
});

test('every kind is complete and every starter points at a real kind', function () {
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

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ', with failures' : ''));
