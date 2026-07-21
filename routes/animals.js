'use strict';

const express = require('express');
const { getDb } = require('../lib/db');
const { requireAuth, requireWrite } = require('../lib/auth');
const { wrap, clean, num, toDate, ageYears, daysBetween, addDays, GESTATION_DAYS } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['active', 'sold', 'dead', 'culled'];
const REPRO = ['open', 'pregnant', 'lactating', 'lamb', 'ram'];

function shape(body, existing = {}) {
  const doc = {
    tag: clean(body.tag) || existing.tag,
    name: clean(body.name),
    sex: body.sex === 'M' ? 'M' : 'F',
    breed: clean(body.breed) || 'אסף',
    birthDate: toDate(body.birthDate),
    groupName: clean(body.groupName),
    status: STATUSES.includes(body.status) ? body.status : (existing.status || 'active'),
    reproStatus: REPRO.includes(body.reproStatus) ? body.reproStatus : (existing.reproStatus || 'open'),
    ministryId: clean(body.ministryId),
    motherTag: clean(body.motherTag),
    fatherTag: clean(body.fatherTag),
    origin: body.origin === 'purchased' ? 'purchased' : 'own',
    lastWeightKg: num(body.lastWeightKg, existing.lastWeightKg ?? null),
    lastWeightDate: toDate(body.lastWeightDate) || existing.lastWeightDate || null,
    expectedLambingDate: toDate(body.expectedLambingDate) || existing.expectedLambingDate || null,
    notes: clean(body.notes),
    updatedAt: new Date(),
  };
  return doc;
}

function decorate(a) {
  return {
    ...a,
    ageYears: ageYears(a.birthDate),
    daysToLambing: a.expectedLambingDate ? daysBetween(new Date(), a.expectedLambingDate) : null,
  };
}

/** GET /api/animals?q=&status=&group=&sex=&repro=&page=&limit=&sort= */
router.get('/', wrap(async (req, res) => {
  const page = Math.max(1, num(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, num(req.query.limit, 25)));
  const filter = {};
  const q = clean(req.query.q);
  if (q) {
    filter.$or = [
      { tag: { $regex: q, $options: 'i' } },
      { name: { $regex: q, $options: 'i' } },
      { ministryId: { $regex: q, $options: 'i' } },
      { groupName: { $regex: q, $options: 'i' } },
    ];
  }
  if (clean(req.query.status)) filter.status = clean(req.query.status);
  if (clean(req.query.group)) filter.groupName = clean(req.query.group);
  if (clean(req.query.sex)) filter.sex = clean(req.query.sex);
  if (clean(req.query.repro)) filter.reproStatus = clean(req.query.repro);

  const sortKey = ['tag', 'birthDate', 'lastWeightKg', 'groupName'].includes(req.query.sort) ? req.query.sort : 'tag';
  const dir = req.query.dir === 'desc' ? -1 : 1;

  const col = getDb().collection('animals');
  const [items, total] = await Promise.all([
    col.find(filter).sort({ [sortKey]: dir }).skip((page - 1) * limit).limit(limit).toArray(),
    col.countDocuments(filter),
  ]);
  res.json({ items: items.map(decorate), total, page, limit, pages: Math.ceil(total / limit) || 1 });
}));

/** Distinct groups, for filter dropdowns. */
router.get('/groups', wrap(async (req, res) => {
  const groups = await getDb().collection('animals').distinct('groupName', { groupName: { $nin: ['', null] } });
  res.json({ groups: groups.sort() });
}));

/** Full animal card: animal + events + offspring + parents. */
router.get('/:tag', wrap(async (req, res) => {
  const db = getDb();
  const tag = clean(req.params.tag);
  const animal = await db.collection('animals').findOne({ tag });
  if (!animal) return res.status(404).json({ error: 'חיה לא נמצאה' });

  const [events, offspring, mother, father, lambings] = await Promise.all([
    db.collection('events').find({ animalTag: tag }).sort({ date: -1 }).limit(100).toArray(),
    db.collection('animals').find({ motherTag: tag }).sort({ birthDate: -1 }).toArray(),
    animal.motherTag ? db.collection('animals').findOne({ tag: animal.motherTag }) : null,
    animal.fatherTag ? db.collection('animals').findOne({ tag: animal.fatherTag }) : null,
    db.collection('lambings').find({ motherTag: tag }).sort({ date: -1 }).toArray(),
  ]);

  const offspringCount = lambings.reduce((s, l) => s + (l.offspring || []).length, 0);
  res.json({
    animal: decorate(animal),
    events,
    offspring,
    lambings,
    mother: mother ? { tag: mother.tag, name: mother.name } : null,
    father: father ? { tag: father.tag, name: father.name } : null,
    stats: { lambingCount: lambings.length, offspringCount },
  });
}));

router.post('/', requireWrite, wrap(async (req, res) => {
  const doc = shape(req.body);
  if (!doc.tag) return res.status(400).json({ error: 'מספר חיה נדרש' });
  const exists = await getDb().collection('animals').findOne({ tag: doc.tag });
  if (exists) return res.status(409).json({ error: `מספר חיה ${doc.tag} כבר קיים` });
  doc.createdAt = new Date();
  await getDb().collection('animals').insertOne(doc);
  res.status(201).json({ animal: decorate(doc) });
}));

router.put('/:tag', requireWrite, wrap(async (req, res) => {
  const tag = clean(req.params.tag);
  const existing = await getDb().collection('animals').findOne({ tag });
  if (!existing) return res.status(404).json({ error: 'חיה לא נמצאה' });
  const doc = shape({ ...req.body, tag }, existing);
  await getDb().collection('animals').updateOne({ tag }, { $set: doc });
  res.json({ animal: decorate({ ...existing, ...doc }) });
}));

router.delete('/:tag', requireWrite, wrap(async (req, res) => {
  const tag = clean(req.params.tag);
  const r = await getDb().collection('animals').deleteOne({ tag });
  if (!r.deletedCount) return res.status(404).json({ error: 'חיה לא נמצאה' });
  await getDb().collection('events').deleteMany({ animalTag: tag });
  res.json({ ok: true });
}));

/**
 * Records an event on an animal and applies its side effects
 * (weighing → last weight, pregnancy check → expected lambing date).
 */
router.post('/:tag/events', requireWrite, wrap(async (req, res) => {
  const db = getDb();
  const tag = clean(req.params.tag);
  const animal = await db.collection('animals').findOne({ tag });
  if (!animal) return res.status(404).json({ error: 'חיה לא נמצאה' });

  const type = clean(req.body.type);
  const allowed = ['weighing', 'pregnancy_check', 'vaccination', 'mating', 'treatment', 'note'];
  if (!allowed.includes(type)) return res.status(400).json({ error: 'סוג אירוע לא חוקי' });

  const date = toDate(req.body.date) || new Date();
  const payload = req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  const event = {
    animalTag: tag, type, date, payload,
    note: clean(req.body.note),
    createdBy: req.user.username,
    createdAt: new Date(),
  };
  await db.collection('events').insertOne(event);

  const set = {};
  if (type === 'weighing' && num(payload.weightKg) !== null) {
    set.lastWeightKg = num(payload.weightKg);
    set.lastWeightDate = date;
  }
  if (type === 'pregnancy_check' && payload.result === 'positive') {
    set.reproStatus = 'pregnant';
    const matingDate = toDate(payload.matingDate);
    set.expectedLambingDate = addDays(matingDate || date, matingDate ? GESTATION_DAYS : 100);
  }
  if (type === 'pregnancy_check' && payload.result === 'negative') {
    set.reproStatus = 'open';
    set.expectedLambingDate = null;
  }
  if (type === 'mating') {
    set.reproStatus = 'open';
    if (payload.ramTag) set.lastRamTag = clean(payload.ramTag);
  }
  if (Object.keys(set).length) {
    set.updatedAt = new Date();
    await db.collection('animals').updateOne({ tag }, { $set: set });
  }
  res.status(201).json({ event });
}));

module.exports = router;
