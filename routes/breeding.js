'use strict';

const express = require('express');
const { ObjectId } = require('mongodb');
const { getDb } = require('../lib/db');
const { requireAuth, requireWrite } = require('../lib/auth');
const { wrap, clean, num, toDate, addDays, daysBetween, GESTATION_DAYS } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

const STAGES = ['mating', 'diagnosis', 'pre_lambing', 'lambing', 'done'];

function decorate(g) {
  const expected = g.expectedLambingDate ? new Date(g.expectedLambingDate) : null;
  return {
    ...g,
    daysToLambing: expected ? daysBetween(new Date(), expected) : null,
    conceptionRate: g.femaleCount ? +((g.pregnantCount || 0) / g.femaleCount * 100).toFixed(0) : null,
    stageIndex: STAGES.indexOf(g.stage),
  };
}

router.get('/groups', wrap(async (req, res) => {
  const filter = {};
  if (req.query.active === '1') filter.stage = { $ne: 'done' };
  const groups = await getDb().collection('breeding_groups').find(filter).sort({ matingStart: 1 }).toArray();
  res.json({ groups: groups.map(decorate) });
}));

/** 6-month lambing forecast, bucketed per month, from active groups. */
router.get('/forecast', wrap(async (req, res) => {
  const groups = await getDb().collection('breeding_groups')
    .find({ stage: { $ne: 'done' }, expectedLambingDate: { $ne: null } }).toArray();
  const buckets = {};
  for (const g of groups) {
    const d = new Date(g.expectedLambingDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!buckets[key]) buckets[key] = { month: key, mothers: 0, groups: [] };
    buckets[key].mothers += g.pregnantCount || g.femaleCount || 0;
    buckets[key].groups.push(g.name);
  }
  const forecast = Object.values(buckets).sort((a, b) => a.month.localeCompare(b.month)).slice(0, 6);
  res.json({
    forecast,
    totalExpected: forecast.reduce((s, b) => s + b.mothers, 0),
    activeGroups: groups.length,
  });
}));

function shape(body, existing = {}) {
  const matingStart = toDate(body.matingStart) || existing.matingStart || null;
  const matingEnd = toDate(body.matingEnd) || existing.matingEnd || null;
  const explicit = toDate(body.expectedLambingDate);
  return {
    name: clean(body.name) || existing.name,
    rams: Array.isArray(body.rams) ? body.rams.map(clean).filter(Boolean) : (existing.rams || []),
    femaleCount: num(body.femaleCount, existing.femaleCount ?? 0),
    pregnantCount: num(body.pregnantCount, existing.pregnantCount ?? 0),
    matingStart,
    matingEnd,
    stage: STAGES.includes(body.stage) ? body.stage : (existing.stage || 'mating'),
    // Default expected lambing = mating start + gestation.
    expectedLambingDate: explicit || (matingStart ? addDays(matingStart, GESTATION_DAYS) : existing.expectedLambingDate || null),
    notes: clean(body.notes),
    updatedAt: new Date(),
  };
}

router.post('/groups', requireWrite, wrap(async (req, res) => {
  const doc = shape(req.body);
  if (!doc.name) return res.status(400).json({ error: 'שם קבוצה נדרש' });
  const exists = await getDb().collection('breeding_groups').findOne({ name: doc.name });
  if (exists) return res.status(409).json({ error: 'קבוצה בשם הזה כבר קיימת' });
  doc.createdAt = new Date();
  await getDb().collection('breeding_groups').insertOne(doc);
  res.status(201).json({ group: decorate(doc) });
}));

router.put('/groups/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const existing = await getDb().collection('breeding_groups').findOne({ _id });
  if (!existing) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
  const doc = shape(req.body, existing);
  await getDb().collection('breeding_groups').updateOne({ _id }, { $set: doc });
  res.json({ group: decorate({ ...existing, ...doc }) });
}));

router.delete('/groups/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const r = await getDb().collection('breeding_groups').deleteOne({ _id });
  if (!r.deletedCount) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
  res.json({ ok: true });
}));

// --- treatments / tasks ---
router.get('/treatments', wrap(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = clean(req.query.status);
  const treatments = await getDb().collection('treatments').find(filter).sort({ date: 1 }).limit(200).toArray();
  res.json({ treatments });
}));

router.post('/treatments', requireWrite, wrap(async (req, res) => {
  const doc = {
    title: clean(req.body.title),
    type: ['vaccination', 'antibiotic', 'weaning', 'other'].includes(req.body.type) ? req.body.type : 'other',
    groupName: clean(req.body.groupName),
    animalTags: Array.isArray(req.body.animalTags) ? req.body.animalTags.map(clean).filter(Boolean) : [],
    count: num(req.body.count, 0),
    date: toDate(req.body.date) || new Date(),
    status: ['planned', 'in_progress', 'done'].includes(req.body.status) ? req.body.status : 'planned',
    notes: clean(req.body.notes),
    createdBy: req.user.username,
    createdAt: new Date(),
  };
  if (!doc.title) return res.status(400).json({ error: 'כותרת טיפול נדרשת' });
  const { insertedId } = await getDb().collection('treatments').insertOne(doc);
  res.status(201).json({ treatment: { ...doc, _id: insertedId } });
}));

router.put('/treatments/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const set = {};
  if (req.body.status) set.status = clean(req.body.status);
  if (req.body.title) set.title = clean(req.body.title);
  if (req.body.date) set.date = toDate(req.body.date);
  if (req.body.notes !== undefined) set.notes = clean(req.body.notes);
  const r = await getDb().collection('treatments').updateOne({ _id }, { $set: set });
  if (!r.matchedCount) return res.status(404).json({ error: 'טיפול לא נמצא' });
  res.json({ ok: true });
}));

router.delete('/treatments/:id', requireWrite, wrap(async (req, res) => {
  let _id;
  try { _id = new ObjectId(req.params.id); } catch (_) { return res.status(400).json({ error: 'מזהה לא חוקי' }); }
  const r = await getDb().collection('treatments').deleteOne({ _id });
  if (!r.deletedCount) return res.status(404).json({ error: 'טיפול לא נמצא' });
  res.json({ ok: true });
}));

module.exports = router;
