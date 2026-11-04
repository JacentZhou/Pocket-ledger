import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Pocket Ledger — personal finance MVP, offline/manual only.
// Amounts are kept as integer cents to avoid floating-point currency errors.
const STORAGE_KEY = 'pocket-ledger-v1';
const NAV = [
  ['home', '⌂', 'Overview'], ['transactions', '↔', 'Activity'],
  ['schedule', '◷', 'Planned'], ['analytics', '▥', 'Insights'],
  ['accounts', '▤', 'Accounts'],
];
const EXPENSE_CATEGORIES = ['Groceries', 'Dining', 'Transport', 'Shopping', 'Housing', 'Bills', 'Health', 'Fun', 'Other'];
const INCOME_CATEGORIES = ['Salary', 'Refund', 'Gift', 'Interest', 'Other'];
const CATEGORY_COLORS = {
  Groceries: '#5A96E9', Dining: '#E18B5E', Transport: '#8B80D9', Shopping: '#DB6B9B',
  Housing: '#54AF9A', Bills: '#BC9B47', Health: '#54B4BC', Fun: '#9B76C9', Other: '#8692A6',
  Salary: '#42A883', Refund: '#72A8CC', Gift: '#AB8DD0', Interest: '#42A883',
};
const ACCOUNT_COLORS = ['#4D63E8', '#139C99', '#C07E52', '#8B66CB', '#314C73'];
const REPEATS = ['None', 'Weekly', 'Fortnightly', 'Monthly', 'Yearly'];
const money = (cents) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
function shiftDays(value, count) { const d = parseDate(value); if (!d) return value; d.setDate(d.getDate() + count); return iso(d); }
function monthOffset(value, offset) {
  const original = parseDate(value); if (!original) return value;
  const year = original.getFullYear(); const month = original.getMonth() + offset;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return iso(new Date(year, month, Math.min(original.getDate(), lastDay), 12));
}
function parseAmount(text) {
  const value = text.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fractional = ''] = value.split('.');
  const result = Number(whole) * 100 + Number((fractional + '00').slice(0, 2));
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}
function accountBalance(account, transactions) {
  let total = account.openingCents;
  for (const t of transactions) {
    if (t.type === 'income' && t.accountId === account.id) total += t.amountCents;
    if (t.type === 'expense' && t.accountId === account.id) total -= t.amountCents;
    if (t.type === 'transfer') {
      if (t.accountId === account.id) total -= t.amountCents;
      if (t.toAccountId === account.id) total += t.amountCents;
    }
  }
  return total;
}
function weekStart(value) {
  const d = parseDate(value); const weekday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - weekday);
  return iso(d);
}
function getPeriod(value, period) {
  if (period === 'week') { const start = weekStart(value); return [start, shiftDays(start, 6)]; }
  const start = `${value.slice(0, 7)}-01`;
  const d = parseDate(start); return [start, iso(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))];
}
function periodTotals(transactions, start, end) {
  let income = 0, expenses = 0;
  for (const t of transactions) {
    if (t.date < start || t.date > end) continue;
    if (t.type === 'income') income += t.amountCents;
    if (t.type === 'expense') expenses += t.amountCents;
    // Transfers between personal accounts are neither income nor expenses.
  }
  return { income, expenses, net: income - expenses };
}
function categoryTotals(transactions, start, end) {
  const result = {};
  for (const t of transactions) {
    if (t.type !== 'expense' || t.date < start || t.date > end) continue;
    result[t.category] = (result[t.category] || 0) + t.amountCents;
  }
  return Object.entries(result).sort((a, b) => b[1] - a[1]);
}
function dueDate(schedule, now) {
  if (schedule.completed) return null;
  if (schedule.repeat === 'None') return schedule.startDate;
  const anchor = schedule.startDate;
  if (anchor > now && (!schedule.lastPaidThrough || schedule.lastPaidThrough < anchor)) return anchor;
  let last = anchor, next = anchor;
  // Always calculate from the original anchor: monthly payments on the 31st
  // will not permanently drift to the 28th after February.
  for (let i = 0; i < 2500; i++) {
    next = schedule.repeat === 'Weekly' ? shiftDays(anchor, (i + 1) * 7)
      : schedule.repeat === 'Fortnightly' ? shiftDays(anchor, (i + 1) * 14)
      : schedule.repeat === 'Monthly' ? monthOffset(anchor, i + 1)
      : monthOffset(anchor, (i + 1) * 12);
    if (next > now) break;
    last = next;
  }
  return !schedule.lastPaidThrough || last > schedule.lastPaidThrough ? last : next;
}
const empty = () => ({ accounts: [], transactions: [], schedules: [], mode: 'personal' });
function demo() {
  const now = today();
  const checking = 'demo-everyday', savings = 'demo-savings';
  return {
    mode: 'demo',
    accounts: [
      { id: checking, name: 'Everyday', kind: 'Bank', openingCents: 460000, color: '#4D63E8' },
      { id: savings, name: 'Savings', kind: 'Savings', openingCents: 1450000, color: '#139C99' },
    ],
    transactions: [
      ['expense', 1, 1550, 'Dining', 'Coffee', checking],
      ['expense', 2, 8600, 'Groceries', 'Weekly groceries', checking],
      ['expense', 4, 3500, 'Transport', 'Opal top-up', checking],
      ['expense', 6, 42000, 'Housing', 'Rent', checking],
      ['income', 6, 195000, 'Salary', 'Pay', checking],
      ['expense', 9, 2890, 'Fun', 'Cinema', checking],
      ['expense', 12, 4800, 'Dining', 'Dinner', checking],
      ['expense', 16, 14000, 'Shopping', 'Clothing', checking],
      ['expense', 21, 36500, 'Housing', 'Rent', checking],
      ['income', 22, 188000, 'Salary', 'Pay', checking],
      ['expense', 32, 12000, 'Groceries', 'Groceries', checking],
      ['expense', 37, 19800, 'Bills', 'Utilities', checking],
      ['expense', 44, 35500, 'Housing', 'Rent', checking],
      ['income', 45, 191000, 'Salary', 'Pay', checking],
      ['expense', 60, 22400, 'Shopping', 'Shoes', checking],
      ['expense', 65, 9700, 'Groceries', 'Groceries', checking],
      ['expense', 80, 43000, 'Housing', 'Rent', checking],
      ['income', 80, 190000, 'Salary', 'Pay', checking],
    ].map(([type, ago, amountCents, category, description, accountId], index) => ({
      id: `demo-tx-${index}`, type, date: shiftDays(now, -ago), amountCents,
      category, description, accountId, toAccountId: null,
    })),
    schedules: [
      { id: 'demo-bill-1', name: 'Rent', amountCents: 42000, accountId: checking, category: 'Housing', startDate: shiftDays(now, 4), repeat: 'Weekly', lastPaidThrough: null, completed: false },
      { id: 'demo-bill-2', name: 'Phone plan', amountCents: 3900, accountId: checking, category: 'Bills', startDate: shiftDays(now, 9), repeat: 'Monthly', lastPaidThrough: null, completed: false },
    ],
  };
}
const C = { ink: '#18223D', mute: '#76829D', pale: '#F4F6FA', border: '#E7EBF2', white: '#FFFFFF', blue: '#4D63E8', green: '#169B7C', red: '#DA6273' };

function Button({ title, onPress, secondary = false, small = false, disabled = false }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.buttonSecondary, small && { paddingVertical: 9, paddingHorizontal: 12 }, disabled && { opacity: .45 }]}> 
    <Text style={[styles.buttonText, secondary && { color: C.blue }, small && { fontSize: 12 }]}>{title}</Text>
  </Pressable>;
}
function Pill({ title, active, onPress, color }) {
  return <Pressable onPress={onPress} style={[styles.pill, active && { backgroundColor: color || C.blue, borderColor: color || C.blue }]}>
    <Text style={[styles.pillText, active && { color: '#fff' }]}>{title}</Text>
  </Pressable>;
}
function SectionTitle({ children, side }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionText}>{children}</Text>{side}</View>;
}
function Metric({ label, value, color }) {
  return <View style={{ flex: 1, minWidth: 105 }}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, color && { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>;
}
function EmptyMessage({ title, detail }) {
  return <View style={styles.empty}><Text style={{ fontSize: 28, marginBottom: 7 }}>◌</Text><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.subtleCenter}>{detail}</Text></View>;
}
function TxRow({ t, accountName, onEdit, onRemove }) {
  const isExpense = t.type === 'expense'; const isIncome = t.type === 'income';
  const symbol = isExpense ? '−' : isIncome ? '+' : '↔';
  return <View style={styles.listRow}>
    <View style={[styles.txIcon, { backgroundColor: `${CATEGORY_COLORS[t.category] || C.blue}20` }]}><Text style={{ color: CATEGORY_COLORS[t.category] || C.blue, fontWeight: '800', fontSize: 19 }}>{symbol}</Text></View>
    <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.rowTitle} numberOfLines={1}>{t.description || (t.type === 'transfer' ? 'Transfer' : t.category)}</Text><Text style={styles.rowSubtitle}>{t.date} · {t.type === 'transfer' ? 'Transfer' : t.category} · {accountName}</Text></View>
    <View style={{ alignItems: 'flex-end', gap: 5 }}><Text style={[styles.rowAmount, { color: isExpense ? C.ink : isIncome ? C.green : C.mute }]}>{isExpense ? '−' : isIncome ? '+' : ''}{money(t.amountCents)}</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}><Text onPress={onEdit} style={styles.inlineAction}>Edit</Text><Text onPress={onRemove} style={[styles.inlineAction, { color: C.red }]}>Delete</Text></View>
    </View>
  </View>;
}
function Chart({ series, accent = C.blue }) {
  const high = Math.max(1, ...series.map(x => x.value));
  return <View style={styles.chart}><View style={styles.chartBars}>
    {series.map((item) => <View key={item.key} style={styles.barItem}>
      <View style={styles.barTrack}><View style={[styles.barFill, { height: `${item.value === 0 ? 0 : Math.max(2, item.value / high * 100)}%`, backgroundColor: item.highlight ? accent : '#C9D2F7' }]} /></View>
      <Text style={styles.barLabel}>{item.label}</Text>
    </View>)}
  </View></View>;
}
function LabeledInput({ label, value, onChangeText, hint, keyboardType, placeholder }) {
  return <View style={{ gap: 6 }}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType || 'default'} placeholder={placeholder || ''} placeholderTextColor="#A6AEC1" autoCapitalize="sentences" />{hint ? <Text style={styles.helper}>{hint}</Text> : null}</View>;
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('home');
  const [period, setPeriod] = useState('month');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [savedError, setSavedError] = useState('');
  useEffect(() => {
    (async () => {
      try { const stored = await AsyncStorage.getItem(STORAGE_KEY); if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.accounts) && Array.isArray(parsed.transactions) && Array.isArray(parsed.schedules)) setData(parsed);
      } } catch (e) { setSavedError('Saved data could not be read. No changes have been made.'); }
      finally { setLoading(false); }
    })();
  }, []);
  useEffect(() => {
    if (loading || !data) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => setSavedError('Could not save changes on this device.'));
  }, [data, loading]);
  const update = (fn) => setData(previous => fn(previous));
  const now = today();
  const accounts = data?.accounts || [];
  const transactions = data?.transactions || [];
  const schedules = data?.schedules || [];
  const balance = accounts.reduce((sum, a) => sum + accountBalance(a, transactions), 0);
  const range = getPeriod(now, period);
  const totals = periodTotals(transactions, range[0], range[1]);
  const groups = categoryTotals(transactions, range[0], range[1]);
  const scheduled = schedules.map(s => ({ ...s, due: dueDate(s, now) })).filter(s => s.due).sort((a,b) => a.due.localeCompare(b.due));
  const accountName = id => accounts.find(a => a.id === id)?.name || 'Deleted account';
  const recent = [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const series = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    if (period === 'month') {
      const marker = monthOffset(`${now.slice(0,7)}-01`, i - 5);
      const [start, end] = getPeriod(marker, 'month');
      return { key: marker, label: parseDate(marker).toLocaleDateString('en-AU', { month: 'short' }), value: periodTotals(transactions, start, end).expenses, highlight: i === 5 };
    }
    const marker = shiftDays(weekStart(now), (i - 5) * 7);
    return { key: marker, label: parseDate(marker).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }), value: periodTotals(transactions, marker, shiftDays(marker, 6)).expenses, highlight: i === 5 };
  }), [transactions, period, now]);

  function openTransaction(t = null) {
    setModal('transaction'); setEditingId(t?.id || null); setError('');
    setDraft(t ? { ...t, amount: (t.amountCents / 100).toFixed(2) } : {
      type: 'expense', date: now, accountId: accounts[0]?.id, toAccountId: accounts[1]?.id,
      amount: '', category: 'Groceries', description: '',
    });
  }
  function openAccount(a = null) {
    setModal('account'); setEditingId(a?.id || null); setError('');
    setDraft(a ? { ...a, opening: (a.openingCents / 100).toFixed(2) } : { name: '', kind: 'Bank', opening: '0.00', color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length] });
  }
  function openSchedule(s = null) {
    setModal('schedule'); setEditingId(s?.id || null); setError('');
    setDraft(s ? { ...s, amount: (s.amountCents / 100).toFixed(2) } : { name: '', amount: '', accountId: accounts[0]?.id, category: 'Bills', startDate: now, repeat: 'Monthly' });
  }
  function closeModal() { setModal(null); setError(''); }
  function saveTransaction() {
    const cents = parseAmount(draft.amount || '');
    if (!cents) return setError('Enter a positive amount, with up to two decimal places.');
    if (!parseDate(draft.date)) return setError('Use a valid date, e.g. 2026-11-04.');
    if (!accounts.some(a => a.id === draft.accountId)) return setError('Choose an account.');
    if (draft.type === 'transfer' && (!draft.toAccountId || draft.toAccountId === draft.accountId)) return setError('Choose a different destination account.');
    const tx = { id: editingId || uid(), type: draft.type, date: draft.date,
      amountCents: cents, category: draft.type === 'transfer' ? 'Transfer' : draft.category,
      description: String(draft.description || '').trim() || (draft.type === 'transfer' ? 'Transfer' : draft.category),
      accountId: draft.accountId, toAccountId: draft.type === 'transfer' ? draft.toAccountId : null };
    update(d => ({ ...d, transactions: editingId ? d.transactions.map(t => t.id === editingId ? tx : t) : [...d.transactions, tx] }));
    closeModal();
  }
  function saveAccount() {
    const name = String(draft.name || '').trim();
    const raw = String(draft.opening || '').trim().replace(/[$,\s]/g, '');
    if (!name) return setError('Give the account a name.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return setError('Use a valid opening balance.');
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isSafeInteger(cents)) return setError('Balance is too large.');
    const account = { id: editingId || uid(), name, kind: draft.kind, openingCents: cents, color: draft.color };
    update(d => ({ ...d, accounts: editingId ? d.accounts.map(a => a.id === editingId ? account : a) : [...d.accounts, account] }));
    closeModal();
  }
  function saveSchedule() {
    const cents = parseAmount(draft.amount || '');
    if (!String(draft.name || '').trim()) return setError('Give this planned expense a name.');
    if (!cents) return setError('Enter a positive amount.');
    if (!parseDate(draft.startDate)) return setError('Use a valid due date, e.g. 2026-11-04.');
    if (!accounts.some(a => a.id === draft.accountId)) return setError('Choose an account.');
    const scheduledPayment = { id: editingId || uid(), name: String(draft.name).trim(), amountCents: cents,
      category: draft.category, accountId: draft.accountId, repeat: draft.repeat, startDate: draft.startDate,
      lastPaidThrough: editingId ? draft.lastPaidThrough : null, completed: editingId ? draft.completed : false };
    update(d => ({ ...d, schedules: editingId ? d.schedules.map(s => s.id === editingId ? scheduledPayment : s) : [...d.schedules, scheduledPayment] }));
    closeModal();
  }
  function confirmRemove(type, id) {
    const field = type === 'transaction' ? 'transactions' : type === 'account' ? 'accounts' : 'schedules';
    if (type === 'account' && (transactions.some(t => t.accountId === id || t.toAccountId === id) || schedules.some(s => s.accountId === id))) {
      Alert.alert('Account in use', 'Delete or move its transactions and scheduled expenses first.'); return;
    }
    Alert.alert('Delete this item?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => update(d => ({ ...d, [field]: d[field].filter(item => item.id !== id) })) },
    ]);
  }
  function recordPayment(s) {
    Alert.alert('Record payment?', `${s.name}: ${money(s.amountCents)}. This will add an expense dated today and advance the schedule.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Record', onPress: () => update(d => ({ ...d,
        transactions: [...d.transactions, { id: uid(), date: today(), type: 'expense', amountCents: s.amountCents,
          category: s.category, description: s.name, accountId: s.accountId, toAccountId: null }],
        schedules: d.schedules.map(x => x.id === s.id ? { ...x, lastPaidThrough: s.due, completed: s.repeat === 'None' } : x),
      })) },
    ]);
  }
  function resetAll() {
    Alert.alert('Erase all data?', 'All accounts, transactions and planned payments stored in this app will be deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Erase data', style: 'destructive', onPress: () => { setData(null); AsyncStorage.removeItem(STORAGE_KEY).catch(() => setSavedError('Could not remove local data.')); setTab('home'); } },
    ]);
  }

  if (loading) return <SafeAreaView style={styles.screen}><ActivityIndicator style={{ flex: 1 }} size="large" color={C.blue} /></SafeAreaView>;
  if (!data) return <SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content"/><View style={styles.onboarding}>
    <Text style={{ fontSize: 43, marginBottom: 12 }}>◈</Text><Text style={styles.brand}>Pocket Ledger</Text>
    <Text style={[styles.subtleCenter, { fontSize: 16, marginTop: 12, marginBottom: 32 }]}>Know where your money goes. Track accounts, record spending, and view simple, clear insights.</Text>
    {savedError ? <Text style={{ color: C.red, marginBottom: 12 }}>{savedError}</Text> : null}
    <Button title="Start with empty accounts" onPress={() => setData(empty())} />
    <View style={{ height: 12 }}/><Button title="Explore with fictional demo data" secondary onPress={() => setData(demo())} />
    <Text style={[styles.helper, { textAlign: 'center', marginTop: 26 }]}>Offline only · No bank login · AUD</Text>
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content"/>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View><Text style={styles.eyebrow}>POCKET LEDGER {data.mode === 'demo' ? '· DEMO' : ''}</Text><Text style={styles.pageTitle}>{NAV.find(n => n[0] === tab)?.[2]}</Text></View><View style={styles.avatar}><Text style={{ fontSize: 23, color: C.blue }}>◈</Text></View></View>
      {savedError ? <Text style={styles.errorBanner}>{savedError}</Text> : null}
      {data.mode === 'demo' ? <View style={styles.demoBanner}><Text style={styles.demoText}>Fictional demo data. Erase it in Accounts before tracking your own finances.</Text></View> : null}
      {tab === 'home' && <>
        <View style={styles.hero}><Text style={styles.heroSmall}>TOTAL ACROSS ACCOUNTS</Text><Text style={styles.heroBig} adjustsFontSizeToFit numberOfLines={1}>{money(balance)}</Text><Text style={styles.heroHint}>{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} · calculated from opening balances and transactions</Text>
          <View style={styles.heroDivider}/><View style={styles.metricsRow}><Metric label="This month in" value={money(periodTotals(transactions, ...getPeriod(now, 'month')).income)} color="#9AE6C6"/><Metric label="This month out" value={money(periodTotals(transactions, ...getPeriod(now, 'month')).expenses)} color="#FFBAC8"/></View>
        </View>
        <View style={styles.quickRow}><Button title="+ Add transaction" onPress={() => accounts.length ? openTransaction() : openAccount()} /><Button title="+ Add account" secondary onPress={() => openAccount()}/></View>
        <View style={styles.card}><SectionTitle side={<Text style={styles.smallLink} onPress={() => setTab('analytics')}>View insights ›</Text>}>Spending trend</SectionTitle><Chart series={series}/></View>
        <View style={styles.card}><SectionTitle side={<Text style={styles.smallLink} onPress={() => setTab('schedule')}>View planned ›</Text>}>Upcoming payments</SectionTitle>
          {!scheduled.length ? <EmptyMessage title="Nothing planned" detail="Add a recurring or one-off expense." /> : scheduled.slice(0,3).map(s => <View key={s.id} style={styles.miniRow}><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{s.name}</Text><Text style={styles.rowSubtitle}>{s.due} · {s.repeat}</Text></View><Text style={styles.rowAmount}>{money(s.amountCents)}</Text></View>)}
        </View>
        <View style={styles.card}><SectionTitle side={<Text style={styles.smallLink} onPress={() => setTab('transactions')}>All activity ›</Text>}>Recent transactions</SectionTitle>{!recent.length ? <EmptyMessage title="No transactions yet" detail="Record your first expense or income."/> : recent.slice(0,4).map(t => <TxRow key={t.id} t={t} accountName={accountName(t.accountId)} onEdit={() => openTransaction(t)} onRemove={() => confirmRemove('transaction', t.id)}/>)}</View>
      </>}
      {tab === 'transactions' && <>
        <View style={styles.toolbar}><View style={{ flex: 1 }}><Text style={styles.subtle}>Manual income, expenses and internal transfers.</Text></View><Button title="+ New" small onPress={() => accounts.length ? openTransaction() : openAccount()}/></View>
        <View style={styles.filterRow}>{[['all','All'],['expense','Spending'],['income','Income'],['transfer','Transfers']].map(([k,l]) => <Pill key={k} title={l} active={filter === k} onPress={() => setFilter(k)}/>)}</View>
        <View style={styles.card}>{!recent.filter(t => filter === 'all' || t.type === filter).length ? <EmptyMessage title="No matching transactions" detail="Tap + New to record one." /> : recent.filter(t => filter === 'all' || t.type === filter).map(t => <TxRow key={t.id} t={t} accountName={accountName(t.accountId)} onEdit={() => openTransaction(t)} onRemove={() => confirmRemove('transaction', t.id)}/>)}</View>
      </>}
      {tab === 'schedule' && <>
        <View style={styles.toolbar}><Text style={[styles.subtle, { flex: 1 }]}>Planned payments are not counted as spending until recorded.</Text><Button title="+ Plan" small onPress={() => accounts.length ? openSchedule() : openAccount()}/></View>
        <View style={styles.card}><SectionTitle>Upcoming and overdue</SectionTitle>
          {!scheduled.length ? <EmptyMessage title="No planned payments" detail="Add rent, subscriptions or another bill." /> : scheduled.map(s => <View key={s.id} style={styles.scheduleRow}>
            <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{s.name}</Text><Text style={[styles.rowSubtitle, s.due < now && { color: C.red }]}>{s.due < now ? 'Overdue · ' : ''}{s.due} · {s.repeat} · {accountName(s.accountId)}</Text></View>
            <View style={{ alignItems: 'flex-end', gap: 7 }}><Text style={styles.rowAmount}>{money(s.amountCents)}</Text><Button title="Record paid" small secondary onPress={() => recordPayment(s)}/><View style={{ flexDirection:'row', gap:12 }}><Text style={styles.inlineAction} onPress={() => openSchedule(s)}>Edit</Text><Text style={[styles.inlineAction, { color: C.red }]} onPress={() => confirmRemove('schedule', s.id)}>Delete</Text></View></View>
          </View>)}
        </View>
      </>}
      {tab === 'analytics' && <>
        <View style={styles.filterRow}><Pill title="This week" active={period === 'week'} onPress={() => setPeriod('week')}/><Pill title="This month" active={period === 'month'} onPress={() => setPeriod('month')}/></View>
        <View style={styles.card}><Text style={styles.subtle}>{range[0]} to {range[1]}</Text><View style={[styles.metricsRow, { marginTop: 18 }]}><Metric label="Income" value={money(totals.income)} color={C.green}/><Metric label="Expenses" value={money(totals.expenses)} color={C.red}/></View><View style={styles.lightDivider}/><Metric label="Net cash flow" value={money(totals.net)} color={totals.net >= 0 ? C.green : C.red}/></View>
        <View style={styles.card}><SectionTitle>Spending over time</SectionTitle><Chart series={series}/><Text style={styles.helper}>Only recorded expenses are included; transfers and scheduled but unpaid items are excluded.</Text></View>
        <View style={styles.card}><SectionTitle>By category</SectionTitle>
          {!groups.length ? <EmptyMessage title="No expenses for this period" detail="Record an expense to see the breakdown." /> : groups.map(([name, cents]) => <View key={name} style={{ marginBottom: 18, gap: 7 }}><View style={styles.between}><Text style={styles.rowTitle}>{name}</Text><Text style={styles.rowAmount}>{money(cents)} · {Math.round(cents / Math.max(1, totals.expenses) * 100)}%</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${cents / Math.max(1, totals.expenses) * 100}%`, backgroundColor: CATEGORY_COLORS[name] || C.blue }]}/></View></View>)}
        </View>
        <View style={styles.card}><SectionTitle>Quick summary</SectionTitle><Text style={styles.summary}>{totals.expenses ? `You recorded ${money(totals.expenses)} in spending ${period === 'week' ? 'this week' : 'this month'}. ${groups[0]?.[0] || 'Other'} is your largest category (${money(groups[0]?.[1] || 0)}).` : 'You have not recorded any expenses in this period yet.'}</Text></View>
      </>}
      {tab === 'accounts' && <>
        <View style={styles.toolbar}><Text style={[styles.subtle,{flex:1}]}>Opening balance + recorded activity = current balance.</Text><Button title="+ Account" small onPress={() => openAccount()}/></View>
        {!accounts.length ? <View style={styles.card}><EmptyMessage title="Add your first account" detail="Start with a bank, savings or cash account."/></View> : accounts.map(a => <View style={styles.accountCard} key={a.id}><View style={styles.between}><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><View style={[styles.accountLogo, { backgroundColor: a.color }]}><Text style={{ color:'#fff', fontWeight:'800', fontSize:21 }}>{a.name.slice(0,1).toUpperCase()}</Text></View><View><Text style={styles.rowTitle}>{a.name}</Text><Text style={styles.rowSubtitle}>{a.kind} account</Text></View></View><Text style={styles.accountMoney} numberOfLines={1} adjustsFontSizeToFit>{money(accountBalance(a, transactions))}</Text></View><View style={styles.lightDivider}/><View style={styles.between}><Text style={styles.helper}>Opening: {money(a.openingCents)}</Text><View style={{ flexDirection:'row', gap:16 }}><Text style={styles.inlineAction} onPress={() => openAccount(a)}>Edit</Text><Text style={[styles.inlineAction, { color:C.red }]} onPress={() => confirmRemove('account', a.id)}>Delete</Text></View></View></View>)}
        <View style={styles.card}><SectionTitle>Privacy and data</SectionTitle><Text style={styles.summary}>This prototype stores your data locally on this device. It does not connect to a bank or upload transactions to a server. Local app storage is not separately encrypted or backed up.</Text><View style={{ marginTop: 14 }}><Button title="Erase everything / restart" secondary onPress={resetAll}/></View></View>
      </>}
    </ScrollView>
    <View style={styles.tabBar}>{NAV.map(([key, icon, label]) => <Pressable key={key} onPress={() => setTab(key)} style={styles.tabItem}><Text style={[styles.tabIcon, tab===key && {color:C.blue}]}>{icon}</Text><Text style={[styles.tabText, tab===key && {color:C.blue, fontWeight:'800'}]}>{label}</Text></Pressable>)}</View>
    <Modal visible={!!modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
      <SafeAreaView style={styles.modalScreen}><KeyboardAvoidingView style={{ flex:1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingId ? 'Edit' : 'New'} {modal === 'transaction' ? 'transaction' : modal === 'account' ? 'account' : 'planned payment'}</Text><Text onPress={closeModal} style={styles.close}>Close</Text></View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 55, gap: 20 }} keyboardShouldPersistTaps="handled">
          {modal === 'transaction' && <>
            <View style={styles.filterRow}>{[['expense','Expense'],['income','Income'],['transfer','Transfer']].map(([k,l]) => <Pill key={k} title={l} active={draft.type===k} onPress={() => setDraft(x => ({...x, type:k, category:k==='income'?'Salary':'Groceries'}))}/>)}</View>
            <LabeledInput label="Amount (AUD)" value={draft.amount} onChangeText={amount => setDraft(x=>({...x,amount}))} placeholder="0.00" keyboardType="decimal-pad" />
            <LabeledInput label="Description" value={draft.description} onChangeText={description => setDraft(x=>({...x,description}))} placeholder="e.g. Weekly groceries" />
            <LabeledInput label="Date (YYYY-MM-DD)" value={draft.date} onChangeText={date => setDraft(x=>({...x,date}))} placeholder="2026-11-04" />
            <Text style={styles.fieldLabel}>{draft.type === 'transfer' ? 'From account' : 'Account'}</Text><View style={styles.chips}>{accounts.map(a=><Pill key={a.id} title={a.name} active={draft.accountId===a.id} onPress={()=>setDraft(x=>({...x,accountId:a.id}))}/>)}</View>
            {draft.type === 'transfer' ? <><Text style={styles.fieldLabel}>To account</Text><View style={styles.chips}>{accounts.filter(a=>a.id!==draft.accountId).map(a=><Pill key={a.id} title={a.name} active={draft.toAccountId===a.id} onPress={()=>setDraft(x=>({...x,toAccountId:a.id}))}/>)}</View></> : <><Text style={styles.fieldLabel}>Category</Text><View style={styles.chips}>{(draft.type==='income'?INCOME_CATEGORIES:EXPENSE_CATEGORIES).map(c=><Pill key={c} title={c} active={draft.category===c} onPress={()=>setDraft(x=>({...x,category:c}))}/>)}</View></>}
          </>}
          {modal === 'account' && <>
            <LabeledInput label="Account name" value={draft.name} onChangeText={name=>setDraft(x=>({...x,name}))} placeholder="e.g. Everyday" />
            <Text style={styles.fieldLabel}>Account type</Text><View style={styles.chips}>{['Bank','Savings','Cash'].map(kind=><Pill key={kind} title={kind} active={draft.kind===kind} onPress={()=>setDraft(x=>({...x,kind}))}/>)}</View>
            <LabeledInput label="Opening balance (AUD)" value={draft.opening} onChangeText={opening=>setDraft(x=>({...x,opening}))} keyboardType="decimal-pad" hint="Balance before your first recorded transaction. Use your balance before the first transaction you plan to enter." />
            <Text style={styles.fieldLabel}>Colour</Text><View style={styles.chips}>{ACCOUNT_COLORS.map(color=><Pressable key={color} onPress={()=>setDraft(x=>({...x,color}))} style={[styles.colorDot,{backgroundColor:color,borderWidth:draft.color===color?4:0,borderColor:'#DAE0EF'}]}/>)}</View>
          </>}
          {modal === 'schedule' && <>
            <LabeledInput label="Name" value={draft.name} onChangeText={name=>setDraft(x=>({...x,name}))} placeholder="e.g. Rent" />
            <LabeledInput label="Amount (AUD)" value={draft.amount} onChangeText={amount=>setDraft(x=>({...x,amount}))} placeholder="0.00" keyboardType="decimal-pad" />
            <LabeledInput label="First due date (YYYY-MM-DD)" value={draft.startDate} onChangeText={startDate=>setDraft(x=>({...x,startDate}))}/>
            <Text style={styles.fieldLabel}>Repeat</Text><View style={styles.chips}>{REPEATS.map(repeat=><Pill key={repeat} title={repeat} active={draft.repeat===repeat} onPress={()=>setDraft(x=>({...x,repeat}))}/>)}</View>
            <Text style={styles.fieldLabel}>Account</Text><View style={styles.chips}>{accounts.map(a=><Pill key={a.id} title={a.name} active={draft.accountId===a.id} onPress={()=>setDraft(x=>({...x,accountId:a.id}))}/>)}</View>
            <Text style={styles.fieldLabel}>Category</Text><View style={styles.chips}>{EXPENSE_CATEGORIES.map(category=><Pill key={category} title={category} active={draft.category===category} onPress={()=>setDraft(x=>({...x,category}))}/>)}</View>
          </>}
          {!!error && <Text style={styles.errorBanner}>{error}</Text>}
          <Button title={editingId ? 'Save changes' : modal==='transaction' ? 'Add transaction' : modal==='account' ? 'Add account' : 'Add planned payment'} onPress={modal==='transaction'?saveTransaction:modal==='account'?saveAccount:saveSchedule}/>
        </ScrollView>
      </KeyboardAvoidingView></SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:C.pale}, page:{paddingHorizontal:18,paddingTop:17,paddingBottom:28,gap:17},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:2},
  eyebrow:{color:C.mute,fontSize:10,fontWeight:'800',letterSpacing:1.5},pageTitle:{fontSize:29,fontWeight:'800',color:C.ink,marginTop:5,letterSpacing:-.8},
  avatar:{width:43,height:43,borderRadius:15,backgroundColor:'#E8EBFD',alignItems:'center',justifyContent:'center'},
  brand:{fontSize:34,color:C.ink,fontWeight:'800'},onboarding:{flex:1,justifyContent:'center',paddingHorizontal:35},
  subtleCenter:{textAlign:'center',color:C.mute,lineHeight:23},subtle:{color:C.mute,fontSize:13,lineHeight:19},
  button:{backgroundColor:C.blue,paddingVertical:13,paddingHorizontal:17,borderRadius:13,alignItems:'center',justifyContent:'center'},buttonSecondary:{backgroundColor:'#E9EDFD'},buttonText:{color:'#fff',fontSize:14,fontWeight:'800'},
  hero:{backgroundColor:'#19243D',padding:22,borderRadius:23},heroSmall:{fontSize:11,color:'#B8C5DF',fontWeight:'800',letterSpacing:1.3},heroBig:{fontSize:36,color:'#fff',fontWeight:'800',marginTop:14},heroHint:{color:'#A8B4CD',fontSize:11,marginTop:7,lineHeight:17},heroDivider:{height:1,backgroundColor:'#37425A',marginTop:22,marginBottom:17},
  metricsRow:{flexDirection:'row',gap:18},metricLabel:{color:C.mute,fontSize:12,fontWeight:'600',marginBottom:6},metricValue:{color:C.ink,fontSize:19,fontWeight:'800'},
  quickRow:{flexDirection:'row',gap:9},card:{backgroundColor:C.white,borderRadius:19,padding:18,gap:13,borderWidth:1,borderColor:'#EEF0F5'},
  sectionTitle:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},sectionText:{fontSize:17,fontWeight:'800',color:C.ink},smallLink:{color:C.blue,fontSize:12,fontWeight:'800'},
  chart:{marginTop:12},chartBars:{height:142,flexDirection:'row',gap:12,alignItems:'flex-end'},barItem:{flex:1,alignItems:'center',gap:8,height:'100%'},barTrack:{height:113,width:'100%',justifyContent:'flex-end',alignItems:'center',backgroundColor:'#F6F7FC',borderRadius:7,overflow:'hidden'},barFill:{width:'66%',borderTopLeftRadius:6,borderTopRightRadius:6},barLabel:{fontSize:10,color:C.mute,fontWeight:'700'},
  miniRow:{flexDirection:'row',alignItems:'center',paddingVertical:11,borderTopWidth:1,borderTopColor:C.border},listRow:{flexDirection:'row',alignItems:'center',paddingVertical:12,borderBottomWidth:1,borderBottomColor:C.border,gap:11},
  txIcon:{width:40,height:40,borderRadius:13,alignItems:'center',justifyContent:'center'},rowTitle:{color:C.ink,fontWeight:'800',fontSize:14},rowSubtitle:{color:C.mute,fontSize:11,marginTop:4},rowAmount:{color:C.ink,fontWeight:'800',fontSize:13},inlineAction:{fontSize:11,color:C.blue,fontWeight:'800'},
  empty:{paddingVertical:25,paddingHorizontal:12,alignItems:'center'},emptyTitle:{fontSize:15,color:C.ink,fontWeight:'800',marginBottom:5},
  toolbar:{flexDirection:'row',alignItems:'center',gap:12},filterRow:{flexDirection:'row',gap:7,flexWrap:'wrap'},
  pill:{borderWidth:1,borderColor:'#DFE4EF',borderRadius:22,paddingHorizontal:12,paddingVertical:9,backgroundColor:'#fff'},pillText:{fontSize:12,color:C.mute,fontWeight:'800'},
  scheduleRow:{flexDirection:'row',gap:12,paddingVertical:16,borderBottomWidth:1,borderBottomColor:C.border},
  lightDivider:{height:1,backgroundColor:C.border,marginVertical:10},track:{height:9,backgroundColor:'#EFF2F8',borderRadius:7,overflow:'hidden'},fill:{height:9,borderRadius:7},between:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:9},
  summary:{color:'#56637E',fontSize:13,lineHeight:21},accountCard:{padding:18,borderRadius:18,backgroundColor:'#fff',borderWidth:1,borderColor:'#EFF1F6'},accountLogo:{width:43,height:43,borderRadius:14,justifyContent:'center',alignItems:'center'},accountMoney:{fontSize:17,color:C.ink,fontWeight:'800',maxWidth:'40%'},
  tabBar:{flexDirection:'row',backgroundColor:'#fff',borderTopWidth:1,borderTopColor:C.border,paddingVertical:10,paddingHorizontal:3},tabItem:{flex:1,alignItems:'center',justifyContent:'center',gap:4},tabIcon:{fontSize:23,fontWeight:'800',color:'#A1AAC0'},tabText:{fontSize:10,color:'#8B96AA',fontWeight:'600'},
  modalScreen:{flex:1,backgroundColor:C.pale},modalHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:20,backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:C.border},modalTitle:{color:C.ink,fontSize:20,fontWeight:'800'},close:{fontSize:14,color:C.blue,fontWeight:'800'},
  fieldLabel:{fontSize:13,fontWeight:'800',color:C.ink},input:{backgroundColor:'#fff',borderColor:'#DDE4EF',borderWidth:1,borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:16,color:C.ink},helper:{fontSize:11,color:C.mute,lineHeight:17},chips:{flexDirection:'row',flexWrap:'wrap',gap:7},colorDot:{width:35,height:35,borderRadius:18},
  errorBanner:{color:'#9A2D46',backgroundColor:'#FFE7ED',padding:12,borderRadius:9,fontSize:12},demoBanner:{backgroundColor:'#FFF5DF',borderRadius:12,padding:11},demoText:{color:'#9B6D25',fontSize:11,lineHeight:17},
});
