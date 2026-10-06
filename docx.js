/*
 * Travel Board - Word (.docx) itinerary builder.
 *
 * Build a real Word document for the trip, or any part of it, without
 * libraries or network calls. A .docx is a ZIP of XML files; this builds a
 * minimal, valid one (stored entries, no compression) by hand.
 * Depends on model.js (window.TB). Works in the browser (window.TBDocx)
 * and in Node (require('./docx.js')) so it can be tested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.TBDocx = factory(root.TB);
  }
})(typeof self !== 'undefined' ? self : this, function (TB) {
  'use strict';

  // ---------- zip: CRC-32 ----------

  var CRC_TABLE = (function () {
    var t = new Array(256), c, k, n;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- zip: writer (stored, no compression) ----------

  function num16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function num32(v) {
    v = v >>> 0;
    return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  }

  function nameBytes(s) {
    var out = new Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
  }

  // files: [{ name: string, data: Uint8Array }] -> Uint8Array of the whole zip
  function makeZip(files) {
    var bytes = [];
    var central = [];
    files.forEach(function (f) {
      var data = f.data;
      var nb = nameBytes(f.name);
      var crc = crc32(data);
      var at = bytes.length;
      // local file header: sig, version, flags, method, time, date (1980-01-01),
      // crc, compressed size, uncompressed size, name length, extra length
      bytes = bytes.concat(
        [0x50, 0x4B, 0x03, 0x04], num16(20), num16(0), num16(0),
        num16(0), num16(0x21),
        num32(crc), num32(data.length), num32(data.length),
        num16(nb.length), num16(0));
      bytes = bytes.concat(nb, Array.prototype.slice.call(data));
      central = central.concat(
        [0x50, 0x4B, 0x01, 0x02], num16(20), num16(20), num16(0), num16(0),
        num16(0), num16(0x21),
        num32(crc), num32(data.length), num32(data.length),
        num16(nb.length), num16(0), num16(0), num16(0), num16(0),
        num32(0), num32(at), nb);
    });
    var centralAt = bytes.length;
    bytes = bytes.concat(central);
    bytes = bytes.concat(
      [0x50, 0x4B, 0x05, 0x06], num16(0), num16(0),
      num16(files.length), num16(files.length),
      num32(bytes.length - centralAt), num32(centralAt), num16(0));
    return new Uint8Array(bytes);
  }

  // ---------- document XML ----------

  // UTF-8 encoder without TextEncoder (Safari 15 has TextEncoder, but Node
  // test paths and older WebViews may not; Buffer is Node-only).
  function utf8Bytes(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.codePointAt(i);
      if (c > 0xFFFF) i += 1; // surrogate pair consumed
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function para(opts) {
    var pPr = opts && opts.style ? '<w:pPr><w:pStyle w:val="' + opts.style + '"/></w:pPr>' : '';
    var runs = ((opts && opts.runs) || []).map(function (r) {
      var props = [];
      if (r.bold) props.push('<w:b/>');
      if (r.italic) props.push('<w:i/>');
      if (r.small) props.push('<w:sz w:val="18"/><w:szCs w:val="18"/>');
      if (r.colour) props.push('<w:color w:val="' + r.colour + '"/>');
      var rPr = props.length ? '<w:rPr>' + props.join('') + '</w:rPr>' : '';
      return '<w:r>' + rPr + '<w:t xml:space="preserve">' + esc(r.text) + '</w:t></w:r>';
    }).join('');
    return '<w:p>' + pPr + runs + '</w:p>';
  }

  var W_OPEN =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  // A4 page with 2 cm margins.
  var W_CLOSE =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>' +
    '</w:sectPr></w:body></w:document>';

  // ---- hyperlinks ----
  // A .docx link is a relationship (word/_rels/document.xml.rels) plus a
  // <w:hyperlink r:id="..."> run referencing it.
  var LINK_RELS = []; // rebuilt per document

  function resetLinks() { LINK_RELS = []; }

  function linkRelId(url) {
    for (var i = 0; i < LINK_RELS.length; i++) {
      if (LINK_RELS[i].url === url) return LINK_RELS[i].id;
    }
    var id = 'rIdLink' + (LINK_RELS.length + 1);
    LINK_RELS.push({ id: id, url: url });
    return id;
  }

  // r namespace is needed on the hyperlink element (declared inline).
  function linkPara(url, label) {
    var id = linkRelId(url);
    var run = '<w:r><w:rPr><w:color w:val="185FA5"/><w:u/></w:rPr>' +
      '<w:t xml:space="preserve">' + esc(label || url) + '</w:t></w:r>';
    return '<w:p><w:hyperlink r:id="' + id + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      run + '</w:hyperlink></w:p>';
  }

  // DOC_RELS becomes dynamic: styles relationship + one per link used.
  function buildDocRels() {
    var rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    LINK_RELS.forEach(function (l) {
      rels += '<Relationship Id="' + l.id +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' +
        esc(l.url) + '" TargetMode="External"/>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>';
  }

  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  var ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  var DOC_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="2C2C2A"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="2C2C2A"/></w:rPr></w:style>' +
    '</w:styles>';

  // ---------- the itinerary itself ----------

  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  // One line describing a note: kind, route, dates, times, nights, reference,
  // packing, payment, and what is still to sort. Shared by the Word file and
  // the reading view.
  function metaText(note) {
    var bits = [TB.kindOf(note.kind).label];
    if (note.from || note.to) bits.push((note.from || '?') + ' \u2192 ' + (note.to || '?'));
    var n = TB.nights(note);
    var when = '';
    if (note.startDate && note.endDate) {
      when = n === 0
        ? 'on ' + fmtDate(note.startDate)
        : fmtDate(note.startDate) + ' to ' + fmtDate(note.endDate) +
          (n !== null ? ' \u00B7 ' + n + (n === 1 ? ' night' : ' nights') : '');
    } else if (note.startDate) {
      when = 'from ' + fmtDate(note.startDate);
    } else if (note.endDate) {
      when = 'until ' + fmtDate(note.endDate);
    }
    if (note.startTime && note.endTime) when += ', ' + note.startTime + ' to ' + note.endTime;
    else if (note.startTime) when += ', ' + note.startTime;
    if (when) bits.push(when);
    if (note.reference) bits.push('Ref ' + note.reference);
    if (note.kind === 'item') bits.push(note.checked ? 'packed' : 'not packed');
    if (note.kind === 'payment') bits.push(note.checked ? 'paid' : 'unpaid');
    var prompt = TB.promptFor(note);
    if (prompt) bits.push('Still to sort: ' + prompt);
    return bits.join(' \u00B7 ');
  }

  // Paragraphs for the focused note: its heading and summary, then every
  // top-level child as a Heading with its descendants as indented bullets.
  // filter: { kindId -> true } of kinds to include; children of included notes
  // are still walked, but only included if their own kind is ticked.
  function included(state, id, filter) {
    var n = TB.getNote(state, id);
    if (!n || !filter[n.kind]) return false;
    return true;
  }

  // Add the note's link paragraph (call for any included note that has one).
  function linkLine(note, out) {
    if (note.link) out.push(linkPara(note.link, 'Open link: ' + note.link));
  }

  function buildParagraphs(state, focusId, filter) {
    resetLinks();
    var focus = TB.getNote(state, focusId);
    var out = [];
    out.push(para({ style: 'Heading1', runs: [{ text: focus.title }] }));
    var m = metaText(focus);
    if (m) out.push(para({ runs: [{ text: m, italic: true, small: true, colour: '5F5E5A' }] }));
    if (focus.details) out.push(para({ runs: [{ text: focus.details }] }));
    linkLine(focus, out);
    TB.children(state, focus.id).forEach(function (child) {
      section(state, child, out, filter);
    });
    return out;
  }

  function section(state, note, out, filter) {
    if (included(state, note.id, filter)) {
      out.push(para({ style: 'Heading2', runs: [{ text: note.title }] }));
      var m = metaText(note);
      if (m) out.push(para({ runs: [{ text: m, italic: true, small: true, colour: '5F5E5A' }] }));
      if (note.details) out.push(para({ runs: [{ text: note.details }] }));
      linkLine(note, out);
      TB.children(state, note.id).forEach(function (c) {
        bulletDeep(state, c, 0, out, filter);
      });
      return;
    }
    // Excluded section — still descend: an included note inside survives.
    TB.children(state, note.id).forEach(function (c) {
      section(state, c, out, filter);
    });
  }

  function bulletDeep(state, note, depth, out, filter) {
    if (!included(state, note.id, filter)) {
      // Skipped note — but still walk inside it: an included child survives.
      TB.children(state, note.id).forEach(function (c) {
        bulletDeep(state, c, depth, out, filter);
      });
      return;
    }
    var indent = '';
    for (var i = 0; i < depth; i++) indent += '\u00A0\u00A0\u00A0';
    var m = metaText(note);
    var runs = [{ text: indent + '\u2022  ' + note.title }];
    if (m) runs.push({ text: '   ' + m, italic: true, small: true, colour: '5F5E5A' });
    out.push(para({ runs: runs }));
    linkLine(note, out);
    TB.children(state, note.id).forEach(function (c) {
      bulletDeep(state, c, depth + 1, out, filter);
    });
  }

  function documentXml(state, focusId, filter) {
    return W_OPEN + buildParagraphs(state, focusId, filter || everythingFilter(state, focusId)).join('') + W_CLOSE;
  }

  // Every kind present in the tree, ticked — the default "all" filter.
  function everythingFilter(state, focusId) {
    var kinds = TB.kindsInTree(state, focusId);
    var f = {};
    Object.keys(kinds).forEach(function (k) { f[k] = true; });
    return f;
  }

  // ---------- package ----------

  function buildZipBytes(state, focusId, filter) {
    return makeZip([
      { name: '[Content_Types].xml', data: utf8Bytes(CONTENT_TYPES) },
      { name: '_rels/.rels', data: utf8Bytes(ROOT_RELS) },
      { name: 'word/document.xml', data: utf8Bytes(documentXml(state, focusId, filter)) },
      { name: 'word/_rels/document.xml.rels', data: utf8Bytes(buildDocRels()) },
      { name: 'word/styles.xml', data: utf8Bytes(STYLES) }
    ]);
  }

  function buildDocxBlob(state, focusId, filter) {
    return new Blob([buildZipBytes(state, focusId, filter)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  // "Italy 2027" -> "italy-2027-itinerary.docx"; with a restricted filter,
  // the kinds still included name the file: "...-itinerary-stay-bag.docx"
  function fileName(state, focusId, filter) {
    var focus = TB.getNote(state, focusId);
    var slug = String(focus ? focus.title : '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'trip';
    var name = slug + '-itinerary';
    if (filter) {
      var all = everythingFilter(state, focusId);
      var left = Object.keys(filter).filter(function (k) { return filter[k] && all[k]; }).sort();
      if (left.length && left.length !== Object.keys(all).length) {
        name += '-' + left.slice(0, 4).join('-');
      }
    }
    return name + '.docx';
  }

  return {
    fileName: fileName,
    metaText: metaText,
    documentXml: documentXml,
    buildZipBytes: buildZipBytes,
    buildDocxBlob: buildDocxBlob,
    everythingFilter: everythingFilter
  };
});