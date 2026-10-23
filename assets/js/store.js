/* Robobox Connect - state + persistence via Backend API. */
window.RB = window.RB || {};

RB.store = (function () {
  'use strict';

  var U = RB.util;
  var listeners = [];
  var state = null;
  // var API_BASE = 'http://localhost:3000';
  var API_BASE = 'https://api2.therobobox.co';
  var apiAdapter = {
    name: 'api',
    read: function () {
      return fetch(API_BASE + '/api/state')
        .then(function (res) {
          if (!res.ok) throw new Error('The server at ' + API_BASE + ' answered ' + res.status + '.');
          return res.json();
        }, function () {
          /* The call never reached the server, or the browser blocked the
           * reply. Nearly always one of two things: the API is down, or this
           * page is served from an origin the API does not allow (CORS).
           * Swallowing this used to boot the app with no data at all — an
           * empty sign-in list and no clue why — so it is thrown on to the
           * error screen instead. */
          throw new Error('Could not reach ' + API_BASE + ' from ' + location.origin +
            '. The API is either down, or not allowing this address to call it.');
        });
    },
    save: function (change, currentState) {
      return fetch(API_BASE + '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ change: change })
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Server refused the write');
          return res.json();
        });
    },
    clear: function () {
      // Handled server-side if reset is triggered, or can call a reset endpoint if needed
    }
  };

  var adapter = apiAdapter;

  function load() {
    return Promise.resolve(adapter.read()).then(function (stored) {
      state = (stored && stored.schools && stored.version === 2) ? stored : {
        version: 2, meta: { source: 'MySQL Database' }, users: [], schools: [], contacts: [], opportunities: [], connects: []
      };
      /* No people means nobody can sign in, so the sign-in screen would just
       * sit there with an empty list. Say what happened instead. */
      if (!state.users.length) {
        throw new Error('The server at ' + API_BASE + ' sent no people to sign in as.');
      }
      reconcileOfferings();
      return state;
    });
  }

  /* The product list changed under the data: some products were renamed and
   * one was retired. Settling both here, once, as the data arrives means
   * every screen, every roll-up and every export sees the current list
   * without any of them knowing anything happened. Nothing is rewritten on
   * the server, so both are reversible from model.js — OFFERING_ALIAS for
   * the renames, OFFERING_RETIRED for what is gone. */
  function reconcileOfferings() {
    var dropped = {};
    state.opportunities = state.opportunities.filter(function (o) {
      if (RB.model.OFFERING_RETIRED[o.offering]) { dropped[o.id] = true; return false; }
      var to = RB.model.offeringOf(o.offering);
      if (to !== o.offering) { o.renamedFrom = o.offering; o.offering = to; }
      return true;
    });
    // A connect only makes sense against the deal it was logged on.
    state.connects = state.connects.filter(function (c) { return !dropped[c.opportunityId]; });
  }

  function commit(change) {
    RB.model.invalidate();
    if (adapter.save) {
      Promise.resolve(adapter.save(change, state)).catch(function (e) {
        if (RB.ui) RB.ui.toast('Could not save: ' + (e.message || 'server refused the write'));
      });
    }
    listeners.forEach(function (fn) { fn(state); });
  }

  /* ------------------------------------------------------------- reads */
  var schools = function () { return state.schools; };
  var contacts = function () { return state.contacts; };
  var opportunities = function () { return state.opportunities; };
  var connects = function () { return state.connects; };
  var users = function () { return state.users; };
  var meta = function () { return state.meta; };

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  var schoolById = function (id) { return byId(state.schools, id); };
  var opportunityById = function (id) { return byId(state.opportunities, id); };
  var contactById = function (id) { return byId(state.contacts, id); };
  var userById = function (id) { return byId(state.users, id); };

  function contactsFor(schoolId) {
    return state.contacts.filter(function (c) { return c.schoolId === schoolId; });
  }
  function opportunitiesFor(schoolId) {
    return state.opportunities.filter(function (o) { return o.schoolId === schoolId; });
  }
  function connectsForSchool(schoolId) {
    return state.connects.filter(function (c) { return c.schoolId === schoolId; })
      .sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }

  function findSchool(name, location) {
    var n = String(name || '').trim().toLowerCase();
    var l = String(location || '').trim().toLowerCase();
    return state.schools.filter(function (s) {
      return s.name.trim().toLowerCase() === n &&
        (!l || String(s.location || '').trim().toLowerCase() === l);
    })[0] || null;
  }

  /* ------------------------------------------------------------ writes */
  function addUser(fields) {
    var name = String(fields.name || '').trim();
    var base = name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '') || 'USER';
    var key = base, n = 2;
    while (state.users.some(function (u) { return u.ownerKey === key; })) key = base + n++;
    var id = key.toLowerCase();
    var u = {
      id: id, name: name, role: fields.role || 'sales', ownerKey: key,
      designation: fields.designation || null, region: fields.region || null,
      email: fields.email || (id + '@robobox.in'),
      pin: fields.pin || id, origin: 'app'
    };
    state.users.push(u);
    commit({ type: 'user', user: u });
    return u;
  }

  function updateUser(id, patch) {
    var u = userById(id);
    if (u) {
      Object.assign(u, patch);
      commit({ type: 'user', user: u });
    }
    return u;
  }

  function removeUser(id) {
    var idx = state.users.findIndex(function (u) { return u.id === id; });
    if (idx === -1) {
      return { ok: false, error: 'User not found' };
    }
    var removed = state.users.splice(idx, 1)[0];
    commit({ type: 'user_delete', userId: id });
    return { ok: true, user: removed };
  }

  function addSchool(fields) {
    var s = Object.assign({
      id: U.uid('SCH'), name: '', location: null, region: 'Central', cluster: null,
      board: null, students: null, stemLab: null, labType: null, labSpend: null,
      existingLab: "Don't Know", competitor: 'None', leadSource: null, referredBy: null,
      ownerKey: null, origin: 'app', createdAt: U.iso(U.today())
    }, fields);
    state.schools.push(s);
    commit({ type: 'school_add', school: s });
    return s;
  }

  function addContact(fields) {
    var c = Object.assign({ id: U.uid('CON'), schoolId: null, name: '', role: null, phone: null, email: null }, fields);

    // Safety safeguard: if school doesn't exist locally, create a placeholder school first
    if (c.schoolId && !schoolById(c.schoolId)) {
      addSchool({ id: c.schoolId, name: 'Auto-created School (' + c.schoolId + ')' });
    }

    state.contacts.push(c);
    commit({ type: 'contact_add', contact: c });
    return c;
  }

  function addOpportunity(fields) {
    var o = Object.assign({
      id: U.uid('OPP'), schoolId: null, offering: null, variant: null, ownerKey: null,
      coOwners: [], initialPotential: null, currentNeed: null, decisionMaker: null,
      expectedClosure: null, probability: null, stage: null, salesYear: null, status: 'Open',
      closedValue: null, lossReason: null, holdReason: null, closedAt: null,
      origin: 'app', createdAt: U.iso(U.today())
    }, fields);

    // Safety safeguard: if school doesn't exist locally, create a placeholder school first
    if (o.schoolId && !schoolById(o.schoolId)) {
      addSchool({ id: o.schoolId, name: 'Auto-created School (' + o.schoolId + ')' });
    }

    state.opportunities.push(o);
    commit({ type: 'opportunity_add', opportunity: o });
    return o;
  }

  function logConnect(fields) {
    var c = Object.assign({
      id: U.uid('CNX'), schoolId: null, opportunityId: null, by: null,
      kind: 'Reconnect', mode: null, contactId: null, response: null, interest: 'Warm',
      blocker: 'None', blockerDetail: null, commercial: {},
      nextAction: null, nextActionOwner: null, nextActionAt: null,
      stage: null, expectedValue: null, probability: null, expectedClosure: null,
      notes: null, remarks: null, at: new Date().toISOString(), origin: 'app'
    }, fields);

    // Safety safeguard: if school doesn't exist locally, create a placeholder school first
    if (c.schoolId && !schoolById(c.schoolId)) {
      addSchool({ id: c.schoolId, name: 'Auto-created School (' + c.schoolId + ')' });
    }

    state.connects.push(c);

    var opp = opportunityById(c.opportunityId);
    if (opp && fields.close) {
      opp.status = fields.close.status;
      opp.closedAt = c.at.slice(0, 10);
      if (fields.close.status === 'Won') opp.closedValue = fields.close.value;
      else if (fields.close.status === 'On Hold') opp.holdReason = fields.close.reason;
      else { opp.lossReason = fields.close.reason; opp.finalValue = fields.close.value; }
    } else if (opp && c.stage && !RB.model.CLOSED[c.stage]) {
      opp.status = 'Open'; opp.closedAt = null;
    }
    if (opp && c.salesYear) opp.salesYear = c.salesYear;
    if (opp && c.expectedClosure) opp.expectedClosure = c.expectedClosure;
    if (opp && c.probability != null) opp.probability = c.probability;

    commit({ type: 'connect', connect: c, opportunity: opp });
    return c;
  }

  function updateSchool(id, patch) {
    var s = schoolById(id);
    if (s) { Object.assign(s, patch); commit({ type: 'school_add', school: s }); }
    return s;
  }

  function updateOpportunity(id, patch) {
    var o = opportunityById(id);
    if (o) { Object.assign(o, patch); commit({ type: 'opportunity_add', opportunity: o }); }
    return o;
  }

  function resetDemo() {
    load().then(function () {
      RB.model.invalidate();
      listeners.forEach(function (fn) { fn(state); });
    });
  }

  function exportState() { return JSON.stringify(state, null, 1); }

  return {
    load: load, commit: commit,
    schools: schools, contacts: contacts, opportunities: opportunities,
    connects: connects, users: users, meta: meta,
    schoolById: schoolById, opportunityById: opportunityById, contactById: contactById,
    userById: userById, contactsFor: contactsFor, opportunitiesFor: opportunitiesFor,
    connectsForSchool: connectsForSchool, findSchool: findSchool,
    addUser: addUser, updateUser: updateUser, removeUser: removeUser, // <-- ADD removeUser HERE
    addSchool: addSchool, addContact: addContact, addOpportunity: addOpportunity,
    logConnect: logConnect, updateSchool: updateSchool, updateOpportunity: updateOpportunity,
    resetDemo: resetDemo, exportState: exportState,
    subscribe: function (fn) { listeners.push(fn); },
    get adapter() { return adapter; },
    set adapter(a) { adapter = a; }
  };
})();