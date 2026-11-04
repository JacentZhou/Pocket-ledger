// Lightweight checks of the self-contained pure money and recurrence functions in App.js.
// Run with `node test-calculations.cjs` (does not require React Native dependencies).
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const app = fs.readFileSync(__dirname + '/App.js', 'utf8');
const start = app.indexOf('const STORAGE_KEY');
const end = app.indexOf('const C = ');
assert(start >= 0 && end > start);
const context = vm.createContext({ Intl, Date, Math, Number, String, Object, Array });
vm.runInContext(app.slice(start, end) + '\nglobalThis.testable = { parseAmount, iso, parseDate, monthOffset, weekStart, accountBalance, periodTotals, categoryTotals, dueDate };', context);
const f = context.testable;
assert.equal(f.parseAmount('0.01'), 1);
assert.equal(f.parseAmount('100.10'), 10010);
assert.equal(f.parseAmount('$1,234.56'), 123456);
assert.equal(f.parseAmount('1.234'), null);
assert.equal(f.parseAmount('-10'), null);
assert.equal(f.parseDate('2026-02-30'), null);
assert.equal(f.weekStart('2026-11-04'), '2026-11-02');
assert.equal(f.monthOffset('2026-01-31', 1), '2026-02-28');
assert.equal(f.monthOffset('2026-01-31', 2), '2026-03-31');
const tx = [
  { type:'expense', accountId:'a', amountCents: 5000, date:'2026-11-03', category:'Dining'},
  { type:'income', accountId:'a', amountCents: 12000, date:'2026-11-02', category:'Salary'},
  { type:'transfer', accountId:'a', toAccountId:'b', amountCents: 3000, date:'2026-11-04', category:'Transfer'},
];
assert.equal(f.accountBalance({id:'a',openingCents:10000},tx), 14000);
assert.equal(f.accountBalance({id:'b',openingCents:5000},tx), 8000);
const totals = f.periodTotals(tx, '2026-11-01', '2026-11-30');
assert.equal(totals.expenses, 5000);
assert.equal(totals.income, 12000);
assert.equal(totals.net, 7000);
const due = { startDate:'2026-01-31', repeat:'Monthly', completed:false, lastPaidThrough: null };
assert.equal(f.dueDate(due, '2026-02-15'), '2026-01-31');
due.lastPaidThrough='2026-01-31';
assert.equal(f.dueDate(due, '2026-02-15'), '2026-02-28');
const advance = { startDate:'2026-11-20', repeat:'Monthly', completed:false, lastPaidThrough:'2026-11-20' };
assert.equal(f.dueDate(advance, '2026-11-04'), '2026-12-20');
console.log('Calculation checks passed.');
