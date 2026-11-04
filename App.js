import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Modal, Platform,
  Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recoverAutomaticBackup, uploadAutomaticBackup } from './icloudBackup';

// Pocket Ledger — personal finance MVP, offline/manual only.
// Amounts are kept as integer cents to avoid floating-point currency errors.
const STORAGE_KEY = 'pocket-ledger-v1'; // Keep this key to preserve v0.1/v0.2 data.
const BACKUP_FORMAT = 'pocket-ledger-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const timeNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
function parseTime(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return null;
  return value;
}
// Never invent historical timestamps when upgrading earlier versions.
// A null time means that no time was recorded in the original data.
const NAV = [
  ['home', '⌂', 'Overview'], ['transactions', '↔', 'Activity'],
  ['schedule', '◷', 'Planned'], ['analytics', '▥', 'Insights'],
  ['accounts', '▤', 'Accounts'], ['settings', '⚙', 'Settings'],
];
const EXPENSE_CATEGORIES = ['Groceries', 'Dining', 'Transport', 'Shopping', 'Housing', 'Bills', 'Health', 'Fun', 'Other'];
const INCOME_CATEGORIES = ['Salary', 'Refund', 'Gift', 'Interest', 'Other'];
const CATEGORY_ICONS = {
  Groceries:'🛒', Dining:'🍽️', Transport:'🚌', Shopping:'🛍️', Housing:'🏠', Bills:'🧾',
  Health:'💊', Fun:'🎮', Other:'📦', Salary:'💼', Refund:'↩️', Gift:'🎁', Interest:'🏦', Transfer:'🔁',
};
const ICON_CHOICES = [
  '🛒','🍽️','☕','🥗','🍕','🚌','🚗','🚕','🚲','✈️','⛽','🛍️','👕','💻','📱',
  '🏠','🔑','🧾','💡','📶','💊','🏥','🦷','🎮','🎬','🎵','🏋️','⚽','🐈','🐕',
  '📚','🎓','💼','💰','🏦','💵','🎁','↩️','📈','📉','🔁','🪙','🧰','🔧','🌿',
  '👨‍👩‍👧','💖','📦','⭐','🎯','🚀','🧳','🏖️','💳','💸','💻','📷',
];
const CATEGORY_COLORS = {
  Groceries: '#5A96E9', Dining: '#E18B5E', Transport: '#8B80D9', Shopping: '#DB6B9B',
  Housing: '#54AF9A', Bills: '#BC9B47', Health: '#54B4BC', Fun: '#9B76C9', Other: '#8692A6',
  Salary: '#42A883', Refund: '#72A8CC', Gift: '#AB8DD0', Interest: '#42A883',
};
const ACCOUNT_COLORS = [
  '#4D63E8', '#139C99', '#C07E52', '#8B66CB', '#314C73', '#E05E77',
  '#F39C42', '#D3B34A', '#6FBA6F', '#4CBFAF', '#39A6C5', '#6482C6',
  '#A67ED7', '#CE75BE', '#745F94', '#A47A65', '#485C66', '#E47555',
  '#BB557A', '#2A8B75', '#7D929D', '#D2A24E', '#7056C8', '#E0779A',
];
const defaultCategories = () => EXPENSE_CATEGORIES.map(name => ({ name, icon: CATEGORY_ICONS[name] || '📦', color: CATEGORY_COLORS[name] || ACCOUNT_COLORS[0] }));
const defaultIncomeCategories = () => INCOME_CATEGORIES.map(name => ({ name, icon: CATEGORY_ICONS[name] || '💰' }));
function normalizeCategoryList(input, defaults, type) {
  const items = Array.isArray(input) ? input.filter(c => c && typeof c.name === 'string' && c.name.trim()) : defaults;
  const names = new Set();
  const normalized = items.filter(c => {
    const name = c.name.trim().toLowerCase();
    if (names.has(name)) return false;
    names.add(name); return true;
  }).map(c => ({ name:c.name.trim(), icon: typeof c.icon === 'string' && c.icon.trim() ? c.icon : CATEGORY_ICONS[c.name] || (type === 'income' ? '💰' : '📦'),
    ...(type === 'expense' ? { color: c.color || CATEGORY_COLORS[c.name] || ACCOUNT_COLORS[0] } : {}) }));
  if (!normalized.some(c => c.name === 'Other')) normalized.push({ name:'Other', icon:'📦', ...(type === 'expense' ? {color:CATEGORY_COLORS.Other} : {}) });
  return normalized;
}
function normalizeData(d) {
  const accounts = Array.isArray(d.accounts) ? d.accounts : [];
  const transactions = Array.isArray(d.transactions) ? d.transactions : [];
  const schedules = Array.isArray(d.schedules) ? d.schedules : [];
  const categories = normalizeCategoryList(d.categories, defaultCategories(), 'expense');
  const incomeCategories = normalizeCategoryList(d.incomeCategories, defaultIncomeCategories(), 'income');
  // Legacy category colours remain readable, but category editing now uses icons.
  // Preserve previously used names on both transaction types.
  for (const item of [...transactions, ...schedules]) {
    const kind = item.type || item.kind || 'expense';
    if (kind !== 'expense' && kind !== 'income') continue;
    const list = kind === 'income' ? incomeCategories : categories;
    if (item.category && !list.some(c => c.name === item.category)) {
      list.push({ name:item.category, icon:CATEGORY_ICONS[item.category] || (kind === 'income' ? '💰' : '📦'),
        ...(kind === 'expense' ? {color:CATEGORY_COLORS[item.category] || ACCOUNT_COLORS[0]} : {}) });
    }
  }
  return { ...d, categories, incomeCategories, autoPostPlannedExpenses: !!d.autoPostPlannedExpenses,
    transactions: transactions.map(t => ({ ...t, time: parseTime(t.time) || null })),
    accounts: accounts.map(a => ({ ...a, creditLimitCents: Number.isSafeInteger(a.creditLimitCents) ? a.creditLimitCents : 0 })) };
}
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
  // Bank/savings/cash: positive is an asset. Credit Card: positive is DEBT OWED.
  const sign = account.kind === 'Credit Card' ? -1 : 1;
  let total = account.openingCents;
  for (const t of transactions) {
    if (t.type === 'income' && t.accountId === account.id) total += sign * t.amountCents;
    if (t.type === 'expense' && t.accountId === account.id) total -= sign * t.amountCents;
    if (t.type === 'transfer') {
      if (t.accountId === account.id) total -= sign * t.amountCents;
      if (t.toAccountId === account.id) total += sign * t.amountCents;
    }
  }
  return total;
}
function netWorth(accounts, transactions) {
  return accounts.reduce((sum, a) => sum + (a.kind === 'Credit Card' ? -1 : 1) * accountBalance(a, transactions), 0);
}
function previousRange(start, end) {
  const days = Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000) + 1;
  return [shiftDays(start, -days), shiftDays(start, -1)];
}
function parseFilterAmount(value) {
  const text = String(value || '').trim().replace(/[$,\s]/g,'');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const n = Math.round(Number(text) * 100);
  return Number.isSafeInteger(n) ? n : null;
}
function filteredTransactions(transactions, filters, accounts) {
  const query = String(filters.query || '').trim().toLowerCase();
  const start = parseDate(filters.start) ? filters.start : null;
  const end = parseDate(filters.end) ? filters.end : null;
  return transactions.filter(t => {
    if (filters.type && filters.type !== 'all' && t.type !== filters.type) return false;
    if (filters.accountId && filters.accountId !== 'all' && t.accountId !== filters.accountId && t.toAccountId !== filters.accountId) return false;
    if (filters.category && filters.category !== 'all' && t.category !== filters.category) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    const min = filters.minAmount ? parseFilterAmount(filters.minAmount) : null;
    const max = filters.maxAmount ? parseFilterAmount(filters.maxAmount) : null;
    if (min !== null && t.amountCents < min) return false;
    if (max !== null && t.amountCents > max) return false;
    if (!query) return true;
    const first = accounts.find(a => a.id === t.accountId)?.name || '';
    const second = accounts.find(a => a.id === t.toAccountId)?.name || '';
    const amount = (t.amountCents / 100).toFixed(2);
    return [t.description, t.category, t.type, t.date, t.time, first, second, amount, money(t.amountCents)].some(x => String(x || '').toLowerCase().includes(query));
  });
}
function spendingSeries(transactions, start, end) {
  const days = Math.max(1, Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000) + 1);
  const result = [];
  const push = (s, e, label) => result.push({ key: s, label, value: periodTotals(transactions, s, e).expenses, highlight: e >= today() });
  if (days <= 14) {
    for (let s = start; s <= end; s = shiftDays(s, 1)) push(s, s, parseDate(s).toLocaleDateString('en-AU', { day:'numeric', month:'short' }));
  } else if (days <= 100) {
    for (let s = start; s <= end; s = shiftDays(s, 7)) {
      const e = shiftDays(s, 6) < end ? shiftDays(s, 6) : end;
      push(s, e, parseDate(s).toLocaleDateString('en-AU', { day:'numeric', month:'short' }));
    }
  } else if (days <= 580) {
    for (let s = start; s <= end;) {
      const next = monthOffset(s.slice(0,7)+'-01', 1);
      const e = shiftDays(next, -1) < end ? shiftDays(next, -1) : end;
      push(s, e, parseDate(s).toLocaleDateString('en-AU', { month:'short', year: days > 370 ? '2-digit': undefined }));
      s = shiftDays(e, 1);
    }
  } else {
    // Group longer selected ranges into chronological calendar-year buckets.
    for (let s = start; s <= end;) {
      const e = `${s.slice(0,4)}-12-31` < end ? `${s.slice(0,4)}-12-31` : end;
      push(s, e, s.slice(0,4)); s = shiftDays(e, 1);
    }
  }
  return result;
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
  const anchor = schedule.startDate;
  if (schedule.repeat === 'None') return schedule.lastPaidThrough && schedule.lastPaidThrough >= anchor ? null : anchor;
  const cutoff = schedule.lastPaidThrough || '';
  let overdue = null;
  for (let i = 0; i < 2500; i++) {
    const when = schedule.repeat === 'Weekly' ? shiftDays(anchor, i * 7)
      : schedule.repeat === 'Fortnightly' ? shiftDays(anchor, i * 14)
      : schedule.repeat === 'Monthly' ? monthOffset(anchor, i)
      : monthOffset(anchor, i * 12);
    if (when <= cutoff) continue; // Also skip future items posted early on the 1st.
    if (when > now) return overdue || when;
    overdue = when;
  }
  return overdue;
}
function applyRecordedPayment(data, schedule, date) {
  const isRepayment = schedule.kind === 'card_payment';
  const type = isRepayment ? 'transfer' : schedule.kind === 'income' ? 'income' : 'expense';
  const occurrence = schedule.due || schedule.startDate;
  // The schedule id + original due date help prevent duplicate bulk postings.
  if (data.transactions.some(t => t.scheduleId === schedule.id && t.scheduledFor === occurrence)) return data;
  const tx = { id: uid(), date, time: timeNow(), type,
    amountCents: schedule.amountCents, category: isRepayment ? 'Transfer' : schedule.category,
    description: schedule.name, accountId: schedule.accountId,
    toAccountId: isRepayment ? schedule.toAccountId : null,
    scheduleId: schedule.id, scheduledFor: occurrence };
  return {
    ...data, transactions: [...data.transactions, tx],
    schedules: data.schedules.map(s => s.id === schedule.id ? {
      ...s, lastPaidThrough: occurrence, completed: schedule.repeat === 'None',
    } : s),
  };
}
function pendingOccurrencesInMonth(schedule, monthStart) {
  if (schedule.completed || (schedule.kind || 'expense') !== 'expense') return [];
  const monthEnd = monthOffset(monthStart, 1);
  const end = shiftDays(monthEnd, -1);
  const start = schedule.startDate;
  if (!parseDate(start) || start > end) return [];
  const result = [];
  for (let index = 0; index < 2500; index++) {
    const when = schedule.repeat === 'None' ? start
      : schedule.repeat === 'Weekly' ? shiftDays(start, index * 7)
      : schedule.repeat === 'Fortnightly' ? shiftDays(start, index * 14)
      : schedule.repeat === 'Monthly' ? monthOffset(start, index)
      : monthOffset(start, index * 12);
    if (when > end) break;
    if (when >= monthStart && (!schedule.lastPaidThrough || when > schedule.lastPaidThrough)) result.push(when);
    if (schedule.repeat === 'None') break;
  }
  return result;
}
function postPlannedMonth(data, monthStart) {
  // Post every planned occurrence for this month in advance, but date the
  // transaction on its original scheduled day (not on the posting day).
  // Each occurrence is linked by schedule ID and scheduled date for idempotency.
  if (!parseDate(monthStart) || !monthStart.endsWith('-01')) return data;
  const newTransactions = [];
  const nextSchedules = data.schedules.map(schedule => {
    const pending = pendingOccurrencesInMonth(schedule, monthStart);
    if (!pending.length) return schedule;
    const existingKeys = new Set([...data.transactions, ...newTransactions]
      .filter(t => t.scheduleId === schedule.id).map(t => t.scheduledFor));
    const fresh = pending.filter(when => !existingKeys.has(when));
    if (!fresh.length) return schedule;
    for (const when of fresh) newTransactions.push({ id:uid(), type:'expense', date:when,
      time:timeNow(), amountCents:schedule.amountCents, category:schedule.category,
      description:schedule.name, accountId:schedule.accountId, toAccountId:null,
      scheduleId:schedule.id, scheduledFor:when });
    const last = fresh[fresh.length - 1];
    return {...schedule, lastPaidThrough:last, completed:schedule.repeat === 'None'};
  });
  return newTransactions.length ? {...data, transactions:[...data.transactions,...newTransactions], schedules:nextSchedules} : data;
}
const recentSort = tx => [...tx].sort((a, b) =>
  b.date.localeCompare(a.date) ||
  (b.time || '').localeCompare(a.time || '') ||
  String(b.id).localeCompare(String(a.id))
);
function groupActivity(transactions) {
  const map = new Map();
  for (const tx of recentSort(transactions)) {
    if (!map.has(tx.date)) map.set(tx.date, { date: tx.date, transactions: [], income: 0, expenses: 0 });
    const group = map.get(tx.date);
    group.transactions.push(tx);
    if (tx.type === 'income') group.income += tx.amountCents;
    if (tx.type === 'expense') group.expenses += tx.amountCents;
  }
  return [...map.values()];
}
// Versioned snapshots support automatic iCloud backup and validated recovery.
function makeBackup(data, timestamp = new Date().toISOString()) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: timestamp, payload: data };
}
function readBackup(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_BACKUP_BYTES) throw new Error('Backup file is too large or unreadable.');
  let backup;
  try { backup = JSON.parse(raw); } catch (_) { throw new Error('This file is not valid JSON.'); }
  if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION)
    throw new Error('Unrecognised Pocket Ledger backup format or version.');
  const d = backup.payload;
  if (!d || !Array.isArray(d.accounts) || !Array.isArray(d.transactions) || !Array.isArray(d.schedules))
    throw new Error('The backup is missing required financial data.');
  if (d.accounts.length > 500 || d.transactions.length > 100000 || d.schedules.length > 5000)
    throw new Error('The backup contains an unsupported number of records.');
  const unique = entries => {
    const seen = new Set();
    return entries.every(x => {
      if (!x || typeof x.id !== 'string' || !x.id || seen.has(x.id)) return false;
      seen.add(x.id); return true;
    });
  };
  if (!unique(d.accounts) || !unique(d.transactions) || !unique(d.schedules)) throw new Error('The backup contains invalid or duplicate record IDs.');
  const ids = new Set(d.accounts.map(a => a.id));
  if (!d.accounts.every(a => typeof a.name === 'string' && a.name.trim() && ['Bank','Savings','Cash','Credit Card'].includes(a.kind)
    && Number.isSafeInteger(a.openingCents) && a.openingCents >= 0
    && (!('creditLimitCents' in a) || (Number.isSafeInteger(a.creditLimitCents) && a.creditLimitCents >= 0))))
    throw new Error('The backup contains an invalid account.');
  if (!d.transactions.every(t => ['income','expense','transfer'].includes(t.type) && parseDate(t.date)
    && (!t.time || parseTime(t.time)) && Number.isSafeInteger(t.amountCents) && t.amountCents > 0
    && ids.has(t.accountId) && (t.type !== 'transfer' || (ids.has(t.toAccountId) && t.toAccountId !== t.accountId))
    && typeof t.description === 'string' && typeof t.category === 'string'))
    throw new Error('The backup contains an invalid transaction.');
  if (!d.schedules.every(sc => typeof sc.name === 'string' && Number.isSafeInteger(sc.amountCents) && sc.amountCents > 0
    && parseDate(sc.startDate) && REPEATS.includes(sc.repeat) && ids.has(sc.accountId)
    && ((sc.kind || 'expense') !== 'card_payment' || ids.has(sc.toAccountId))))
    throw new Error('The backup contains an invalid planned payment.');
  const validCategoryList = (list, requiresLegacyColour) => Array.isArray(list) && list.length <= 500
    && list.every(c => c && typeof c.name === 'string' && c.name.trim()
      && (!('icon' in c) || typeof c.icon === 'string')
      && (!requiresLegacyColour || !('color' in c) || typeof c.color === 'string'));
  if (d.categories !== undefined && !validCategoryList(d.categories, true)) throw new Error('The backup contains invalid spending categories.');
  if (d.incomeCategories !== undefined && !validCategoryList(d.incomeCategories, false)) throw new Error('The backup contains invalid income categories.');
  if (d.autoPostPlannedExpenses !== undefined && typeof d.autoPostPlannedExpenses !== 'boolean') throw new Error('The backup contains invalid settings.');
  return normalizeData(d);
}
const empty = () => ({ accounts: [], transactions: [], schedules: [], categories: defaultCategories(), incomeCategories: defaultIncomeCategories(), autoPostPlannedExpenses:false, mode: 'personal' });
function demo() {
  const now = today();
  const checking = 'demo-everyday', savings = 'demo-savings';
  return {
    mode: 'demo',
    categories: defaultCategories(), incomeCategories: defaultIncomeCategories(), autoPostPlannedExpenses:false,
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
      id: `demo-tx-${index}`, type, date: shiftDays(now, -ago), time: `${String(8 + (index * 3) % 12).padStart(2,'0')}:${String(index * 11 % 60).padStart(2,'0')}`, amountCents,
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
function Pill({ title, active, onPress, color, compact = false }) {
  return <Pressable onPress={onPress} style={[styles.pill, compact && styles.compactPill, active && { backgroundColor: color || C.blue, borderColor: color || C.blue }]}>
    <Text style={[styles.pillText, active && { color: '#fff' }]}>{title}</Text>
  </Pressable>;
}
function SectionTitle({ children, side }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionText}>{children}</Text>{side}</View>;
}
function SettingsMenuRow({ icon, title, detail, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title} settings`} onPress={onPress} style={styles.settingsMenuRow}>
    <View style={styles.settingsMenuIcon}><Text style={{fontSize:21}}>{icon}</Text></View>
    <View style={{flex:1,minWidth:0}}>
      <Text style={styles.settingsMenuTitle}>{title}</Text>
      <Text style={styles.settingsMenuDetail}>{detail}</Text>
    </View>
    <Text style={styles.settingsChevron}>›</Text>
  </Pressable>;
}
const SETTINGS_TITLES = {
  menu:'Settings', planned:'Planned payments', expenses:'Spending categories',
  income:'Income categories', accounts:'Account management',
  backup:'iCloud backup', privacy:'Privacy & data',
};
function Metric({ label, value, color }) {
  return <View style={{ flex: 1, minWidth: 105 }}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, color && { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>;
}
function EmptyMessage({ title, detail }) {
  return <View style={styles.empty}><Text style={{ fontSize: 28, marginBottom: 7 }}>◌</Text><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.subtleCenter}>{detail}</Text></View>;
}
function TxRow({ t, accountName, destinationName, onEdit, icon }) {
  const isExpense = t.type === 'expense'; const isIncome = t.type === 'income';
  const typeLabel = isExpense ? 'Expense' : isIncome ? 'Income' : 'Transfer';
  const accountLabel = t.type === 'transfer' ? `${accountName} → ${destinationName || 'Unknown account'}` : accountName;
  return <Pressable onPress={onEdit} accessibilityRole="button"
    accessibilityLabel={`Edit ${typeLabel.toLowerCase()}, ${t.description}, ${money(t.amountCents)}, ${t.date}${t.time ? ` at ${t.time}` : ''}`}
    style={styles.listRow}>
    <View style={styles.txIcon}><Text style={{fontSize:18}}>{icon || '📦'}</Text></View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.rowTitle} numberOfLines={1}>{t.description || t.category || typeLabel}</Text>
      <Text style={styles.rowSubtitle} numberOfLines={1}>{accountLabel}</Text>
    </View>
    <Text style={[styles.rowAmount, { color: isExpense ? C.red : isIncome ? C.green : C.mute }]} numberOfLines={1}>
      {isExpense ? '−' : isIncome ? '+' : ''}{money(t.amountCents)}
    </Text>
  </Pressable>;
}
function ActivityDay({ group, onEdit, accountName, categoryIcon }) {
  const label = parseDate(group.date)?.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short', year:'numeric' }) || group.date;
  return <View style={styles.activityDay}>
    <View style={styles.dayHeader}>
      <Text style={styles.dayHeaderDate}>{label}</Text>
      <View style={styles.dayTotals}>
        <Text style={styles.dayOut}>Out {money(group.expenses)}</Text>
        <Text style={styles.dayIn}>In {money(group.income)}</Text>
      </View>
    </View>
    {group.transactions.map(t => <TxRow key={t.id} t={t} icon={categoryIcon(t)}
      accountName={accountName(t.accountId)} destinationName={accountName(t.toAccountId)} onEdit={() => onEdit(t)}/>) }
  </View>;
}

function Chart({ series, accent = C.blue }) {
  const high = Math.max(1, ...series.map(x => x.value));
  return <ScrollView style={styles.chart} horizontal showsHorizontalScrollIndicator={series.length > 7} contentContainerStyle={{ flexGrow: 1 }}>
    <View style={[styles.chartBars, { width: Math.max(290, series.length * 44) }]}>
      {series.map((item) => <View key={item.key} style={styles.barItem}>
        <View style={styles.barTrack}><View style={[styles.barFill, { height: `${item.value === 0 ? 0 : Math.max(2, item.value / high * 100)}%`, backgroundColor: item.highlight ? accent : '#C9D2F7' }]} /></View>
        <Text style={styles.barLabel} numberOfLines={1}>{item.label}</Text>
      </View>)}
    </View>
  </ScrollView>;
}
function LabeledInput({ label, value, onChangeText, hint, keyboardType, placeholder }) {
  return <View style={{ gap: 6 }}><Text style={styles.fieldLabel}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType || 'default'} placeholder={placeholder || ''} placeholderTextColor="#A6AEC1" autoCapitalize="sentences" />{hint ? <Text style={styles.helper}>{hint}</Text> : null}</View>;
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('home');
  const [settingsPage, setSettingsPage] = useState('menu');
  const [plannedView, setPlannedView] = useState('all');
  const [activeDay, setActiveDay] = useState(today());
  const [period, setPeriod] = useState('month');
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStart, setSearchStart] = useState('');
  const [searchEnd, setSearchEnd] = useState('');
  const [searchMin, setSearchMin] = useState('');
  const [searchMax, setSearchMax] = useState('');
  const [searchAccount, setSearchAccount] = useState('all');
  const [searchCategory, setSearchCategory] = useState('all');
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [insightStart, setInsightStart] = useState(`${today().slice(0,4)}-01-01`);
  const [insightEnd, setInsightEnd] = useState(today());
  const [appliedCustom, setAppliedCustom] = useState([`${today().slice(0,4)}-01-01`, today()]);
  const [insightError, setInsightError] = useState('');
  const [modal, setModal] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState('');
  const [savedError, setSavedError] = useState('');
  const [cloudStatus, setCloudStatus] = useState({ state: 'checking', text: 'Checking automatic iCloud backup…', at: null });
  const pageScrollRef = useRef(null);
  useEffect(() => { pageScrollRef.current?.scrollTo({y:0,animated:false}); }, [tab,settingsPage]);
  const dataRef = useRef(null);
  dataRef.current = data;
  const cloudStatusRef = useRef(cloudStatus);
  cloudStatusRef.current = cloudStatus;
  const persistQueueRef = useRef(Promise.resolve());
  const backupTimerRef = useRef(null);
  const backupRunningRef = useRef(false);
  const lastCloudJsonRef = useRef(null);
  const loadingRef = useRef(true);
  loadingRef.current = loading;
  const recoveryRunningRef = useRef(false);

  async function backupCurrentData() {
    if (backupRunningRef.current) return;
    backupRunningRef.current = true;
    try {
      while (dataRef.current) {
        const snapshot = dataRef.current;
        if (snapshot.mode === 'demo') {
          setCloudStatus({ state: 'demo', text: 'Demo transactions are not uploaded to iCloud.', at: null });
          return;
        }
        const dataJson = JSON.stringify(snapshot);
        if (dataJson === lastCloudJsonRef.current) return;
        setCloudStatus({ state: 'uploading', text: 'Saving an automatic iCloud backup…', at: null });
        try {
          const date = await uploadAutomaticBackup(JSON.stringify(makeBackup(snapshot)));
          lastCloudJsonRef.current = dataJson;
          setCloudStatus({ state: 'submitted', text: 'Saved to the iCloud container; Apple may still be syncing it.', at: date });
        } catch (e) {
          setCloudStatus({ state: 'error', text: e?.message || 'Could not back up to iCloud. Data remains saved on this device.', at: null });
          return; // Retry on the next change, app activation or periodic check.
        }
      }
    } finally { backupRunningRef.current = false; }
  }
  function scheduleCloudBackup(delay = 1600) {
    if (backupTimerRef.current) clearTimeout(backupTimerRef.current);
    backupTimerRef.current = setTimeout(() => {
      backupTimerRef.current = null;
      backupCurrentData();
    }, delay);
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.schedules)) {
            throw new Error('Local financial data is invalid.');
          }
          if (!cancelled) setData(normalizeData(parsed));
        } else {
          // Restore only on first install / with no local ledger: never overwrite
          // existing local transactions automatically across multiple devices.
          try {
            const recovered = await recoverAutomaticBackup(readBackup);
            if (cancelled) return;
            if (recovered) {
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recovered));
              if (!cancelled) {
                setData(recovered);
                setCloudStatus({ state: 'restored', text: 'Restored your latest valid iCloud snapshot automatically.', at: null });
              }
            } else {
              setCloudStatus({ state: 'ready', text: 'No previous iCloud backup found. New entries will back up automatically.', at: null });
            }
          } catch (e) {
            if (!cancelled) setCloudStatus({ state: 'error', text: e?.message || 'Could not check iCloud. Local tracking still works.', at: null });
          }
        }
      } catch (e) {
        if (!cancelled) setSavedError('Saved data could not be read. No changes have been made.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (loading || !data) return;
    const snapshot = data;
    const json = JSON.stringify(snapshot);
    // Serialize local writes to prevent a slow earlier write replacing a newer one.
    persistQueueRef.current = persistQueueRef.current.catch(() => {}).then(async () => {
      await AsyncStorage.setItem(STORAGE_KEY, json);
      if (dataRef.current === snapshot) scheduleCloudBackup();
    }).catch(() => setSavedError('Could not save changes on this device. iCloud backup is paused until the local save works.'));
  }, [data, loading]);
  async function retryCloudRecoveryWhenEmpty() {
    if (loadingRef.current || dataRef.current || recoveryRunningRef.current) return;
    recoveryRunningRef.current = true;
    try {
      const recovered = await recoverAutomaticBackup(readBackup);
      if (recovered && !dataRef.current) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recovered));
        if (!dataRef.current) {
          setData(recovered);
          setCloudStatus({ state: 'restored', text: 'Recovered an existing iCloud backup automatically.', at: null });
        }
      }
    } catch (e) {
      if (!dataRef.current) setCloudStatus({ state: 'error', text: e?.message || 'Could not retry iCloud recovery.', at: null });
    } finally { recoveryRunningRef.current = false; }
  }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && !loadingRef.current) {
        setActiveDay(today());
        if (dataRef.current) scheduleCloudBackup(200);
        else retryCloudRecoveryWhenEmpty();
      }
    });
    const retry = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      setActiveDay(today());
      if (dataRef.current && cloudStatusRef.current.state === 'error') scheduleCloudBackup(200);
      if (!dataRef.current && cloudStatusRef.current.state === 'error') retryCloudRecoveryWhenEmpty();
    }, 5 * 60 * 1000);
    return () => {
      subscription.remove(); clearInterval(retry);
      if (backupTimerRef.current) clearTimeout(backupTimerRef.current);
    };
  }, []);
  const update = (fn) => setData(previous => fn(previous));
  const now = today();
  const accounts = data?.accounts || [];
  const transactions = data?.transactions || [];
  const schedules = data?.schedules || [];
  const categories = data?.categories || defaultCategories();
  const incomeCategories = data?.incomeCategories || defaultIncomeCategories();
  const categoryColor = name => categories.find(c => c.name === name)?.color || CATEGORY_COLORS[name] || C.blue;
  const categoryIcon = t => t.type === 'transfer' ? CATEGORY_ICONS.Transfer :
    (t.type === 'income' ? incomeCategories : categories).find(c => c.name === t.category)?.icon
      || CATEGORY_ICONS[t.category] || (t.type === 'income' ? '💰' : '📦');
  useEffect(() => {
    if (loading || !data?.autoPostPlannedExpenses) return;
    const firstDay = `${activeDay.slice(0,7)}-01`;
    setData(previous => {
      if (!previous?.autoPostPlannedExpenses) return previous;
      return postPlannedMonth(previous, firstDay);
    });
  }, [loading, data, activeDay]);
  const balance = netWorth(accounts, transactions);
  const creditDebt = accounts.filter(a => a.kind === 'Credit Card').reduce((sum, a) => sum + Math.max(0, accountBalance(a, transactions)), 0);
  const range = period === 'year' ? [`${now.slice(0, 4)}-01-01`, now] : period === 'custom' ? appliedCustom : period === 'week' ? [weekStart(now), now] : [`${now.slice(0,7)}-01`, now];
  const prevRange = previousRange(range[0], range[1]);
  const prevTotals = periodTotals(transactions, ...prevRange);
  const totals = periodTotals(transactions, range[0], range[1]);
  const groups = categoryTotals(transactions, range[0], range[1]);
  const scheduled = schedules.map(s => ({ ...s, due: dueDate(s, now) })).filter(s => s.due).sort((a,b) => a.due.localeCompare(b.due));
  const accountName = id => accounts.find(a => a.id === id)?.name || 'Deleted account';
  const searchResults = filteredTransactions(recentSort(transactions), { type: filter, query: searchQuery, start: searchStart, end: searchEnd, accountId: searchAccount, category: searchCategory, minAmount:searchMin, maxAmount:searchMax }, accounts);
  const activityGroups = groupActivity(searchResults);
  const searchCategories = [...new Set([...categories.map(c=>c.name), ...incomeCategories.map(c=>c.name), ...transactions.map(t=>t.category)])].filter(Boolean);
  const insightSeries = spendingSeries(transactions, ...range);
  const topTransaction = [...transactions].filter(t => t.type === 'expense' && t.date >= range[0] && t.date <= range[1]).sort((a,b)=>b.amountCents-a.amountCents)[0];
  const expenseChange = prevTotals.expenses ? Math.round((totals.expenses - prevTotals.expenses) / prevTotals.expenses * 100) : null;
  const recent = recentSort(transactions);
  const series = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const marker = monthOffset(`${now.slice(0,7)}-01`, i - 5);
    const [start, end] = getPeriod(marker, 'month');
    return { key: marker, label: parseDate(marker).toLocaleDateString('en-AU', { month: 'short' }), value: periodTotals(transactions, start, end).expenses, highlight: i === 5 };
  }), [transactions, now]);

  function openTransaction(t = null, preset = null) {
    setModal('transaction'); setEditingId(t?.id || null); setError('');
    setDraft(t ? { ...t, time: t.time || '', amount: (t.amountCents / 100).toFixed(2) } : {
      type: 'expense', date: today(), time: timeNow(), accountId: accounts[0]?.id, toAccountId: accounts[1]?.id,
      amount: '', category: categories[0]?.name || 'Other', description: '', ...preset,
    });
  }
  function openAccount(a = null) {
    setModal('account'); setEditingId(a?.id || null); setError('');
    setDraft(a ? { ...a, opening: (a.openingCents / 100).toFixed(2), creditLimit: ((a.creditLimitCents || 0) / 100).toFixed(2) } : { name: '', kind: 'Bank', opening: '0.00', creditLimit: '0.00', color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length] });
  }
  function goToSettings(page = 'menu') { setSettingsPage(page); setTab('settings'); }
  function openCategory(c = null, kind = settingsPage === 'income' ? 'income' : 'expense') {
    setModal('category'); setEditingId(c?.name || null); setError('');
    setDraft(c ? {...c, categoryType:kind} : { name:'', categoryType:kind, icon:kind==='income'?'💰':'📦' });
  }
  function applyCustom() {
    if (!parseDate(insightStart) || !parseDate(insightEnd) || insightStart > insightEnd) return setInsightError('Enter valid start/end dates (YYYY-MM-DD), with start on or before end.');
    setAppliedCustom([insightStart, insightEnd]); setPeriod('custom'); setInsightError('');
  }
  function clearSearch() {
    setFilter('all'); setSearchQuery(''); setSearchStart(''); setSearchEnd(''); setSearchMin(''); setSearchMax(''); setSearchAccount('all'); setSearchCategory('all');
  }
  function openSchedule(s = null) {
    setModal('schedule'); setEditingId(s?.id || null); setError('');
    setDraft(s ? { ...s, kind: s.kind || 'expense', amount: (s.amountCents / 100).toFixed(2) } : { kind: plannedView === 'income' ? 'income' : 'expense', name: '', amount: '', accountId: accounts[0]?.id, toAccountId: accounts.find(a => a.kind === 'Credit Card')?.id, category: plannedView === 'income' ? incomeCategories[0]?.name || 'Other' : 'Bills', startDate: now, repeat: 'Monthly' });
  }
  function closeModal() { setModal(null); setError(''); }
  function saveTransaction() {
    const cents = parseAmount(draft.amount || '');
    if (!cents) return setError('Enter a positive amount, with up to two decimal places.');
    if (!parseDate(draft.date)) return setError('Use a valid date, e.g. 2026-11-04.');
    if (!parseTime(draft.time) && !(editingId && !draft.time)) return setError('Enter the time in 24-hour format HH:mm (e.g. 14:35).');
    if (!accounts.some(a => a.id === draft.accountId)) return setError('Choose an account.');
    if (!['expense','income','transfer'].includes(draft.type)) return setError('Choose a transaction type.');
    if (draft.type === 'transfer' && (!accounts.some(a => a.id === draft.toAccountId) || draft.toAccountId === draft.accountId)) return setError('Choose a different destination account.');
    if (draft.type === 'expense' && !categories.some(c => c.name === draft.category)) return setError('Choose a spending category.');
    if (draft.type === 'income' && !incomeCategories.some(c=>c.name === draft.category)) return setError('Choose an income category.');
    const tx = { id: editingId || uid(), type: draft.type, date: draft.date, time: parseTime(draft.time) || null,
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
    if (editingId) {
      const original = accounts.find(a => a.id === editingId);
      if (original && (original.kind === 'Credit Card') !== (draft.kind === 'Credit Card') && (transactions.some(t => t.accountId === editingId || t.toAccountId === editingId) || schedules.some(t => t.accountId === editingId || t.toAccountId === editingId))) return setError('Cannot change this account between credit card and asset after transactions exist. Create a new account instead.');
    }
    const rawLimit = String(draft.creditLimit || '0').trim().replace(/[$,\s]/g, '');
    if (draft.kind === 'Credit Card' && !/^\d+(?:\.\d{1,2})?$/.test(rawLimit)) return setError('Use a valid credit limit.');
    const creditLimitCents = draft.kind === 'Credit Card' ? Math.round(Number(rawLimit) * 100) : 0;
    if (!Number.isSafeInteger(creditLimitCents)) return setError('Credit limit is too large.');
    const account = { id: editingId || uid(), name, kind: draft.kind, openingCents: cents, creditLimitCents, color: draft.color };
    update(d => ({ ...d, accounts: editingId ? d.accounts.map(a => a.id === editingId ? account : a) : [...d.accounts, account] }));
    closeModal();
  }
  function saveSchedule() {
    const cents = parseAmount(draft.amount || '');
    if (!String(draft.name || '').trim()) return setError('Give this planned expense a name.');
    if (!cents) return setError('Enter a positive amount.');
    if (!parseDate(draft.startDate)) return setError('Use a valid due date, e.g. 2026-11-04.');
    if (!accounts.some(a => a.id === draft.accountId)) return setError('Choose an account.');
    const kind = draft.kind || 'expense';
    if (kind === 'card_payment' && (!accounts.some(a => a.id === draft.accountId && a.kind !== 'Credit Card') || !accounts.some(a => a.id === draft.toAccountId && a.kind === 'Credit Card'))) return setError('Choose a payment account and a credit card.');
    if (kind === 'expense' && !categories.some(c => c.name === draft.category)) return setError('Choose an expense category.');
    if (kind === 'income' && !incomeCategories.some(c => c.name === draft.category)) return setError('Choose an income category.');
    const scheduledPayment = { id: editingId || uid(), kind, name: String(draft.name).trim(), amountCents: cents,
      category: kind === 'card_payment' ? 'Transfer' : draft.category, accountId: draft.accountId, toAccountId: kind === 'card_payment' ? draft.toAccountId : null, repeat: draft.repeat, startDate: draft.startDate,
      lastPaidThrough: editingId ? draft.lastPaidThrough : null, completed: editingId ? draft.completed : false };
    update(d => ({ ...d, schedules: editingId ? d.schedules.map(s => s.id === editingId ? scheduledPayment : s) : [...d.schedules, scheduledPayment] }));
    closeModal();
  }
  function saveCategory() {
    const name = String(draft.name || '').trim();
    const kind = draft.categoryType === 'income' ? 'income' : 'expense';
    const current = kind === 'income' ? incomeCategories : categories;
    const key = kind === 'income' ? 'incomeCategories' : 'categories';
    if (!name) return setError('Enter a category name.');
    if (name.length > 30) return setError('Keep category names under 31 characters.');
    if (editingId === 'Other' && name !== 'Other') return setError('Other is the fallback category and cannot be renamed.');
    if (current.some(c => c.name.toLowerCase() === name.toLowerCase() && c.name !== editingId)) return setError('A category with this name already exists.');
    if (!ICON_CHOICES.includes(draft.icon)) return setError('Choose a category icon.');
    update(d => ({ ...d,
      [key]: editingId ? d[key].map(c => c.name === editingId ? {...c,name,icon:draft.icon} : c)
        : [...d[key], {name,icon:draft.icon,...(kind==='expense'?{color:CATEGORY_COLORS[name] || C.blue}:{})}],
      transactions: editingId && name !== editingId ? d.transactions.map(t => t.type === kind && t.category === editingId ? {...t,category:name} : t) : d.transactions,
      schedules: editingId && name !== editingId ? d.schedules.map(t => (t.kind || 'expense') === kind && t.category === editingId ? {...t,category:name} : t) : d.schedules,
    }));
    closeModal();
  }
  function removeCategory(name, kind = settingsPage === 'income' ? 'income' : 'expense') {
    if (name === 'Other') return Alert.alert('Required category', 'Other is kept as a fallback.');
    const key = kind === 'income' ? 'incomeCategories' : 'categories';
    Alert.alert('Delete category?', `Existing ${kind} transactions and plans in ${name} will be moved to Other.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete and reassign', style: 'destructive', onPress: () => update(d => ({ ...d,
        [key]:d[key].filter(c=>c.name !== name),
        transactions:d.transactions.map(t=>t.type === kind && t.category === name ? {...t,category:'Other'} : t),
        schedules:d.schedules.map(t=>(t.kind || 'expense') === kind && t.category === name ? {...t,category:'Other'} : t),
      })) },
    ]);
  }
  function confirmRemove(type, id) {
    const field = type === 'transaction' ? 'transactions' : type === 'account' ? 'accounts' : 'schedules';
    if (type === 'account' && (transactions.some(t => t.accountId === id || t.toAccountId === id) || schedules.some(s => s.accountId === id || s.toAccountId === id))) {
      Alert.alert('Account in use', 'Delete or move its transactions and scheduled expenses first.'); return;
    }
    Alert.alert('Delete this item?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { update(d => ({ ...d, [field]: d[field].filter(item => item.id !== id) })); if (modal === 'transaction' || modal === 'schedule') closeModal(); } },
    ]);
  }
  function recordPayment(s) {
    Alert.alert('Record payment?', `${s.name}: ${money(s.amountCents)}. This will add ${s.kind === 'card_payment' ? 'an internal transfer (not an expense)' : s.kind === 'income' ? 'income' : 'an expense'} dated today and advance the schedule.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Record', onPress: () => update(d => applyRecordedPayment(d, s, today())) },
    ]);
  }
  function postThisMonth() {
    const monthStart = `${today().slice(0,7)}-01`;
    const pending = schedules.flatMap(s=>pendingOccurrencesInMonth(s,monthStart));
    const remaining = pending.length;
    if (!remaining) return Alert.alert('Nothing to post', 'All this month’s eligible planned expenses have already been recorded, or there are none.');
    Alert.alert('Record this month’s planned expenses?',
      `${remaining} planned expense occurrence(s) will be recorded now, each dated on its own scheduled day in ${monthStart.slice(0, 7)}. Future-dated entries will appear under their due dates in Activity and affect projected balances.`, [
      {text:'Cancel',style:'cancel'},
      {text:'Record expenses',onPress:()=>update(d=>postPlannedMonth(d,monthStart))},
    ]);
  }
  function resetAll() {
    Alert.alert('Clear all records?', 'This removes the accounts, transactions and planned payments from this device. The new empty ledger will also be saved to iCloud automatically; prior snapshots may remain in iCloud. This cannot be undone in the app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear records', style: 'destructive', onPress: () => {
        // Never remove the storage key: that would trigger a cloud restore after restart.
        setData(empty()); setSavedError(''); setTab('home');
      } },
    ]);
  }

  if (loading) return <SafeAreaView style={styles.screen}><ActivityIndicator style={{ flex: 1 }} size="large" color={C.blue} /></SafeAreaView>;
  if (!data) return <SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content"/><View style={styles.onboarding}>
    <Text style={{ fontSize: 43, marginBottom: 12 }}>◈</Text><Text style={styles.brand}>Pocket Ledger</Text>
    <Text style={[styles.subtleCenter, { fontSize: 16, marginTop: 12, marginBottom: 32 }]}>Know where your money goes. Track accounts, record spending, and view simple, clear insights.</Text>
    {savedError ? <Text style={{ color: C.red, marginBottom: 12 }}>{savedError}</Text> : null}
    {cloudStatus.state === 'error' ? <Text style={[styles.helper, { textAlign: 'center', color: C.red, marginBottom: 14 }]}>{cloudStatus.text}</Text> : null}
    <Button title="Start with empty accounts" onPress={() => setData(empty())} />
    <View style={{ height: 12 }}/><Button title="Explore with fictional demo data" secondary onPress={() => setData(demo())} />
    <Text style={[styles.helper, { textAlign: 'center', marginTop: 22 }]}>Automatic iCloud recovery is checked when you first open the app. iCloud backup requires a properly signed iOS build; local tracking still works without it.</Text>
    <Text style={[styles.helper, { textAlign: 'center', marginTop: 12 }]}>No bank login · AUD</Text>
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content"/>
    <ScrollView ref={pageScrollRef} contentContainerStyle={[styles.page, tab === 'transactions' && styles.activityPage]} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={{flex:1}}>
        {tab === 'settings' && settingsPage !== 'menu'
          ? <Pressable accessibilityRole="button" accessibilityLabel="Back to all settings" onPress={()=>setSettingsPage('menu')}><Text style={styles.settingsBack}>‹ All settings</Text></Pressable>
          : <Text style={styles.eyebrow}>POCKET LEDGER {data.mode === 'demo' ? '· DEMO' : ''}</Text>}
        <Text style={styles.pageTitle}>{tab === 'settings' ? SETTINGS_TITLES[settingsPage] : NAV.find(n => n[0] === tab)?.[2]}</Text>
      </View><View style={styles.avatar}><Text style={{ fontSize: 23, color: C.blue }}>◈</Text></View></View>
      {savedError ? <Text style={styles.errorBanner}>{savedError}</Text> : null}
      {data.mode === 'demo' ? <View style={styles.demoBanner}><Text style={styles.demoText}>Fictional demo data. Erase it in Accounts before tracking your own finances.</Text></View> : null}
      {tab === 'home' && <>
        <View style={styles.hero}><Text style={styles.heroSmall}>NET WORTH (ASSETS LESS CARD DEBT)</Text><Text style={styles.heroBig} adjustsFontSizeToFit numberOfLines={1}>{money(balance)}</Text><Text style={styles.heroHint}>{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} · credit card debt: {money(creditDebt)}</Text>
          <View style={styles.heroDivider}/><View style={styles.metricsRow}><Metric label="This month in" value={money(periodTotals(transactions, ...getPeriod(now, 'month')).income)} color="#9AE6C6"/><Metric label="This month out" value={money(periodTotals(transactions, ...getPeriod(now, 'month')).expenses)} color="#FFBAC8"/></View>
        </View>
        <View style={styles.quickRow}><Button title="+ Add transaction" onPress={() => accounts.length ? openTransaction() : openAccount()} /><Button title="+ Add account" secondary onPress={() => openAccount()}/></View>
        <View style={styles.card}><SectionTitle side={<Text style={styles.smallLink} onPress={() => setTab('analytics')}>View insights ›</Text>}>Spending trend</SectionTitle><Chart series={series}/></View>
        <View style={styles.card}><SectionTitle side={<Text style={styles.smallLink} onPress={() => setTab('schedule')}>View planned ›</Text>}>Upcoming payments</SectionTitle>
          {!scheduled.length ? <EmptyMessage title="Nothing planned" detail="Add a recurring or one-off expense." /> : scheduled.slice(0,3).map(s => <View key={s.id} style={styles.miniRow}><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{s.name}</Text><Text style={styles.rowSubtitle}>{s.due} · {s.repeat}</Text></View><Text style={styles.rowAmount}>{money(s.amountCents)}</Text></View>)}
        </View>
        <View style={styles.card}><SectionTitle side={<Text style={styles.smallLink} onPress={() => setTab('transactions')}>All activity ›</Text>}>Recent transactions</SectionTitle>{!recent.length ? <EmptyMessage title="No transactions yet" detail="Record your first expense or income."/> : recent.slice(0,4).map(t => <TxRow key={t.id} t={t} icon={categoryIcon(t)} accountName={accountName(t.accountId)} destinationName={accountName(t.toAccountId)} onEdit={() => openTransaction(t)}/>)}</View>
      </>}
      {tab === 'transactions' && <>
        <View style={styles.activityToolbar}>
          <TextInput value={searchQuery} onChangeText={setSearchQuery} style={styles.searchInput}
            placeholder="Search description, account, date, amount..." placeholderTextColor="#9FA9BA"
            accessibilityLabel="Search all transactions" autoCapitalize="none" />
          <Button title="+ New" small onPress={() => accounts.length ? openTransaction() : openAccount()}/>
        </View>
        <View style={styles.filterRow}>{[['all','All'],['expense','Spending'],['income','Income'],['transfer','Transfers']].map(([k,l]) => <Pill compact key={k} title={l} active={filter === k} onPress={() => setFilter(k)}/>)}</View>
        <View style={styles.activityMeta}>
          <Text style={styles.activityCount}>{searchResults.length} of {transactions.length} transactions · tap to edit</Text>
          <Text style={styles.smallLink} onPress={() => setShowAdvancedSearch(x=>!x)}>{showAdvancedSearch ? 'Less filters' : 'More filters'}</Text>
          <Text style={styles.smallLink} onPress={clearSearch}>Clear</Text>
        </View>
        {showAdvancedSearch ? <View style={styles.card}>
          <LabeledInput label="From (YYYY-MM-DD)" value={searchStart} onChangeText={setSearchStart} placeholder="Optional start date"/>
          <LabeledInput label="To (YYYY-MM-DD)" value={searchEnd} onChangeText={setSearchEnd} placeholder="Optional end date"/>
          {(searchStart && !parseDate(searchStart) || searchEnd && !parseDate(searchEnd) || searchStart && searchEnd && parseDate(searchStart) && parseDate(searchEnd) && searchStart > searchEnd) ? <Text style={styles.errorBanner}>Enter valid dates with start no later than end. Invalid date fields are not applied.</Text> : null}
          <LabeledInput label="Minimum amount (AUD)" value={searchMin} onChangeText={setSearchMin} keyboardType="decimal-pad" placeholder="Optional minimum"/>
          <LabeledInput label="Maximum amount (AUD)" value={searchMax} onChangeText={setSearchMax} keyboardType="decimal-pad" placeholder="Optional maximum"/>
          {((searchMin && parseFilterAmount(searchMin) === null) || (searchMax && parseFilterAmount(searchMax) === null) || (searchMin && searchMax && parseFilterAmount(searchMin) !== null && parseFilterAmount(searchMax) !== null && parseFilterAmount(searchMin) > parseFilterAmount(searchMax))) ? <Text style={styles.errorBanner}>Enter valid amounts with minimum no greater than maximum. Invalid amounts are not applied.</Text> : null}
          <Text style={styles.fieldLabel}>Account (including transfers)</Text><View style={styles.chips}><Pill title="All accounts" active={searchAccount==='all'} onPress={()=>setSearchAccount('all')}/>{accounts.map(a=><Pill key={a.id} title={a.name} active={searchAccount===a.id} onPress={()=>setSearchAccount(a.id)}/>)}</View>
          <Text style={styles.fieldLabel}>Category</Text><View style={styles.chips}><Pill title="All categories" active={searchCategory==='all'} onPress={()=>setSearchCategory('all')}/>{searchCategories.map(c=><Pill key={c} title={c} active={searchCategory===c} onPress={()=>setSearchCategory(c)}/>)}</View>
        </View> : null}
        <View style={styles.activityList}>
          {!searchResults.length ? <EmptyMessage title="No matching transactions" detail="Change the filters or add an entry." /> : activityGroups.map(group =>
            <ActivityDay key={group.date} group={group} onEdit={openTransaction} accountName={accountName} categoryIcon={categoryIcon}/>) }
        </View>
      </>}
      {tab === 'schedule' && <>
        <View style={styles.toolbar}><Text style={[styles.subtle, { flex: 1 }]}>See upcoming payments, income and repayments. Tap an entry to edit.</Text><Button title="Manage" small onPress={()=>goToSettings('planned')}/></View>
        <View style={styles.filterRow}>{[['all','All'],['expense','Expenses'],['income','Income'],['card_payment','Card repayments']].map(([k,label])=><Pill compact key={k} title={label} active={plannedView===k} onPress={()=>setPlannedView(k)}/>)}</View>
        <View style={styles.card}><SectionTitle>Upcoming and overdue</SectionTitle>
          {!scheduled.filter(s=>plannedView==='all'||(s.kind||'expense')===plannedView).length ? <EmptyMessage title="No planned entries" detail="Add income, expenses or a card repayment plan." /> : scheduled.filter(s=>plannedView==='all'||(s.kind||'expense')===plannedView).map(s =>
            <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Edit planned ${s.name}`} onPress={()=>openSchedule(s)} style={styles.scheduleRow}>
              <View style={styles.txIcon}><Text style={{fontSize:18}}>{categoryIcon({type:s.kind==='card_payment'?'transfer':s.kind||'expense',category:s.category})}</Text></View>
              <View style={{flex:1,minWidth:0}}><Text style={styles.rowTitle} numberOfLines={1}>{s.name}</Text><Text style={[styles.rowSubtitle,s.due<now&&{color:C.red}]} numberOfLines={2}>{s.due < now ? 'Overdue · ' : ''}{s.due} · {s.repeat} · {accountName(s.accountId)}</Text></View>
              <Text style={[styles.rowAmount,{color:s.kind==='income'?C.green:s.kind==='card_payment'?C.mute:C.red}]}>{s.kind==='income'?'+':s.kind==='card_payment'?'':'−'}{money(s.amountCents)}</Text>
            </Pressable>)}
        </View>
      </>}
      {tab === 'analytics' && <>
        <View style={styles.filterRow}>
          <Pill title="This week" active={period === 'week'} onPress={() => setPeriod('week')}/>
          <Pill title="This month" active={period === 'month'} onPress={() => setPeriod('month')}/>
          <Pill title="This year" active={period === 'year'} onPress={() => setPeriod('year')}/>
          <Pill title="Custom dates" active={period === 'custom'} onPress={() => { setPeriod('custom'); setInsightError(''); }}/>
        </View>
        {period === 'custom' ? <View style={styles.card}>
          <LabeledInput label="Start date (YYYY-MM-DD)" value={insightStart} onChangeText={setInsightStart}/>
          <LabeledInput label="End date (YYYY-MM-DD)" value={insightEnd} onChangeText={setInsightEnd}/>
          <Button title="Apply date range" onPress={applyCustom}/>
          {insightError ? <Text style={styles.errorBanner}>{insightError}</Text> : null}
        </View> : null}
        <View style={styles.card}><Text style={styles.subtle}>{range[0]} to {range[1]}</Text><View style={[styles.metricsRow, { marginTop: 18 }]}><Metric label="Income" value={money(totals.income)} color={C.green}/><Metric label="Expenses" value={money(totals.expenses)} color={C.red}/></View><View style={styles.lightDivider}/><View style={styles.metricsRow}><Metric label="Net cash flow" value={money(totals.net)} color={totals.net >= 0 ? C.green : C.red}/><Metric label="Savings rate" value={totals.income > 0 ? `${Math.round(totals.net/totals.income*100)}%` : '—'} /></View></View>
        <View style={styles.card}><SectionTitle>Spending over selected period</SectionTitle><Chart series={insightSeries}/><Text style={styles.helper}>Recorded expenses include card purchases. Transfers, card repayments and unpaid schedules are excluded.</Text></View>
        <View style={styles.card}><SectionTitle>By category</SectionTitle>
          {!groups.length ? <EmptyMessage title="No expenses for this period" detail="Record an expense to see the breakdown." /> : groups.map(([name, cents]) => <View key={name} style={{ marginBottom: 18, gap: 7 }}><View style={styles.between}><Text style={styles.rowTitle}>{name}</Text><Text style={styles.rowAmount}>{money(cents)} · {Math.round(cents / Math.max(1, totals.expenses) * 100)}%</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${cents / Math.max(1, totals.expenses) * 100}%`, backgroundColor: categoryColor(name) }]}/></View></View>)}
        </View>
        <View style={styles.card}><SectionTitle>Insights</SectionTitle>
          <Text style={styles.summary}>{totals.expenses ? `You spent ${money(totals.expenses)} between ${range[0]} and ${range[1]}. Your largest category was ${groups[0]?.[0]} (${money(groups[0]?.[1] || 0)}).` : 'You have no recorded expenses in this period.'}</Text>
          <Text style={styles.summary}>{expenseChange === null ? `Previous equivalent period: ${money(prevTotals.expenses)} in expenses.` : `Compared with the previous equivalent period (${prevRange[0]} to ${prevRange[1]}), your spending ${expenseChange > 0 ? `increased ${expenseChange}%` : expenseChange < 0 ? `decreased ${Math.abs(expenseChange)}%` : 'was unchanged'}.`}</Text>
          {topTransaction ? <Text style={styles.summary}>Largest single expense: {money(topTransaction.amountCents)} for {topTransaction.description} ({topTransaction.date}).</Text> : null}
          <Text style={styles.helper}>These are rule-based summaries of manually entered data, not financial advice.</Text>
        </View>
      </>}
      {tab === 'accounts' && <>
        <View style={styles.toolbar}><Text style={[styles.subtle,{flex:1}]}>Asset balances less credit card amounts owed = net worth.</Text><Button title="Manage" small onPress={()=>goToSettings('accounts')}/></View>
        {!accounts.length ? <View style={styles.card}><EmptyMessage title="Add your first account" detail="Start with a bank, savings, cash or credit card account."/></View> : accounts.map(a => {
          const current = accountBalance(a, transactions);
          const card = a.kind === 'Credit Card';
          const remainingCredit = (a.creditLimitCents || 0) - current;
          return <View style={styles.accountCard} key={a.id}>
            <View style={styles.between}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flex:1 }}><View style={[styles.accountLogo, { backgroundColor: a.color }]}><Text style={{ color:'#fff', fontWeight:'800', fontSize:21 }}>{a.name.slice(0,1).toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{a.name}</Text><Text style={styles.rowSubtitle}>{a.kind}{card ? (current >= 0 ? ' · owed' : ' · credit balance') : ' account'}</Text></View></View>
              <Text style={styles.accountMoney} numberOfLines={1} adjustsFontSizeToFit>{money(card ? Math.abs(current) : current)}</Text>
            </View>
            {card && a.creditLimitCents > 0 ? <Text style={[styles.helper, {marginTop:10}]}>Credit limit: {money(a.creditLimitCents)} · Available: {money(Math.max(0, remainingCredit))}{remainingCredit < 0 ? ' · Over limit' : ''}</Text> : null}
            <View style={styles.lightDivider}/>
            <View style={styles.between}><Text style={styles.helper}>{card ? 'Opening owed' : 'Opening balance'}: {money(a.openingCents)}</Text><View style={{ flexDirection:'row', gap:14 }}>
              {card && accounts.some(b => b.kind !== 'Credit Card') ? <Text style={styles.inlineAction} onPress={() => openTransaction(null, { type:'transfer', accountId: accounts.find(b=>b.kind !== 'Credit Card').id, toAccountId:a.id, category:'Transfer', description:`Payment to ${a.name}` })}>Repay</Text> : null}
              <Text style={styles.inlineAction} onPress={()=>goToSettings('accounts')}>Settings ›</Text>
            </View></View>
          </View>;
        })}
      </>}
      {tab === 'settings' && <>
        {settingsPage === 'menu' && <View style={styles.card}>
          <Text style={styles.subtle}>Choose what you'd like to adjust. Each item opens its own settings screen.</Text>
          <SettingsMenuRow icon="📅" title="Planned expenses & income" detail={`${schedules.length} plans · monthly posting options`} onPress={()=>setSettingsPage('planned')}/>
          <SettingsMenuRow icon="🛒" title="Spending categories" detail={`${categories.length} categories · names and icons`} onPress={()=>setSettingsPage('expenses')}/>
          <SettingsMenuRow icon="💼" title="Income categories" detail={`${incomeCategories.length} categories · names and icons`} onPress={()=>setSettingsPage('income')}/>
          <SettingsMenuRow icon="🏦" title="Accounts" detail={`${accounts.length} accounts · add, edit or remove`} onPress={()=>setSettingsPage('accounts')}/>
          <SettingsMenuRow icon="☁️" title="Automatic iCloud backup" detail="Backup status and recovery information" onPress={()=>setSettingsPage('backup')}/>
          <SettingsMenuRow icon="🔒" title="Privacy & data" detail="Data storage and clear-all controls" onPress={()=>setSettingsPage('privacy')}/>
        </View>}
        {settingsPage === 'planned' && <>
          <View style={styles.card}>
            <SectionTitle>Record planned expenses in advance</SectionTitle>
            <Text style={styles.subtle}>Pre-record expenses due this month, keeping every transaction on its original scheduled date. Income and credit-card repayments are not automatically recorded.</Text>
            <Pressable accessibilityRole="switch" accessibilityState={{checked:!!data.autoPostPlannedExpenses}}
              onPress={()=>update(d=>({...d,autoPostPlannedExpenses:!d.autoPostPlannedExpenses}))} style={styles.between}>
              <Text style={[styles.rowTitle,{flex:1}]}>Automatically record at month start</Text>
              <Text style={[styles.toggleBadge,{backgroundColor:data.autoPostPlannedExpenses?C.green:'#DCE1EB'}]}>{data.autoPostPlannedExpenses?'ON':'OFF'}</Text>
            </Pressable>
            <Text style={styles.helper}>When enabled, the app records the month's remaining planned expenses when opened (even after the 1st), preserving their due dates. It does not run while iOS fully suspends the app.</Text>
            <Button title="Record this month's planned expenses now" secondary small onPress={postThisMonth}/>
          </View>
          <View style={styles.card}>
            <SectionTitle side={<Button title="+ New plan" small onPress={()=>accounts.length ? openSchedule() : openAccount()}/>}>Manage planned entries</SectionTitle>
            <Text style={styles.subtle}>Tap a plan to adjust its amount, due date, recurrence, category or account, or delete it in the editor.</Text>
            {!schedules.length ? <EmptyMessage title="No plans yet" detail="Add planned expenses, income or credit-card repayments."/> :
              [...schedules].sort((a,b)=>a.startDate.localeCompare(b.startDate)).map(s=>
                <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Edit planned ${s.name}`} onPress={()=>openSchedule(s)} style={styles.scheduleRow}>
                  <View style={styles.txIcon}><Text style={{fontSize:18}}>{categoryIcon({type:s.kind==='card_payment'?'transfer':s.kind||'expense',category:s.category})}</Text></View>
                  <View style={{flex:1,minWidth:0}}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.rowSubtitle} numberOfLines={2}>{s.completed ? 'Completed' : (dueDate(s,now) || s.startDate)} · {s.repeat} · {accountName(s.accountId)}</Text>
                  </View>
                  <Text style={styles.settingsChevron}>›</Text>
                </Pressable>)}
          </View>
        </>}
        {settingsPage === 'expenses' && <View style={styles.card}>
          <SectionTitle side={<Button title="+ Add" small onPress={()=>openCategory(null,'expense')}/>}>Spending categories</SectionTitle>
          <Text style={styles.subtle}>Tap to rename or choose an icon. Changes update matching expenses and planned payments.</Text>
          {categories.map(c=><Pressable key={c.name} accessibilityRole="button" onPress={()=>openCategory(c,'expense')} style={styles.miniRow}>
            <Text style={styles.categoryEmoji}>{c.icon || CATEGORY_ICONS[c.name] || '📦'}</Text>
            <Text style={[styles.rowTitle,{flex:1}]}>{c.name}</Text>
            <Text style={styles.settingsChevron}>›</Text>
          </Pressable>)}
        </View>}
        {settingsPage === 'income' && <View style={styles.card}>
          <SectionTitle side={<Button title="+ Add" small onPress={()=>openCategory(null,'income')}/>}>Income categories</SectionTitle>
          <Text style={styles.subtle}>Tap to rename or choose an icon. Changes update matching income and planned income.</Text>
          {incomeCategories.map(c=><Pressable key={c.name} accessibilityRole="button" onPress={()=>openCategory(c,'income')} style={styles.miniRow}>
            <Text style={styles.categoryEmoji}>{c.icon || CATEGORY_ICONS[c.name] || '💰'}</Text>
            <Text style={[styles.rowTitle,{flex:1}]}>{c.name}</Text>
            <Text style={styles.settingsChevron}>›</Text>
          </Pressable>)}
        </View>}
        {settingsPage === 'accounts' && <View style={styles.card}>
          <SectionTitle side={<Button title="+ Add" small onPress={()=>openAccount()}/>}>Manage accounts</SectionTitle>
          <Text style={styles.subtle}>Add or edit bank, savings, cash and credit-card accounts. An account in use cannot be deleted.</Text>
          {!accounts.length ? <EmptyMessage title="No accounts" detail="Add an account to track income and expenses."/> : accounts.map(a=><View key={a.id} style={styles.miniRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${a.name} account`} onPress={()=>openAccount(a)} style={{flex:1,flexDirection:'row',gap:12,alignItems:'center'}}>
              <View style={[styles.accountLogo,{width:34,height:34,borderRadius:10,backgroundColor:a.color}]}><Text style={{color:'#fff',fontWeight:'800'}}>{a.name.slice(0,1).toUpperCase()}</Text></View>
              <View style={{flex:1,minWidth:0}}><Text style={styles.rowTitle} numberOfLines={1}>{a.name}</Text><Text style={styles.rowSubtitle}>{a.kind}</Text></View>
              <Text style={styles.smallLink}>Edit ›</Text>
            </Pressable>
            <Text accessibilityRole="button" style={[styles.inlineAction,{color:C.red,marginLeft:14}]} onPress={()=>confirmRemove('account',a.id)}>Delete</Text>
          </View>)}
        </View>}
        {settingsPage === 'backup' && <View style={styles.card}>
          <SectionTitle>Automatic iCloud backup</SectionTitle>
          <Text style={styles.summary}>{cloudStatus.text}</Text>
          {cloudStatus.at ? <Text style={styles.helper}>Last saved by the app: {new Date(cloudStatus.at).toLocaleString('en-AU')}</Text> : null}
          <Text style={styles.helper}>Backups occur while the app runs. A new installation attempts to recover the latest valid snapshot if no local ledger exists. This is not live multi-device sync.</Text>
          <Text style={styles.helper}>Backups are readable JSON in the app's private iCloud container and are not separately password-encrypted. A signed native iOS build is required.</Text>
        </View>}
        {settingsPage === 'privacy' && <View style={styles.card}>
          <SectionTitle>Privacy and data</SectionTitle>
          <Text style={styles.summary}>Records stay on this device and are backed up automatically when iCloud is available. No bank credentials or external app server are used.</Text>
          <Text style={styles.helper}>Clearing records removes local financial data and creates a new empty backup. Earlier iCloud snapshots may remain.</Text>
          <Button title="Clear all records" secondary onPress={resetAll}/>
        </View>}
      </>}
    </ScrollView>
    <View style={styles.tabBar}>{NAV.map(([key, icon, label]) => <Pressable key={key} onPress={() => { if (key === 'settings') setSettingsPage('menu'); setTab(key); }} style={styles.tabItem}><Text style={[styles.tabIcon, tab===key && {color:C.blue}]}>{icon}</Text><Text style={[styles.tabText, tab===key && {color:C.blue, fontWeight:'800'}]}>{label}</Text></Pressable>)}</View>
    <Modal visible={!!modal} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
      <SafeAreaView style={styles.modalScreen}><KeyboardAvoidingView style={{ flex:1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingId ? 'Edit' : 'New'} {modal === 'transaction' ? 'transaction' : modal === 'account' ? 'account' : modal === 'category' ? `${draft.categoryType==='income'?'income':'spending'} category` : 'planned payment'}</Text><Text onPress={closeModal} style={styles.close}>Close</Text></View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 55, gap: 20 }} keyboardShouldPersistTaps="handled">
          {modal === 'transaction' && <>
            <View style={styles.filterRow}>{[['expense','Expense'],['income','Income'],['transfer','Transfer']].map(([k,l]) => <Pill key={k} title={l} active={draft.type===k} onPress={() => setDraft(x => ({...x, type:k, category:k==='income'?incomeCategories[0]?.name || 'Other': k==='transfer'?'Transfer':categories[0]?.name || 'Other'}))}/>)}</View>
            <LabeledInput label="Amount (AUD)" value={draft.amount} onChangeText={amount => setDraft(x=>({...x,amount}))} placeholder="0.00" keyboardType="decimal-pad" />
            <LabeledInput label="Description" value={draft.description} onChangeText={description => setDraft(x=>({...x,description}))} placeholder="e.g. Weekly groceries" />
            <LabeledInput label="Date (YYYY-MM-DD)" value={draft.date} onChangeText={date => setDraft(x=>({...x,date}))} placeholder="2026-11-04" />
            <LabeledInput label="Time (HH:mm, 24-hour)" value={draft.time || ''} onChangeText={time => setDraft(x=>({...x,time}))}
              placeholder="e.g. 14:35" hint={editingId && !draft.time ? 'This older entry has no recorded time. Leave blank if unknown, or enter the actual time.' : 'Defaults to the local time when you opened New transaction; you can change it.'}/>

            <Text style={styles.fieldLabel}>{draft.type === 'transfer' ? 'From account' : 'Account'}</Text><View style={styles.chips}>{accounts.map(a=><Pill key={a.id} title={a.name} active={draft.accountId===a.id} onPress={()=>setDraft(x=>({...x,accountId:a.id}))}/>)}</View>
            {draft.type === 'transfer' ? <><Text style={styles.fieldLabel}>To account</Text><View style={styles.chips}>{accounts.filter(a=>a.id!==draft.accountId).map(a=><Pill key={a.id} title={a.name} active={draft.toAccountId===a.id} onPress={()=>setDraft(x=>({...x,toAccountId:a.id}))}/>)}</View><Text style={styles.helper}>Credit-card repayments should be transfers from your bank to the card, not expenses. Card purchases should be recorded as expenses on the card.</Text></> : <><Text style={styles.fieldLabel}>Category</Text><View style={styles.chips}>{(draft.type==='income'?incomeCategories.map(c=>c.name):categories.map(c=>c.name)).map(c=><Pill key={c} title={c} active={draft.category===c} onPress={()=>setDraft(x=>({...x,category:c}))}/>)}</View></>}
          </>}
          {modal === 'account' && <>
            <LabeledInput label="Account name" value={draft.name} onChangeText={name=>setDraft(x=>({...x,name}))} placeholder="e.g. Everyday" />
            <Text style={styles.fieldLabel}>Account type</Text><View style={styles.chips}>{['Bank','Savings','Cash','Credit Card'].map(kind=><Pill key={kind} title={kind} active={draft.kind===kind} onPress={()=>setDraft(x=>({...x,kind}))}/>)}</View>
            <LabeledInput label={draft.kind === 'Credit Card' ? 'Opening debt owed (AUD)' : 'Opening balance (AUD)'} value={draft.opening} onChangeText={opening=>setDraft(x=>({...x,opening}))} keyboardType="decimal-pad" hint={draft.kind === 'Credit Card' ? 'Amount already owed on this credit card before your first recorded transaction. Enter 0 if nothing is owed.' : 'Balance before your first recorded transaction. Use your balance before the first transaction you plan to enter.'} />
            {draft.kind === 'Credit Card' ? <LabeledInput label="Credit limit (AUD)" value={draft.creditLimit} onChangeText={creditLimit=>setDraft(x=>({...x,creditLimit}))} keyboardType="decimal-pad" hint="Optional: use 0 if you do not want to track available credit." /> : null}
            <Text style={styles.fieldLabel}>Colour</Text><View style={styles.chips}>{ACCOUNT_COLORS.map(color=><Pressable key={color} onPress={()=>setDraft(x=>({...x,color}))} style={[styles.colorDot,{backgroundColor:color,borderWidth:draft.color===color?4:0,borderColor:'#DAE0EF'}]}/>)}</View>
          </>}
          {modal === 'schedule' && <>
            <Text style={styles.fieldLabel}>Planned payment type</Text>
            <View style={styles.chips}>
              <Pill title="Expense" active={(draft.kind || 'expense')==='expense'} onPress={()=>setDraft(x=>({...x,kind:'expense',category:categories[0]?.name||'Other'}))}/>
              <Pill title="Income" active={draft.kind==='income'} onPress={()=>setDraft(x=>({...x,kind:'income',category:incomeCategories[0]?.name||'Other'}))}/>
              <Pill title="Card repayment" active={draft.kind==='card_payment'} onPress={()=>setDraft(x=>({...x,kind:'card_payment',accountId:accounts.find(a=>a.kind !== 'Credit Card')?.id,toAccountId:accounts.find(a=>a.kind === 'Credit Card')?.id}))}/>
            </View>
            <LabeledInput label="Name" value={draft.name} onChangeText={name=>setDraft(x=>({...x,name}))} placeholder="e.g. Rent" />
            <LabeledInput label="Amount (AUD)" value={draft.amount} onChangeText={amount=>setDraft(x=>({...x,amount}))} placeholder="0.00" keyboardType="decimal-pad" />
            <LabeledInput label="First due date (YYYY-MM-DD)" value={draft.startDate} onChangeText={startDate=>setDraft(x=>({...x,startDate}))}/>
            <Text style={styles.fieldLabel}>Repeat</Text><View style={styles.chips}>{REPEATS.map(repeat=><Pill key={repeat} title={repeat} active={draft.repeat===repeat} onPress={()=>setDraft(x=>({...x,repeat}))}/>)}</View>
            <Text style={styles.fieldLabel}>{draft.kind==='card_payment' ? 'Pay from account' : 'Account'}</Text><View style={styles.chips}>{accounts.filter(a=>draft.kind !== 'card_payment' || a.kind !== 'Credit Card').map(a=><Pill key={a.id} title={a.name} active={draft.accountId===a.id} onPress={()=>setDraft(x=>({...x,accountId:a.id}))}/>)}</View>
            {draft.kind === 'card_payment' ? <>
              <Text style={styles.fieldLabel}>Pay credit card</Text><View style={styles.chips}>{accounts.filter(a=>a.kind === 'Credit Card').map(a=><Pill key={a.id} title={a.name} active={draft.toAccountId===a.id} onPress={()=>setDraft(x=>({...x,toAccountId:a.id}))}/>)}</View>
              <Text style={styles.helper}>Recording this schedule creates an internal transfer and reduces card debt; it will not count as additional spending.</Text>
            </> : <><Text style={styles.fieldLabel}>Category</Text><View style={styles.chips}>{(draft.kind==='income'?incomeCategories:categories).map(c=><Pill key={c.name} title={`${c.icon} ${c.name}`} active={draft.category===c.name} onPress={()=>setDraft(x=>({...x,category:c.name}))}/>)}</View></>}
          </>}
          {modal === 'category' && <>
            <LabeledInput label="Category name" value={draft.name} onChangeText={name=>setDraft(x=>({...x,name}))} placeholder="e.g. Pets"/>
            <Text style={styles.fieldLabel}>Category icon</Text>
            <View style={styles.iconPicker}>{ICON_CHOICES.map((icon,index)=><Pressable key={`${icon}-${index}`} accessibilityRole="button" accessibilityLabel={`Select icon ${icon}`} accessibilityState={{selected:draft.icon===icon}} onPress={()=>setDraft(x=>({...x,icon}))} style={[styles.iconChoice,draft.icon===icon&&styles.iconChoiceSelected]}><Text style={{fontSize:23}}>{icon}</Text></Pressable>)}</View>
            <Text style={styles.helper}>Renaming updates existing {draft.categoryType==='income'?'income':'spending'} transactions and planned entries. Deleting reassigns them to Other.</Text>
            {editingId && editingId !== 'Other' ? <Button title="Delete category" secondary onPress={()=>{const name=editingId;const kind=draft.categoryType;closeModal();removeCategory(name,kind);}}/> : null}
          </>}
          {modal === 'transaction' && editingId ? <Button title="Delete this transaction" secondary onPress={() => confirmRemove('transaction', editingId)}/> : null}
          {modal === 'schedule' && editingId ? <>
            <Button title={draft.kind==='income'?'Record this income':draft.kind==='card_payment'?'Record this repayment':'Record this expense'} secondary onPress={()=>{const schedule=scheduled.find(s=>s.id===editingId);if(schedule){closeModal();recordPayment(schedule)}else setError('No pending occurrence remains.');}}/>
            <Button title="Delete this plan" secondary onPress={()=>confirmRemove('schedule',editingId)}/>
          </> : null}
          {!!error && <Text style={styles.errorBanner}>{error}</Text>}
          <Button title={editingId ? 'Save changes' : modal==='transaction' ? 'Add transaction' : modal==='account' ? 'Add account' : modal==='category' ? 'Add category' : 'Add planned payment'} onPress={modal==='transaction'?saveTransaction:modal==='account'?saveAccount:modal==='category'?saveCategory:saveSchedule}/>
        </ScrollView>
      </KeyboardAvoidingView></SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:C.pale}, page:{paddingHorizontal:18,paddingTop:17,paddingBottom:28,gap:17},activityPage:{paddingHorizontal:12,paddingTop:10,paddingBottom:14,gap:9},
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
  chart:{marginTop:12},chartBars:{height:142,flexDirection:'row',gap:12,alignItems:'flex-end'},barItem:{flex:1,alignItems:'center',gap:8,height:'100%'},barTrack:{height:113,width:'100%',justifyContent:'flex-end',alignItems:'center',backgroundColor:'#F6F7FC',borderRadius:7,overflow:'hidden'},barFill:{width:'66%',borderTopLeftRadius:6,borderTopRightRadius:6},barLabel:{fontSize:9,color:C.mute,fontWeight:'700',textAlign:'center'},
  miniRow:{flexDirection:'row',alignItems:'center',paddingVertical:11,borderTopWidth:1,borderTopColor:C.border},
  listRow:{flexDirection:'row',alignItems:'center',minHeight:46,paddingVertical:6,borderBottomWidth:1,borderBottomColor:C.border,gap:9},
  activityToolbar:{flexDirection:'row',gap:8,alignItems:'center'},
  searchInput:{backgroundColor:'#fff',borderWidth:1,borderColor:C.border,borderRadius:11,flex:1,height:40,paddingHorizontal:11,fontSize:13,color:C.ink},
  activityMeta:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:7},
  activityCount:{flex:1,color:C.mute,fontSize:10},
  activityList:{backgroundColor:'#fff',borderRadius:15,paddingHorizontal:10,borderWidth:1,borderColor:C.border,overflow:'hidden'},
  activityDay:{marginBottom:1},
  dayHeader:{paddingTop:9,paddingBottom:7,borderBottomWidth:1,borderBottomColor:C.border,gap:3},
  dayHeaderDate:{fontSize:12,fontWeight:'800',color:C.ink},
  dayTotals:{flexDirection:'row',gap:12},dayOut:{fontSize:10,color:C.red,fontWeight:'700'},dayIn:{fontSize:10,color:C.green,fontWeight:'700'},
  txIcon:{width:30,height:30,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:'#F1F4F9'},rowTitle:{color:C.ink,fontWeight:'700',fontSize:13},rowSubtitle:{color:C.mute,fontSize:10,marginTop:2},rowAmount:{color:C.ink,fontWeight:'800',fontSize:12},inlineAction:{fontSize:11,color:C.blue,fontWeight:'800'},
  empty:{paddingVertical:25,paddingHorizontal:12,alignItems:'center'},emptyTitle:{fontSize:15,color:C.ink,fontWeight:'800',marginBottom:5},
  toolbar:{flexDirection:'row',alignItems:'center',gap:12},filterRow:{flexDirection:'row',gap:7,flexWrap:'wrap'},
  pill:{borderWidth:1,borderColor:'#DFE4EF',borderRadius:22,paddingHorizontal:12,paddingVertical:9,backgroundColor:'#fff'},compactPill:{paddingHorizontal:11,paddingVertical:6},pillText:{fontSize:12,color:C.mute,fontWeight:'800'},
  scheduleRow:{flexDirection:'row',alignItems:'center',gap:9,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.border},
  lightDivider:{height:1,backgroundColor:C.border,marginVertical:10},track:{height:9,backgroundColor:'#EFF2F8',borderRadius:7,overflow:'hidden'},fill:{height:9,borderRadius:7},between:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:9},
  summary:{color:'#56637E',fontSize:13,lineHeight:21},accountCard:{padding:18,borderRadius:18,backgroundColor:'#fff',borderWidth:1,borderColor:'#EFF1F6'},accountLogo:{width:43,height:43,borderRadius:14,justifyContent:'center',alignItems:'center'},accountMoney:{fontSize:17,color:C.ink,fontWeight:'800',maxWidth:'40%'},
  tabBar:{flexDirection:'row',backgroundColor:'#fff',borderTopWidth:1,borderTopColor:C.border,paddingVertical:10,paddingHorizontal:3},tabItem:{flex:1,alignItems:'center',justifyContent:'center',gap:4},tabIcon:{fontSize:23,fontWeight:'800',color:'#A1AAC0'},tabText:{fontSize:10,color:'#8B96AA',fontWeight:'600'},
  modalScreen:{flex:1,backgroundColor:C.pale},modalHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:20,backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:C.border},modalTitle:{color:C.ink,fontSize:20,fontWeight:'800'},close:{fontSize:14,color:C.blue,fontWeight:'800'},
  fieldLabel:{fontSize:13,fontWeight:'800',color:C.ink},input:{backgroundColor:'#fff',borderColor:'#DDE4EF',borderWidth:1,borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:16,color:C.ink},helper:{fontSize:11,color:C.mute,lineHeight:17},chips:{flexDirection:'row',flexWrap:'wrap',gap:7},colorDot:{width:35,height:35,borderRadius:18},
  settingsBack:{color:C.blue,fontSize:13,fontWeight:'800',marginBottom:2},
  settingsMenuRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,borderTopWidth:1,borderTopColor:C.border},
  settingsMenuIcon:{width:42,height:42,borderRadius:13,backgroundColor:'#F1F4FA',alignItems:'center',justifyContent:'center'},
  settingsMenuTitle:{fontSize:14,fontWeight:'800',color:C.ink},settingsMenuDetail:{fontSize:11,color:C.mute,marginTop:3,lineHeight:16},
  settingsChevron:{color:C.mute,fontSize:24,fontWeight:'600'},
  categoryEmoji:{fontSize:22,width:36,marginRight:7,textAlign:'center'},iconPicker:{flexDirection:'row',flexWrap:'wrap',gap:8},iconChoice:{width:45,height:45,borderRadius:12,backgroundColor:'#F2F4FA',justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:'#E2E6EF'},iconChoiceSelected:{borderColor:C.blue,borderWidth:2,backgroundColor:'#E4E9FE'},toggleBadge:{color:'#fff',fontSize:11,fontWeight:'800',paddingHorizontal:12,paddingVertical:7,borderRadius:9,overflow:'hidden'},
  errorBanner:{color:'#9A2D46',backgroundColor:'#FFE7ED',padding:12,borderRadius:9,fontSize:12},demoBanner:{backgroundColor:'#FFF5DF',borderRadius:12,padding:11},demoText:{color:'#9B6D25',fontSize:11,lineHeight:17},
});
