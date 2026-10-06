/*
 * Travel Board attachments: file storage in IndexedDB, metadata on the note.
 *
 * Design (decided):
 *  - Files live in IndexedDB (per-device, per-browser), keyed 'att_<noteId>_<i>'.
 *  - The note keeps a plain-text array `attachments`: [{name, size, type, key}] —
 *    so text backup/restore keeps the names (with a "file not on this device"
 *    marker), never the binary. Attachments move device-to-device only via the
 *    .tripboard export file (see packTripFile / unpackTripFile).
 *  - No server, no cloud: files never leave the device except inside an
 *    explicitly shared trip file.
 */
'use strict';
var TBAtt = (function () {
  var HAVE_IDB = (typeof indexedDB !== 'undefined');
  var memory = {}; // fallback so tests and odd browsers still function (not persistent)
  var DB_NAME = 'travelboard-attachments';
  var DB_VERSION = 1;
  var STORE = 'files';
  var MAX_BYTES = 10 * 1024 * 1024; // 10 MB guard — warn, not block
  var dbPromise = null;

  // Resolves to a STORE directly (tx()'s contract returns a store, not a transaction).
  function memoryStore() {
    return Promise.resolve({
      put: function (v, k) { memory[k] = v; return dummyReq(undefined); },
      get: function (k) { return dummyReq(memory[k]); },
      delete: function (k) { delete memory[k]; return dummyReq(undefined); },
      getAllKeys: function () { return dummyReq(Object.keys(memory)); }
    });
  }
  function dummyReq(v) {
    var req = { onsuccess: null, onerror: null, result: v };
    setTimeout(function () { if (req.onsuccess) req.onsuccess(); }, 0);
    return req;
  }

  function openDb() {
    if (!HAVE_IDB) return Promise.reject(new Error('no-idb'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open file storage')); };
      req.onblocked = function () { reject(new Error('File storage is busy — close other tabs and try again')); };
    });
    return dbPromise;
  }

  function tx(mode) {
    return openDb().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    }, function () {
      return memoryStore(); // no IndexedDB (tests / unsupported browser): volatile storage
    });
  }

  // Promise wrappers
  function reqAsPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('File storage error')); };
    });
  }

  function putFile(key, blob) {
    return tx('readwrite').then(function (store) {
      return reqAsPromise(store.put(blob, key));
    });
  }

  function getFile(key) {
    return tx('readonly').then(function (store) {
      return reqAsPromise(store.get(key));
    });
  }

  function deleteFile(key) {
    return tx('readwrite').then(function (store) {
      return reqAsPromise(store.delete(key));
    });
  }

  // Which file keys are actually referenced by the trip (for pruning orphans).
  function usedKeys(notes) {
    var used = {};
    (notes || []).forEach(function (n) {
      (n.attachments || []).forEach(function (a) { if (a && a.key) used[a.key] = true; });
    });
    return used;
  }

  // Remove stored files no longer referenced by any note (after restores/replaces).
  function pruneOrphans(notes) {
    return tx('readonly').then(function (store) {
      return reqAsPromise(store.getAllKeys());
    }).then(function (keys) {
      var used = usedKeys(notes);
      var dead = keys.filter(function (k) { return !used[k]; });
      return Promise.all(dead.map(deleteFile)).then(function () { return dead.length; });
    });
  }

  // Read the user's picked File into storage and return its metadata record.
  function attach(noteId, file) {
    var key = 'att_' + noteId + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return putFile(key, file).then(function () {
      return { name: file.name || 'file', size: file.size || 0, type: file.type || '', key: key };
    });
  }

  function replaceFile(key, file) {
    return putFile(key, file);
  }

  function removeAttachment(att) {
    return att && att.key ? deleteFile(att.key) : Promise.resolve();
  }

  // human size: 240 KB · 1.2 MB
  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (Math.round(bytes / 1024)) + ' KB';
    return (Math.round(bytes / (1024 * 1024) * 10) / 10) + ' MB';
  }

  // ---------- .tripboard file (trip + attachments in one file) ----------

  // manifest: {format:'travelboard-trip', version:1, trip:'<json string>',
  //            attachments:[{name,size,type,key,payloadBase64}]}
  // (payload omitted when the file is not on this device)
  function b64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function bytesOf(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(new Error('Could not read ' + 'file')); };
      r.readAsArrayBuffer(blob);
    });
  }

  // Build the full trip file: JSON trip + every attachment present on this device.
  function packTripFile(tripJson, notes, progress) {
    var manifest = {
      format: 'travelboard-trip',
      version: 1,
      trip: tripJson,
      attachments: []
    };
    var metas = [];
    (notes || []).forEach(function (n) {
      (n.attachments || []).forEach(function (a) {
        if (a && a.key && !metas.some(function (m) { return m.key === a.key; })) metas.push(a);
      });
    });
    var chain = Promise.resolve();
    metas.forEach(function (a) {
      chain = chain.then(function () {
        return getFile(a.key).then(function (blob) {
          if (!blob) return; // not on this device — leave payload out
          return bytesOf(blob).then(function (u8) {
            manifest.attachments.push({ name: a.name, size: a.size, type: a.type, key: a.key, payloadBase64: b64(u8) });
          });
        });
      });
    });
    return chain.then(function () {
      if (progress) progress(manifest.attachments.length, metas.length);
      return manifest;
    });
  }

  // Read a .tripboard file (as text) and return {tripJson, files:[{key,blob}]}.
  function unpackTripFile(text) {
    var m = JSON.parse(text); // throws with a poor message if not JSON — caller wraps
    if (!m || m.format !== 'travelboard-trip' || typeof m.trip !== 'string') {
      throw new Error('That file is not a Travel Board trip file.');
    }
    var files = (m.attachments || []).filter(function (a) { return a && a.payloadBase64; }).map(function (a) {
      return { key: a.key, blob: new Blob([unb64(a.payloadBase64)], { type: a.type || 'application/octet-stream' }) };
    });
    return { tripJson: m.trip, files: files };
  }

  // Store all files from an unpacked trip file.
  function storeFiles(files) {
    return Promise.all(files.map(function (f) { return putFile(f.key, f.blob); }));
  }

  return {
    MAX_BYTES: MAX_BYTES,
    attach: attach,
    replaceFile: replaceFile,
    getFile: getFile,
    deleteFile: deleteFile,
    removeAttachment: removeAttachment,
    pruneOrphans: pruneOrphans,
    usedKeys: usedKeys,
    humanSize: humanSize,
    packTripFile: packTripFile,
    unpackTripFile: unpackTripFile,
    storeFiles: storeFiles
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = TBAtt;