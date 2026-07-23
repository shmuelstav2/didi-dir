'use strict';

/** מזון — feed inventory: deliveries in, consumption out, live stock per type. */
const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../lib/db');
const { requireAuth, requireWrite } = require('../lib/auth');
const { wrap, clean, num, toDate, currentSeason } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

const DIRECTIONS = ['in', 'out'];

function shape(body, existing = {}) {
  const direction = DIRECTIONS.includes(body.direction) ? body.direction : (existing.direction || 'in');
  return {
    date: toDate(body.date) || existing.date || new Date(),
    feedType: clean(body.feedType) || existing.feedType || '',
    direction,
    quantityKg: num(body.quantityKg, existing.quantityKg ?? 0) || 0,
    // Cost only applies to deliveries; consumption has none.
    cost: direction === 'in' ? (num(body.cost, existing.cost ?? 0) || 0) : 0,
    supplier: clean(body.supplier),
    groupName: clean(body.groupName),
    notes: clean(body.notes),
    updatedAt: new Date(),
  };
}

router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, num(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, num(req.query.limit, 25)));
  const filter = {};
  if (clean(req.query.feedType)) filter.feedType = clean(req.query.feedType);
  if (clean(req.query.direction)) filter.direction = clean(req.query.direction);
  const col = getDb().collection('feed_records');
  const [items, total] = await Promise.all([
    col.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/types', wrap(async (req, res) => {
  const types = await getDb().collection('feed_records').distinct('feedType', { feedType: { $nin: ['', null] } });
  res.json({ types: types.sort() });
}));

/** Live stock per feed type (in minus out) + season cost. */
router.get('/stock', wrap(async (req, res) => {
  const db = getDb();
  const season = currentSeason();
  const rows = await db.collection('feed_records').aggregate([
    { $group: {
      _id: '$feedType',
      inKg: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$quantityKg', 0] } },
      outKg: { $sum: { $cond: [{ $eq: ['$direction', 'out'] }, '$quantityKg', 0] } },
      cost: { $sum: '$cost' },
    } },
    { $sort: { _id: 1 } },
  ]).toArray();

  const stock = rows.map(r => ({
    feedType: r._id || '(ללא שם)',
    inKg: r.inKg, outKg: r.outKg,
    stockKg: +(r.inKg - r.outKg).toFixed(1),
    cost: r.cost,
  }));

  const seasonAgg = await db.collection('feed_records').aggregate([
    { $match: { direction: 'in', date: { $gte: season.start, $lte: season.end } } },
    { $group: { _id: null, cost: { $sum: '$cost' }, kg: { $sum: '$quantityKg' } } },
  ]).toArray();

  res.json({
    stock,
    totalStockKg: +stock.reduce((s, x) => s + x.stockKg, 0).toFixed(1),
    seasonCost: (seasonAgg[0] || {}).cost || 0,
    seasonKg: (seasonAgg[0] || {}).kg || 0,
    season: season.label,
  });
}));

router.post('/', requireWrite, wrap(async (req, res) => {
  const doc = shape(req.body);
  if (!doc.feedType) return res.status(400).json({ error: 'סוג מזון נדרש' });
  if (doc.quantityKg <= 0) return res.status(400).json({ error: 'כמות חייבת להיות גדולה מאפס' });
  doc.createdBy = req.user.username;
  doc.createdAt = new Date();
  const { insertedId } = await getDb().collection('feed_records').insertOne(doc);
  res.status(201).json({ record: { ...doc, _id: insertedId } });
}));

router.put('/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const existing = await getDb().collection('feed_records').findOne({ _id });
  if (!existing) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  const doc = shape(req.body, existing);
  await getDb().collection('feed_records').updateOne({ _id }, { $set: doc });
  res.json({ record: { ...existing, ...doc } });
}));

router.delete('/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const r = await getDb().collection('feed_records').deleteOne({ _id });
  if (!r.deletedCount) return res.status(404).json({ error: 'רשומה לא נמצאה' });
  res.json({ ok: true });
}));

module.exports = router;
