'use strict';

/** קניה — buying animals. A purchase registers the animals and books the cost. */
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

router.get('/', wrap(async (req, res) => {
  const { start, end } = seasonRange(req);
  const page = Math.max(1, num(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, num(req.query.limit, 25)));
  const col = getDb().collection('purchases');
  const filter = { date: { $gte: start, $lte: end } };
  const [items, total] = await Promise.all([
    col.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

router.get('/stats', wrap(async (req, res) => {
  const { start, end, label } = seasonRange(req);
  const rows = await getDb().collection('purchases').find({ date: { $gte: start, $lte: end } }).toArray();
  const cost = rows.reduce((s, x) => s + (x.total || 0), 0);
  const heads = rows.reduce((s, x) => s + (x.newAnimals || []).length + (x.extraHeads || 0), 0);
  res.json({
    season: label, count: rows.length, cost, heads,
    avgPerHead: heads ? +(cost / heads).toFixed(0) : 0,
  });
}));

router.post('/', requireWrite, wrap(async (req, res) => {
  const db = getDb();
  const rawAnimals = Array.isArray(req.body.animals) ? req.body.animals : [];
  const date = toDate(req.body.date) || new Date();
  const seller = clean(req.body.seller);

  const created = [];
  for (const a of rawAnimals) {
    const tag = clean(a.tag);
    if (!tag) continue;
    const exists = await db.collection('animals').findOne({ tag });
    if (exists) continue; // skip tags already in the book
    const doc = {
      tag,
      name: '', sex: a.sex === 'M' ? 'M' : 'F',
      breed: clean(a.breed) || 'אסף',
      birthDate: toDate(a.birthDate),
      groupName: clean(a.groupName) || 'נרכשו',
      status: 'active',
      reproStatus: a.sex === 'M' ? 'ram' : 'open',
      ministryId: clean(a.ministryId),
      motherTag: '', fatherTag: '',
      origin: 'purchased',
      lastWeightKg: num(a.weightKg, null),
      lastWeightDate: a.weightKg ? date : null,
      expectedLambingDate: null,
      notes: seller ? `נרכשה מ${seller}` : '',
      createdAt: date, updatedAt: new Date(),
    };
    await db.collection('animals').insertOne(doc);
    created.push(tag);
  }

  const doc = {
    date, seller,
    newAnimals: created,
    extraHeads: Math.max(0, num(req.body.extraHeads, 0) || 0),
    total: num(req.body.total, 0) || 0,
    notes: clean(req.body.notes),
    createdBy: req.user.username, createdAt: new Date(),
  };
  if (!created.length && !doc.extraHeads) return res.status(400).json({ error: 'יש להזין לפחות חיה אחת (מספרים שכבר קיימים מדולגים)' });
  if (doc.total <= 0) return res.status(400).json({ error: 'סכום הקנייה נדרש' });

  const { insertedId } = await db.collection('purchases').insertOne(doc);
  res.status(201).json({ purchase: { ...doc, _id: insertedId }, createdCount: created.length });
}));

router.delete('/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const purchase = await getDb().collection('purchases').findOne({ _id });
  if (!purchase) return res.status(404).json({ error: 'קנייה לא נמצאה' });
  // Remove animals that were created by this purchase and never changed since.
  for (const tag of (purchase.newAnimals || [])) {
    await getDb().collection('animals').deleteOne({ tag, origin: 'purchased' });
  }
  await getDb().collection('purchases').deleteOne({ _id });
  res.json({ ok: true });
}));

module.exports = router;
