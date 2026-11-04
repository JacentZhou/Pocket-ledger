const assert = require('node:assert/strict');
const f=require('./cashFlowCore');
const bank={id:'bank',kind:'Bank',name:'Everyday',openingCents:100000,minBufferCents:20000};
const savings={id:'savings',kind:'Savings',name:'Savings',openingCents:500000,minBufferCents:50000};
const credit={id:'card',kind:'Credit Card',name:'Card',openingCents:10000,creditLimitCents:100000,minBufferCents:10000};
const plan=(id,kind,date,amount,repeat='None',accountId='bank',toAccountId=null)=>({id,name:id,kind,category:kind==='income'?'Salary':'Bills',accountId,toAccountId,amountCents:amount,startDate:date,repeat,lastPaidThrough:null,completed:false});
const make=(extra={})=>({accounts:[bank,savings,credit],transactions:[],schedules:[],...extra});
const today='2026-11-04';
const schedules=[
 plan('rent','expense','2026-11-07',90000),
 plan('power','expense','2026-11-10',18000),
 plan('salary','income','2026-11-12',150000),
 plan('cardpay','card_payment','2026-11-09',5000,'None','bank','card'),
];
const data=make({schedules});
assert.equal(f.validDate('2026-02-30'),false);
assert.equal(f.addMonths('2026-01-31',1),'2026-02-28');
assert.equal(f.addMonths('2024-01-31',1),'2024-02-29');
assert.equal(f.plusDays('2026-11-30',1),'2026-12-01');
let result=f.projectCashFlow(data,{asOf:today,days:14});
assert.equal(result.events.length,4);
assert.equal(result.accounts.bank.start,100000);
assert.equal(result.accounts.bank.lowest,-13000);
assert.equal(result.accounts.bank.firstShortfall,'2026-11-07'); // buffer $200; $100 after rent
assert.equal(result.accounts.bank.firstShortfallAmount,10000);
assert.equal(result.accounts.bank.safeToSpend,0);
assert.equal(result.accounts.bank.end,137000);
assert.equal(result.accounts.card.start,90000); // credit available = limit - debt
assert.equal(result.accounts.card.end,95000); // card payment lowers debt
assert.equal(result.accounts.savings.start,500000);
assert.equal(result.accounts.savings.firstShortfall,null);
assert.deepEqual(result.daily.filter(d=>d.events.length).map(d=>d.date),['2026-11-07','2026-11-09','2026-11-10','2026-11-12']);
assert.equal(f.actualBalances(data.accounts, [{id:'future',type:'expense',accountId:'bank',date:'2026-11-19',amountCents:20000}],today).bank,100000,'future actual must not affect current balance');
const withFuture=make({schedules:[plan('rent','expense','2026-11-07',90000)],transactions:[{id:'future',type:'expense',accountId:'bank',date:'2026-11-11',amountCents:8000}]});
result=f.projectCashFlow(withFuture,{asOf:today,days:14});
assert.equal(result.accounts.bank.start,100000);
assert.equal(result.accounts.bank.end,2000);
assert.equal(result.events.length,2);
assert.equal(result.events.find(e=>e.source==='actual').date,'2026-11-11');
// Scheduled expense does not change current recorded bank balance.
assert.equal(f.actualBalances(data.accounts,data.transactions,today).bank,100000);
// Marking a planned bill as paid today removes that planned occurrence and creates an actual.
const paid=f.confirmScheduledPayment(data,{scheduleId:'rent',scheduledFor:'2026-11-07',recordedOn:today,time:'15:01',id:'r1'});
assert.equal(paid.transactions.length,1);
assert.equal(paid.transactions[0].date,today);
assert.equal(paid.transactions[0].scheduledFor,'2026-11-07');
assert.equal(f.actualBalances(paid.accounts,paid.transactions,today).bank,10000);
assert.equal(f.projectCashFlow(paid,{asOf:today,days:14}).events.filter(e=>e.scheduleId==='rent').length,0);
assert.strictEqual(f.confirmScheduledPayment(paid,{scheduleId:'rent',scheduledFor:'2026-11-07',recordedOn:today,id:'r2'}),paid,'record only once');
assert.strictEqual(f.confirmScheduledPayment(data,{scheduleId:'rent',scheduledFor:'2026-11-08',recordedOn:today,id:'bad'}),data,'cannot invent occurrence dates');
const repaid=f.confirmScheduledPayment(data,{scheduleId:'cardpay',scheduledFor:'2026-11-09',recordedOn:today,id:'cardpaid'});
assert.equal(repaid.transactions[0].type,'transfer');
assert.equal(f.actualBalances(repaid.accounts,repaid.transactions,today).bank,95000);
assert.equal(f.actualBalances(repaid.accounts,repaid.transactions,today).card,5000);
assert(!f.projectCashFlow(repaid,{asOf:today,days:14}).events.some(e=>e.scheduleId==='cardpay'));
const incomePaid=f.confirmScheduledPayment(data,{scheduleId:'salary',scheduledFor:'2026-11-12',recordedOn:'2026-11-12',id:'salarypaid'});
assert.equal(incomePaid.transactions[0].type,'income');
const weekly=plan('weekly','expense','2026-11-04',1000,'Weekly');
let rdata=make({schedules:[weekly]});
let events=f.pendingPlanEvents(rdata,'2026-11-04','2026-11-30',{asOf:today});
assert.deepEqual(events.map(e=>e.due),['2026-11-04','2026-11-11','2026-11-18','2026-11-25']);
rdata=f.confirmScheduledPayment(rdata,{scheduleId:'weekly',scheduledFor:'2026-11-18',recordedOn:'2026-11-10',id:'outoforder'});
assert.equal(rdata.schedules[0].lastPaidThrough,null,'out-of-order confirmation must not erase earlier due dates');
events=f.pendingPlanEvents(rdata,'2026-11-04','2026-11-30',{asOf:today});
assert.deepEqual(events.map(e=>e.due),['2026-11-04','2026-11-11','2026-11-25']);
const calendar=f.calendarItems(rdata,'2026-11-01');
assert.equal(calendar.find(e=>e.scheduledFor==='2026-11-18').source,'recorded');
assert.equal(calendar.find(e=>e.scheduledFor==='2026-11-18').date,'2026-11-18');
const overdue=make({schedules:[plan('late','expense','2026-11-01',10000)]});
result=f.projectCashFlow(overdue,{asOf:today,days:7});
assert.equal(result.events[0].overdue,true);
assert.equal(result.events[0].date,today);
assert.equal(result.events[0].due,'2026-11-01');
const linkedFuture=make({schedules:[plan('pay','income','2026-11-15',80000)],transactions:[{id:'early',type:'income',date:'2026-11-15',accountId:'bank',amountCents:80000,scheduleId:'pay',scheduledFor:'2026-11-15'}]});
result=f.projectCashFlow(linkedFuture,{asOf:today,days:30});
assert.equal(result.events.filter(e=>e.source==='planned' && e.scheduleId==='pay').length,0,'confirmed plan must not be projected twice');
assert.equal(result.events.filter(e=>e.source==='actual').length,1);
assert.equal(result.accounts.bank.start,100000);
assert.equal(result.accounts.bank.end,180000);
// A negative daily cash balance should be caught before a same-day salary deposit.
const sameDay=make({schedules:[plan('bill','expense','2026-11-08',120000),plan('salary','income','2026-11-08',200000)]});
result=f.projectCashFlow(sameDay,{asOf:today,days:7});
assert.equal(result.accounts.bank.firstShortfall,'2026-11-08');
assert.equal(result.accounts.bank.lowest,-20000);
assert.equal(result.accounts.bank.end,180000);
// Even if all accounts net positive, an individual bank account may fall short.
assert.equal(result.accounts.savings.firstShortfall,null);
console.log('Cash-flow forecast, recurring schedules, credit repayment, calendar, threshold, paid-link and duplicate tests passed.');
assert.equal(f.nextPendingDue(weekly,rdata.transactions),'2026-11-04');
const onceDone=f.confirmScheduledPayment(data,{scheduleId:'rent',scheduledFor:'2026-11-07',recordedOn:'2026-11-05',id:'test'});
assert.equal(f.nextPendingDue(onceDone.schedules.find(s=>s.id==='rent'),onceDone.transactions),null);
