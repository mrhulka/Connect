/* Robobox Connect — sample data, for checking the build without the API.
 *
 * On when the file is opened straight off a disk, because a page served
 * from file:// cannot call the API at all - there is nothing else it could
 * usefully do. On a real server it stays off unless the address ends in
 * ?demo, so a deployed site is untouched.
 *
 * It swaps the storage adapter for one that reads the fixture below and
 * throws every write away, so nothing here can reach the real server. The
 * schools are invented; the products, prices and targets are the real ones,
 * because those are the thing being checked. */
(function () {
  'use strict';
  if (location.protocol !== 'file:' && !/[?&]demo\b/.test(location.search)) return;

  var USERS = [
    { id: 'parth',  name: 'Parth',   role: 'ceo',        ownerKey: 'PARTH',   pin: 'parth' },
    { id: 'ayush',  name: 'Ayush',   role: 'sales_head', ownerKey: 'AYUSH',   pin: 'ayush' },
    { id: 'sajesh', name: 'Sajesh',  role: 'outsight',   ownerKey: 'SAJESH',  pin: 'sajesh' },
    { id: 'sachin', name: 'Sachin C', role: 'sales',     ownerKey: 'SACHIN C', pin: 'sachin' },
    { id: 'sid',    name: 'Sid',     role: 'sales',      ownerKey: 'SID',     pin: 'sid' },
    { id: 'bhavik', name: 'Bhavik',  role: 'sales',      ownerKey: 'BHAVIK',  pin: 'bhavik' },
    { id: 'suraj',  name: 'Suraj K', role: 'sales',      ownerKey: 'SURAJ K', pin: 'suraj' },
    { id: 'gaurav', name: 'Gaurav',  role: 'sales',      ownerKey: 'GAURAV',  pin: 'gaurav' }
  ].map(function (u) { u.email = u.id + '@robobox.in'; u.origin = 'demo'; return u; });

  var SCHOOLS = [
    ['SCH-1', 'Greenfield International', 'Thane',       'Central',     'CBSE', 820, 'SID'],
    ['SCH-2', 'Sunrise Public School',    'Kalyan',      'KDMC',        'SSC',  640, 'SID'],
    ['SCH-3', 'Riverdale Academy',        'Vashi',       'Navi Mumbai', 'ICSE', 700, 'GAURAV'],
    ['SCH-4', 'St. Aloysius High',        'Andheri',     'Western',     'ICSE', 1100, 'GAURAV'],
    ['SCH-5', 'Vidya Niketan',            'Kothrud',     'Pune',        'SSC',  450, 'SACHIN C'],
    ['SCH-6', 'Orchid World School',      'Baner',       'Pune',        'CBSE', 980, 'SACHIN C'],
    ['SCH-7', 'Lakeview Academy',         'Dombivli',    'KDMC',        'CBSE', 700, 'BHAVIK'],
    ['SCH-8', 'Pinnacle English School',  'Nerul',       'Navi Mumbai', 'SSC',  520, 'SURAJ K']
  ].map(function (r) {
    return { id: r[0], name: r[1], location: r[2], region: r[3], board: r[4], students: r[5],
             ownerKey: r[6], stemLab: 'No', existingLab: "Don't Know", competitor: 'None',
             leadSource: 'Cold', origin: 'demo', createdAt: '2026-04-10' };
  });

  /* Deliberately mixed: deals still carrying the old product names, deals on
   * the new ones, a retired Advanced Lab Pro, both sales years, and a kit
   * deal sized off the standard bands. */
  var OPPS = [
    ['OPP-1', 'SCH-1', 'STEM Lab',                          'SID',      1770000, 'Won',  '26-27', 1680000],
    ['OPP-2', 'SCH-2', 'Kit Class',                         'SID',      2098000, 'Open', '27-28', null],
    ['OPP-3', 'SCH-3', 'Advanced Lab',                      'GAURAV',   2002527, 'Open', '27-28', null],
    ['OPP-4', 'SCH-4', 'Advanced Lab Pro',                  'GAURAV',   4500000, 'Won',  '26-27', 4500000],
    ['OPP-5', 'SCH-5', 'Composite Skill Lab (One Time Sale)', 'SACHIN C', 982527, 'Won', '26-27', 982527],
    ['OPP-6', 'SCH-6', 'Composite Skill Labs + Kits Curriculum', 'SACHIN C', 4168000, 'Open', '27-28', null],
    ['OPP-7', 'SCH-7', 'Robobox Kits',                      'BHAVIK',    419864, 'Won',  '26-27', 395000],
    ['OPP-8', 'SCH-8', 'Bagless',                           'SURAJ K',   180000, 'Open', '26-27', null],
    ['OPP-9', 'SCH-1', 'Workshop',                          'SID',        65000, 'Won',  '26-27', 65000],
    ['OPP-10', 'SCH-4', 'Innovation Stem Lab + Curriculum', 'GAURAV',   2376000, 'Open', '27-28', null]
  ].map(function (r) {
    return { id: r[0], schoolId: r[1], offering: r[2], variant: r[2] === 'Bagless' ? 'Pottery' : null,
             ownerKey: r[3], initialPotential: r[4], status: r[5], salesYear: r[6],
             closedValue: r[7], closedAt: r[7] ? '2026-08-20' : null,
             probability: r[5] === 'Open' ? 60 : null, expectedClosure: '2027-01-31',
             origin: 'demo', createdAt: '2026-04-12' };
  });

  var CONNECTS = OPPS.map(function (o, i) {
    return { id: 'CNX-' + (i + 1), schoolId: o.schoolId, opportunityId: o.id, by: o.ownerKey,
             kind: 'Reconnect', mode: 'Call', response: 'Interested', interest: 'Warm',
             blocker: 'None', stage: o.status === 'Won' ? 'Closed Won' : 'Proposal Sent',
             expectedValue: o.initialPotential, probability: 60, salesYear: o.salesYear,
             nextAction: 'Follow up on the proposal', nextActionOwner: o.ownerKey,
             nextActionAt: '2026-11-0' + ((i % 8) + 1) + 'T10:00',
             at: '2026-08-1' + (i % 9) + 'T09:30:00.000Z', origin: 'demo' };
  });

  var DATA = { version: 2, meta: { source: 'Sample data' }, users: USERS, schools: SCHOOLS,
               contacts: SCHOOLS.map(function (s, i) {
                 return { id: 'CON-' + (i + 1), schoolId: s.id, name: 'Principal', role: 'Principal',
                          phone: '98200000' + (10 + i), email: 'office@example.edu' };
               }),
               opportunities: OPPS, connects: CONNECTS };

  RB.store.adapter = {
    name: 'demo',
    read: function () { return JSON.parse(JSON.stringify(DATA)); },
    save: function () { /* a sample deck writes nowhere */ }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.textContent = 'Sample data — nothing here is saved. Sign in as any name; the access code is that name in lower case.';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:8px 14px;' +
      'background:#b45309;color:#fff;font:500 13px/1.4 Inter,system-ui,sans-serif;text-align:center';
    document.body.appendChild(bar);
    document.body.style.paddingBottom = '44px';   // so the strip covers nothing
  });
})();
