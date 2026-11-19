/* Robobox Connect - "Upload updated data".
 *
 * Applies an update file prepared from a backup: records to put back and
 * records to change, each named by its id. It only ever adds or edits, the
 * same way the website saves a deal or a connect; it never deletes anything.
 *
 *   people    [{...user}]                  added if nobody has that name/code
 *   deals     [{id, create:{...}}]         put back if the id is not there
 *             [{id, patch:{...}}]          fields set on the live deal
 *   connects  [{id, create:{...}}]         put back if the id is not there
 *             [{id, link:'OPP-...'}]       a connect re-attached to its deal
 *
 * Before anything changes it saves a full backup to this computer and tries
 * one re-link, then reads the data back: if the server did not update that
 * connect in place, it stops there. Afterwards it reads everything back and
 * checks every change stuck and that no connect is missing or doubled.
 * Running the same file again finds nothing to do.
 */
window.RB = window.RB || {};

RB.dataUpdate = (function () {
  'use strict';

  var first = function (n) { return String(n || '').split(/\s+/)[0].toLowerCase(); };
  var same = function (a, b) { return a === b || (a == null && b == null); };
  var index = function (rows) { var m = {}; rows.forEach(function (r) { m[r.id] = r; }); return m; };

  function read(text) {
    var f = JSON.parse(text);
    if (!f || f.kind !== 'robobox-updated-data') throw new Error('This is not a Robobox update file.');
    return f;
  }

  /* What is still to do, against the live data as it is right now. */
  function plan(live, f) {
    var deals = index(live.opportunities), conns = index(live.connects);
    var p = { people: [], dealCreate: [], dealPatch: [], connCreate: [], connLink: [], done: 0, problems: [] };
    (f.people || []).forEach(function (n) {
      var there = live.users.some(function (u) { return u.id === n.id || u.ownerKey === n.ownerKey || first(u.name) === first(n.name); });
      there ? p.done++ : p.people.push(n);
    });
    (f.deals || []).forEach(function (d) {
      var o = deals[d.id];
      if (d.create) return o ? p.done++ : p.dealCreate.push(d.create);
      if (!o) return p.problems.push('Deal ' + d.id + ' is not in the data any more - left alone.');
      if (Object.keys(d.patch).every(function (k) { return same(o[k], d.patch[k]); })) return p.done++;
      p.dealPatch.push(Object.assign({}, o, d.patch));
    });
    var willExist = index(live.opportunities.concat(p.dealCreate));
    (f.connects || []).forEach(function (c) {
      var x = conns[c.id];
      if (c.create) {
        if (x) return p.done++;
        if (c.create.opportunityId && !willExist[c.create.opportunityId]) return p.problems.push('Connect ' + c.id + ': its deal is missing - left alone.');
        return p.connCreate.push(c.create);
      }
      if (!x) return p.problems.push('Connect ' + c.id + ' is not in the data any more - left alone.');
      if (x.opportunityId === c.link) return p.done++;
      if (!willExist[c.link]) return p.problems.push('Connect ' + c.id + ': its deal is missing - left alone.');
      p.connLink.push(Object.assign({}, x, { opportunityId: c.link }));
    });
    p.total = p.people.length + p.dealCreate.length + p.dealPatch.length + p.connCreate.length + p.connLink.length;
    p.connects = live.connects.length;
    p.dealsById = index(live.opportunities.concat(p.dealCreate).concat(p.dealPatch));
    return p;
  }

  function sendConnect(p, c) {
    return RB.store.send({ type: 'connect', connect: c, opportunity: p.dealsById[c.opportunityId] || null });
  }

  function apply(p, live) {
    var failed = [];
    var before = index(live.connects);
    var tries = function (label, fn) { return fn().catch(function () { failed.push(label); }); };
    // 1. One re-link first: the server must update a connect in place. It is
    //    one whose deal is already there, so the trial changes nothing else.
    var liveDeals = index(live.opportunities);
    var probe = p.connLink.filter(function (c) { return liveDeals[c.opportunityId]; })[0] || p.connLink[0];
    var start = probe ? sendConnect(p, probe).catch(function () {
      throw new Error('The server refused to re-link a connect, so nothing else was changed.');
    }).then(function () { return RB.store.raw(); }).then(function (st) {
      var x = index(st.connects)[probe.id];
      if (!x || x.opportunityId !== probe.opportunityId || st.connects.length !== live.connects.length) {
        throw new Error('The server did not re-link a connect in place, so nothing else was changed. ' +
          'Connects now: ' + st.connects.length + ' (were ' + live.connects.length + ').');
      }
    }) : Promise.resolve();
    // 2. The rest, in an order where every connect's deal already exists.
    return start.then(function () {
      var steps = [];
      p.people.forEach(function (u) {
        steps.push(function () { return tries('person ' + u.name, function () {
          return RB.store.send({ type: 'user', user: Object.assign({ email: u.id + '@robobox.in', origin: 'app' }, u) }); }); });
      });
      p.dealCreate.concat(p.dealPatch).forEach(function (o) {
        steps.push(function () { return tries('deal ' + o.id, function () { return RB.store.send({ type: 'opportunity_add', opportunity: o }); }); });
      });
      p.connCreate.concat(p.connLink.filter(function (c) { return c !== probe; })).forEach(function (c) {
        steps.push(function () { return tries('connect ' + c.id, function () { return sendConnect(p, c); }); });
      });
      return steps.reduce(function (chain, s) { return chain.then(s); }, Promise.resolve());
    }).then(function () { return RB.store.raw(); }).then(function (st) {
      // 3. Read it all back.
      var d = index(st.opportunities), c = index(st.connects), u = index(st.users);
      p.dealCreate.concat(p.dealPatch).forEach(function (o) {
        var x = d[o.id];
        if (!x || !same(x.status, o.status) || !same(x.initialPotential, o.initialPotential)) failed.push('deal ' + o.id);
      });
      p.connCreate.concat(p.connLink).forEach(function (o) {
        if (!c[o.id] || c[o.id].opportunityId !== o.opportunityId) failed.push('connect ' + o.id);
      });
      p.people.forEach(function (n) { if (!u[n.id] || u[n.id].role !== n.role) failed.push('person ' + n.name); });
      var lost = Object.keys(before).filter(function (id) { return !c[id]; });
      var ids = st.connects.map(function (x) { return x.id; });
      return { done: p.total - failed.length, total: p.total, failed: unique(failed),
               connectsBefore: live.connects.length, connectsAfter: st.connects.length,
               lost: lost.length, doubled: ids.length - Object.keys(c).length };
    });
  }

  function unique(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }

  return { read: read, plan: plan, apply: apply };
})();
