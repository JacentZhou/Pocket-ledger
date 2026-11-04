// Pocket Ledger v0.7 — pure cash-flow projection (no bank connections).
// Dates are local ISO calendar dates (YYYY-MM-DD); all money is integer AUD cents.
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}
function asDate(value) { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d,12); }
function dateISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function plusDays(date, n) { const d=asDate(date); d.setDate(d.getDate()+n); return dateISO(d); }
function addMonths(date, n) { const d=asDate(date); const last=new Date(d.getFullYear(),d.getMonth()+n+1,0).getDate(); return dateISO(new Date(d.getFullYear(),d.getMonth()+n,Math.min(d.getDate(),last),12)); }
function diffDays(a,b) { return Math.round((asDate(b)-asDate(a))/86400000); }
function occurrenceDate(plan, index) {
  if (plan.repeat === 'None') return index===0 ? plan.startDate : null;
  if (plan.repeat === 'Weekly') return plusDays(plan.startDate,7*index);
  if (plan.repeat === 'Fortnightly') return plusDays(plan.startDate,14*index);
  if (plan.repeat === 'Monthly') return addMonths(plan.startDate,index);
  if (plan.repeat === 'Yearly') return addMonths(plan.startDate,12*index);
  return null;
}
function planType(plan) { return plan.kind==='income'?'income':plan.kind==='card_payment'?'transfer':'expense'; }
function linkedKey(planId, date) { return `${planId}::${date}`; }
function pendingPlanEvents(data, start, end, options={}) {
  if (!validDate(start)||!validDate(end)||end<start) return [];
  const {includeOverdue=false, asOf=start} = options;
  const confirmed = new Set((data.transactions||[]).filter(t=>t.scheduleId&&t.scheduledFor).map(t=>linkedKey(t.scheduleId,t.scheduledFor)));
  const events=[];
  const from=includeOverdue? asOf : start;
  for(const plan of data.schedules||[]) {
    if(plan.completed||!validDate(plan.startDate)||!Number.isSafeInteger(plan.amountCents)||plan.amountCents<=0) continue;
    // All outstanding occurrences, including overdue. Limit iterations to 2500 per plan.
    for(let i=0;i<2500;i++) {
      const due=occurrenceDate(plan,i);
      if(!due||due>end) break;
      if(plan.lastPaidThrough&&due<=plan.lastPaidThrough) continue;
      if(confirmed.has(linkedKey(plan.id,due))) continue;
      if(due<start && !includeOverdue) continue;
      const when = includeOverdue && due<asOf ? asOf : due;
      if(when<start||when>end) continue;
      events.push({id:`planned:${linkedKey(plan.id,due)}`,source:'planned',scheduleId:plan.id,scheduledFor:due,
        date:when, due, overdue:due<asOf, description:plan.name, category:plan.category,
        accountId:plan.accountId,toAccountId:plan.kind==='card_payment'?plan.toAccountId:null,
        type:planType(plan),amountCents:plan.amountCents});
    }
  }
  return events;
}
function futureActualEvents(data, start, end) {
  return (data.transactions||[]).filter(t=>t.date>=start&&t.date<=end)
    .map(t=>({...t,id:`actual:${t.id}`,source:'actual',due:t.date,scheduledFor:t.scheduledFor||null}));
}
function accountSign(account) { return account.kind==='Credit Card'?-1:1; }
function adjustBalance(balance, account, event) {
  const s=accountSign(account);
  if(event.type==='income'&&event.accountId===account.id) return balance+s*event.amountCents;
  if(event.type==='expense'&&event.accountId===account.id) return balance-s*event.amountCents;
  if(event.type==='transfer') {
    if(event.accountId===account.id) balance-=s*event.amountCents;
    if(event.toAccountId===account.id) balance+=s*event.amountCents;
  }
  return balance;
}
function actualBalances(accounts, transactions, throughDate) {
  const balances={};
  for(const a of accounts||[]) balances[a.id]=a.openingCents||0;
  for(const t of transactions||[]) {
    if(t.date>throughDate)continue;
    for(const account of accounts||[]) {
      if(account.id!==t.accountId && account.id!==t.toAccountId)continue;
      balances[account.id]=adjustBalance(balances[account.id],account,t);
    }
  }
  return balances;
}
function limitForAccount(a) { return a.kind==='Credit Card' ? (a.creditLimitCents||0) : null; }
function availableAmount(account,balance) {
  return account.kind==='Credit Card' && account.creditLimitCents>0
    ? account.creditLimitCents-balance : balance;
}
function bufferForAccount(account) { return Math.max(0,account.minBufferCents||0); }
function projectCashFlow(data,{asOf,days=30}={}) {
  if(!validDate(asOf))throw Error('Valid forecast date required');
  const daysCount=[7,14,30,60,90].includes(days)?days:30;
  const until=plusDays(asOf,daysCount-1);
  const accounts=data.accounts||[], transactions=data.transactions||[];
  const balances=actualBalances(accounts,transactions,asOf);
  const events=[
    ...pendingPlanEvents(data,asOf,until,{includeOverdue:true,asOf}),
    ...futureActualEvents(data,plusDays(asOf,1),until),
  ];
  // Conservative ordering: expenses/repayments before income on the same day.
  const order={expense:0,transfer:1,income:2};
  events.sort((a,b)=>a.date.localeCompare(b.date)||(order[a.type]-order[b.type])||a.due.localeCompare(b.due)||String(a.id).localeCompare(String(b.id)));
  const watch={};
  for(const account of accounts){
    const initial=availableAmount(account,balances[account.id]);
    watch[account.id]={lowest:initial, lowestDate:asOf,firstShortfall:null,firstShortfallAmount:0,
      buffer:bufferForAccount(account), monitor:account.kind!=='Credit Card'||account.creditLimitCents>0};
  }
  function check(account,day){
    const w=watch[account.id], amount=availableAmount(account,balances[account.id]);
    if(amount<w.lowest){w.lowest=amount;w.lowestDate=day;}
    if(w.monitor&&amount<w.buffer&&!w.firstShortfall){w.firstShortfall=day;w.firstShortfallAmount=w.buffer-amount;}
  }
  for(const a of accounts)check(a,asOf);
  const daily=[];
  let k=0;
  for(let day=asOf;day<=until;day=plusDays(day,1)){
    const dayEvents=[];
    while(k<events.length&&events[k].date===day){
      const event=events[k++];
      for(const account of accounts){
        if(account.id!==event.accountId&&account.id!==event.toAccountId)continue;
        balances[account.id]=adjustBalance(balances[account.id],account,event);
        check(account,day);
      }
      event.balanceAfter={};
      for(const id of [event.accountId,event.toAccountId].filter(Boolean)) if(balances[id]!==undefined) event.balanceAfter[id]=balances[id];
      dayEvents.push(event);
    }
    daily.push({date:day,balances:{...balances},events:dayEvents});
  }
  const output={asOf,until,days:daysCount,daily,events,watch,startingBalances:actualBalances(accounts,transactions,asOf)};
  output.accounts={};
  for(const a of accounts){
    const w=watch[a.id];
    const start=availableAmount(a,output.startingBalances[a.id]);
    const end=availableAmount(a,balances[a.id]);
    output.accounts[a.id]={...w,start,end,
      safeToSpend:a.kind==='Credit Card'?null:Math.max(0,w.lowest-w.buffer),
      availableCredit:a.kind==='Credit Card'&&a.creditLimitCents>0?end:null};
  }
  return output;
}
function recordedForPlan(transactions,scheduleId,scheduledFor){
  return (transactions||[]).some(t=>t.scheduleId===scheduleId&&t.scheduledFor===scheduledFor);
}
function confirmScheduledPayment(data,{scheduleId,scheduledFor,recordedOn,time,id}){
  const schedule=(data.schedules||[]).find(s=>s.id===scheduleId);
  if(!schedule||!validDate(scheduledFor)||!validDate(recordedOn))return data;
  if(recordedForPlan(data.transactions,scheduleId,scheduledFor))return data;
  // Verify this date really belongs to the schedule to block synthetic/malformed postings.
  let validOccurrence=false;
  for(let i=0;i<2500;i++){
    const day=occurrenceDate(schedule,i);
    if(!day||day>scheduledFor)break;
    if(day===scheduledFor){validOccurrence=true;break;}
  }
  if(!validOccurrence || (schedule.lastPaidThrough&&scheduledFor<=schedule.lastPaidThrough))return data;
  const type=planType(schedule);
  const tx={id:id||`paid-${scheduleId}-${scheduledFor}`,type,date:recordedOn,time:time||null,
    amountCents:schedule.amountCents,category:type==='transfer'?'Transfer':schedule.category,
    description:schedule.name,accountId:schedule.accountId,
    toAccountId:type==='transfer'?schedule.toAccountId:null,
    scheduleId,scheduledFor};
  // Don't advance lastPaidThrough for out-of-order payments: it would erase earlier dues.
  // The per-occurrence recorded link is the authoritative duplicate check.
  const nextSchedule=schedule.repeat==='None'?{...schedule,completed:true}:schedule;
  return {...data,transactions:[...data.transactions,tx],
    schedules:data.schedules.map(s=>s.id===scheduleId?nextSchedule:s)};
}
function nextPendingDue(schedule,transactions) {
  if(schedule.completed||!validDate(schedule.startDate))return null;
  const linked=new Set((transactions||[]).filter(t=>t.scheduleId===schedule.id && t.scheduledFor).map(t=>t.scheduledFor));
  for(let i=0;i<2500;i++){
    const due=occurrenceDate(schedule,i);
    if(!due)break;
    if(schedule.lastPaidThrough&&due<=schedule.lastPaidThrough)continue;
    if(linked.has(due))continue;
    return due;
  }
  return null;
}
function calendarItems(data,monthStart){
  if(!validDate(monthStart)||!monthStart.endsWith('-01'))return [];
  const end=plusDays(addMonths(monthStart,1),-1);
  const planned=pendingPlanEvents(data,monthStart,end,{includeOverdue:false,asOf:monthStart});
  const recorded=(data.transactions||[]).filter(t=>t.scheduleId&&t.scheduledFor>=monthStart&&t.scheduledFor<=end)
    .map(t=>({...t,id:`confirmed:${t.id}`,source:'recorded',date:t.scheduledFor,due:t.scheduledFor,description:t.description,
      originalDate:t.date}));
  return [...planned,...recorded].sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
}
module.exports={validDate,plusDays,addMonths,occurrenceDate,pendingPlanEvents,actualBalances,projectCashFlow,confirmScheduledPayment,nextPendingDue,calendarItems,availableAmount,adjustBalance,bufferForAccount};