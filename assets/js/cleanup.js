/* Robobox Connect - apply a data clean-up from an edited export.
 *
 * The sales team cleans the pipeline in Excel: they take the website's own
 * export, and on its "Potential deals" tab blank the deal size of deals that
 * are not real, correct the ones that are wrong, and type CLOSED against the
 * ones they have sold. This reads that tab back and turns it into changes.
 *
 * The export carries no deal ids, so each row is matched to a live deal by
 * school name and location, then product, owner and original size. A row
 * that cannot be pinned to exactly one deal is skipped and listed - never
 * guessed. Nothing is written until the CEO has seen the preview and
 * confirmed, and afterwards the data is read back from the server to check
 * every change stuck.
 *
 *   blank or zero deal size   ->  dropped from the pipeline (status 'Dropped';
 *                                 the record stays on the server, the school
 *                                 stays on file)
 *   a different deal size     ->  the deal's size is set to it
 *   status CLOSED with a size ->  recorded as won at that size
 */
window.RB = window.RB || {};

RB.cleanup = (function () {
  'use strict';
  var U = RB.util, M = RB.model, UI = RB.ui;

  var SHEET = 'Potential deals';

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function num(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
    return isFinite(n) ? n : null;
  }

  /* ------------------------------------------------------------- read */
  function read(buffer) {
    var wb = XLSX.read(buffer, { type: 'array' });
    var ws = wb.Sheets[SHEET];
    if (!ws) throw new Error('This file has no "' + SHEET + '" tab. Use an Excel export from the Business page.');
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    var h = -1;
    for (var i = 0; i < Math.min(aoa.length, 10); i++) if (aoa[i] && aoa[i][0] === 'School') { h = i; break; }
    if (h === -1) throw new Error('Could not find the header row (School, Location, ...) on the "' + SHEET + '" tab.');
    var head = aoa[h].map(function (x) { return String(x || '').trim(); });
    var col = function (name) { return head.indexOf(name); };
    ['School', 'Location', 'Offering', 'Owner', 'Status', 'Current value'].forEach(function (n) {
      if (col(n) === -1) throw new Error('The "' + SHEET + '" tab has no "' + n + '" column.');
    });
    // "Exported 27/10/2026, 10:47:28 · ..." - deals created after this are not in the file
    var stamp = String((aoa[1] && aoa[1][0]) || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    var exportedOn = stamp ? stamp[3] + '-' + ('0' + stamp[2]).slice(-2) + '-' + ('0' + stamp[1]).slice(-2) : null;
    var rows = [];
    for (var r = h + 1; r < aoa.length; r++) {
      var a = aoa[r];
      if (!a || !a.some(function (x) { return x != null && x !== ''; })) continue;
      var get = function (n) { var c = col(n); return c === -1 ? null : a[c]; };
      rows.push({
        line: r + 1, school: get('School'), location: get('Location'), offering: get('Offering'),
        owner: get('Owner'), status: get('Status'), initial: num(get('Initial potential')),
        current: num(get('Current value')), closed: num(get('Closed'))
      });
    }
    return { rows: rows, exportedOn: exportedOn };
  }

  /* What the team asked for on one row. */
  function intent(row) {
    var st = norm(row.status);
    if (st === 'closed') {
      var v = row.closed || row.current;
      return v ? { kind: 'win', value: v } : { kind: 'skip', why: 'Marked CLOSED but has no amount' };
    }
    if (!row.current) return { kind: 'drop' };
    return { kind: 'value', value: row.current };
  }

  /* How well a row fits a live deal; -Infinity rules it out. */
  function score(row, v) {
    var locR = norm(row.location), locV = norm(v.school && v.school.location);
    if (locR && locV && locR !== locV) return -Infinity;
    var s = locR && locR === locV ? 1 : 0;
    var offR = norm(M.offeringOf(row.offering ? String(row.offering).trim() : '')), offV = norm(v.opp.offering);
    if (offR) s += offR === offV ? 4 : -2;
    // a one-letter slip such as AYIUSH still counts as AYUSH
    var ownR = norm(row.owner);
    if (ownR) s += near(ownR, norm(v.owner)) ? 2 : -1;
    if (row.initial != null && v.initialPotential != null && Math.abs(row.initial - v.initialPotential) < 1) s += 1;
    return s;
  }
  /* Equal, or one typed letter apart. */
  function near(a, b) {
    if (a === b) return true;
    if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  function informative(row) { return !!(norm(row.offering) || norm(row.owner) || row.initial != null); }

  /* ------------------------------------------------------------- plan */
  function plan(file) {
    var vs = M.views();
    // deals an earlier clean-up took out are candidates too, so a row finds
    // its own deal ("already out") instead of the next one at that school
    var out = M.views(RB.store.droppedOpportunities());
    var byName = {};
    vs.concat(out).forEach(function (v) { var k = norm(v.school && v.school.name); (byName[k] = byName[k] || []).push(v); });
    var schoolNames = {};
    RB.store.schools().forEach(function (s) { schoolNames[norm(s.name)] = true; });

    var groups = {};
    file.rows.forEach(function (row) { var k = norm(row.school); (groups[k] = groups[k] || []).push(row); });

    var ops = [], unchanged = [], skipped = [], matched = {};
    function skip(row, why) { skipped.push({ row: row, why: why }); }

    Object.keys(groups).forEach(function (k) {
      var rows = groups[k];
      if (!k) { rows.forEach(function (r) { skip(r, 'No school name on this row'); }); return; }
      var cands = (byName[k] || []).slice();
      if (!cands.length) {
        rows.forEach(function (r) {
          if (intent(r).kind === 'drop' && schoolNames[k]) unchanged.push({ row: r, why: 'Already out of the pipeline' });
          else skip(r, 'No deal for a school of this name on the website');
        });
        return;
      }
      // rows that still say which deal they are, best fit first
      var pairs = [];
      rows.filter(informative).forEach(function (r) {
        cands.forEach(function (v) { var sc = score(r, v); if (sc > -Infinity) pairs.push({ r: r, v: v, s: sc }); });
      });
      pairs.sort(function (a, b) { return b.s - a.s; });
      var usedR = [], usedV = [];
      // one deal at the school: the row is that deal, whatever was retyped on it
      var only = cands.length === 1;
      pairs.forEach(function (p) {
        if (usedR.indexOf(p.r) !== -1 || usedV.indexOf(p.v) !== -1 || (p.s < 0 && !only)) return;
        // two deals fitting this row equally well: it cannot be told which
        var rival = pairs.filter(function (q) { return q.r === p.r && q.v !== p.v && q.s === p.s && usedV.indexOf(q.v) === -1; });
        if (rival.length) return;
        usedR.push(p.r); usedV.push(p.v); decide(p.r, p.v);
      });
      // a row that still says which deal it is, but fits none: never paired by elimination
      rows.filter(function (r) { return informative(r) && usedR.indexOf(r) === -1; }).forEach(function (r) {
        var near = cands.filter(function (v) { return usedV.indexOf(v) === -1 && score(r, v) >= 0; });
        skip(r, near.length > 1 ? 'Cannot tell which of this school\'s ' + near.length + ' deals this row is'
                                : 'Its product or owner matches no deal at this school');
      });
      // rows wiped of detail take the deals that are left at that school -
      // only when they all ask for the same thing and the numbers agree
      var restR = rows.filter(function (r) { return !informative(r) && usedR.indexOf(r) === -1; });
      var restV = cands.filter(function (v) {
        return usedV.indexOf(v) === -1 && restR.some(function (r) { return score(r, v) > -Infinity; });
      });
      if (!restR.length) return;
      var kinds = U.uniq(restR.map(function (r) { return intent(r).kind; }));
      if (restR.length === restV.length && kinds.length === 1) {
        restR.forEach(function (r, i) { decide(r, restV[i]); });
      } else {
        restR.forEach(function (r) {
          skip(r, restV.length ? 'Cannot tell which of this school\'s ' + restV.length + ' deals this row is' : 'More rows than deals for this school');
        });
      }
    });

    function decide(row, v) {
      matched[v.opp.id] = true;
      var want = intent(row);
      if (v.opp.status === 'Dropped') {
        return want.kind === 'drop' ? unchanged.push({ row: row, v: v, why: 'Already out of the pipeline' })
          : skip(row, 'This deal was taken out of the pipeline by an earlier clean-up');
      }
      if (want.kind === 'skip') return skip(row, want.why);
      if (want.kind === 'drop') {
        if (v.status === 'Won') return skip(row, 'Deal size blanked, but this deal is won - left as it is');
        if (v.status === 'Lost') return unchanged.push({ row: row, v: v, why: 'Already lost' });
        return ops.push({ kind: 'drop', row: row, v: v });
      }
      if (want.kind === 'win') {
        if (v.status === 'Lost') return skip(row, 'Marked CLOSED, but this deal is lost on the website');
        if (v.status === 'Won' && Math.abs((v.current || 0) - want.value) < 1) return unchanged.push({ row: row, v: v });
        return ops.push({ kind: 'win', row: row, v: v, value: want.value });
      }
      if (v.status === 'Won' || v.status === 'Lost') return skip(row, 'New size given for a ' + v.status.toLowerCase() + ' deal - left as it is');
      if (Math.abs((v.current || 0) - want.value) < 1) return unchanged.push({ row: row, v: v });
      return ops.push({ kind: 'value', row: row, v: v, value: want.value });
    }

    // live deals the file does not mention: older ones were probably deleted
    // from the sheet; newer ones were added after the export and are left alone
    var missing = vs.filter(function (v) { return !matched[v.opp.id] && v.status !== 'Won' && v.status !== 'Lost'; });
    var older = missing.filter(function (v) { return !file.exportedOn || !v.opp.createdAt || v.opp.createdAt <= file.exportedOn; });
    var newer = missing.filter(function (v) { return older.indexOf(v) === -1; });

    return { file: file, vs: vs, ops: ops, unchanged: unchanged, skipped: skipped, notInFile: older, newSince: newer };
  }

  /* Totals as the Business page would show them, before and after. */
  function totals(vs) {
    var b = M.business(vs);
    return { total: b.potential, inPlay: b.activePipeline, won: b.wonValue, deals: b.potentialCount };
  }
  function after(p, dropMissing) {
    var gone = {}, edit = {};
    p.ops.forEach(function (o) {
      if (o.kind === 'drop') gone[o.v.opp.id] = true;
      else edit[o.v.opp.id] = o;
    });
    if (dropMissing) p.notInFile.forEach(function (v) { gone[v.opp.id] = true; });
    return p.vs.filter(function (v) { return !gone[v.opp.id]; }).map(function (v) {
      var o = edit[v.opp.id];
      if (!o) return v;
      var w = Object.assign({}, v, { current: o.value });
      if (o.kind === 'win') { w.status = 'Won'; w.closed = o.value; w.opp = Object.assign({}, v.opp, { closedAt: U.iso(U.today()) }); }
      return w;
    });
  }

  /* ------------------------------------------------------------ apply */
  function changesFor(p, dropMissing) {
    var now = new Date().toISOString(), today = U.iso(U.today());
    function put(v, patch) {
      var o = Object.assign({}, v.opp, patch);
      delete o.renamedFrom;
      return { type: 'opportunity_add', opportunity: o };
    }
    var list = p.ops.map(function (o) {
      if (o.kind === 'drop') return { op: o, change: put(o.v, { status: 'Dropped', closedAt: today }) };
      if (o.kind === 'win') return { op: o, change: put(o.v, { status: 'Won', closedValue: o.value, closedAt: today,
        salesYear: o.v.opp.salesYear || M.currentSalesYear() }) };
      return { op: o, change: put(o.v, { initialPotential: o.value, valueAt: now }) };
    });
    if (dropMissing) p.notInFile.forEach(function (v) {
      list.push({ op: { kind: 'drop', v: v }, change: put(v, { status: 'Dropped', closedAt: today }) });
    });
    return list;
  }

  /* One at a time, in order, so a failure is known and named. */
  function send(list, onStep) {
    var failed = [];
    return list.reduce(function (chain, item, i) {
      return chain.then(function () {
        onStep(i + 1, list.length);
        return Promise.resolve(RB.store.adapter.save(item.change, null)).catch(function (e) {
          failed.push({ item: item, error: (e && e.message) || 'refused' });
        });
      });
    }, Promise.resolve()).then(function () { return failed; });
  }

  /* Read everything back from the server and check each change is there. */
  function verify(list) {
    return RB.store.load().then(function () {
      M.invalidate();
      var byId = {};
      M.views().forEach(function (v) { byId[v.opp.id] = v; });
      return list.filter(function (item) {
        var o = item.op, v = byId[o.v.opp.id];
        if (o.kind === 'drop') return !!v;
        if (!v) return true;
        if (o.kind === 'win') return !(v.status === 'Won' && Math.abs((v.current || 0) - o.value) < 1);
        return Math.abs((v.current || 0) - o.value) >= 1;
      });
    });
  }

  /* --------------------------------------------------------------- UI */
  var KIND = { drop: 'Taken out of the pipeline', value: 'New deal size', win: 'Recorded as won' };

  function money(n) { return n == null ? '—' : U.money(n); }
  function line(v, right) {
    return '<li><span><strong>' + U.esc(v.school ? v.school.name : '—') + '</strong><small>' +
      U.esc([v.school && v.school.location, v.opp.offering, v.owner].filter(Boolean).join(' · ')) + '</small></span>' +
      '<b>' + right + '</b></li>';
  }
  function group(title, items, render, open) {
    if (!items.length) return '';
    return '<details class="cu-group"' + (open ? ' open' : '') + '><summary>' + U.esc(title) +
      '<span class="tag">' + U.count(items.length) + '</span></summary><ul class="cu-list">' +
      items.map(render).join('') + '</ul></details>';
  }
  function tile(label, a, b) {
    return '<div class="cu-tile"><span>' + U.esc(label) + '</span><s>' + U.esc(money(a)) + '</s><strong>' +
      U.esc(money(b)) + '</strong></div>';
  }

  function preview(host, p) {
    var dropMissing = false;
    function draw() {
      var now = totals(p.vs), then = totals(after(p, dropMissing));
      var count = p.ops.length + (dropMissing ? p.notInFile.length : 0);
      var drops = p.ops.filter(function (o) { return o.kind === 'drop'; });
      var values = p.ops.filter(function (o) { return o.kind === 'value'; });
      var wins = p.ops.filter(function (o) { return o.kind === 'win'; });
      host.innerHTML =
        '<p class="sec" style="margin-top:0">From <strong>' + U.esc(p.file.name) + '</strong>' +
          (p.file.exportedOn ? ', exported ' + U.esc(U.fmtDate(p.file.exportedOn)) : '') + ' · ' +
          U.count(p.file.rows.length) + ' rows. Nothing has changed yet.</p>' +
        '<div class="cu-tiles">' + tile('Total Business', now.total, then.total) +
          tile('Business in Play', now.inPlay, then.inPlay) + tile('Business Won', now.won, then.won) + '</div>' +
        group(KIND.drop + ' · ' + money(U.sum(drops, function (o) { return o.v.current || 0; })), drops,
          function (o) { return line(o.v, money(o.v.current)); }, false) +
        group(KIND.value, values, function (o) { return line(o.v, money(o.v.current) + ' → ' + money(o.value)); }, true) +
        group(KIND.win + ' · ' + money(U.sum(wins, function (o) { return o.value; })), wins,
          function (o) { return line(o.v, money(o.value)); }, true) +
        group('Skipped - could not be applied safely', p.skipped, function (s) {
          return '<li><span><strong>' + U.esc(s.row.school || '(no name)') + '</strong><small>Row ' + s.row.line +
            (s.row.location ? ' · ' + U.esc(s.row.location) : '') + '</small></span><b class="muted">' + U.esc(s.why) + '</b></li>';
        }, true) +
        (p.notInFile.length ? '<div class="cu-missing">' +
          group('On the website but not in the file · ' + money(U.sum(p.notInFile, function (v) { return v.current || 0; })),
            p.notInFile, function (v) { return line(v, money(v.current)); }, false) +
          '<label class="cu-check"><input type="checkbox" id="cu-missing"' + (dropMissing ? ' checked' : '') + '> ' +
          'Take these out too - the rows were deleted from the sheet</label></div>' : '') +
        (p.newSince.length ? '<p class="small muted">' + U.count(p.newSince.length) +
          ' deals were added after the export and are left as they are.</p>' : '') +
        '<p class="small muted">' + U.count(p.unchanged.length) + ' rows already match the website.</p>' +
        '<div class="modal-actions"><button class="btn" id="cu-backup">Download a backup first</button>' +
          '<button class="btn btn-primary" id="cu-go"' + (count ? '' : ' disabled') + '>Apply ' + U.count(count) + ' changes</button></div>';
      var box = host.querySelector('#cu-missing');
      if (box) box.addEventListener('change', function () { dropMissing = box.checked; draw(); });
      host.querySelector('#cu-backup').addEventListener('click', function () {
        U.download('robobox-backup-' + U.iso(U.today()) + '.json', RB.store.exportState(), 'application/json');
      });
      host.querySelector('#cu-go').addEventListener('click', function () { run(host, p, dropMissing, now); });
    }
    draw();
  }

  function run(host, p, dropMissing, before) {
    var list = changesFor(p, dropMissing);
    host.innerHTML = '<div class="cu-progress"><div class="meter"><span id="cu-bar" style="width:0%"></span></div>' +
      '<p id="cu-step" class="sec">Saving…</p></div>';
    var bar = host.querySelector('#cu-bar'), step = host.querySelector('#cu-step');
    send(list, function (i, n) {
      bar.style.width = Math.round((i / n) * 100) + '%';
      step.textContent = 'Saving ' + i + ' of ' + n + '…';
    }).then(function (failed) {
      step.textContent = 'Checking the server kept every change…';
      return verify(list).then(function (notKept) { done(host, list, failed, notKept, before); });
    }).catch(function (e) {
      host.innerHTML = '<p class="sec">Stopped: ' + U.esc(e.message || 'something went wrong') +
        '. Reload the page to see what was saved.</p>';
    });
  }

  function done(host, list, failed, notKept, before) {
    var now = totals(M.views());
    var ok = list.length - notKept.length;
    var kinds = U.uniq(notKept.map(function (i) { return i.op.kind; }));
    var fix = {
      drop: 'The opportunities "status" field must accept the value "Dropped".',
      value: 'Opportunities need a "valueAt" field (a date-time); without it a new deal size is overridden by older connects.',
      win: 'Opportunities must keep "status", "closedValue", "closedAt" and "salesYear" when a deal is updated.'
    };
    host.innerHTML =
      '<div class="cu-done' + (notKept.length ? ' has-gaps' : '') + '">' +
        '<strong class="cu-big">' + U.count(ok) + ' of ' + U.count(list.length) + ' changes saved</strong>' +
        '<div class="cu-tiles">' + tile('Total Business', before.total, now.total) +
          tile('Business in Play', before.inPlay, now.inPlay) + tile('Business Won', before.won, now.won) + '</div>' +
        (notKept.length ? '<p class="sec">' + U.count(notKept.length) + ' changes did not stick on the server' +
          (failed.length ? ' (' + U.count(failed.length) + ' were refused outright)' : '') +
          '. Send this to the IT team:</p><ul class="cu-fix">' +
          kinds.map(function (k) { return '<li>' + U.esc(fix[k]) + '</li>'; }).join('') +
          '</ul><p class="small muted">Once they have, run this again with the same file: what already stuck is skipped.</p>'
          : '<p class="sec">The server has every change. Every dashboard now reads the cleaned figures.</p>') +
      '</div>' +
      '<div class="modal-actions"><button class="btn btn-primary" data-close="1">Done</button></div>';
    RB.app.refresh();
  }

  function open() {
    UI.modal('Apply a data clean-up',
      '<div id="cu-host"><p class="sec" style="margin-top:0">Upload an Excel export from the Business page that the team has ' +
        'cleaned on its <strong>Potential deals</strong> tab:</p>' +
        '<ul class="cu-rules"><li><b>Deal size blanked or 0</b> - the deal is taken out of the pipeline. The school stays on file.</li>' +
        '<li><b>A different deal size</b> - the deal takes the new size.</li>' +
        '<li><b>Status CLOSED with an amount</b> - the deal is recorded as won at that amount.</li></ul>' +
        '<p class="small muted">You will see every change and the new totals before anything is saved.</p>' +
        '<label class="cu-drop"><input type="file" id="cu-file" accept=".xlsx,.xls"><span>Choose the cleaned Excel file</span></label>' +
        '<p id="cu-err" class="login-error" hidden></p></div>',
      { wide: true, onMount: function (h) {
          var input = h.querySelector('#cu-file'), err = h.querySelector('#cu-err');
          input.addEventListener('change', function () {
            var f = input.files && input.files[0];
            if (!f) return;
            f.arrayBuffer().then(function (buf) {
              var file = read(buf);
              file.name = f.name;
              preview(h.querySelector('#cu-host'), plan(file));
            }).catch(function (e) { err.textContent = e.message; err.hidden = false; });
          });
        } });
  }

  return { open: open, read: read, plan: plan, after: after, totals: totals, changesFor: changesFor };
})();
