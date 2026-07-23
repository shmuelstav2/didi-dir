'use strict';

/** מכירות — selling animals. A sale marks its animals sold and books income. */
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

function computeTotal(body) {
  const explicit = num(body.total, null);
  if (explicit !== null && explicit > 0) return explicit;
  const kg = num(body.totalWeightKg, 0) || 0;
  const perKg = num(body.pricePerKg, 0) || 0;
  const heads = Array.isArray(body.animalTags) ? body.animalTags.length : num(body.headCount, 0) || 0;
  const perHead = num(body.pricePerHead, 0) || 0;
  if (kg > 0 && perKg > 0) return +(kg * perKg).toFixed(2);
  if (heads > 0 && perHead > 0) return +(heads * perHead).toFixed(2);
  return 0;
}

router.get('/', wrap(async (req, res) => {
  const { start, end } = seasonRange(req);
  const page = Math.max(1, num(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, num(req.query.limit, 25)));
  const col = getDb().collection('sales');
  const filter = { date: { $gte: start, $lte: end } };
  const [items, total] = await Promise.all([
    col.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/stats', wrap(async (req, res) => {
  const { start, end, label } = seasonRange(req);
  const sales = await getDb().collection('sales').find({ date: { $gte: start, $lte: end } }).toArray();
  const revenue = sales.reduce((s, x) => s + (x.total || 0), 0);
  const heads = sales.reduce((s, x) => s + (x.animalTags || []).length + (x.extraHeads || 0), 0);
  const kg = sales.reduce((s, x) => s + (x.totalWeightKg || 0), 0);
  res.json({
    season: label,
    count: sales.length,
    revenue,
    heads,
    kg: +kg.toFixed(1),
    avgPerHead: heads ? +(revenue / heads).toFixed(0) : 0,
    avgPerKg: kg ? +(revenue / kg).toFixed(2) : 0,
  });
}));

router.post('/', requireWrite, wrap(async (req, res) => {
  const db = getDb();
  const animalTags = Array.isArray(req.body.animalTags) ? req.body.animalTags.map(clean).filter(Boolean) : [];
  const doc = {
    date: toDate(req.body.date) || new Date(),
    buyer: clean(req.body.buyer),
    animalTags,
    extraHeads: Math.max(0, num(req.body.extraHeads, 0) || 0),
    totalWeightKg: num(req.body.totalWeightKg, 0) || 0,
    pricePerKg: num(req.body.pricePerKg, 0) || 0,
    pricePerHead: num(req.body.pricePerHead, 0) || 0,
    total: computeTotal(req.body),
    notes: clean(req.body.notes),
    createdBy: req.user.username,
    createdAt: new Date(),
  };
  if (!animalTags.length && !doc.extraHeads) return res.status(400).json({ error: 'יש לבחור לפחות חיה אחת או להזין מספר ראשים' });
  if (doc.total <= 0) return res.status(400).json({ error: 'לא ניתן לחשב סכום — הזינו מחיר לק״ג + משקל, מחיר לראש, או סכום כולל' });

  const { insertedId } = await db.collection('sales').insertOne(doc);

  // Mark the sold animals and write a sale event on each.
  for (const tag of animalTags) {
    await db.collection('animals').updateOne({ tag }, { $set: { status: 'sold', soldDate: doc.date, updatedAt: new Date() } });
    await db.collection('events').insertOne({
      animalTag: tag, type: 'note', date: doc.date,
      payload: { sale: true, buyer: doc.buyer },
      note: `נמכר${doc.buyer ? ` ל${doc.buyer}` : ''}`,
      createdBy: req.user.username, createdAt: new Date(),
    });
  }
  res.status(201).json({ sale: { ...doc, _id: insertedId } });
}));

router.delete('/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const sale = await getDb().collection('sales').findOne({ _id });
  if (!sale) return res.status(404).json({ error: 'מכירה לא נמצאה' });
  // Revert the animals back to active.
  for (const tag of (sale.animalTags || [])) {
    await getDb().collection('animals').updateOne({ tag }, { $set: { status: 'active', updatedAt: new Date() }, $unset: { soldDate: '' } });
  }
  await getDb().collection('sales').deleteOne({ _id });
  res.json({ ok: true });
}));

module.exports = router;
