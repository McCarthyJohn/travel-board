/*
 * Travel Board - note model
 *
 * Pure logic, no browser APIs. Works in the browser (window.TB) and in Node
 * (require('./model.js')) so it can be tested without a browser.
 *
 * Everything is a note. A note may hold child notes to any depth.
 * The whole trip is one flat array of notes; children are found by parentId.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TB = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE_VERSION = 2;

  /*
   * Kinds are data, not logic. To add a new kind (e.g. "ferry"), add one entry.
   *   label    shown on the note
   *   colour   CSS class suffix (see styles.css: .k-<colour>)
   *   prompt   text shown while the note is still a placeholder ('' = none)
   *   fields   which extra fields the edit sheet shows:
   *            'dates' | 'route' | 'reference' | 'checked'
   *   starters child notes created automatically when a note of this kind is made
   * Kinds with an empty prompt are structural and start as 'confirmed' (solid).
   */
  var KINDS = {
    trip: {
      label: 'Trip', colour: 'grey', prompt: '', fields: [],
      starters: [
        { kind: 'other', title: 'Planning' },
        { kind: 'documents', title: 'Documents' },
        { kind: 'money', title: 'Money' },
        { kind: 'home', title: 'Home' }
      ]
    },
    home: {
      label: 'Home', colour: 'grey', prompt: '', fields: [],
      starters: [{ kind: 'packing', title: 'Packing' }, { kind: 'transfer', title: 'Getting to the airport' }]
    },
    packing: {
      label: 'Packing list', colour: 'purple', prompt: '', fields: [],
      starters: [{ kind: 'bag', title: 'Suitcase' }, { kind: 'bag', title: 'Carry-on' },
        { kind: 'bag', title: 'Toiletries' }, { kind: 'bag', title: 'Document pouch' }]
    },
    place: {
      label: 'Place', colour: 'amber', prompt: 'Add dates', fields: ['dates'],
      starters: [{ kind: 'stay', title: 'Stay' }, { kind: 'activity', title: 'Things to do' }, { kind: 'restaurant', title: 'Eat' }]
    },
    flight:     { label: 'Flight',     colour: 'blue',   prompt: 'Book flight', fields: ['route', 'dates', 'times', 'reference'],
      starters: [{ kind: 'payment', title: 'Payment' }, { kind: 'seat', title: 'Seats & bags' }],
      times: { from: 'Departure time', to: 'Arrival time' } },
    train:      { label: 'Train',      colour: 'blue',   prompt: 'Book train',  fields: ['route', 'dates', 'times', 'reference'],
      starters: [{ kind: 'payment', title: 'Payment' }, { kind: 'seat', title: 'Seats & bags' }],
      times: { from: 'Departure time', to: 'Arrival time' } },
    transfer:   { label: 'Transfer',   colour: 'grey',   prompt: 'Work out how', fields: ['route', 'dates', 'times'],
      times: { from: 'Pickup time', to: null }, starters: [] },
    layover:    { label: 'Layover',    colour: 'grey',   prompt: 'Time to be confirmed', fields: ['times'],
      times: { from: 'From', to: 'Until' }, starters: [] },
    stay:       { label: 'Stay',       colour: 'orange', prompt: 'To be booked', fields: ['dates', 'reference'],
      starters: [{ kind: 'payment', title: 'Payment' }, { kind: 'contact', title: 'Address & contact' }] },
    activity:   { label: 'Activity',   colour: 'green',  prompt: 'To plan', fields: ['dates', 'times', 'reference'],
      times: { from: 'Starts at', to: null },
      starters: [{ kind: 'payment', title: 'Payment' }, { kind: 'contact', title: 'Address & contact' }] },
    restaurant: { label: 'Restaurant', colour: 'pink',   prompt: 'To choose', fields: ['dates', 'times', 'reference'],
      times: { from: 'Booking time', to: null },
      starters: [{ kind: 'contact', title: 'Address & contact' }] },
    payment:    { label: 'Payment',         colour: 'amber',  prompt: 'To pay', fields: ['checked'], starters: [] },
    seat:       { label: 'Seats & bags',    colour: 'grey',   prompt: 'To choose', fields: ['checked'], starters: [] },
    contact:    { label: 'Address & contact', colour: 'pink', prompt: 'To find', fields: [], starters: [] },
    bag:        { label: 'Bag',        colour: 'purple', prompt: '', fields: [], starters: [] },
    documents:  { label: 'Documents',  colour: 'blue',   prompt: '', fields: [], starters: [] },
    money:      { label: 'Money',      colour: 'amber',  prompt: '', fields: [], starters: [] },
    doc:        { label: 'Document entry', colour: 'blue', prompt: 'To obtain', fields: ['dates'],
      times: null, dateLabels: { from: 'Issue date', to: 'Expiry date' }, starters: [] },
    item:       { label: 'Item',       colour: 'purple', prompt: '', fields: ['checked'], starters: [] },
    other:      { label: 'Other',      colour: 'grey',   prompt: '', fields: [], starters: [] }
  };

  // Kinds the person can pick when adding a note by hand.
  var ADDABLE_KINDS = ['place', 'flight', 'train', 'transfer', 'layover', 'stay',
    'activity', 'restaurant', 'payment', 'seat', 'contact', 'bag', 'packing', 'item', 'other',
    'documents', 'money', 'doc'];

  // Ways of travelling offered by the "Where next?" flow.
  var JOURNEY_MODES = [
    { id: 'flight', label: 'Flight' },
    { id: 'train', label: 'Train' },
    { id: 'transfer', label: 'Taxi or transfer' },
    { id: 'other', label: 'Other' },
    { id: 'none', label: 'No journey note' }
  ];

  var COLOURS = ['grey', 'blue', 'orange', 'green', 'pink', 'purple', 'amber'];

  // ---------- custom kinds ----------
  // Recipes live in the trip document (state.customKinds) and are registered
  // into KINDS at load, so every part of the app treats them like real kinds.

  // What a custom kind holds, mapped to its editable fields and time labels.
  var HOLDS = {
    booking: { fields: ['dates', 'times', 'reference'], times: { from: 'Starts at', to: 'Until' } },
    listing: { fields: ['dates', 'times'], times: { from: 'Starts at', to: null } },
    tick:    { fields: ['checked'], times: null },
    simple:  { fields: [], times: null }
  };
  var HOLD_LABELS = [
    { id: 'booking', label: 'Booking (dates, times, reference)' },
    { id: 'listing', label: 'Listing (dates, times)' },
    { id: 'tick', label: 'Tick list (packed or done)' },
    { id: 'simple', label: 'Simple (title and notes only)' }
  ];

  var BUILTIN_KEYS = Object.keys(KINDS);
  var customOrder = [];
  var RECIPES = {}; // key -> full recipe (kept for merge-on-restore)

  function slugify(s) {
    var slug = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'kind';
  }

  function uniqueKey(base) {
    var key = base;
    var n = 2;
    while (KINDS[key]) { key = base + '-' + n; n += 1; }
    return key;
  }

  // Complete, valid recipe from raw saved input; null when unusable.
  function normaliseRecipe(raw) {
    if (!raw || typeof raw.label !== 'string' || !raw.label.trim()) return null;
    var holds = HOLDS[raw.holds] ? raw.holds : 'simple';
    var starters = [];
    (Array.isArray(raw.starters) ? raw.starters : []).forEach(function (s) {
      if (s && typeof s.title === 'string' && s.title.trim() && KINDS[s.kind]) {
        starters.push({ kind: s.kind, title: s.title });
      }
    });
    return {
      label: raw.label.trim(),
      colour: COLOURS.indexOf(raw.colour) !== -1 ? raw.colour : 'purple',
      holds: holds,
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      starters: starters,
      fields: HOLDS[holds].fields.slice(),
      times: HOLDS[holds].times
    };
  }

  function registerRecipe(recipe) {
    RECIPES[recipe.key] = recipe;
    KINDS[recipe.key] = {
      label: recipe.label, colour: recipe.colour, prompt: recipe.prompt,
      fields: recipe.fields, starters: recipe.starters, times: recipe.times
    };
    if (customOrder.indexOf(recipe.key) === -1) customOrder.push(recipe.key);
    return recipe;
  }

  function clearCustomKinds() {
    customOrder.forEach(function (k) { delete KINDS[k]; });
    customOrder = [];
  }

  // Replace the registered custom kinds with this list; returns the recipes kept.
  function setCustomKinds(list) {
    clearCustomKinds();
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var r = normaliseRecipe(raw);
      if (!r) return;
      r.key = (typeof raw.key === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(raw.key) && !KINDS[raw.key])
        ? raw.key : uniqueKey(slugify(raw.label));
      registerRecipe(r);
      out.push(r);
    });
    return out;
  }

  // Add a kind from the Kinds sheet. opts: { label, colour, holds, prompt, starters }
  function addCustomKind(state, opts) {
    var label = str(opts && opts.label).trim();
    if (!label) return null;
    var holds = opts && HOLDS[opts.holds] ? opts.holds : 'simple';
    var starters = [];
    (opts && opts.starters ? opts.starters : []).forEach(function (s) {
      if (s && str(s.title).trim() && KINDS[s.kind] && s.kind !== 'trip') {
        starters.push({ kind: s.kind, title: str(s.title).trim() });
      }
    });
    var colour = opts && COLOURS.indexOf(opts.colour) !== -1 ? opts.colour : 'purple';
    var recipe = normaliseRecipe({ label: label, holds: holds, prompt: opts && opts.prompt,
      starters: starters, colour: colour });
    if (!recipe) return null;
    recipe.key = uniqueKey(slugify(label));
    state.customKinds = state.customKinds || [];
    state.customKinds.push(recipe);
    registerRecipe(recipe);
    return recipe;
  }

  // Remove a custom kind. Its notes become 'other'; nothing is deleted.
  function removeCustomKind(state, key) {
    var list = state.customKinds || [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].key === key) { idx = i; break; } }
    if (idx === -1) return false;
    list.splice(idx, 1);
    state.notes.forEach(function (n) { if (n.kind === key) n.kind = 'other'; });
    delete KINDS[key];
    var j = customOrder.indexOf(key);
    if (j !== -1) customOrder.splice(j, 1);
    return true;
  }

  // Kinds offered when adding a note by hand: built-ins, then customs in order.
  function addableKinds() {
    return ADDABLE_KINDS.concat(customOrder);
  }

  var STATUSES = ['placeholder', 'confirmed'];
  var EDITABLE = ['kind', 'title', 'details', 'startDate', 'endDate', 'from', 'to',
    'status', 'reference', 'checked', 'startTime', 'endTime', 'link', 'amount'];

  // ---------- helpers ----------

  var idCounter = 0;
  function newId() {
    idCounter += 1;
    return 'n' + Date.now().toString(36) + idCounter.toString(36) +
      Math.random().toString(36).slice(2, 6);
  }

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function kindOf(kind) {
    return KINDS[kind] || KINDS.other;
  }

  function parseDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-');
    var y = +p[0], m = +p[1], d = +p[2];
    var t = Date.UTC(y, m - 1, d);
    var chk = new Date(t);
    if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d) return null;
    return t;
  }

  // Nights between start and end, or null unless both dates exist and are in order.
  function nights(note) {
    var a = parseDate(note.startDate);
    var b = parseDate(note.endDate);
    if (a === null || b === null || b < a) return null;
    return Math.round((b - a) / 86400000);
  }

  function startingStatus(kind) {
    return kindOf(kind).prompt ? 'placeholder' : 'confirmed';
  }

  // Text shown on a note that is still waiting for details ('' when none).
  function promptFor(note) {
    return note.status === 'placeholder' ? kindOf(note.kind).prompt : '';
  }

  // ---------- state ----------

  function emptyNote(parentId, kind, title) {
    var k = KINDS[kind] ? kind : 'other';
    return {
      id: newId(),
      parentId: parentId,
      position: 0,
      kind: k,
      title: (title && title.trim()) || kindOf(k).label,
      details: '',
      startDate: '',
      endDate: '',
      from: '',
      to: '',
      status: startingStatus(k),
      reference: '',
      startTime: '',
      endTime: '',
      link: '',
      attachments: [],
      checked: false,
      amount: 0
    };
  }

  function createState(tripName) {
    var state = { version: STATE_VERSION, rootId: null, customKinds: [], notes: [] };
    var trip = addNote(state, { parentId: null, kind: 'trip', title: tripName || 'My trip' });
    state.rootId = trip.id;
    return state;
  }

  function getNote(state, id) {
    for (var i = 0; i < state.notes.length; i++) {
      if (state.notes[i].id === id) return state.notes[i];
    }
    return null;
  }

  function children(state, parentId) {
    return state.notes
      .filter(function (n) { return n.parentId === parentId; })
      .sort(function (a, b) { return a.position - b.position; });
  }

  function renumber(state, parentId) {
    children(state, parentId).forEach(function (n, i) { n.position = i; });
  }

  // Titles from the trip down to this note.
  function pathTo(state, id) {
    var path = [];
    var guard = 0;
    var cur = getNote(state, id);
    while (cur && guard < 1000) {
      path.unshift(cur);
      cur = cur.parentId ? getNote(state, cur.parentId) : null;
      guard += 1;
    }
    return path;
  }

  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  // Attachable web link: stored as plain text so backups/JSON keep working.
  // Accepts anything a person pastes; normalises to an absolute http(s) URL.
  // javascript:/data: etc. are rejected — a link must be a web address.
  function normalizeLink(v) {
    var s = str(v).trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s; // bare "qantas.com" gets a scheme
    if (!/^https?:\/\//i.test(s)) return '';                 // only web links allowed
    return s;
  }

  function applyFields(note, patch) {
    EDITABLE.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
      var v = patch[key];
      if (key === 'kind') {
        if (KINDS[v] && v !== 'trip') note.kind = v;
      } else if (key === 'title') {
        var t = str(v).trim();
        note.title = t || kindOf(note.kind).label;
      } else if (key === 'startDate' || key === 'endDate') {
        note[key] = parseDate(v) === null ? '' : v;
      } else if (key === 'startTime' || key === 'endTime') {
        note[key] = TIME_RE.test(str(v)) ? v : '';
      } else if (key === 'link') {
        note.link = normalizeLink(v);
      } else if (key === 'status') {
        if (STATUSES.indexOf(v) !== -1) note.status = v;
      } else if (key === 'checked') {
        note.checked = !!v;
      } else if (key === 'amount') {
        var num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
        note.amount = (typeof num === 'number' && isFinite(num) && num >= 0) ? Math.round(num * 100) / 100 : 0;
      } else {
        note[key] = str(v);
      }
    });
  }

  // Add a note (and its kind's starter children) under parentId.
  // opts: { parentId, kind, title, index, fields }
  function addNote(state, opts) {
    var parentId = opts.parentId === undefined ? null : opts.parentId;
    var note = emptyNote(parentId, opts.kind, opts.title);
    if (opts.fields) applyFields(note, opts.fields);

    var sibs = children(state, parentId);
    var idx = typeof opts.index === 'number' ? clamp(opts.index, 0, sibs.length) : sibs.length;
    sibs.splice(idx, 0, note);
    sibs.forEach(function (n, i) { n.position = i; });
    state.notes.push(note);

    kindOf(note.kind).starters.forEach(function (s) {
      addNote(state, { parentId: note.id, kind: s.kind, title: s.title });
    });
    return note;
  }

  // Edit a note. A place becomes confirmed once both dates are valid; any other
  // kind becomes confirmed when a reference is added (unless status is given).
  function updateNote(state, id, patch) {
    var note = getNote(state, id);
    if (!note) return null;
    var before = { reference: note.reference, checked: note.checked };
    applyFields(note, patch);

    if (!Object.prototype.hasOwnProperty.call(patch, 'status') && note.status === 'placeholder') {
      if (note.kind === 'place' && nights(note) !== null) {
        note.status = 'confirmed';
      } else if (note.kind === 'payment' && note.checked && !before.checked) {
        note.status = 'confirmed';
      } else if (note.kind !== 'place' && note.kind !== 'payment' && note.reference && !before.reference) {
        note.status = 'confirmed';
      }
    }
    return note;
  }

  function deleteNote(state, id) {
    var note = getNote(state, id);
    if (!note || note.id === state.rootId) return false;
    var doomed = {};
    doomed[id] = true;
    var changed = true;
    while (changed) {
      changed = false;
      state.notes.forEach(function (n) {
        if (!doomed[n.id] && n.parentId && doomed[n.parentId]) {
          doomed[n.id] = true;
          changed = true;
        }
      });
    }
    var parentId = note.parentId;
    state.notes = state.notes.filter(function (n) { return !doomed[n.id]; });
    renumber(state, parentId);
    return true;
  }

  // Days until a document entry's expiry date expires (null when none set).
  function expiryDays(note) {
    if (!note.endDate) return null;
    var e = parseDate(note.endDate);
    if (!e) return null;
    return Math.round((e - Date.now()) / 86400000);
  }

  // Money ledger: every payment note in the subtree, grouped by paid/owed, with the
  // nearest non-payment ancestor as the booking it belongs to.
  function moneyLedger(state, rootId) {
    var root = getNote(state, rootId);
    if (!root) return { paid: [], owed: [], paidTotal: 0, owedTotal: 0 };
    var paid = [], owed = [];
    function walk(note, owner) {
      var nextOwner = note.kind === 'payment' ? owner : note.title;
      if (note.kind === 'payment') {
        var entry = { title: note.title, amount: note.amount || 0, owner: owner, reference: note.reference };
        (note.checked ? paid : owed).push(entry);
      }
      children(state, note.id).forEach(function (c) { walk(c, nextOwner); });
    }
    walk(root, root.title);
    var sum = function (list) { return list.reduce(function (t, e) { return t + e.amount; }, 0); };
    return { paid: paid, owed: owed, paidTotal: sum(paid), owedTotal: sum(owed) };
  }

  // Move a note up (-1) or down (+1) among its siblings. Position only: dates never change.
  function moveNote(state, id, delta) {
    var note = getNote(state, id);
    if (!note || !note.parentId) return false;
    var sibs = children(state, note.parentId);
    var i = sibs.indexOf(note);
    var j = i + delta;
    if (j < 0 || j >= sibs.length) return false;
    var other = sibs[j];
    var tmp = note.position;
    note.position = other.position;
    other.position = tmp;
    return true;
  }

  // The "Where next?" action: a journey note plus the place it arrives at.
  // opts: { parentId, mode, to, index }
  function addJourney(state, opts) {
    var parentId = opts.parentId;
    var mode = opts.mode;
    var to = str(opts.to).trim() || 'New place';
    var sibs = children(state, parentId);
    var idx = typeof opts.index === 'number' ? clamp(opts.index, 0, sibs.length) : sibs.length;

    var journey = null;
    if (mode !== 'none') {
      var kind = (mode === 'flight' || mode === 'train' || mode === 'transfer') ? mode : 'other';
      var from = '';
      for (var i = idx - 1; i >= 0; i--) {
        var prev = sibs[i];
        if (prev.kind === 'place' || prev.kind === 'home') { from = prev.title; break; }
        if (prev.to) { from = prev.to; break; }
      }
      journey = addNote(state, {
        parentId: parentId,
        kind: kind,
        title: from ? from + ' → ' + to : 'To ' + to,
        index: idx,
        fields: { from: from, to: to }
      });
      idx += 1;
    }
    var place = addNote(state, { parentId: parentId, kind: 'place', title: to, index: idx });
    return { journey: journey, place: place };
  }

  // Ids of notes whose dates start before an earlier sibling's end date.
  function dateClashes(state, parentId) {
    var flagged = {};
    var lastEnd = null;
    children(state, parentId).forEach(function (n) {
      var s = parseDate(n.startDate);
      var e = parseDate(n.endDate);
      if (s === null || e === null || e < s) return;
      if (lastEnd !== null && s < lastEnd) flagged[n.id] = true;
      if (lastEnd === null || e > lastEnd) lastEnd = e;
    });
    return flagged;
  }

  // Kinds present anywhere in the subtree rooted at id (the root included),
  // for the export filter's tick-boxes.
  function kindsInTree(state, id) {
    var found = {};
    (function walk(nid) {
      var n = getNote(state, nid);
      if (!n) return;
      found[n.kind] = true;
      children(state, nid).forEach(function (c) { walk(c.id); });
    })(id);
    return found;
  }

  // ---------- packing suggestions ----------
  // A generic prompt library — NOT trip data. Nothing is created until the
  // person ticks it in the Suggestions sheet. Keep labels generic.

  var SUGGESTIONS = [
    { id: 'clothes', label: 'Clothes',
      items: ['Polos', 'T-shirts', 'Dress shirts', 'Jumper', 'Shorts', 'Jeans',
        'Underwear', 'Socks', 'Shoes', 'Thongs', 'Swimwear', 'Hat', 'Rain jacket'] },
    { id: 'toiletries', label: 'Toiletries',
      items: ['Toothbrush', 'Toothpaste', 'Razor', 'Shampoo', 'Conditioner',
        'Deodorant', 'Sunscreen', 'Medications', 'First aid kit', 'Glasses/sunglasses'] },
    { id: 'documents', label: 'Documents',
      items: ['Passports', 'Visas', 'Travel insurance', 'Licences', 'Booking printouts'] },
    { id: 'tech', label: 'Tech',
      items: ['Phone charger', 'Power bank', 'Power adapter', 'Headphones', 'Camera'] },
    { id: 'general', label: 'General',
      items: ['Water bottle', 'Snacks', 'Book', 'Laundry bag', 'Locks'] }
  ];

  // Which category opens pre-selected for a bag named this; null = none.
  function suggestCategoryFor(bagTitle) {
    var t = String(bagTitle || '').toLowerCase();
    if (/toiletr|medic|pharmac|razor/.test(t)) return 'toiletries';
    if (/shirt|polo|cloth|wear|wardrobe|clothing/.test(t)) return 'clothes';
    if (/document|passport|visa|insurance|licen|paper/.test(t)) return 'documents';
    if (/tech|charg|electron|gadget|camera|cable/.test(t)) return 'tech';
    if (/pouch|case|bag|cube/.test(t)) return null; // generic container words guess nothing
    return null;
  }

  function suggestionCategory(id) {
    for (var i = 0; i < SUGGESTIONS.length; i++) {
      if (SUGGESTIONS[i].id === id) return SUGGESTIONS[i];
    }
    return null;
  }

  // Ids of suggestions already present in this bag (case-insensitive title match).
  function existingTitles(state, parentId) {
    var have = {};
    children(state, parentId).forEach(function (n) {
      have[n.title.trim().toLowerCase()] = true;
    });
    return have;
  }

  // ---------- saving and loading ----------

  function exportJSON(state) {
    return JSON.stringify(state);
  }

  // Validate and normalise saved or pasted data. Throws Error with a plain message.
  // Custom kinds ride inside the document; merge = also keep other saved recipes
  // (from the current trip or an earlier backup) so old notes keep their kind.
  function importJSON(text, merge) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('That is not valid backup data.');
    }
    if (!data || !Array.isArray(data.notes) || data.notes.length === 0) {
      throw new Error('The backup has no notes in it.');
    }
    // Merge pass: register anything new BEFORE notes are mapped, so notes on
    // custom kinds are recognised instead of falling back to 'other'.
    if (merge === true) {
      (Array.isArray(data.customKinds) ? data.customKinds : []).forEach(function (raw) {
        if (!raw || typeof raw.key !== 'string' || !raw.key) return;
        if (KINDS[raw.key]) return; // already known: never overwrite
        var r = normaliseRecipe(raw);
        if (r) { r.key = raw.key; registerRecipe(r); }
      });
    }
    // Migration: v1 gave Money/Documents the generic 'other' kind. Promote them so
    // the ledger and expiry warnings key off kind, not the title.
    if (!data.version || data.version < 2) {
      data.notes.forEach(function (raw) {
        if (!raw || raw.kind !== 'other') return;
        var t = String(raw.title || '').trim().toLowerCase();
        if (t === 'money') raw.kind = 'money';
        else if (t === 'documents') raw.kind = 'documents';
      });
    }
    var seen = {};
    var notes = data.notes.map(function (raw) {
      if (!raw || typeof raw.id !== 'string' || !raw.id) throw new Error('A note is missing its id.');
      if (seen[raw.id]) throw new Error('Two notes share the same id.');
      seen[raw.id] = true;
      var note = emptyNote(typeof raw.parentId === 'string' ? raw.parentId : null,
        KINDS[raw.kind] ? raw.kind : 'other', str(raw.title));
      note.id = raw.id;
      note.position = typeof raw.position === 'number' ? raw.position : 0;
      note.kind = KINDS[raw.kind] ? raw.kind : 'other';
      note.status = STATUSES.indexOf(raw.status) !== -1 ? raw.status : startingStatus(note.kind);
      note.details = str(raw.details);
      note.startDate = parseDate(raw.startDate) === null ? '' : raw.startDate;
      note.endDate = parseDate(raw.endDate) === null ? '' : raw.endDate;
      note.from = str(raw.from);
      note.to = str(raw.to);
      note.reference = str(raw.reference);
      note.startTime = TIME_RE.test(str(raw.startTime)) ? raw.startTime : '';
      note.endTime = TIME_RE.test(str(raw.endTime)) ? raw.endTime : '';
      note.link = normalizeLink(raw.link);
      note.attachments = (Array.isArray(raw.attachments) ? raw.attachments : [])
        .filter(function (a) {
          return a && typeof a.name === 'string' && a.name && typeof a.key === 'string' && a.key;
        })
        .map(function (a) {
          return { name: String(a.name).slice(0, 200), size: typeof a.size === 'number' ? a.size : 0,
            type: typeof a.type === 'string' ? a.type : '', key: String(a.key).slice(0, 100) };
        });
      note.checked = !!raw.checked;
      note.amount = (typeof raw.amount === 'number' && isFinite(raw.amount) && raw.amount >= 0)
        ? Math.round(raw.amount * 100) / 100 : 0;
      return note;
    });

    var state = {
      version: STATE_VERSION, rootId: null, notes: notes,
      customKinds: (Array.isArray(data.customKinds) ? data.customKinds : [])
        .map(function (raw) { return normaliseRecipe(raw); })
        .filter(function (r) { return r !== null; })
    };
    var roots = notes.filter(function (n) { return n.parentId === null; });
    if (roots.length !== 1) throw new Error('The backup must have exactly one trip at the top.');
    state.rootId = roots[0].id;

    notes.forEach(function (n) {
      if (n.parentId !== null && !seen[n.parentId]) throw new Error('A note points at a missing parent.');
      var guard = 0;
      var cur = n;
      while (cur && cur.parentId !== null && guard <= notes.length) {
        cur = getNote(state, cur.parentId);
        guard += 1;
      }
      if (guard > notes.length) throw new Error('The backup contains a loop.');
    });

    var parents = {};
    notes.forEach(function (n) { parents[n.parentId === null ? '' : n.parentId] = true; });
    Object.keys(parents).forEach(function (p) { renumber(state, p === '' ? null : p); });
    // Register this document's own recipes so its notes display correctly.
    if (merge !== true) setCustomKinds(state.customKinds);
    else state.customKinds.forEach(function (r) { if (!KINDS[r.key || slugify(r.label)]) registerRecipe(Object.assign({ key: r.key || uniqueKey(slugify(r.label)) }, r)); });
    return state;
  }

  return {
    KINDS: KINDS,
    ADDABLE_KINDS: ADDABLE_KINDS,
    addableKinds: addableKinds,
    JOURNEY_MODES: JOURNEY_MODES,
    HOLDS: HOLDS,
    HOLD_LABELS: HOLD_LABELS,
    COLOURS: COLOURS,
    SUGGESTIONS: SUGGESTIONS,
    moneyLedger: moneyLedger,
    expiryDays: expiryDays,
    suggestCategoryFor: suggestCategoryFor,
    suggestionCategory: suggestionCategory,
    existingTitles: existingTitles,
    kindsInTree: kindsInTree,
    isCustomKind: function (key) { return customOrder.indexOf(key) !== -1 && BUILTIN_KEYS.indexOf(key) === -1; },
    customRecipes: function () { return customOrder.map(function (k) { return RECIPES[k]; }); },
    addCustomKind: addCustomKind,
    removeCustomKind: removeCustomKind,
    setCustomKinds: setCustomKinds,
    createState: createState,
    getNote: getNote,
    children: children,
    pathTo: pathTo,
    addNote: addNote,
    updateNote: updateNote,
    deleteNote: deleteNote,
    moveNote: moveNote,
    addJourney: addJourney,
    dateClashes: dateClashes,
    nights: nights,
    promptFor: promptFor,
    kindOf: kindOf,
    exportJSON: exportJSON,
    importJSON: importJSON
  };
});
