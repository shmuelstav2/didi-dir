'use strict';

const express = require('express');
const { getDb } = require('../lib/db');
const { requireAuth, requireWrite } = require('../lib/auth');
const { wrap, clean, num, toDate, currentSeason } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

const DIFFICULTY = ['normal', 'watch', 'hard'];

function seasonRange(req) {
  const from = toDate(req.query.from);
  const to = toDate(req.query.to);
  if (from && to) return { start: from, end: to, label: 'טווח מותאם' };
  return currentSeason();
}

/** GET /api/lambings?from=&to=&page=&limit= */
router.get('/', wrap(async (req, res) => {
  const { start, end } = seasonRange(req);
  const page = Math.max(1, num(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, num(req.query.limit, 25)));
  const filter = { date: { $gte: start, $lte: end } };
  if (clean(req.query.mother)) filter.motherTag = clean(req.query.mother);

  const col = getDb().collection('lambings');
  const [items, total] = await Promise.all([
    col.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

/** Season KPIs + per-month distribution, all computed from the collection. */
router.get('/stats', wrap(async (req, res) => {
  const db = getDb();
  const { start, end, label } = seasonRange(req);
  const lambings = await db.collection('lambings').find({ date: { $gte: start, $lte: end } }).toArray();

  const offspring = lambings.flatMap(l => l.offspring || []);
  const born = offspring.length;
  const dead = offspring.filter(o => o.status === 'dead').length;
  const weights = offspring.map(o => num(o.weightKg)).filter(w => w !== null && w > 0);

  // Lambing rate = mothers that lambed / females that were bred this season.
  const bredFemales = await db.collection('animals').countDocuments({
    sex: 'F', status: 'active', reproStatus: { $in: ['pregnant', 'lactating', 'open'] },
  });
  const mothers = new Set(lambings.map(l => l.motherTag)).size;

  const litterMix = { single: 0, twins: 0, triplets: 0 };
  for (const l of lambings) {
    const n = (l.offspring || []).length;
    if (n === 1) litterMix.single++;
    else if (n === 2) litterMix.twins++;
    else if (n >= 3) litterMix.triplets++;
  }

  const byMonth = {};
  for (const l of lambings) {
    const d = new Date(l.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  }
  const months = Object.keys(byMonth).sort().map(k => ({ month: k, count: byMonth[k] }));

  res.json({
    season: label,
    from: start, to: end,
    lambings: lambings.length,
    mothers,
    bredFemales,
    lambingRate: bredFemales ? +(mothers / bredFemales * 100).toFixed(1) : 0,
    offspring: born,
    offspringPerMother: mothers ? +(born / mothers).toFixed(2) : 0,
    twinRate: lambings.length ? +(lambings.filter(l => (l.offspring || []).length >= 2).length / lambings.length * 100).toFixed(1) : 0,
    avgBirthWeight: weights.length ? +(weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(2) : 0,
    offspringMortality: born ? +(dead / born * 100).toFixed(1) : 0,
    deadOffspring: dead,
    litterMix,
    byMonth: months,
  });
}));

/**
 * Creating a lambing also: registers each newborn as an animal,
 * writes a lambing event on the mother, and flips her repro status.
 */
router.post('/', requireWrite, wrap(async (req, res) => {
  const db = getDb();
  const motherTag = clean(req.body.motherTag);
  const mother = await db.collection('animals').findOne({ tag: motherTag });
  if (!mother) return res.status(400).json({ error: 'אם לא נמצאה בספר העדר' });

  const date = toDate(req.body.date) || new Date();
  const rawOffspring = Array.isArray(req.body.offspring) ? req.body.offspring : [];
  if (!rawOffspring.length) return res.status(400).json({ error: 'יש לרשום לפחות ולד אחד' });

  const offspring = rawOffspring.map((o, i) => ({
    tag: clean(o.tag) || `${motherTag}-${date.getFullYear()}-${i + 1}`,
    sex: o.sex === 'M' ? 'M' : 'F',
    weightKg: num(o.weightKg, null),
    status: ['alive', 'dead', 'sold'].includes(o.status) ? o.status : 'alive',
  }));

  const doc = {
    motherTag,
    fatherTag: clean(req.body.fatherTag) || mother.lastRamTag || '',
    date,
    offspring,
    difficulty: DIFFICULTY.includes(req.body.difficulty) ? req.body.difficulty : 'normal',
    groupName: clean(req.body.groupName) || mother.groupName || '',
    notes: clean(req.body.notes),
    createdBy: req.user.username,
    createdAt: new Date(),
  };
  const { insertedId } = await db.collection('lambings').insertOne(doc);

  // Register living newborns in the flock book (skip tags already taken).
  for (const o of offspring) {
    if (o.status === 'dead') continue;
    const exists = await db.collection('animals').findOne({ tag: o.tag });
    if (exists) continue;
    await db.collection('animals').insertOne({
      tag: o.tag,
      name: '',
      sex: o.sex,
      breed: mother.breed || 'אסף',
      birthDate: date,
      groupName: 'טלאים',
      status: 'active',
      reproStatus: 'lamb',
      ministryId: '',
      motherTag,
      fatherTag: doc.fatherTag,
      origin: 'own',
      lastWeightKg: o.weightKg,
      lastWeightDate: o.weightKg ? date : null,
      expectedLambingDate: null,
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  await db.collection('events').insertOne({
    animalTag: motherTag,
    type: 'lambing',
    date,
    payload: { offspringCount: offspring.length, offspringTags: offspring.map(o => o.tag), difficulty: doc.difficulty },
    note: doc.notes,
    createdBy: req.user.username,
    createdAt: new Date(),
  });

  await db.collection('animals').updateOne(
    { tag: motherTag },
    { $set: { reproStatus: 'lactating', expectedLambingDate: null, lastLambingDate: date, updatedAt: new Date() } }
  );

  res.status(201).json({ lambing: { ...doc, _id: insertedId } });
}));

router.delete('/:id', requireWrite, wrap(async (req, res) => {
  const { ObjectId } = require('mongodb');
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const r = await getDb().collection('lambings').deleteOne({ _id });
  if (!r.deletedCount) return res.status(404).json({ error: 'המלטה לא נמצאה' });
  res.json({ ok: true });
}));

module.exports = router;
