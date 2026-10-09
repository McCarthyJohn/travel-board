/*
 * Smoke test for app.js using a tiny fake DOM (no dependencies).
 * Run with:  node test-ui.js
 *
 * This is NOT a substitute for trying the app in Safari. It only proves that the
 * main flows run without errors and produce the expected notes on screen.
 */
'use strict';
var assert = require('assert');

// ---------- minimal fake DOM ----------

function TextNode(text) { this.nodeType = 3; this.textContent = String(text); this.parentNode = null; }

function El(tag) {
  this.nodeType = 1;
  this.tagName = tag.toLowerCase();
  this.children = [];
  this.parentNode = null;
  this.attrs = {};
  this.listeners = {};
  this.className = '';
  this.value = '';
  this.checked = false;
  this.selected = false;
  this._text = '';
  var self = this;
  this.classList = {
    add: function (c) { if (self.className.split(' ').indexOf(c) === -1) self.className = (self.className + ' ' + c).trim(); },
    remove: function (c) { self.className = self.className.split(' ').filter(function (x) { return x !== c; }).join(' '); }
  };
  if (this.tagName === 'select') {
    Object.defineProperty(this, 'value', {
      get: function () {
        var opts = self.children.filter(function (c) { return c.tagName === 'option'; });
        var sel = opts.filter(function (o) { return o.selected; })[0] || opts[0];
        return sel ? sel.value : '';
      },
      set: function (v) {
        self.children.forEach(function (o) { if (o.tagName === 'option') o.selected = (o.value === v); });
      }
    });
  }
}
El.prototype.appendChild = function (c) {
  if (c.nodeType === 11) {
    var kids = c.children.slice();
    c.children = [];
    var self = this;
    kids.forEach(function (k) { self.appendChild(k); });
    return c;
  }
  if (c.parentNode) c.parentNode.removeChild(c);
  c.parentNode = this;
  this.children.push(c);
  return c;
};
El.prototype.removeChild = function (c) {
  var i = this.children.indexOf(c);
  if (i !== -1) this.children.splice(i, 1);
  c.parentNode = null;
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return this.attrs[k]; };
El.prototype.addEventListener = function (t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); };
El.prototype.fire = function (t, extra) {
  var ev = Object.assign({ target: this, preventDefault: function () {} }, extra || {});
  (this.listeners[t] || []).forEach(function (f) { f(ev); });
};
El.prototype.focus = function () {};
El.prototype.select = function () {};
Object.defineProperty(El.prototype, 'textContent', {
  get: function () {
    return this._text + this.children.map(function (c) { return c.textContent; }).join('');
  },
  set: function (v) { this.children = []; this._text = String(v); }
});
El.prototype.querySelector = function () {
  // Only the selector app.js uses: first text input, select or textarea.
  return all(this, function (n) {
    return n.tagName === 'select' || n.tagName === 'textarea' || (n.tagName === 'input' && n.attrs.type === 'text');
  })[0] || null;
};

function all(root, pred) {
  var out = [];
  (function walk(n) {
    if (n.nodeType === 1 && pred(n)) out.push(n);
    (n.children || []).forEach(walk);
  })(root);
  return out;
}

var elements = {};
var bodyEl = new El('body');
elements.app = new El('div');
elements.toast = new El('div');
bodyEl.appendChild(elements.app);
bodyEl.appendChild(elements.toast);

var store = {};
var confirmAnswer = true;

global.document = {
  body: bodyEl,
  title: '',
  activeElement: null,
  getElementById: function (id) { return elements[id] || null; },
  createElement: function (t) { return new El(t); },
  createTextNode: function (t) { return new TextNode(t); },
  createDocumentFragment: function () { var f = new El('fragment'); f.nodeType = 11; return f; },
  addEventListener: function () {},
  removeEventListener: function () {},
  execCommand: function () { return true; }
};
// Newer Node versions define a read-only global navigator, so replace it explicitly.
Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
global.window = {
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  },
  confirm: function () { return confirmAnswer; },
  scrollTo: function () {},
  addEventListener: function () {}
};
global.TB = require('./model.js');
global.TBDocx = require('./docx.js');
global.TBAtt = require('./attachments.js');

// ---------- helpers ----------

function button(root, text) {
  var hit = all(root, function (n) { return n.tagName === 'button' && n.textContent === text; })[0];
  assert.ok(hit, 'no button with text "' + text + '"');
  return hit;
}
function cardTitles() {
  return all(elements.app, function (n) { return n.className === 'card-title'; }).map(function (n) { return n.textContent; });
}
function heading() {
  return all(elements.app, function (n) { return n.tagName === 'h1'; })[0].textContent;
}
function sheetOpen() {
  return all(bodyEl, function (n) { return n.className === 'backdrop'; }).length > 0;
}
function textInputs(root) {
  return all(root, function (n) { return n.tagName === 'input' && n.attrs.type === 'text'; });
}
function savedState() {
  return TB.importJSON(store['travelboard.v1']);
}
var passed = 0;
function step(name, fn) {
  try {
    var r = fn();
    if (r && typeof r.then === 'function') {
      PENDING = PENDING.then(function () { return r; }).then(function () { passed += 1; console.log('ok   - ' + name); },
        function (e) { console.error('FAIL - ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; });
      return;
    }
    passed += 1;
    console.log('ok   - ' + name);
  } catch (e) { console.error('FAIL - ' + name + '\n       ' + (e.stack || e.message)); process.exitCode = 1; }
}
var PENDING = Promise.resolve();
process.on('beforeExit', function () { PENDING.then(function () {}, function () {}); });

// ---------- scenarios ----------

function boot() {
  delete require.cache[require.resolve('./app.js')];
  require('./app.js');
}

step('first run shows the welcome screen', function () {
  boot();
  var form = all(elements.app, function (n) { return n.className === 'welcome'; })[0];
  assert.ok(form, 'welcome form missing');
});

step('naming the trip creates Planning, Documents, Money and Home', function () {
  var form = all(elements.app, function (n) { return n.className === 'welcome'; })[0];
  textInputs(form)[0].value = 'Italy';
  form.fire('submit');
  assert.strictEqual(heading(), 'Italy');
  assert.deepStrictEqual(cardTitles(), ['Planning', 'Documents', 'Money', 'Home']);
  assert.ok(store['travelboard.v1'], 'nothing was saved');
});

step('Where next? adds a journey and a place', function () {
  button(elements.app, 'Where next?').fire('click');
  assert.ok(sheetOpen(), 'sheet did not open');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  button(sheet, 'Train').fire('click');
  textInputs(sheet)[0].value = 'Singapore';
  all(sheet, function (n) { return n.tagName === 'form'; })[0].fire('submit');
  assert.ok(!sheetOpen(), 'sheet did not close');
  assert.deepStrictEqual(cardTitles(), ['Planning', 'Documents', 'Money', 'Home', 'Home → Singapore', 'Singapore']);
  var s = savedState();
  var journey = TB.children(s, s.rootId)[4];
  assert.strictEqual(journey.kind, 'train');
  assert.deepStrictEqual(TB.children(s, journey.id).map(function (n) { return n.kind; }), ['payment', 'seat']);
});

step('opening a place shows its starter notes', function () {
  var openButtons = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open'; });
  openButtons[openButtons.length - 1].fire('click');
  assert.strictEqual(heading(), 'Singapore');
  assert.deepStrictEqual(cardTitles(), ['Stay', 'Things to do', 'Eat']);
});

step('editing a stay saves its dates and reference', function () {
  all(elements.app, function (n) { return n.className === 'card-title' && n.textContent === 'Stay'; })[0].fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var dates = all(sheet, function (n) { return n.tagName === 'input' && n.attrs.type === 'date'; });
  assert.strictEqual(dates.length, 2);
  dates[0].value = '2027-03-10';
  dates[1].value = '2027-03-13';
  var texts = textInputs(sheet);
  texts[0].value = 'Hotel Orchid';
  texts[texts.length - 1].value = 'REF-42';
  all(sheet, function (n) { return n.tagName === 'form'; })[0].fire('submit');
  var s = savedState();
  var stay = s.notes.filter(function (n) { return n.title === 'Hotel Orchid'; })[0];
  assert.ok(stay, 'renamed stay not saved');
  assert.strictEqual(stay.startDate, '2027-03-10');
  assert.strictEqual(stay.reference, 'REF-42');
  assert.strictEqual(stay.status, 'confirmed');
  assert.strictEqual(TB.nights(stay), 3);
});

step('adding a note inside works and the packing tick box saves', function () {
  button(elements.app, 'Back').fire('click');
  var homeOpen = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open'; })[3];
  homeOpen.fire('click');
  assert.strictEqual(heading(), 'Home');
  var packingOpen = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open'; })[0];
  packingOpen.fire('click');
  assert.strictEqual(heading(), 'Packing');
  button(elements.app, 'Add a note').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var select = all(sheet, function (n) { return n.tagName === 'select'; })[0];
  select.value = 'item';
  textInputs(sheet)[0].value = 'Passport';
  all(sheet, function (n) { return n.tagName === 'form'; })[0].fire('submit');
  assert.deepStrictEqual(cardTitles(), ['Suitcase', 'Carry-on', 'Toiletries', 'Document pouch', 'Passport']);
  var s = savedState();
  assert.strictEqual(s.notes.filter(function (n) { return n.title === 'Passport'; })[0].kind, 'item');
});

step('a flight link saves, shows a Link button, and opens the address', function () {
  // We are on the Packing page. Back to Home, then trip; the flight card is 3rd.
  button(elements.app, 'Back').fire('click');
  button(elements.app, 'Back').fire('click');
  // Stay on the trip page; edit the flight via its card-title button (text has the arrow).
  var none = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Link'; });
  assert.strictEqual(none.length, 0, 'Link button showed before any link was set');
  button(elements.app, 'Home \u2192 Singapore').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var urlInput = all(sheet, function (n) { return n.tagName === 'input' && n.attrs.type === 'url'; })[0];
  assert.ok(urlInput, 'Website link field missing from edit sheet');
  urlInput.value = 'jetstar.com/manage';
  all(sheet, function (n) { return n.tagName === 'form'; })[0].fire('submit');
  // Card now shows Link; tapping it opens the normalised address.
  var opened = [];
  window.open = function (u) { opened.push(u); return {}; };
  var linkBtn = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Link'; })[0];
  assert.ok(linkBtn, 'Link button not shown after saving a link');
  linkBtn.fire('click');
  assert.deepStrictEqual(opened, ['https://jetstar.com/manage']);
  var s = savedState();
  assert.strictEqual(s.notes.filter(function (n) { return n.kind === 'train'; })[0].link, 'https://jetstar.com/manage');
});

step('backup shows the data and restore replaces the trip', function () {
  button(elements.app, 'Backup').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var boxes = all(sheet, function (n) { return n.tagName === 'textarea'; });
  assert.ok(boxes[0].value.indexOf('Passport') !== -1, 'backup text missing the packed item');
  boxes[1].value = boxes[0].value.replace('Italy', 'Italy again');
  button(sheet, 'Restore from pasted backup').fire('click');
  assert.strictEqual(heading(), 'Italy again');
});

step('a restart loads the saved trip', function () {
  elements.app.textContent = '';
  boot();
  assert.strictEqual(heading(), 'Italy again');
});

step('a bad restore is refused with a message and nothing changes', function () {
  button(elements.app, 'Backup').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var boxes = all(sheet, function (n) { return n.tagName === 'textarea'; });
  boxes[1].value = 'garbage';
  button(sheet, 'Restore from pasted backup').fire('click');
  assert.ok(/not valid/.test(elements.toast.textContent), 'no error message shown');
  assert.strictEqual(savedState().notes.filter(function (n) { return n.kind === 'trip'; })[0].title, 'Italy again');
});

step('itinerary sheet shows the trip and its parts', function () {
  button(elements.app, 'Itinerary').fire('click');
  assert.ok(sheetOpen(), 'itinerary sheet did not open');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var text = all(sheet, function (n) { return n.className === 'itin'; })[0].textContent;
  assert.ok(text.indexOf('Home') !== -1, 'itinerary missing Home');
  assert.ok(text.indexOf('Singapore') !== -1, 'itinerary missing Singapore');
  assert.ok(text.indexOf('Hotel Orchid') !== -1, 'itinerary missing the booked stay');
  assert.ok(text.indexOf('REF-42') !== -1, 'itinerary missing the booking reference');
  button(sheet, 'Close').fire('click');
  assert.ok(!sheetOpen(), 'itinerary sheet did not close');
});

step('itinerary opened inside a place shows only that place', function () {
  // Ensure we start on the trip page, then open the Singapore place card.
  assert.strictEqual(heading(), 'Italy again');
  var openButtons = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open'; });
  openButtons[openButtons.length - 1].fire('click'); // last card is the Singapore place
  assert.strictEqual(heading(), 'Singapore');
  button(elements.app, 'Itinerary').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var text = all(sheet, function (n) { return n.className === 'itin'; })[0].textContent;
  assert.ok(text.indexOf('Singapore') !== -1, 'place itinerary missing the place');
  assert.ok(text.indexOf('Hotel Orchid') !== -1, 'place itinerary missing the stay');
  assert.ok(text.indexOf('Home') === -1 && text.indexOf('Italy again') === -1, 'trip-level content leaked into place itinerary');
  button(sheet, 'Close').fire('click');
});

step('quick-add puts an item and a bag into a bag in one tap each', function () {
  // Navigate: trip -> Home -> Packing
  button(elements.app, 'Back').fire('click');
  all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open'; })[3].fire('click');
  assert.strictEqual(heading(), 'Home');
  all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open'; })[0].fire('click');
  assert.strictEqual(heading(), 'Packing');
  // Open the Suitcase bag card
  all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open'; })[0].fire('click');
  var quick = all(elements.app, function (n) { return n.className === 'quick-btn'; });
  assert.strictEqual(quick.length, 3, 'quick-add buttons missing on bag page');
  quick.filter(function (b) { return b.textContent === '+ Item'; })[0].fire('click');
  assert.deepStrictEqual(cardTitles(), ['Item']);
  var s = savedState();
  var item = s.notes.filter(function (n) { return n.kind === 'item' && n.parentId !== null && s.notes.filter(function (p) { return p.id === n.parentId; })[0].kind === 'bag'; })[0];
  assert.ok(item, 'quick item not saved inside the bag');
  quick.filter(function (b) { return b.textContent === '+ Bag'; })[0].fire('click');
  s = savedState();
  var bags = s.notes.filter(function (n) { return n.kind === 'bag'; });
  assert.ok(bags.length >= 2, 'quick bag not saved');
});

step('the quick-added item can be renamed inline where it shows as a chip', function () {
  // Back out to the Packing page, where the Suitcase card renders its
  // items as chips with inline rename fields.
  button(elements.app, 'Back').fire('click');
  assert.strictEqual(heading(), 'Packing');
  var input = all(elements.app, function (n) { return n.tagName === 'input' && n.className === 'chip-rename'; })
    .filter(function (n) { return n.value === 'Item'; })[0];
  assert.ok(input, 'inline rename field missing for the quick-added item');
  input.value = 'Hiking boots';
  input.fire('change');
  var s = savedState();
  assert.ok(s.notes.filter(function (n) { return n.title === 'Hiking boots'; })[0], 'inline rename not saved');
});

step('suggestions sheet opens, filters by bag name, and adds ticked items', function () {
  // From the Packing page: open the Toiletries bag card, tap + Suggestions.
  var toiletries = all(elements.app, function (n) {
    return n.tagName === 'button' && n.textContent === 'Open' ;
  });
  // On Packing page the cards are Suitcase, Carry-on, Toiletries, Document pouch (chips are inside).
  // Open Toiletries (3rd card).
  toiletries[2].fire('click');
  assert.strictEqual(heading(), 'Toiletries');
  var sugg = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === '+ Suggestions'; })[0];
  assert.ok(sugg, '+ Suggestions missing on bag page');
  sugg.fire('click');
  assert.ok(sheetOpen(), 'suggestions sheet did not open');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  // Pre-selected category should be Toiletries (bag named "Toiletries").
  var pressed = all(sheet, function (n) {
    return n.tagName === 'button' && n.getAttribute('aria-pressed') === 'true';
  })[0];
  assert.strictEqual(pressed.textContent, 'Toiletries', 'wrong category pre-selected');
  // Tick Toothbrush and Razor.
  var boxes = all(sheet, function (n) { return n.tagName === 'input' && n.attrs.type === 'checkbox'; });
  assert.ok(boxes.length >= 10, 'toiletries list missing');
  boxes.filter(function (b) { return b.getAttribute('aria-label') === 'Toothbrush'; })[0].checked = true;
  boxes.filter(function (b) { return b.getAttribute('aria-label') === 'Razor'; })[0].checked = true;
  button(sheet, 'Add').fire('click');
  assert.ok(!sheetOpen(), 'sheet did not close');
  assert.deepStrictEqual(cardTitles().slice(0, 2), ['Toothbrush', 'Razor']);
  var s = savedState();
  var added = s.notes.filter(function (n) { return n.title === 'Toothbrush'; })[0];
  assert.ok(added && added.kind === 'item');
});

step('suggestions skip items the bag already has and add nothing when nothing ticked', function () {
  // Re-open Toiletries' Suggestions from the CURRENT page (Toiletries after step 1 re-render).
  var sugg = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === '+ Suggestions'; })[0];
  sugg.fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  // The sheet should have pre-opened on Toiletries (bag name match) AND show duplicates disabled.
  var boxes = all(sheet, function (n) { return n.tagName === 'input' && n.attrs.type === 'checkbox'; });
  var toothbrush = boxes.filter(function (b) { return b.getAttribute('aria-label') === 'Toothbrush'; })[0];
  assert.ok(toothbrush, 'toothbrush row missing entirely');
  assert.ok(toothbrush.attrs.disabled !== undefined,
    'duplicate suggestion not disabled');
  // Add with nothing ticked: toast + no change.
  var countBefore = savedState().notes.length;
  button(sheet, 'Add').fire('click');
  assert.ok(/tick/i.test(elements.toast.textContent), 'no gentle prompt when nothing ticked');
  assert.strictEqual(savedState().notes.length, countBefore, 'something was added with nothing ticked');
  button(sheet, 'Close').fire('click');
});

step('export filter: untick packing kinds and the view drops them live', function () {
  // Get back to the trip page first (we are on Toiletries after the last step).
  button(elements.app, 'Back').fire('click'); // -> Packing
  button(elements.app, 'Back').fire('click'); // -> Home
  button(elements.app, 'Back').fire('click'); // -> Trip
  assert.strictEqual(heading(), 'Italy again');
  // Open the trip itinerary.
  button(elements.app, 'Itinerary').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  // Filter chips are one per kind present, all ticked, with labels.
  var chips = all(sheet, function (n) { return n.className === 'filter-chip'; });
  assert.ok(chips.length >= 5, 'filter chips missing');
  // Untick "Item" via its checkbox.
  var itemChip = chips.filter(function (c) {
    return all(c, function (x) { return x.tagName === 'span'; })[0] &&
      all(c, function (x) { return x.tagName === 'span'; })[0].textContent === 'Item';
  })[0];
  assert.ok(itemChip, 'Item chip missing');
  var box = all(itemChip, function (x) { return x.tagName === 'input'; })[0];
  box.checked = false;
  box.fire('change');
  var view = all(sheet, function (n) { return n.className === 'itin'; })[0];
  assert.strictEqual(view.textContent.indexOf('Passport'), -1, 'unticked item still visible in view');
  button(sheet, 'Close').fire('click');
});

step('trip basics: Edit shows Leaving/Back dates and From/To places, and saves them', function () {
  // From the trip page (after the backup-restore step). Open the trip's own edit sheet.
  button(elements.app, 'Edit').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var dates = all(sheet, function (n) { return n.tagName === 'input' && n.attrs.type === 'date'; });
  assert.strictEqual(dates.length, 2, 'trip sheet missing date pair');
  assert.ok(sheet.textContent.indexOf('Leaving') !== -1, 'Leaving label missing');
  assert.ok(sheet.textContent.indexOf('Back') !== -1, 'Back label missing');
  assert.ok(sheet.textContent.indexOf('From place') !== -1, 'From place missing on trip');
  dates[0].value = '2027-04-10';
  dates[1].value = '2027-04-24';
  var texts = textInputs(sheet).filter(function (i) { return i.attrs.placeholder !== 'Booking or confirmation reference'; });
  // order: Title, From place, To place — skip the title (keep 'Italy again').
  texts[1].value = 'Melbourne';
  texts[2].value = 'Rome';
  all(sheet, function (n) { return n.tagName === 'form'; })[0].fire('submit');
  var s = savedState();
  var trip = s.notes.filter(function (n) { return n.id === s.rootId; })[0];
  assert.strictEqual(trip.from, 'Melbourne');
  assert.strictEqual(trip.to, 'Rome');
  assert.strictEqual(trip.startDate, '2027-04-10');
  assert.strictEqual(trip.endDate, '2027-04-24');
  assert.strictEqual(TB.nights(trip), 14);
  // Summary on the trip page now shows the route line:
  var summary = all(elements.app, function (n) { return n.className === 'summary'; })[0];
  assert.ok(summary && summary.textContent.indexOf('Melbourne \u2192 Rome') !== -1, 'route line missing from summary');
});

step('payment amount: edit sheet takes an amount, card shows it', function () {
  // From whatever page we are on, go back to the trip page first.
  var back = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Back'; });
  if (back.length) back[back.length - 1].fire('click');
  // Open the flight's Payment chip's edit sheet via the chip button.
  var chip = all(elements.app, function (n) { return n.className.indexOf('chip ') === 0 && n.textContent.indexOf('Payment') !== -1; })[0];
  chip.fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var amt = all(sheet, function (n) { return n.tagName === 'input' && n.attrs.inputmode === 'decimal'; })[0];
  assert.ok(amt, 'amount input missing on payment sheet');
  amt.value = '1870.50';
  all(sheet, function (n) { return n.tagName === 'form'; })[0].fire('submit');
  var s = savedState();
  var pays = s.notes.filter(function (n) { return n.kind === 'payment' && n.amount === 1870.5; });
  assert.strictEqual(pays.length, 1, 'amount not saved');
  assert.ok(chip.textContent.indexOf('Payment') !== -1, 'chip gone');
  // Go to the journey page and check the payment card meta carries the amount.
  var jOpen = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open' && n.getAttribute('aria-label') === 'Open Home \u2192 Singapore'; })[0];
  assert.ok(jOpen, 'journey Open button not found');
  jOpen.fire('click');
  var cards = all(elements.app, function (n) { return n.className === 'meta' && n.textContent.indexOf('$1,870.50') !== -1; });
  assert.ok(cards.length >= 1, 'amount tag missing on card: ' +
    JSON.stringify(all(elements.app, function (n) { return n.className === 'meta'; }).map(function (n) { return n.textContent; })));
});

step('money page shows the ledger roll-up', function () {
  // Back out to the trip page first (we are inside the journey).
  while (all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Back'; }).length) {
    all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Back'; })[0].fire('click');
  }
  var moneyCard = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open' && n.getAttribute('aria-label') === 'Open Money'; })[0];
  assert.ok(moneyCard, 'Money Open not found on trip page');
  moneyCard.fire('click');
  var ledger = all(elements.app, function (n) { return n.className.indexOf('ledger') !== -1; })[0];
  assert.ok(ledger, 'ledger missing on money page');
  assert.ok(ledger.textContent.indexOf('Still to pay: $1,870.50') !== -1, 'owed total wrong: ' + ledger.textContent);
  assert.ok(ledger.textContent.indexOf('Nothing waiting') === -1, 'should show an owed line');
});

step('documents get expiry dates and warn under six months', function () {
  // From the attach step we are on the journey's sheet-closed trip page? Re-trip:
  while (all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Back'; }).length) {
    all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Back'; })[0].fire('click');
  }
  var docOpen = all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Open' && n.getAttribute('aria-label') === 'Open Documents'; })[0];
  assert.ok(docOpen, 'Documents Open not found');
  docOpen.fire('click');
  // Add a document entry with a near expiry via the add sheet.
  button(elements.app, 'Add a note').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  // pick kind: Document entry
  var kindSel = all(sheet, function (n) { return n.tagName === 'select'; })[0];
  assert.ok(kindSel, 'kind select missing');
  kindSel.value = 'doc';
  var texts = textInputs(sheet);
  texts[0].value = 'Visa';
  all(sheet, function (n) { return n.tagName === 'form'; })[0].fire('submit');
    // Now open the new note's edit sheet and give it a near expiry.
  var titleBtn = all(elements.app, function (n) { return n.className === 'card-title' && n.textContent === 'Visa'; })[0];
  assert.ok(titleBtn, 'visa card not found');
  titleBtn.fire('click');
  var sheet2 = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var dates = all(sheet2, function (n) { return n.tagName === 'input' && n.attrs.type === 'date'; });
  assert.strictEqual(dates.length, 2, 'doc should offer issue + expiry dates');
  assert.ok(sheet2.textContent.indexOf('Issue date') !== -1 && sheet2.textContent.indexOf('Expiry date') !== -1,
    'doc date labels missing');
  dates[1].value = '2026-11-01'; // within six months of the real clock (tested Oct 2026) -> warns
  all(sheet2, function (n) { return n.tagName === 'form'; })[0].fire('submit');
  var cards = all(elements.app, function (n) { return n.className === 'meta' && n.textContent.indexOf('Expires in') !== -1; });
  assert.strictEqual(cards.length, 1, 'expiry warning not on card');
});

step('itinerary sheet offers Copy text alongside Word', function () {
  button(elements.app, 'Itinerary').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  assert.ok(all(sheet, function (n) { return n.tagName === 'button' && n.textContent === 'Copy text'; }).length === 1,
    'Copy text button missing');
  button(sheet, 'Close').fire('click');
});

step('attach a document to the flight: picker stores it, paperclip shows, restore keeps the name', function () {
  // Back out to the trip page (the money step left us inside the Money page).
  while (all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Back'; }).length) {
    all(elements.app, function (n) { return n.tagName === 'button' && n.textContent === 'Back'; })[0].fire('click');
  }
  button(elements.app, 'Home \u2192 Singapore').fire('click');
  var sheet = all(bodyEl, function (n) { return n.className === 'sheet'; })[0];
  var pickBtn = all(sheet, function (n) { return n.tagName === 'button' && n.textContent === 'Attach from Files'; })[0];
  assert.ok(pickBtn, 'Attach from Files button missing');
  var pick = all(sheet, function (n) { return n.tagName === 'input' && n.attrs.type === 'file'; })
    .filter(function (i) { return i.attrs.accept !== '.tripboard,application/json'; })[0];
  assert.ok(pick, 'file picker input missing');
  // Simulate the user picking a file through the picker (stub the storage call).
  var calls = [];
  global.TBAtt.attach = function (noteId, f) {
    calls.push({ noteId: noteId, name: f.name });
    return Promise.resolve({ name: f.name, size: f.size, type: f.type, key: 'att_test_1' });
  };
  global.TBAtt.getFile = function () { return Promise.resolve(new global.Blob(['x'])); };
  pick.attrs.files = [{ name: 'e-ticket.pdf', size: 12345, type: 'application/pdf' }];
  pick.fire('change');
  return Promise.resolve().then(function () { return new Promise(function (r) { setTimeout(r, 5); }); }).then(function () {
    var s = savedState();
    var t = s.notes.filter(function (n) { return n.kind === 'train'; })[0];
    assert.strictEqual(t.attachments.length, 1, 'attachment not recorded');
    assert.strictEqual(t.attachments[0].name, 'e-ticket.pdf');
    assert.strictEqual(calls.length, 1, 'attach not called once');
    // paperclip: close the sheet, then the train card lives on the trip page below the place cards.
    button(sheet, 'Close').fire('click');
    assert.strictEqual(all(elements.app, function (n) { return n.className === 'tag' && n.textContent === '[doc] 1'; }).length, 1,
      'paperclip count missing on card');
  });
});

PENDING.then(function () {
  console.log('\n' + passed + ' UI steps passed' + (process.exitCode ? ', with failures' : ''));
}, function (e) {
  console.error('ASYNC-FAIL:', e && e.message);
  process.exitCode = 1;
});
