/*
 * Tests for attachments (files) and the .tripboard trip file. Run: node test-attachments.js
 * IndexedDB does not exist in Node, so the storage layer is stubbed with an
 * in-memory map exercising the same API surface.
 */
'use strict';
var assert = require('assert');
var TB = require('./model.js');
var fs = require('fs');
var vm = require('vm');

var passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('ok   - ' + name); }
  catch (e) { console.error('FAIL - ' + name + '\n       ' + e.message); process.exitCode = 1; }
}


// ---- stubs first, then module under test ----

var TBAtt = require('./attachments.js');

var passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('ok   - ' + name); }
  catch (e) { console.error('FAIL - ' + name + '\n       ' + e.message); process.exitCode = 1; }
}

// ---- stub the browser bits TBAtt uses (btoa/atob/FileReader/Blob) ----
var fileStore = {}; // key -> fake blob {bytes, type}
function FakeBlob(parts, opts) {
  this.bytes = parts[0];
  this.type = (opts && opts.type) || '';
}
FakeBlob.prototype.size = undefined;

global.Blob = FakeBlob;
global.atob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };
global.btoa = function (s) { return Buffer.from(s, 'binary').toString('base64'); };
// FileReader stub for bytesOf
global.FileReader = function () {
  var self = this;
  this.readAsArrayBuffer = function (blob) {
    setTimeout(function () {
      self.result = blob.bytes.buffer || blob.bytes;
      if (self.onload) self.onload();
    }, 0);
  };
};
// minimal File-like
function FakeFile(name, bytes, type) {
  FakeBlob.call(this, [bytes], { type: type });
  this.name = name;
  this.size = bytes.length;
}
// IndexedDB stub
var objStoreMock = null;
var objStore = {
  put: function (v, k) { fileStore[k] = v; return fakeReq(undefined); },
  get: function (k) { return fakeReqGet(fileStore[k]); },
  delete: function (k) { delete fileStore[k]; return fakeReq(undefined); },
  getAllKeys: function () { return fakeReqGet(Object.keys(fileStore)); }
};
function fakeReq(v) { var r = { result: v }; setTimeout(function () { r.onsuccess && r.onsuccess(); }, 0); return r; }
function fakeReqGet(v) { var r = { result: v }; setTimeout(function () { r.onsuccess && r.onsuccess(); }, 0); return r; }
global.indexedDB = {
  open: function () {
    var db = {
      transaction: function () { return { objectStore: function () { return objStore; } }; },
      createObjectStore: function () { return objStore; }
    };
    var r = { result: db };
    setTimeout(function () { r.onsuccess && r.onsuccess(); }, 0);
    return r;
  }
};

// patch Promise-based attach/getFile deleteFile to be sync-ish via the stubs (they already are)

// Node has no microtask pump here for our setTimeout-based stubs; use async wrapper instead.
(async function run() {
  var t = function (name, fn) {
    return Promise.resolve().then(fn).then(function () { passed += 1; console.log('ok   - ' + name); },
      function (e) { console.error('FAIL - ' + name + '\n       ' + (e && e.message)); process.exitCode = 1; });
  };

  await t('attach stores the file and returns clean metadata', async function () {
    var pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4]);
    var file = new FakeFile('e-ticket.pdf', pdfBytes, 'application/pdf');
    var meta = await TBAtt.attach('n1', file);
    assert.ok(meta.key && meta.key.indexOf('att_n1_') === 0, 'key shape wrong');
    assert.strictEqual(meta.name, 'e-ticket.pdf');
    assert.strictEqual(meta.size, 8);
    assert.strictEqual(meta.type, 'application/pdf');
  });

  await t('trip file packs the trip JSON plus attachment payloads', async function () {
    var pdfBytes = new Uint8Array([9, 9, 8, 7]);
    var file = new FakeFile('booking.pdf', pdfBytes, 'application/pdf');
    var meta = await TBAtt.attach('n1', file);
    var notes = [{ id: 'n1', attachments: [meta] }];
    var manifest = await TBAtt.packTripFile('{"trip":true}', notes);
    assert.strictEqual(manifest.format, 'travelboard-trip');
    assert.strictEqual(manifest.trip, '{"trip":true}');
    assert.strictEqual(manifest.attachments.length, 1);
    var a = manifest.attachments[0];
    assert.strictEqual(a.name, 'booking.pdf');
    var decoded = Buffer.from(a.payloadBase64, 'base64');
    assert.deepStrictEqual(Array.from(decoded), [9, 9, 8, 7], 'payload bytes changed');
  });

  await t('unpack validates and refuses non-tripboard content', async function () {
    var bad = await new Promise(function (res) {
      try { TBAtt.unpackTripFile('{"hello":"world"}'); res('no-throw'); }
      catch (e) { res(e.message); }
    });
    assert.ok(String(bad).indexOf('not a Travel Board trip file') !== -1, 'bad content accepted: ' + bad);
    var good = TBAtt.unpackTripFile(JSON.stringify({
      format: 'travelboard-trip', version: 1, trip: '{"x":1}',
      attachments: [{ key: 'att_a_1', name: 'a.pdf', type: 'application/pdf', payloadBase64: Buffer.from([1, 2]).toString('base64') }]
    }));
    assert.strictEqual(good.tripJson, '{"x":1}');
    assert.strictEqual(good.files.length, 1);
    await TBAtt.storeFiles(good.files);
    var blob = await TBAtt.getFile('att_a_1');
    assert.ok(blob, 'stored file missing');
  });

  await t('model: attachments ride through export/import with names kept', function () {
    var s = TB.createState('Italy');
    var f = TB.addJourney(s, { parentId: s.rootId, mode: 'flight', to: 'Rome' }).journey;
    f.attachments.push({ name: 'e-ticket.pdf', size: 12345, type: 'application/pdf', key: 'att_nx_9' });
    var copy = TB.importJSON(TB.exportJSON(s));
    var fc = TB.getNote(copy, f.id);
    assert.strictEqual(fc.attachments.length, 1);
    assert.strictEqual(fc.attachments[0].name, 'e-ticket.pdf');
    assert.strictEqual(fc.attachments[0].key, 'att_nx_9');
    // malformed attachment records are dropped, not fatal
    f.attachments.push({ name: '' });
    f.attachments.push(null);
    var copy2 = TB.importJSON(TB.exportJSON(s));
    assert.strictEqual(TB.getNote(copy2, f.id).attachments.length, 1, 'malformed rows not filtered');
  });

  await t('model: fresh notes start with an empty attachments array', function () {
    var s = TB.createState('Italy');
    TB.children(s, s.rootId).forEach(function (n) {
      assert.deepStrictEqual(n.attachments, []);
    });
  });

  await t('pruneOrphans removes only unreferenced files', async function () {
    var keep = await TBAtt.attach('nA', new FakeFile('keep.pdf', new Uint8Array([1]), 'application/pdf'));
    var drop = await TBAtt.attach('nB', new FakeFile('drop.pdf', new Uint8Array([2]), 'application/pdf'));
    var notes = [{ id: 'nA', attachments: [keep] }];
    var removed = await TBAtt.pruneOrphans(notes);
    assert.ok(removed >= 1, 'nothing pruned');
    var still = await TBAtt.getFile(keep.key);
    assert.ok(still, 'referenced file was pruned!');
    var gone = await TBAtt.getFile(drop.key);
    assert.strictEqual(gone, undefined, 'orphan survived');
  });

  await t('humanSize reads naturally', function () {
    assert.strictEqual(TBAtt.humanSize(0), '0 B');
    assert.strictEqual(TBAtt.humanSize(240 * 1024), '240 KB');
    assert.strictEqual(TBAtt.humanSize(1.2 * 1024 * 1024), '1.2 MB');
  });

  console.log('\n' + passed + ' attachment checks passed' + (process.exitCode ? ', with failures' : ''));
  fs.writeFileSync('/tmp/att-tests-done', '1');
})();