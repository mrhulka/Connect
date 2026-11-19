/* Robobox Connect - one-time: apply the corrected business sheet.
 *
 * The CEO picks robobox-business_corrected.xlsx in Settings. Its "Change log"
 * says which deals were won in the tracker and which were removed or reset to
 * a lead. This turns that into deal edits on the live data - the same API
 * call the website makes when a deal is saved - after a full backup:
 *   - CLOSED in the tracker -> recorded as Won (skipped if already won);
 *   - removed / reset to a lead -> status Dropped, size cleared: the school
 *     and every connect stay, the deal leaves every money figure;
 *   - a deal the team logged connects on, or closed, on the website is left
 *     alone, whatever the sheet says.
 * It never deletes anything and never sends a connect. It also adds the new
 * people if they are missing. Running it again changes nothing.
 * Delete this file (and its Settings button) once the update is done.
 */
window.RB = window.RB || {};

RB.sheetUpdate = (function () {
  'use strict';

  var KINDS = { 'Marked Won (CLOSED in tracker)': 'won', 'Removed': 'clear', 'Reset to lead (old deal cleared)': 'clear' };
  var CLOSED_ON = '2026-10-27', SALES_YEAR = '26-27';   // the tracker's date
  var PEOPLE = [
    { id: 'suraj', name: 'Suraj K', role: 'sales', ownerKey: 'SURAJ K', region: 'KDMC', designation: 'Sales', pin: 'suraj' },
    { id: 'pramod', name: 'Pramod', role: 'sales', ownerKey: 'PRAMOD', region: 'Pune', designation: 'Sales', pin: 'pramod' },
    { id: 'robobox', name: 'Robobox Caller', role: 'caller', ownerKey: 'ROBOBOX', region: null, designation: 'Calls new schools', pin: 'robobox' }
  ];
  var norm = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  var first = function (n) { return String(n || '').split(/\s+/)[0].toLowerCase(); };

  /* The Change log sheet, as {do, school, offering, owner, value}. */
  function changes(XLSX, wb) {
    var name = wb.SheetNames.filter(function (n) { return n.toLowerCase() === 'change log'; })[0];
    if (!name) throw new Error('This file has no "Change log" sheet. Pick robobox-business_corrected.xlsx.');
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
    return rows.slice(1).filter(function (r) { return KINDS[r[0]]; }).map(function (r) {
      return { do: KINDS[r[0]], school: r[1], offering: r[2], owner: r[3], value: typeof r[5] === 'number' ? r[5] : null };
    });
  }

  /* Which live deal each row means: same school, then the best match on
   * product, owner and size. A deal already changed by this still counts as
   * the match, so a second run finds the same deal and leaves its twin alone. */
  function plan(st, rows) {
    var schools = {}, bySchool = {}, logged = {}, used = {};
    st.schools.forEach(function (s) { schools[s.id] = s; });
    st.opportunities.forEach(function (o) {
      var k = norm(schools[o.schoolId] && schools[o.schoolId].name);
      (bySchool[k] = bySchool[k] || []).push(o);
    });
    st.connects.slice().sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); })
      .forEach(function (c) {
        var l = logged[c.opportunityId] = logged[c.opportunityId] || { all: 0, web: 0 };
        l.all++; if (c.origin !== 'import') l.web++;
        if (c.stage) l.stage = c.stage;
      });
    var closed = function (o) {
      var s = (logged[o.id] || {}).stage;
      return (o.status && o.status !== 'Open' && o.status !== 'Dropped') || s === 'Won' || s === 'Lost' || s === 'On Hold';
    };
    var p = { won: [], clear: [], kept: [], done: [], missing: [] };
    rows.forEach(function (ch) {
      var score = function (o) {
        return (norm(RB.model.offeringOf(o.offering)) === norm(ch.offering)) * 4 +
          ((o.ownerKey || '') === (ch.owner || '')) * 2 +
          (o.initialPotential === ch.value ||
           (ch.do === 'clear' && (o.status === 'Dropped' || o.initialPotential == null)) ||
           (ch.do === 'won' && o.status === 'Won' && o.closedValue === ch.value)) * 1;
      };
      var act = function (o) { return (logged[o.id] || { all: 0 }).all; };
      var o = (bySchool[norm(ch.school)] || []).filter(function (x) { return !used[x.id]; })
        .sort(function (a, b) { return score(b) - score(a) || (ch.do === 'clear' ? act(a) - act(b) : act(b) - act(a)); })[0];
      // A win is money: it must match on both product and owner.
      if (!o || (ch.do === 'won' && score(o) < 6)) return p.missing.push(ch);
      used[o.id] = true;
      var row = { ch: ch, o: o };
      if (ch.do === 'won') {
        if (o.status === 'Won' && o.closedValue === ch.value) return p.done.push(row);
        if (closed(o)) return p.kept.push(row);
        row.patch = { status: 'Won', closedValue: ch.value != null ? ch.value : o.initialPotential,
                      closedAt: CLOSED_ON, salesYear: o.salesYear || SALES_YEAR };
        return p.won.push(row);
      }
      if ((logged[o.id] || { web: 0 }).web || closed(o)) return p.kept.push(row);
      if (o.status === 'Dropped' && o.initialPotential == null) return p.done.push(row);
      row.patch = { status: 'Dropped', initialPotential: null };
      p.clear.push(row);
    });
    p.people = PEOPLE.filter(function (n) {
      return !st.users.some(function (u) { return u.id === n.id || u.ownerKey === n.ownerKey || first(u.name) === first(n.name); });
    });
    p.connects = st.connects.length;
    p.pipelineBefore = pipeline(st);
    p.pipelineAfter = p.pipelineBefore - U().sum(p.clear.concat(p.won), function (r) {
      return r.o.status === 'Open' || !r.o.status ? (r.o.initialPotential || 0) : 0;
    });
    return p;
  }

  function U() { return RB.util; }
  function pipeline(st) {
    return U().sum(st.opportunities, function (o) { return o.status === 'Open' || !o.status ? (o.initialPotential || 0) : 0; });
  }

  /* One change at a time, then read everything back and check each one stuck
   * and that not a single connect went missing. */
  function apply(p) {
    var todo = p.won.concat(p.clear), failed = [];
    var steps = p.people.map(function (n) {
      return { change: { type: 'user', user: Object.assign({ email: n.id + '@robobox.in', origin: 'app' }, n) } };
    }).concat(todo.map(function (r) {
      return { row: r, change: { type: 'opportunity_add', opportunity: Object.assign({}, r.o, r.patch) } };
    }));
    var chain = Promise.resolve();
    steps.forEach(function (s) {
      chain = chain.then(function () { return RB.store.send(s.change); }).catch(function () { s.failed = true; });
    });
    return chain.then(function () { return RB.store.raw(); }).then(function (after) {
      var byId = {};
      after.opportunities.forEach(function (o) { byId[o.id] = o; });
      todo.forEach(function (r) {
        var o = byId[r.o.id];
        var ok = o && Object.keys(r.patch).every(function (k) { return o[k] === r.patch[k] || (r.patch[k] == null && o[k] == null); });
        if (!ok) failed.push(r.ch.school + ' (' + (r.o.offering || 'no product') + ')');
      });
      p.people.forEach(function (n) {
        var u = after.users.filter(function (x) { return x.id === n.id; })[0];
        if (!u || u.role !== n.role) failed.push('person ' + n.name);
      });
      return { done: steps.length - failed.length, total: steps.length, failed: failed,
               connectsBefore: p.connects, connectsAfter: after.connects.length, pipeline: pipeline(after) };
    });
  }

  return { changes: changes, plan: plan, apply: apply };
})();
