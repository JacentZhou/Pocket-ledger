// Pure finance regression tests. No React Native packages are required.
// Run: node test-calculations.cjs
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync(__dirname + '/App.js', 'utf8');
const start = app.indexOf('const STORAGE_KEY');
const end = app.indexOf('const C = ');
assert(start >= 0 && end > start);
const context = vm.createContext({ Intl, Date, Math, Number, String, Object, Array });
vm.runInContext(app.slice(start, end) + '\nglobalThis.testable = { parseAmount, iso, parseDate, monthOffset, weekStart, accountBalance, netWorth, periodTotals, categoryTotals, dueDate, filteredTransactions, previousRange, spendingSeries, normalizeData, applyRecordedPayment, parseTime, recentSort, groupActivity, makeBackup, readBackup };', context);
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
  { type:'expense', accountId:'a', amountCents: 5000, date:'2026-11-03', category:'Dining',description:'Coffee' },
  { type:'income', accountId:'a', amountCents: 12000, date:'2026-11-02', category:'Salary',description:'Pay' },
  { type:'transfer', accountId:'a', toAccountId:'b', amountCents: 3000, date:'2026-11-04', category:'Transfer',description:'Transfer to savings' },
];
assert.equal(f.accountBalance({id:'a',kind:'Bank',openingCents:10000},tx), 14000);
assert.equal(f.accountBalance({id:'b',kind:'Savings',openingCents:5000},tx), 8000);
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
// CREDIT CARDS: debt is positive, spending increases debt, repayment decreases it.
const checking = { id:'bank', name:'Everyday', kind:'Bank', openingCents:100000 };
const card = { id:'visa', name:'Visa', kind:'Credit Card', openingCents:20000, creditLimitCents:300000 };
const cardPurchase = { id:'p',type:'expense', date:'2026-10-15', amountCents:5000, category:'Groceries',description:'Supermarket', accountId:'visa',toAccountId:null };
const cardPayment = { id:'r',type:'transfer',date:'2026-10-17',amountCents:10000,category:'Transfer',description:'Visa repayment',accountId:'bank',toAccountId:'visa' };
assert.equal(f.accountBalance(card,[cardPurchase]),25000);
assert.equal(f.netWorth([checking,card],[cardPurchase]),75000);
assert.equal(f.accountBalance(checking,[cardPurchase,cardPayment]),90000);
assert.equal(f.accountBalance(card,[cardPurchase,cardPayment]),15000);
assert.equal(f.netWorth([checking,card],[cardPurchase,cardPayment]),75000);
assert.equal(f.periodTotals([cardPurchase,cardPayment],'2026-10-01','2026-10-31').expenses,5000);
// Repayment schedule should generate a TRANSFER, not spending.
const repaySchedule = { id:'s1',kind:'card_payment',name:'Visa monthly payment',repeat:'Monthly',date:'2026-11-10',due:'2026-11-10',amountCents:10000,accountId:'bank',toAccountId:'visa' };
const recorded = f.applyRecordedPayment({transactions:[cardPurchase],schedules:[repaySchedule]},repaySchedule,'2026-11-10');
assert.equal(recorded.transactions.length,2);
assert.equal(recorded.transactions[1].type,'transfer');
assert.equal(recorded.transactions[1].toAccountId,'visa');
assert.equal(recorded.schedules[0].lastPaidThrough,'2026-11-10');
assert.equal(f.periodTotals(recorded.transactions,'2026-11-01','2026-11-30').expenses,0);
// Filters: text, account, category, date, amount and type.
const all = [cardPurchase,cardPayment,{id:'i',type:'income',accountId:'bank',date:'2026-10-10',amountCents:80000,category:'Salary',description:'Work pay'}];
const bankAndCard = [checking,card];
function search(filters){return f.filteredTransactions(all,{type:'all',accountId:'all',category:'all',...filters},bankAndCard);}
assert.equal(search({query:'supermarket'}).length,1);
assert.equal(search({query:'Visa'}).length,2);
assert.equal(search({query:'50.00'}).length,1);
assert.equal(search({minAmount:'50',maxAmount:'100'}).length,2);
assert.equal(search({minAmount:'500'}).length,1);
assert.equal(search({start:'2026-10-16'}).length,1);
assert.equal(search({end:'2026-10-14'}).length,1);
assert.equal(search({type:'transfer'}).length,1);
assert.equal(search({category:'Groceries'}).length,1);
assert.equal(search({accountId:'visa'}).length,2);
assert.equal(f.previousRange('2026-11-01','2026-11-04').join(','),'2026-10-28,2026-10-31');
assert.equal(f.spendingSeries(all,'2026-10-01','2026-10-31').reduce((n,b)=>n+b.value,0),5000);
assert.equal(f.spendingSeries(all,'2026-01-01','2026-12-31').reduce((n,b)=>n+b.value,0),5000);
// Old stored data (without categories) upgrades without losing history.
const legacy = f.normalizeData({mode:'personal',accounts:[checking],transactions:[{...cardPurchase,category:'Pets'}],schedules:[]});
assert.equal(legacy.transactions[0].category,'Pets');
assert(legacy.categories.some(x=>x.name==='Pets'));
assert(legacy.categories.some(x=>x.name==='Other'));
// v0.3: HH:mm 24h capture, migration and newest-first chronological ordering.
assert.equal(f.parseTime('00:00'), '00:00');
assert.equal(f.parseTime('23:59'), '23:59');
for (const bad of ['24:00','8:00','10:60','12:30:15','']) assert.equal(f.parseTime(bad), null);
assert.equal(f.normalizeData({accounts:[checking],transactions:[{...cardPurchase}],schedules:[]}).transactions[0].time, null);
const byTime = [
  {id:'old', type:'expense', date:'2026-11-04', time:null, amountCents:100, accountId:'bank',category:'Dining',description:'Unknown time'},
  {id:'early',type:'expense', date:'2026-11-04',time:'07:00',amountCents:200,accountId:'bank',category:'Dining',description:'Morning'},
  {id:'late',type:'income',date:'2026-11-04',time:'20:15',amountCents:500,accountId:'bank',category:'Salary',description:'Evening'},
  {id:'yesterday',type:'income',date:'2026-11-03',time:'22:00',amountCents:700,accountId:'bank',category:'Salary',description:'Prior day'},
  {id:'transfer',type:'transfer',date:'2026-11-04',time:'14:00',amountCents:450,accountId:'bank',toAccountId:'visa',category:'Transfer',description:'Payment'},
];
assert.equal(f.recentSort(byTime).map(x=>x.id).join(','),'late,transfer,early,old,yesterday');
const daily = f.groupActivity(byTime);
assert.equal(daily.length,2);
assert.equal(daily[0].date,'2026-11-04');
assert.equal(daily[0].income,500);
assert.equal(daily[0].expenses,300);
assert.equal(daily[1].income,700);
assert.equal(daily[1].expenses,0);
assert.equal(f.filteredTransactions(byTime,{query:'20:15',type:'all',accountId:'all',category:'all'},[checking,card]).length,1);
// The totals displayed for a filtered date are totals of the visible entries.
const expensesOnly = f.filteredTransactions(byTime,{query:'',type:'expense',accountId:'all',category:'all'},[checking,card]);
assert.equal(f.groupActivity(expensesOnly)[0].income,0);
assert.equal(f.groupActivity(expensesOnly)[0].expenses,300);
// Backup roundtrip, older null time, schema/ID/account validation.
const complete = {mode:'personal',accounts:[checking,card], transactions:byTime, schedules:[],categories:[{name:'Dining',color:'#123456'},{name:'Other',color:'#8692A6'}]};
const backup = f.makeBackup(complete, '2026-11-04T00:00:00.000Z');
assert.equal(backup.format,'pocket-ledger-backup');
assert.equal(backup.version,1);
const restored = f.readBackup(JSON.stringify(backup));
assert.equal(restored.transactions.length,5);
assert.equal(restored.transactions.find(x=>x.id==='late').time,'20:15');
assert.equal(restored.transactions.find(x=>x.id==='old').time,null);
assert.equal(restored.categories.find(x=>x.name==='Dining').color,'#123456');
assert.throws(()=>f.readBackup('{bad-json'),/valid JSON/);
assert.throws(()=>f.readBackup(JSON.stringify({...backup,version:999})),/format or version/);
assert.throws(()=>f.readBackup(JSON.stringify({...backup,payload:{...complete,transactions:[byTime[0],byTime[0]]}})),/duplicate/);
assert.throws(()=>f.readBackup(JSON.stringify({...backup,payload:{...complete,transactions:[{...byTime[0],accountId:'missing'}]}})),/invalid transaction/);
assert.throws(()=>f.readBackup(JSON.stringify({...backup,payload:{...complete,transactions:[{...byTime[0],time:'25:00'}]}})),/invalid transaction/);
console.log('All Pocket Ledger v0.3 finance, grouping, time and backup-format tests passed.');
