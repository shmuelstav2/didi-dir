'use strict';

/**
 * כלכלי — financial summary. Income and expenses are aggregated from their
 * source modules (sales, purchases, feed, treatments) plus a manual ledger
 * (`transactions`), so there is a single source of truth and no double counting.
 */
const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../lib/db');
const { requireAuth, requireWrite } = require('../lib/auth');
const { wrap, clean, num, toDate, currentSeason } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

function seasonRange(req) {
  const from = toDate(req.query.from);
  const to = toDate(req.query.to);
  if (from && to) return { start: from, end: to, label: 'טווח מותאם' };
  return currentSeason();
}

const INCOME_CATS = ['מכירת חיות', 'סובסידיה', 'אחר'];
const EXPENSE_CATS = ['מזון', 'וטרינר ותרופות', 'קניית חיות', 'ציוד', 'עבודה', 'אחר'];

/** Full P&L for the period, broken down by source. */
router.get('/summary', wrap(async (req, res) => {
  const db = getDb();
  const { start, end, label } = seasonRange(req);
  const range = { $gte: start, $lte: end };

  const [salesAgg, purchasesAgg, feedAgg, treatAgg, txns] = await Promise.all([
    db.collection('sales').aggregate([{ $match: { date: range } }, { $group: { _id: null, sum: { $sum: '$total' } } }]).toArray(),
    db.collection('purchases').aggregate([{ $match: { date: range } }, { $group: { _id: null, sum: { $sum: '$total' } } }]).toArray(),
    db.collection('feed_records').aggregate([{ $match: { direction: 'in', date: range } }, { $group: { _id: null, sum: { $sum: '$cost' } } }]).toArray(),
    db.collection('treatments').aggregate([{ $match: { date: range } }, { $group: { _id: null, sum: { $sum: '$cost' } } }]).toArray(),
    db.collection('transactions').find({ date: range }).toArray(),
  ]);

  const sum = a => (a[0] || {}).sum || 0;
  const manualIncome = txns.filter(t => t.kind === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const manualExpense = txns.filter(t => t.kind === 'expense').reduce((s, t) => s + (t.amount || 0), 0);

  const income = [
    { source: 'מכירת חיות', amount: sum(salesAgg) },
    { source: 'הכנסות ידניות', amount: manualIncome },
  ];
  const expenses = [
    { source: 'מזון', amount: sum(feedAgg) },
    { source: 'וטרינר ותרופות', amount: sum(treatAgg) },
    { source: 'קניית חיות', amount: sum(purchasesAgg) },
    { source: 'הוצאות ידניות', amount: manualExpense },
  ];
  const totalIncome = income.reduce((s, x) => s + x.amount, 0);
  const totalExpense = expenses.reduce((s, x) => s + x.amount, 0);

  res.json({
    season: label,
    income, expenses,
    totalIncome, totalExpense,
    net: +(totalIncome - totalExpense).toFixed(2),
  });
}));

// --- manual ledger ---
router.get('/transactions', wrap(async (req, res) => {
  const { start, end } = seasonRange(req);
  const txns = await getDb().collection('transactions')
    .find({ date: { $gte: start, $lte: end } }).sort({ date: -1 }).limit(200).toArray();
  res.json({ transactions: txns, incomeCategories: INCOME_CATS, expenseCategories: EXPENSE_CATS });
}));

router.post('/transactions', requireWrite, wrap(async (req, res) => {
  const kind = req.body.kind === 'income' ? 'income' : 'expense';
  const doc = {
    kind,
    date: toDate(req.body.date) || new Date(),
    category: clean(req.body.category) || (kind === 'income' ? 'אחר' : 'אחר'),
    description: clean(req.body.description),
    amount: num(req.body.amount, 0) || 0,
    createdBy: req.user.username, createdAt: new Date(),
  };
  if (doc.amount <= 0) return res.status(400).json({ error: 'סכום חייב להיות גדול מאפס' });
  const { insertedId } = await getDb().collection('transactions').insertOne(doc);
  res.status(201).json({ transaction: { ...doc, _id: insertedId } });
}));

router.delete('/transactions/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const r = await getDb().collection('transactions').deleteOne({ _id });
  if (!r.deletedCount) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  res.json({ ok: true });
}));

module.exports = router;
