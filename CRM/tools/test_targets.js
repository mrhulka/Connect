/* Does the app's plan match the costing and targets sheet?
 *
 *   node tools/test_targets.js
 *
 * Every rupee figure in the sheet is a count times a unit price. This checks
 * both halves against the numbers as supplied, so a typo in either table is
 * caught here rather than on the CEO's dashboard.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0;
const raw = require('assert');
const check = new Proxy(raw, {
  get(t, k) { const v = t[k];
    return typeof v === 'function' ? (...a) => { checks++; return v.apply(t, a); } : v; }
});

const js = f => fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', f), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem() {} } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
['util.js', 'model.js'].forEach(f => vm.runInContext(js(f), ctx, f));
const M = ctx.window.RB.model;
// model.js reads the store for legacy price rows; a bare one is enough here.
ctx.window.RB.store = { opportunities: () => [], users: () => [], connects: () => [], schools: () => [] };

/* ---- the costing sheet ------------------------------------------------- */
// product -> [total package price, students it is priced for, cost per student]
const SHEET = {
  'Innovation Stem Lab + Curriculum':          [1511738.1196, 700, 2159.625885142857],
  'Advance Composite Skill Lab + Curriculum':  [2002527,      700, 2860.752857142857],
  'RBX Kits + Curriculum':                     [2294610,      700, 3278.0142857142855],
  'Composite Skill Labs + Kits Curriculum':    [2977137,      700, 4253.052857142857],
  'Composite Skill Lab (One Time Sale)':       [982527,      null, null],
  'Robobox Kits':                              [419864,      null, null]
};

const cat = M.CATALOGUE;
check.strictEqual(cat.length, 6, 'six products, as the sheet lists');
for (const [name, [price, base, perStudent]] of Object.entries(SHEET)) {
  const row = cat.filter(c => c.key === name)[0];
  check.ok(row, 'catalogue has "' + name + '"');
  check.ok(Math.abs(row.price - price) < 0.01, name + ' priced at ' + price);
  check.strictEqual(row.base ?? null, base, name + ' priced per ' + (base || 'sale, not per student'));
  if (perStudent !== null) {
    check.ok(Math.abs(row.price / row.base - perStudent) < 0.0001,
      name + ' works out at ' + perStudent.toFixed(2) + ' a student');
  } else {
    check.ok(row.oneTime, name + ' is a one-time sale, so no student count comes into it');
  }
}

/* a one-time sale does not pro-rate; a per-700 product does ------------- */
const flat = M.priceFor('Robobox Kits', null, 120);
check.strictEqual(flat.value, 419864, 'Robobox Kits is flat whatever the roll');
check.strictEqual(flat.base, null, 'and says so');
const half = M.priceFor('Innovation Stem Lab + Curriculum', null, 350);
check.ok(Math.abs(half.value - 1511738.1196 / 2) < 0.01,
  'a 350-student school pays half of the 700-student price');
const full = M.priceFor('Advance Composite Skill Lab + Curriculum', null, 700);
check.strictEqual(full.value, 2002527, 'and 700 students pays the sheet price exactly');
check.strictEqual(M.priceFor('Composite Skill Lab (One Time Sale)', null, 900).value, 982527,
  'the one-time lab is the selling price, not the MRP');

/* ---- the targets sheet -------------------------------------------------- */
// person -> [per-product counts in catalogue order, total count, total rupees]
const PLAN = {
  'PARTH':    [[6, 4, 2, 2, 2, 0], 16, 29589084.7176],
  'AYUSH':    [[5, 3, 2, 2, 3, 0], 15, 27057346.598],
  'SACHIN C': [[4, 1, 0, 0, 1, 2],  8,  9871734.4784],
  'SID':      [[3, 0, 0, 0, 0, 3],  6,  5794806.3588],
  'BHAVIK':   [[3, 0, 1, 0, 1, 1],  6,  8232215.3588],
  'SURAJ K':  [[3, 1, 0, 0, 1, 2],  7,  8359996.3588],
  'GAURAV':   [[6, 1, 0, 1, 2, 2], 12, 16854874.7176]
};
// totals per product down the sheet's TOTAL column
const COLUMN_TOTALS = [30, 10, 5, 5, 10, 10];

check.deepStrictEqual(M.targetOwners().sort().join('|'), Object.keys(PLAN).sort().join('|'),
  'the plan names exactly the seven people in the sheet');

const order = cat.map(c => c.key);
for (const [who, [counts, total, rupees]] of Object.entries(PLAN)) {
  const t = M.productTargets(who, vs => vs);
  order.forEach((key, i) => {
    const row = t.rows.filter(r => r.key === key)[0];
    check.strictEqual(row.targetCount, counts[i], who + ' · ' + key + ' = ' + counts[i]);
  });
  check.strictEqual(t.targetCount, total, who + ' is on ' + total + ' deals for the year');
  check.ok(Math.abs(t.targetValue - rupees) < 1,
    who + ' is on ' + Math.round(rupees).toLocaleString('en-IN') + ' — got ' +
    Math.round(t.targetValue).toLocaleString('en-IN'));
}

order.forEach((key, i) => {
  const across = Object.keys(PLAN)
    .reduce((n, who) => n + M.productTargets(who, vs => vs).rows.filter(r => r.key === key)[0].targetCount, 0);
  check.strictEqual(across, COLUMN_TOTALS[i],
    key + ' totals ' + COLUMN_TOTALS[i] + ' across the team');
});

/* nothing sold yet, so achievement is zero and not a divide-by-zero ------ */
const parth = M.productTargets('PARTH', vs => vs);
check.strictEqual(parth.wonValue, 0, 'nothing won in this fixture');
check.strictEqual(parth.pct, 0, 'so achievement reads 0%, not NaN');
const nobody = M.productTargets('NOT-A-PERSON', vs => vs);
check.strictEqual(nobody.inPlan, false, 'somebody outside the plan is flagged as such');
check.strictEqual(nobody.pct, null, 'and has no percentage rather than a false 0%');

console.log('targets: all ' + checks + ' assertions passed');
