/*
 * Travel Board - screens and storage.
 * Depends on model.js (window.TB). No frameworks, no build step.
 * All user text is inserted with textContent / text nodes, never innerHTML.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'travelboard.v1';
  var state = null;
  var focusId = null;
  var openSheetCloser = null;
  var toastTimer = null;

  // ---------- tiny DOM helper ----------

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(el, c); });
    } else if (child.nodeType) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var v = attrs[key];
        if (v === null || v === undefined || v === false) return;
        if (key === 'class') el.className = v;
        else if (key === 'text') el.textContent = v;
        else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), v);
        else if (key === 'value' || key === 'checked' || key === 'selected') el[key] = v;
        else el.setAttribute(key, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  // ---------- storage ----------

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return TB.importJSON(raw, true);
    } catch (e) { /* fall through to first run */ }
    return null;
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, TB.exportJSON(state));
    } catch (e) {
      toast('Could not save on this device. Use Backup to keep a copy.');
    }
  }

  function toast(message) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  // ---------- formatting ----------

  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function datesText(note) {
    var n = TB.nights(note);
    var t = '';
    if (note.startTime && note.endTime) t = ', ' + note.startTime + ' to ' + note.endTime;
    else if (note.startTime) t = ', ' + note.startTime;
    if (note.startDate && note.endDate) {
      if (n === 0) return 'On ' + fmtDate(note.startDate) + t;
      return fmtDate(note.startDate) + ' to ' + fmtDate(note.endDate) + (n !== null ? ' · ' + plural(n, 'night') : '') + t;
    }
    if (note.startDate) return 'From ' + fmtDate(note.startDate) + t;
    if (note.endDate) return 'Until ' + fmtDate(note.endDate) + t;
    if (note.startTime) return 'At ' + note.startTime + (note.endTime ? ' to ' + note.endTime : '');
    return '';
  }

  function stateClass(note) {
    return note.status === 'placeholder' ? 'is-placeholder' : 'is-confirmed';
  }

  // One-tap open of the note's website link.
  function linkButton(note) {
    return h('button', {
      class: 'link-btn', type: 'button', text: 'Open link',
      'aria-label': 'Open link: ' + (note.link || ''),
      onclick: function () { window.open(note.link, '_blank'); }
    });
  }

  // 'Packed' / 'Paid' / '' for kinds with a tick box.
  function tickText(note) {
    if (note.kind === 'item') return note.checked ? 'Packed' : '';
    if (note.kind === 'payment') return note.checked ? 'Paid' : '';
    return '';
  }

  // ---------- sheets ----------

  function closeSheet() {
    if (openSheetCloser) openSheetCloser();
  }

  // Opens a modal sheet. build(body, close) fills the body.
  function openSheet(title, build) {
    closeSheet();
    var previousFocus = document.activeElement;
    var backdrop = h('div', { class: 'backdrop' });
    var body = h('div');
    var closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: 'Close' });
    var sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', { text: title }), closeBtn),
      body);
    backdrop.appendChild(sheet);

    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      document.removeEventListener('keydown', onKey);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      openSheetCloser = null;
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    openSheetCloser = close;
    document.body.appendChild(backdrop);
    build(body, close);
    var first = body.querySelector('input[type="text"], select, textarea');
    if (first) first.focus();
    return close;
  }

  function field(label, control) {
    return h('label', { class: 'field' }, h('span', { text: label }), control);
  }

  function kindSelect(selected, kinds) {
    var sel = h('select');
    kinds.forEach(function (k) {
      sel.appendChild(h('option', { value: k, text: TB.kindOf(k).label, selected: k === selected }));
    });
    return sel;
  }

  // ---------- sheet: Where next? ----------

  function whereNextSheet(parentId, index) {
    openSheet('Where next?', function (body, close) {
      var mode = 'flight';
      var segButtons = [];
      var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'How are you getting there?' });
      TB.JOURNEY_MODES.forEach(function (m) {
        var b = h('button', {
          type: 'button', text: m.label, 'aria-pressed': m.id === mode ? 'true' : 'false',
          onclick: function () {
            mode = m.id;
            segButtons.forEach(function (x) { x.btn.setAttribute('aria-pressed', x.id === mode ? 'true' : 'false'); });
          }
        });
        segButtons.push({ id: m.id, btn: b });
        seg.appendChild(b);
      });
      var to = h('input', { type: 'text', placeholder: 'e.g. Rome', autocomplete: 'off' });
      var form = h('form', {
        onsubmit: function (e) {
          e.preventDefault();
          TB.addJourney(state, { parentId: parentId, mode: mode, to: to.value, index: index });
          saveState();
          close();
          render();
        }
      },
        h('p', { class: 'note-line', text: 'Pick how you are getting there and where to. Both the journey and the place are added as placeholders you can fill in later.' }),
        h('div', { class: 'field' }, h('span', { text: 'How?' }), seg),
        field('Where to?', to),
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn main', type: 'submit', text: 'Add' })));
      body.appendChild(form);
    });
  }

  // ---------- sheet: packing suggestions ----------

  function suggestionsSheet(bagId) {
    var bag = TB.getNote(state, bagId);
    if (!bag) return;
    openSheet('Suggestions for ' + bag.title, function (body, close) {
      var pre = TB.suggestCategoryFor(bag.title);
      var current = pre || 'clothes';
      var have = {}; // set on every category switch / render

      var listWrap = h('div', { class: 'sugg-list' });
      var addBtn = h('button', { class: 'btn main', type: 'button', text: 'Add', disabled: true });

      function itemCount() {
        return listWrap.querySelectorAll ? listWrap.querySelectorAll('input:checked').length : countManual();
      }
      function countManual() {
        var n = 0;
        (function walk(el) {
          if (el.tagName === 'input' && el.checked) n += 1;
          (el.children || []).forEach(walk);
        })(listWrap);
        return n;
      }

      function renderList() {
        have = TB.existingTitles(state, bagId);
        var cat = TB.suggestionCategory(current);
        listWrap.textContent = '';
        cat.items.forEach(function (label) {
          var already = have[label.toLowerCase()];
          var box = h('input', { type: 'checkbox', disabled: already, 'aria-label': label });
          var row = h('label', { class: 'sugg-row' },
            box,
            h('span', { text: label + (already ? ' (already in ' + bag.title + ')' : '') }));
          listWrap.appendChild(row);
        });
        addBtn.disabled = false;
      }

      var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Category' });
      function segButtons() {
        seg.textContent = '';
        TB.SUGGESTIONS.forEach(function (c) {
          seg.appendChild(h('button', {
            type: 'button', text: c.label,
            'aria-pressed': c.id === current ? 'true' : 'false',
            onclick: function () { current = c.id; segButtons(); renderList(); }
          }));
        });
      }

      body.appendChild(h('p', {
        class: 'note-line',
        text: 'Tick what you are taking in ' + bag.title + ' and tap Add. Nothing is added until you tap Add — the list is only a prompt.'
      }));
      segButtons();
      body.appendChild(seg);
      renderList();
      body.appendChild(listWrap);

      function doAdd(e) {
        e.preventDefault();
        var picked = [];
        (function walk(el) {
          if (el.tagName === 'input' && el.checked) picked.push(el.getAttribute('aria-label'));
          (el.children || []).forEach(walk);
        })(listWrap);
        if (!picked.length) { toast('Tick at least one item first'); return; }
        picked.forEach(function (label) {
          TB.addNote(state, { parentId: bagId, kind: 'item', title: label });
        });
        saveState();
        close();
        render();
        toast(picked.length + ' added to ' + bag.title);
      }

      addBtn.addEventListener('click', doAdd);
      body.appendChild(h('div', { class: 'sheet-actions' }, addBtn));
    });
  }

  // ---------- sheet: add a note ----------

  function addNoteSheet(parentId, index) {
    var parent = TB.getNote(state, parentId);
    openSheet('Add inside ' + parent.title, function (body, close) {
      var kind = kindSelect('other', TB.addableKinds());
      var title = h('input', { type: 'text', placeholder: 'Optional', autocomplete: 'off' });
      var form = h('form', {
        onsubmit: function (e) {
          e.preventDefault();
          TB.addNote(state, { parentId: parentId, kind: kind.value, title: title.value, index: index });
          saveState();
          close();
          render();
        }
      },
        field('What is it?', kind),
        field('Title', title),
        h('p', { class: 'note-line', text: 'Only a title is ever needed, and even that can wait.' }),
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn main', type: 'submit', text: 'Add' })));
      body.appendChild(form);
    });
  }

  // ---------- sheet: edit a note ----------

  function editSheet(noteId) {
    var note = TB.getNote(state, noteId);
    if (!note) return;
    openSheet('Edit ' + TB.kindOf(note.kind).label.toLowerCase(), function (body, close) {
      var isRoot = note.id === state.rootId;
      var kindDef = TB.kindOf(note.kind);
      var has = function (f) { return kindDef.fields.indexOf(f) !== -1; };

      var title = h('input', { type: 'text', value: note.title, autocomplete: 'off' });
      var details = h('textarea', { value: note.details });
      var kind = isRoot ? null : kindSelect(note.kind, TB.addableKinds().concat(note.kind === 'home' ? ['home'] : []));
      var status = h('select',
        h('option', { value: 'placeholder', text: 'Placeholder (still to sort)', selected: note.status === 'placeholder' }),
        h('option', { value: 'confirmed', text: 'Confirmed', selected: note.status === 'confirmed' }));
      var start = h('input', { type: 'date', value: note.startDate });
      var end = h('input', { type: 'date', value: note.endDate });
      var nightsLine = h('p', { class: 'note-line' });
      var from = h('input', { type: 'text', value: note.from, autocomplete: 'off' });
      var to = h('input', { type: 'text', value: note.to, autocomplete: 'off' });
      var reference = h('input', { type: 'text', value: note.reference, autocomplete: 'off', placeholder: 'Booking or confirmation reference' });
      var checked = h('input', { type: 'checkbox', checked: note.checked });
      var hasTimes = kindDef.times ? true : false;
      var timeLabels = kindDef.times || { from: 'Starts at', to: null };
      var startTime = hasTimes ? h('input', { type: 'time', value: note.startTime }) : null;
      var endTime = (hasTimes && timeLabels.to) ? h('input', { type: 'time', value: note.endTime }) : null;

      function refreshNights() {
        var probe = { startDate: start.value, endDate: end.value };
        var n = TB.nights(probe);
        if (n === null) { nightsLine.textContent = 'Nights: add both dates'; return; }
        nightsLine.textContent = n === 0 ? 'Same day' : plural(n, 'night');
      }
      start.addEventListener('input', refreshNights);
      end.addEventListener('input', refreshNights);
      refreshNights();

      var form = h('form', {
        onsubmit: function (e) {
          e.preventDefault();
          var patch = { title: title.value, details: details.value };
          if (kind) patch.kind = kind.value;
          if (has('dates')) { patch.startDate = start.value; patch.endDate = end.value; }
          if (hasTimes) {
            patch.startTime = startTime.value;
            if (endTime) patch.endTime = endTime.value;
          }
          if (has('route')) { patch.from = from.value; patch.to = to.value; }
          if (has('reference')) patch.reference = reference.value;
          patch.link = linkInput.value; // validated/normalised by the model; every note may hold one
          if (has('checked')) patch.checked = checked.checked;
          if (status.value !== note.status) patch.status = status.value;
          TB.updateNote(state, note.id, patch);
          saveState();
          close();
          render();
        }
      });

      form.appendChild(field('Title', title));
      if (kind) form.appendChild(field('Kind', kind));
      form.appendChild(field('Notes', details));
      if (has('dates')) {
        form.appendChild(h('div', { class: 'row' }, field('From', start), field('To', end)));
        form.appendChild(nightsLine);
      }
      if (hasTimes) {
        form.appendChild(endTime
          ? h('div', { class: 'row' }, field(timeLabels.from, startTime), field(timeLabels.to, endTime))
          : field(timeLabels.from, startTime));
      }
      if (has('route')) form.appendChild(h('div', { class: 'row' }, field('From place', from), field('To place', to)));
      if (has('reference')) form.appendChild(field('Reference', reference));
      var linkInput = h('input', { type: 'url', inputmode: 'url', value: note.link || '', autocomplete: 'off', placeholder: 'e.g. qantas.com/booking or a maps link' });
      form.appendChild(field('Website link', linkInput));
      if (has('checked')) {
        var tickLabel = note.kind === 'payment' ? 'Paid in full' : 'Packed or done';
        form.appendChild(h('label', { class: 'field' }, h('span', { text: tickLabel }), checked));
      }
      form.appendChild(field('Status', status));

      var actions = h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn main', type: 'submit', text: 'Save' }),
        h('button', {
          class: 'btn', type: 'button', text: 'Open inside',
          onclick: function () { close(); focusId = note.id; render(); window.scrollTo(0, 0); }
        }));
      if (!isRoot) {
        actions.appendChild(h('button', {
          class: 'btn', type: 'button', text: 'Move up',
          onclick: function () { TB.moveNote(state, note.id, -1); saveState(); close(); render(); }
        }));
        actions.appendChild(h('button', {
          class: 'btn', type: 'button', text: 'Move down',
          onclick: function () { TB.moveNote(state, note.id, 1); saveState(); close(); render(); }
        }));
        actions.appendChild(h('button', {
          class: 'btn danger', type: 'button', text: 'Delete',
          onclick: function () {
            var inside = TB.children(state, note.id).length;
            var msg = inside ? 'Delete "' + note.title + '" and everything inside it?' : 'Delete "' + note.title + '"?';
            if (!window.confirm(msg)) return;
            var parentId = note.parentId;
            TB.deleteNote(state, note.id);
            if (focusId === note.id) focusId = parentId;
            saveState();
            close();
            render();
          }
        }));
      }
      form.appendChild(actions);
      body.appendChild(form);
    });
  }

  // ---------- itinerary view (reading + Word export) ----------

  // Export filter: kind id -> true. Rebuilt from "everything" each time the
  // sheet opens (never persisted — every export starts whole, by design).
  var exportFilter = null;

  function renderItinView(view, node) {
    view.textContent = '';
    var keep = exportFilter;
    if (keep[node.kind]) {
      view.appendChild(h('h3', { class: 'itin-root', text: node.title }));
      var rootMeta = TBDocx.metaText(node);
      if (rootMeta) view.appendChild(h('p', { class: 'itin-meta', text: rootMeta }));
      if (node.details) view.appendChild(h('p', { class: 'itin-detail', text: node.details }));
      if (node.link) view.appendChild(linkButton(node));
    }
    TB.children(state, node.id).forEach(function (child) {
      if (!keep[child.kind]) return;
      view.appendChild(h('h3', { class: 'itin-h', text: child.title }));
      var m = TBDocx.metaText(child);
      if (m) view.appendChild(h('p', { class: 'itin-meta', text: m }));
      if (child.details) view.appendChild(h('p', { class: 'itin-detail', text: child.details }));
      if (child.link) view.appendChild(linkButton(child));
      TB.children(state, child.id).forEach(function (c) {
        appendDeep(view, c, 0);
      });
    });
  }

  function itinDeepIncluded(view, note, depth) {
    if (!exportFilter[note.kind]) {
      TB.children(state, note.id).forEach(function (c) { itinDeepIncluded(view, c, depth); });
      return;
    }
    appendDeepRow(view, note, depth);
    TB.children(state, note.id).forEach(function (c) {
      itinDeepIncluded(view, c, depth + 1);
    });
  }

  function appendDeep(view, note, depth) {
    itinDeepIncluded(view, note, depth);
  }

  function appendDeepRow(view, note, depth) {
    var row = h('div', { class: 'itin-row' });
    var pad = '';
    for (var i = 0; i < depth; i++) pad += '\u00A0\u00A0\u00A0';
    row.appendChild(h('span', { class: 'itin-bullet', text: pad + '\u2022' }));
    var line = h('span', { class: 'itin-line' });
    line.appendChild(h('span', { class: 'itin-title', text: note.title }));
    var m = TBDocx.metaText(note);
    if (m) line.appendChild(h('span', { class: 'itin-meta', text: '  ' + m }));
    row.appendChild(line);
    if (note.link) row.appendChild(linkButton(note));
    view.appendChild(row);
  }

  function itinerarySheet(nodeId) {
    var node = TB.getNote(state, nodeId);
    if (!node) return;
    openSheet('Itinerary: ' + node.title, function (body) {
      // Filter: start from everything present in this subtree.
      exportFilter = TBDocx.everythingFilter(state, nodeId);
      var present = Object.keys(exportFilter).sort(function (a, b) {
        return TB.kindOf(a).label.localeCompare(TB.kindOf(b).label);
      });

      body.appendChild(h('p', {
        class: 'note-line',
        text: 'A clean read of "' + node.title + '". Tick the note types to include — untick clothes and packing for a pure itinerary, tick only bags for a packing list. What you see is what downloads.'
      }));

      // Filter row: one tick-box per kind present, all ticked.
      var filterRow = h('div', { class: 'filter-row', role: 'group', 'aria-label': 'Note types to include' });
      var view = h('div', { class: 'itin' });
      present.forEach(function (k) {
        var def = TB.kindOf(k);
        var box = h('input', {
          type: 'checkbox', checked: true,
          'aria-label': 'Include ' + def.label,
          onchange: function (e) {
            exportFilter[k] = e.target.checked;
            renderItinView(view, node);
          }
        });
        filterRow.appendChild(h('label', { class: 'filter-chip' },
          box,
          h('span', { text: def.label })));
      });
      body.appendChild(filterRow);

      renderItinView(view, node);
      body.appendChild(view);

      body.appendChild(h('div', { class: 'sheet-actions' },
        h('button', {
          class: 'btn main', type: 'button', text: 'Download Word (.docx)',
          onclick: function () {
            try {
              var blob = TBDocx.buildDocxBlob(state, nodeId, exportFilter);
              var name = TBDocx.fileName(state, nodeId, exportFilter);
              var url = URL.createObjectURL(blob);
              var a = h('a', { href: url, download: name });
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
              toast('Word document downloaded');
            } catch (err) {
              toast('Could not build the document on this device');
            }
          }
        }),
        h('button', {
          class: 'btn', type: 'button', text: 'Print / Save PDF',
          onclick: function () { window.print(); }
        })));
    });
  }

  // ---------- sheet: the Kinds manager ----------

  function kindsSheet() {
    openSheet('Kinds', function (body, close) {
      function renderList() {
        var list = h('div', { class: 'kinds-list' });
        Object.keys(TB.KINDS).forEach(function (k) {
          var def = TB.KINDS[k];
          var custom = TB.isCustomKind(k);
          list.appendChild(h('div', { class: 'kind-row' },
            h('span', { class: 'kind-swatch k-' + def.colour }),
            h('span', { class: 'kind-name', text: def.label }),
            custom ? h('span', { class: 'tag', text: 'Yours' }) : null,
            custom ? h('button', {
              class: 'small-btn', type: 'button', text: 'Remove',
              'aria-label': 'Remove ' + def.label,
              onclick: function () {
                var count = state.notes.filter(function (n) { return n.kind === k; }).length;
                var msg = count
                  ? 'Remove "' + def.label + '"? Its ' + count + ' notes become Other. Nothing is deleted.'
                  : 'Remove "' + def.label + '"?';
                if (!window.confirm(msg)) return;
                TB.removeCustomKind(state, k);
                saveState();
                close();
                render();
              }
            }) : null));
        });
        return list;
      }

      body.appendChild(h('p', {
        class: 'note-line',
        text: 'Your own note types, saved inside this trip. Built-in kinds stay; removing one of yours turns its notes into Other, deleting nothing.'
      }));
      body.appendChild(renderList());

      // --- add form ---
      var name = h('input', { type: 'text', placeholder: 'e.g. Car hire', autocomplete: 'off' });
      var colour = h('select');
      TB.COLOURS.forEach(function (c) { colour.appendChild(h('option', { value: c, text: c })); });
      var holds = h('select');
      TB.HOLD_LABELS.forEach(function (hm) { holds.appendChild(h('option', { value: hm.id, text: hm.label })); });
      var prompt = h('input', { type: 'text', placeholder: 'Optional, e.g. To be booked', autocomplete: 'off' });
      var starterTitle = h('input', { type: 'text', placeholder: 'Optional, e.g. Pick-up details', autocomplete: 'off' });
      var starterKind = kindSelect('other', TB.addableKinds());

      body.appendChild(h('form', {
        onsubmit: function (e) {
          e.preventDefault();
          if (!name.value.trim()) { toast('Give the kind a name first'); return; }
          var starters = starterTitle.value.trim() ? [{ kind: starterKind.value, title: starterTitle.value.trim() }] : [];
          var r = TB.addCustomKind(state, {
            label: name.value, colour: colour.value, holds: holds.value,
            prompt: prompt.value, starters: starters
          });
          if (!r) { toast('Could not add that kind'); return; }
          saveState();
          close();
          render();
          toast('Kind "' + r.label + '" added');
        }
      },
        h('h2', { text: 'Add a kind' }),
        field('Name', name),
        field('Colour', colour),
        field('What does it hold?', holds),
        field('Placeholder prompt while it is not sorted', prompt),
        h('p', { class: 'note-line', text: 'One optional starter note inside (for example Pick-up details):' }),
        h('div', { class: 'row' }, field('Starter title', starterTitle), field('Starter kind', starterKind)),
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn main', type: 'submit', text: 'Add kind' }))));
    });
  }

  // The app's permanent home, for "can I have a copy?" — update if the app moves.
  var APP_HOME = 'https://mccarthyjohn.github.io/travel-board/';

  function shareAppSheet() {
    openSheet('Share this app', function (body, close) {
      var url = APP_HOME;
      var readonly = h('input', { type: 'text', value: url, readonly: true, 'aria-label': 'App address' });
      body.appendChild(h('p', {
        class: 'note-line',
        text: 'Anyone can install Travel Board from this address. Send it to them (Messages, email), and on their device: open it in Safari, tap Share, then Add to Home Screen. They get a fresh empty board — your trips never leave your device.'
      }));
      body.appendChild(readonly);
      body.appendChild(h('div', { class: 'sheet-actions' },
        h('button', {
          class: 'btn main', type: 'button', text: 'Share / Send',
          onclick: function () {
            if (navigator.share) {
              navigator.share({ title: 'Travel Board', text: 'Install Travel Board:', url: url })
                .catch(function () { /* user cancelled the share sheet */ });
            } else if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(
                function () { toast('Address copied'); },
                function () { toast('Select the address and copy it'); });
            } else {
              readonly.focus(); readonly.select();
              try { document.execCommand('copy'); toast('Address copied'); }
              catch (e) { toast('Select the address and copy it'); }
            }
          }
        }),
        h('button', {
          class: 'btn', type: 'button', text: 'Copy address',
          onclick: function () {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(
                function () { toast('Address copied'); },
                function () { toast('Select the address and copy it'); });
            } else {
              readonly.focus(); readonly.select();
              try { document.execCommand('copy'); toast('Address copied'); }
              catch (e) { toast('Select the address and copy it'); }
            }
          }
        })));
    });
  }

  // ---------- sheet: backup and new trip ----------

  function backupSheet() {
    openSheet('Backup and new trip', function (body, close) {
      var output = h('textarea', { class: 'backup', readonly: true, 'aria-label': 'Backup data' });
      output.value = TB.exportJSON(state);
      var pasted = h('textarea', { class: 'backup', placeholder: 'Paste a backup here to restore it', 'aria-label': 'Paste backup to restore' });

      body.appendChild(h('p', { class: 'note-line', text: 'Everything is stored on this device only. Copy the backup below somewhere safe (Notes, email) so a lost or reset device does not lose the trip.' }));
      body.appendChild(output);
      body.appendChild(h('div', { class: 'sheet-actions' },
        h('button', {
          class: 'btn main', type: 'button', text: 'Copy backup',
          onclick: function () {
            output.focus();
            output.select();
            var done = function () { toast('Backup copied'); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(output.value).then(done, function () { toast('Select the text and copy it'); });
            } else {
              try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text and copy it'); }
            }
          }
        })));

      body.appendChild(h('hr'));
      body.appendChild(pasted);
      body.appendChild(h('div', { class: 'sheet-actions' },
        h('button', {
          class: 'btn', type: 'button', text: 'Restore from pasted backup',
          onclick: function () {
            try {
              var restored = TB.importJSON(pasted.value, true);
              if (!window.confirm('Replace the current trip with this backup?')) return;
              state = restored;
              focusId = state.rootId;
              saveState();
              close();
              render();
              toast('Backup restored');
            } catch (err) {
              toast(err.message);
            }
          }
        }),
        h('button', {
          class: 'btn danger', type: 'button', text: 'Start a new trip',
          onclick: function () {
            if (!window.confirm('Delete the current trip and start a new one? Copy a backup first if you want to keep it.')) return;
            try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            state = null;
            focusId = null;
            close();
            render();
          }
        })));
    });
  }

  // ---------- screens ----------

  function renderWelcome(app) {
    var name = h('input', { type: 'text', placeholder: 'e.g. Italy 2027', autocomplete: 'off' });
    var form = h('form', {
      class: 'welcome',
      onsubmit: function (e) {
        e.preventDefault();
        state = TB.createState(name.value.trim() || 'My trip');
        focusId = state.rootId;
        saveState();
        render();
      }
    },
      h('h1', { text: 'Travel Board' }),
      h('p', { text: 'Plan a trip with sticky notes inside sticky notes, from packing your bag to the last meal. Anything you do not know yet stays a placeholder.' }),
      field('Name your trip', name),
      h('button', { class: 'btn main', type: 'submit', text: 'Start planning' }));
    app.appendChild(form);
    name.focus();
  }

  function renderHeader(focus) {
    var path = TB.pathTo(state, focus.id);
    var top = h('div', { class: 'top' });
    if (focus.parentId) {
      top.appendChild(h('button', {
        class: 'icon-btn', type: 'button', text: 'Back', 'aria-label': 'Back to ' + TB.getNote(state, focus.parentId).title,
        onclick: function () { focusId = focus.parentId; render(); window.scrollTo(0, 0); }
      }));
    }
    top.appendChild(h('h1', { text: focus.title }));
    top.appendChild(h('button', { class: 'icon-btn', type: 'button', text: 'Edit', onclick: function () { editSheet(focus.id); } }));
    top.appendChild(h('button', { class: 'icon-btn', type: 'button', text: 'Itinerary', onclick: function () { itinerarySheet(focus.id); } }));
    top.appendChild(h('button', { class: 'icon-btn', type: 'button', text: 'Kinds', onclick: kindsSheet }));
    top.appendChild(h('button', { class: 'icon-btn', type: 'button', text: 'Share app', onclick: shareAppSheet }));
    top.appendChild(h('button', { class: 'icon-btn', type: 'button', text: 'Backup', onclick: backupSheet }));
    var frag = document.createDocumentFragment();
    frag.appendChild(top);
    frag.appendChild(h('p', { class: 'crumbs', text: path.map(function (n) { return n.title; }).join(' / ') }));
    return frag;
  }

  function renderSummary(focus) {
    var bits = [];
    var prompt = TB.promptFor(focus);
    var dates = datesText(focus);
    if (focus.from || focus.to) bits.push(h('p', { text: (focus.from || '?') + ' → ' + (focus.to || '?') }));
    if (dates) bits.push(h('p', { text: dates }));
    if (prompt) bits.push(h('p', null, h('span', { class: 'tag', text: prompt })));
    if (focus.reference) bits.push(h('p', { text: 'Reference: ' + focus.reference }));
    if (focus.link) bits.push(h('p', null, linkButton(focus)));
    if (focus.details) bits.push(h('p', { text: focus.details }));
    return bits.length ? h('div', { class: 'summary' }, bits) : null;
  }

  function renderChip(child) {
    var def = TB.kindOf(child.kind);
    var cls = 'k-' + def.colour + ' ' + stateClass(child);
    if (child.kind === 'item') {
      var box = h('input', {
        type: 'checkbox', checked: child.checked, 'aria-label': 'Packed: ',
        onchange: function (e) {
          TB.updateNote(state, child.id, { checked: e.target.checked });
          saveState();
          render();
        }
      });
      // Inline rename: the common case is typing the name right after quick-add.
      var rename = h('input', {
        type: 'text', class: 'chip-rename', value: child.title,
        'data-edit-id': child.id, 'aria-label': 'Name of the item',
        onchange: function (e) {
          TB.updateNote(state, child.id, { title: e.target.value });
          saveState();
          render();
        }
      });
      return h('span', { class: 'chip-check ' + cls },
        box,
        rename,
        h('button', { class: 'small-btn', type: 'button', text: 'Edit', 'aria-label': 'Edit ' + child.title, onclick: function () { editSheet(child.id); } }));
    }
    var count = TB.children(state, child.id).length;
    var prompt = TB.promptFor(child);
    return h('button', {
      class: 'chip ' + cls, type: 'button', onclick: function () { editSheet(child.id); }
    },
      h('span', { text: child.title }),
      prompt ? h('span', { class: 'tag', text: prompt }) : null,
      count ? h('span', { class: 'count', text: '(' + count + ' inside)' }) : null);
  }

  function renderCard(note, position, total, clashes) {
    var def = TB.kindOf(note.kind);
    var kids = TB.children(state, note.id);
    var prompt = TB.promptFor(note);
    var classes = 'card k-' + def.colour + ' ' + stateClass(note) + (clashes[note.id] ? ' has-clash' : '');

    var meta = h('div', { class: 'meta' }, h('span', { class: 'tag kind', text: def.label }));
    if (prompt) meta.appendChild(h('span', { class: 'tag', text: prompt }));
    if (clashes[note.id]) meta.appendChild(h('span', { class: 'tag warn', text: 'Dates overlap the one before' }));
    if (note.from || note.to) meta.appendChild(h('span', { text: (note.from || '?') + ' → ' + (note.to || '?') }));
    var dates = datesText(note);
    if (dates) meta.appendChild(h('span', { text: dates }));
    if (note.reference) meta.appendChild(h('span', { text: 'Ref ' + note.reference }));
    var tick = tickText(note);
    if (tick) meta.appendChild(h('span', { class: 'tag', text: tick }));

    var head = h('div', { class: 'card-head' },
      h('button', { class: 'card-title', type: 'button', text: note.title, onclick: function () { editSheet(note.id); } }),
      h('div', { class: 'card-actions' },
        (note.link ? h('button', {
          class: 'small-btn', type: 'button', text: 'Link', 'aria-label': 'Open the website for ' + note.title,
          onclick: function () { window.open(note.link, '_blank'); }
        }) : null),
        h('button', {
          class: 'small-btn', type: 'button', text: 'Up', disabled: position === 0, 'aria-label': 'Move ' + note.title + ' up',
          onclick: function () { TB.moveNote(state, note.id, -1); saveState(); render(); }
        }),
        h('button', {
          class: 'small-btn', type: 'button', text: 'Down', disabled: position === total - 1, 'aria-label': 'Move ' + note.title + ' down',
          onclick: function () { TB.moveNote(state, note.id, 1); saveState(); render(); }
        }),
        h('button', {
          class: 'small-btn', type: 'button', text: 'Open', 'aria-label': 'Open ' + note.title,
          onclick: function () { focusId = note.id; render(); window.scrollTo(0, 0); }
        })));

    var chips = h('div', { class: 'chips' }, kids.map(renderChip));
    var quickRow = null;
    if (note.kind === 'bag' || note.kind === 'packing') {
      quickRow = h('div', { class: 'quick-add' },
        h('button', {
          class: 'quick-btn', type: 'button', text: '+ Item',
          'aria-label': 'Add an item to ' + note.title,
          onclick: function () { quickAddItem(note); }
        }),
        h('button', {
          class: 'quick-btn', type: 'button', text: '+ Bag',
          'aria-label': 'Add a bag inside ' + note.title,
          onclick: function () { quickAddBag(note); }
        }),
        h('button', {
          class: 'quick-btn', type: 'button', text: '+ Suggestions',
          'aria-label': 'Suggested items for ' + note.title,
          onclick: function () { suggestionsSheet(note.id); }
        }));
    }
    var addInside = h('button', {
      class: 'add-inside', type: 'button', text: '+ Add inside',
      onclick: function () { addNoteSheet(note.id); }
    });
    return h('section', { class: classes }, head, meta, kids.length ? chips : null, quickRow, addInside);
  }

  // One-tap item/bag add for packing. Creates the note, saves, redraws, and
  // (for items) puts the cursor straight into the new note's name field.
  // Quick-added rows keep their input addressable without a DOM query:
  // render() stores the newest rename field here for focus.
  var pendingRenameFocus = null;

  function quickAddItem(bagNote) {
    var item = TB.addNote(state, { parentId: bagNote.id, kind: 'item', title: '' });
    pendingRenameFocus = item.id;
    saveState();
    render();
  }

  function quickAddBag(bagNote) {
    TB.addNote(state, { parentId: bagNote.id, kind: 'bag', title: '' });
    pendingRenameFocus = null;
    saveState();
    render();
  }

  function renderBody(focus) {
    var isTrip = focus.kind === 'trip';
    var isBagView = focus.kind === 'bag' || focus.kind === 'packing';
    var kids = TB.children(state, focus.id);
    var clashes = TB.dateClashes(state, focus.id);
    var wrap = h('div');
    var summary = renderSummary(focus);
    if (summary) wrap.appendChild(summary);
    if (isBagView) {
      wrap.appendChild(h('div', { class: 'quick-add quick-add-page' },
        h('button', {
          class: 'quick-btn', type: 'button', text: '+ Item',
          'aria-label': 'Add an item to this bag',
          onclick: function () { quickAddItem(focus); }
        }),
        h('button', {
          class: 'quick-btn', type: 'button', text: '+ Bag',
          'aria-label': 'Add a bag inside this bag',
          onclick: function () { quickAddBag(focus); }
        }),
        h('button', {
          class: 'quick-btn', type: 'button', text: '+ Suggestions',
          'aria-label': 'Suggested items for this bag',
          onclick: function () { suggestionsSheet(focus.id); }
        })));
    }

    var list = h('div', { class: 'list' });
    var insertLabel = isTrip ? '+ Where next?' : '+ Add note here';
    function insertAt(i) {
      return h('button', {
        class: 'insert', type: 'button', text: insertLabel,
        'aria-label': (isTrip ? 'Insert a stop at position ' : 'Insert a note at position ') + (i + 1),
        onclick: function () { if (isTrip) whereNextSheet(focus.id, i); else addNoteSheet(focus.id, i); }
      });
    }

    if (kids.length === 0) {
      list.appendChild(h('div', { class: 'empty', text: 'Nothing in here yet.' }));
    }
    kids.forEach(function (child, i) {
      if (i > 0) list.appendChild(insertAt(i));
      list.appendChild(renderCard(child, i, kids.length, clashes));
    });

    list.appendChild(h('button', {
      class: 'primary', type: 'button', text: isTrip ? 'Where next?' : 'Add a note',
      onclick: function () { if (isTrip) whereNextSheet(focus.id); else addNoteSheet(focus.id); }
    }));
    wrap.appendChild(list);
    return wrap;
  }

  function render() {
    var app = document.getElementById('app');
    app.textContent = '';
    if (!state) {
      renderWelcome(app);
      return;
    }
    var focus = TB.getNote(state, focusId) || TB.getNote(state, state.rootId);
    focusId = focus.id;
    document.title = focus.title + ' - Travel Board';
    app.appendChild(renderHeader(focus));
    app.appendChild(renderBody(focus));
    // After a quick-add, drop the cursor into the new item's name field.
    if (pendingRenameFocus) {
      var target = pendingRenameFocus;
      pendingRenameFocus = null;
      var input = allInputs().filter(function (n) { return n.attrs['data-edit-id'] === target; })[0];
      if (input && input.focus) input.focus();
    }
  }

  // Collect text inputs for focus targeting; uses tree walk so it works in
  // both real browsers and the fake DOM test.
  function allInputs() {
    var out = [];
    (function walk(n) {
      if (n.tagName === 'input' && n.attrs && n.attrs['data-edit-id']) out.push(n);
      (n.children || []).forEach(walk);
    })(document.getElementById('app'));
    return out;
  }

  // ---------- start ----------

  state = loadState();
  focusId = state ? state.rootId : null;
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
    });
  }
})();
