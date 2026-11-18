/* Deals imported from the old sheet have no stage and sometimes no owner.
 * They must still read as worked-on deals, in someone's book.
 *
 *   node tools/test_imported.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const js = f => fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', f), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem() {} } };
ctx.window = ctx; vm.createContext(ctx);
['util.js', 'model.js'].forEach(f => vm.runInContext(js(f), ctx, f));
const M = ctx.window.RB.model;

const users = [{ id: 'ayush', name: 'Ayush', ownerKey: 'AYUSH' }];
const schools = [{ id: 'S1' }];
const opps = [
  { id: 'O1', schoolId: 'S1', ownerKey: null, initialPotential: 100 },   // imported, no owner
  { id: 'O2', schoolId: 'S1', ownerKey: 'SID', initialPotential: 100 },  // imported, owned
  { id: 'O3', schoolId: 'S1', ownerKey: 'SID', initialPotential: 100 },  // app: rep chose the stage
  { id: 'O4', schoolId: 'S1', ownerKey: 'SID', initialPotential: 100 }   // no connect yet
];
const connects = [
  { id: 'C1', opportunityId: 'O1', by: 'ayush', response: 'Other', mode: 'Introductory Call', at: '2026-09-01T10:00:00Z' },
  { id: 'C2', opportunityId: 'O2', by: 'vikas', response: 'Meeting Fixed', at: '2026-09-01T10:00:00Z' },
  { id: 'C3', opportunityId: 'O2', by: 'vikas', response: 'Rejected', at: '2026-09-02T10:00:00Z' },
  { id: 'C4', opportunityId: 'O3', by: 'ayush', response: 'Interested', stage: 'Proposal', at: '2026-10-01T10:00:00Z' },
  { id: 'C5', opportunityId: 'O3', by: 'ayush', response: 'Other', stage: 'New School', at: '2026-10-02T10:00:00Z' }
];
const byId = (rows, id) => rows.find(r => r.id === id) || null;
ctx.window.RB.store = {
  opportunities: () => opps, connects: () => connects, users: () => users, schools: () => schools,
  schoolById: id => byId(schools, id), userById: id => byId(users, id), opportunityById: id => byId(opps, id),
  contactsFor: () => []
};
const v = id => M.view(byId(opps, id));

assert.strictEqual(v('O1').stage, 'Connected', 'a call logged means the school is connected');
assert.strictEqual(v('O1').owner, 'AYUSH', 'no owner -> whoever logged the first connect');
assert.strictEqual(v('O2').stage, 'Meeting', 'a reply that would close the deal is not inferred');
assert.strictEqual(v('O2').status, 'Open');
assert.strictEqual(v('O2').owner, 'SID', 'an owner on the deal always wins');
assert.strictEqual(v('O3').stage, 'New School', 'a stage the rep picked always wins');
assert.strictEqual(v('O4').stage, 'New School');
assert.strictEqual(M.ownerOf(connects[0]), 'AYUSH', 'team-day planning follows the same owner');

/* Robobox Caller leads: routed by region on first name, and a lead's state
 * is its latest call. */
users.push({ id: 'sid', name: 'Sid', ownerKey: 'SID' }, { id: 'gaurav', name: 'Gaurav Mishra', ownerKey: 'GAURAV' },
  { id: 'robobox', name: 'Robobox Caller', role: 'caller', ownerKey: 'ROBOBOX' });
schools.push({ id: 'S2', name: 'New One', region: 'Central' }, { id: 'S3', name: 'New Two', region: 'Pune' });
const leads = [{ id: 'L1', schoolId: 'S2', status: 'Lead' }, { id: 'L2', schoolId: 'S3', status: 'Lead' }];
ctx.window.RB.store.leads = () => leads;
ctx.window.RB.store.leadById = id => byId(leads, id);
ctx.window.RB.store.contactById = () => null;
connects.push(
  { id: 'C6', opportunityId: 'L1', schoolId: 'S2', by: 'robobox', response: 'Meeting Fixed', nextAction: 'Meeting', nextActionAt: '2026-11-19T11:30:00', at: '2026-11-18T10:00:00' },
  { id: 'C7', opportunityId: 'L2', schoolId: 'S3', by: 'robobox', response: 'To confirm in a few days', nextAction: 'Call back', nextActionAt: '2026-11-20T11:00:00', at: '2026-11-18T10:05:00' });
M.invalidate();
const owners = r => M.leadOwners(r).map(u => u.id).sort().join(',');
assert.strictEqual(owners('Central'), 'ayush,sid', 'Central goes to both Sid and Ayush');
assert.strictEqual(owners('Pune'), 'gaurav', 'a name with no login (Pramod) is skipped');
const L = M.leads();
assert.strictEqual(L.find(l => l.lead.id === 'L1').state, 'With sales');
assert.strictEqual(L.find(l => l.lead.id === 'L2').state, 'Callback', 'to confirm stays with the caller');
const leadIds = id => M.tasks(id).filter(t => t.leadId).map(t => t.leadId).join(',');
assert.strictEqual(leadIds('sid'), 'L1'); assert.strictEqual(leadIds('ayush'), 'L1');
assert.strictEqual(leadIds('gaurav'), '', 'a callback is not sent to sales');
assert.strictEqual(leadIds('robobox'), 'L2', 'the callback is on the caller\'s list');
assert.ok(M.views().every(v => v.opp.status !== 'Lead'), 'a lead is never a deal');
console.log('imported: all checks passed');
