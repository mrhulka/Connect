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
check.strictEqual(cat.length, 7, 'the sheet\'s six products, plus Bagless which stays');
check.ok(cat.some(c => c.key === 'Bagless'), 'Bagless is still there, unchanged');
for (const [name, [price, base, perStudent]] of Object.entries(SHEET)) {
  const row = cat.filter(c => c.key === name)[0];
  check.ok(row, 'catalogue has "' + name + '"');
  check.ok(Math.abs(row.sp - price) < 0.01, name + ' sells at no less than ' + price);
  check.strictEqual(row.base ?? null, base, name + ' priced per ' + (base || 'sale, not per student'));
  if (perStudent !== null) {
    check.ok(Math.abs(row.sp / row.base - perStudent) < 0.0001,
      name + ' works out at ' + perStudent.toFixed(2) + ' a student');
  } else {
    check.ok(row.oneTime, name + ' is a one-time sale, so no student count comes into it');
  }
}

/* ---- MRP is the pitch, SP is the floor ---------------------------------- */
const otl = cat.filter(c => c.key === 'Composite Skill Lab (One Time Sale)')[0];
check.strictEqual(otl.mrp, 1403610, 'the one-time lab pitches at MRP 14,03,610');
check.strictEqual(otl.sp, 982527, 'and may not go below 9,82,527');
check.ok(otl.mrp > otl.sp, 'MRP sits above the floor');
const q = M.priceFor('Composite Skill Lab (One Time Sale)', null, 900);
check.strictEqual(q.mrp, 1403610, 'a quote carries the MRP');
check.strictEqual(q.sp, 982527, 'and the floor');
check.strictEqual(M.floorFor('Composite Skill Lab (One Time Sale)', null, 900), 982527,
  'the floor is what the form checks against');
// a per-700 product pro-rates both numbers the same way
const halfQ = M.priceFor('Innovation Stem Lab + Curriculum', null, 350);
check.ok(Math.abs(halfQ.sp - 1511738.1196 / 2) < 0.01, 'half a school, half the floor');
check.ok(Math.abs(halfQ.mrp - halfQ.sp) < 0.01, 'where the sheet gives one number, MRP and floor agree');

/* ---- Robobox Kits price by standard band -------------------------------- */
const bands = M.KIT_BANDS;
check.strictEqual(bands.length, 4, 'four standard bands');
check.strictEqual(bands[0].label, 'Sr KG, 1st, 2nd', 'Sr KG to 2nd share one kit and one price');
check.strictEqual(bands[0].mrp, 1999, 'Sr KG-2nd pitches at 1999 a head');
check.strictEqual(bands[0].sp, 1199.4, 'and floors at 1199.40');
// the sheet's own split is the fallback, and it is what makes the plan add up
// both totals are the bands added up, not numbers typed in beside them
const kitRow = cat.filter(c => c.key === 'Robobox Kits')[0];
const sumMrp = bands.reduce((n, b) => n + b.mrp * b.students, 0);
const sumSp  = bands.reduce((n, b) => n + b.sp  * b.students, 0);
check.strictEqual(kitRow.mrp, sumMrp, 'kit MRP is the bands added up: ' + sumMrp);
check.strictEqual(kitRow.sp, sumSp, 'kit floor is the bands added up: ' + sumSp);
check.strictEqual(sumSp, 419864, 'which is the 4,19,864 the plan values a kit sale at');
check.ok(sumMrp > sumSp, 'and MRP sits above the floor');

const whole = M.priceFor('Robobox Kits', null, null);
check.strictEqual(whole.sp, 419864, 'the sheet\'s split comes to 4,19,864 at the floor');
check.strictEqual(whole.students, 240, 'across 240 students');
// a school buying for only the youngest years pays for only those
const juniorOnly = M.priceFor('Robobox Kits', null, null, { bands: { 'srkg-2': 100 } });
check.strictEqual(juniorOnly.sp, 1199.4 * 100, '100 juniors only = 100 junior kits');
check.strictEqual(juniorOnly.mrp, 1999 * 100, 'at MRP too');
check.strictEqual(juniorOnly.students, 100, 'and 100 students, not 240');
const mixed = M.priceFor('Robobox Kits', null, null, { bands: { 'srkg-2': 50, '9-10': 20 } });
check.strictEqual(mixed.sp, 1199.4 * 50 + 2499.5 * 20, 'two bands add up');
check.strictEqual(mixed.bands.length, 2, 'and only the bands bought are listed');
check.strictEqual(M.priceFor('Robobox Kits', null, null, { bands: {} }).sp, 0,
  'no standards chosen yet is zero, not the illustrative split');

/* ---- the renamed products ------------------------------------------------ */
check.strictEqual(M.offeringOf('STEM Lab'), 'Innovation Stem Lab + Curriculum',
  'STEM Lab deals read as Innovation Stem Lab + Curriculum — the sheet\'s first product');
check.strictEqual(M.offeringOf('Advanced Lab'), 'Advance Composite Skill Lab + Curriculum',
  'Advanced Lab deals read as Advance Composite Skill Lab + Curriculum');
check.strictEqual(M.offeringOf('Kit Class'), 'RBX Kits + Curriculum',
  'Kit Class deals read as RBX Kits + Curriculum');
check.strictEqual(M.offeringOf('Bagless'), 'Bagless', 'Bagless is left alone');
check.strictEqual(M.offeringOf('Innovation Stem Lab + Curriculum'), 'Innovation Stem Lab + Curriculum',
  'a name already current is not touched');
check.strictEqual(M.offeringOf(null), null, 'and nothing is still nothing');
Object.values(M.OFFERING_ALIAS).forEach(to => check.ok(
  cat.some(c => c.key === to), 'every rename points at a product that exists: ' + to));

/* ---- the sales year ------------------------------------------------------ */
const years = M.V.salesYear;
check.strictEqual(years.length, 3, 'three years offered');
check.ok(/^\d{2}-\d{2}$/.test(years[0]), 'written as 26-27, got ' + years[0]);
check.strictEqual(M.currentSalesYear(), years[0], 'the current year is the default');
years.forEach((y, i) => { if (i) check.strictEqual(
  Number(y.slice(0, 2)), Number(years[i - 1].slice(0, 2)) + 1, y + ' follows ' + years[i - 1]); });

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

// The plan covers the sheet's six products. Bagless is sold but carries no
// target, so it is checked separately rather than lined up against a column
// that does not exist.
const order = Object.keys(SHEET);
for (const [who, [counts, total, rupees]] of Object.entries(PLAN)) {
  const t = M.productTargets(who, vs => vs);
  order.forEach((key, i) => {
    const row = t.rows.filter(r => r.key === key)[0];
    check.strictEqual(row.targetCount, counts[i], who + ' · ' + key + ' = ' + counts[i]);
  });
  check.strictEqual(t.rows.filter(r => r.key === 'Bagless')[0].targetCount, 0,
    who + ' has no Bagless target — it is not in the plan');
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

/* the picker offers what the price list holds, so a new deal is created
 * under the new name rather than an old one that then needs aliasing ---- */
check.deepStrictEqual(M.V.coreOfferings, M.CATALOGUE.map(c => c.key),
  'the picker lists exactly the catalogue products');
check.deepStrictEqual(M.V.offering, M.CATALOGUE.map(c => c.key).concat('Workshop'),
  'plus Workshop, which is sold but carries no sheet price');
['Advanced Lab Pro', 'Advanced Lab', 'STEM Lab', 'Kit Class'].forEach(old => {
  check.strictEqual(M.V.offering.indexOf(old), -1, old + ' is off the picker');
});
check.ok(M.OFFERING_RETIRED['Advanced Lab Pro'], 'Advanced Lab Pro is retired');
check.strictEqual(M.CATALOGUE.filter(c => c.key === 'Advanced Lab Pro').length, 0,
  'and is not in the price list');
Object.keys(M.OFFERING_RETIRED).forEach(gone => {
  check.strictEqual(M.OFFERING_ALIAS[gone], undefined,
    gone + ' is dropped, not renamed into something else');
});
Object.keys(M.OFFERING_ALIAS).forEach(from => {
  check.ok(M.V.offering.indexOf(M.OFFERING_ALIAS[from]) > -1,
    from + ' renames to something the picker offers');
});
check.strictEqual(M.V.offeringLabel['Bagless'], 'Bagless Skills',
  'Bagless still reads as Bagless Skills');
M.CATALOGUE.forEach(c => {
  check.ok(M.V.offeringDetail[c.key], c.key + ' has a line of help under it');
});

console.log('targets: all ' + checks + ' assertions passed');
