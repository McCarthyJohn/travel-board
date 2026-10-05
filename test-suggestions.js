/*
 * Tests for packing suggestions (the Suggestions sheet's engine).
 * Run with:  node test-suggestions.js
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

function newStateWithBag(bagTitle) {
  var s = TB.createState('T');
  var home = TB.children(s, s.rootId).filter(function (n) { return n.kind === 'home'; })[0];
  var packing = TB.children(s, home.id).filter(function (n) { return n.kind === 'packing'; })[0];
  var bag = TB.addNote(s, { parentId: packing.id, kind: 'bag', title: bagTitle || 'Shirts cube' });
  return { s: s, packing: packing, bag: bag };
}

test('the library is generic, grouped and non-empty', function () {
  assert.ok(TB.SUGGESTIONS.length >= 4, 'too few categories');
  TB.SUGGESTIONS.forEach(function (c) {
    assert.ok(c.id && c.label && Array.isArray(c.items) && c.items.length >= 3,
      'category ' + c.id + ' is malformed');
  });
  var ids = TB.SUGGESTIONS.map(function (c) { return c.id; });
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate category ids');
});

test('toiletries and shirts-named bags pre-select the right category', function () {
  assert.strictEqual(TB.suggestCategoryFor('Toiletries'), 'toiletries');
  assert.strictEqual(TB.suggestCategoryFor('Toiletry liquids bag'), 'toiletries');
  assert.strictEqual(TB.suggestCategoryFor('Shirts cube'), 'clothes');
  assert.strictEqual(TB.suggestCategoryFor('Polos bag'), 'clothes');
  assert.strictEqual(TB.suggestCategoryFor('Document pouch'), 'documents');
  assert.strictEqual(TB.suggestCategoryFor('Tech pouch'), 'tech');
  assert.strictEqual(TB.suggestCategoryFor('Suitcase'), null); // no guess
  assert.strictEqual(TB.suggestCategoryFor('John\u2019s case'), null);
});

test('adding ticked suggestions creates real item notes, unticked creates nothing', function () {
  var v = newStateWithBag('Shirts cube');
  // Simulates what the sheet does for its ticked rows:
  ['Polos', 'T-shirts'].forEach(function (label) {
    TB.addNote(v.s, { parentId: v.bag.id, kind: 'item', title: label });
  });
  assert.deepStrictEqual(titles(v.s, v.bag.id), ['Polos', 'T-shirts']);
  var polo = v.s.notes.filter(function (n) { return n.title === 'Polos'; })[0];
  assert.strictEqual(polo.kind, 'item');
  assert.strictEqual(polo.checked, false); // packed tick starts empty
  assert.strictEqual(polo.status, 'confirmed'); // structural: no prompt
});

test('existing titles in the bag are detectable, case-insensitively', function () {
  var v = newStateWithBag('Toiletries');
  TB.addNote(v.s, { parentId: v.bag.id, kind: 'item', title: 'Toothbrush' });
  var have = TB.existingTitles(v.s, v.bag.id);
  assert.strictEqual(have['toothbrush'], true);
  assert.strictEqual(have['razor'], undefined);
});

test('suggestions never leak into a trip on their own', function () {
  var s = TB.createState('T');
  var before = s.notes.filter(function (n) { return n.kind === 'item'; }).length;
  assert.strictEqual(before, 0, 'sample trip data leaked into a new trip');
  // the library itself holds no trip data — only generic labels
  TB.SUGGESTIONS.forEach(function (c) {
    c.items.forEach(function (label) {
      assert.ok(!/Melbourne|Sydney|Italy|hotel \d/i.test(label), 'sample data in library: ' + label);
    });
  });
});

console.log('\n' + passed + ' suggestions checks passed' + (process.exitCode ? ', with failures' : ''));