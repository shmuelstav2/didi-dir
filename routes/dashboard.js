'use strict';

const express = require('express');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { wrap, currentSeason, daysBetween } = require('../lib/util');

const router = express.Router();
router.use(requireAuth);

/** Everything the "תמונת מצב" screen needs, in one round trip. */
router.get('/', wrap(async (req, res) => {
  const db = getDb();
  const season = currentSeason();
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);

  const [
    headcount, addedThisSeason, femalesAdult, pregnant, lactating, lambs,
    lambings, openTreatments, upcomingTreatments, nextGroups, deaths,
  ] = await Promise.all([
    db.collection('animals').countDocuments({ status: 'active' }),
    db.collection('animals').countDocuments({ status: 'active', createdAt: { $gte: season.start } }),
    db.collection('animals').countDocuments({ status: 'active', sex: 'F', reproStatus: { $ne: 'lamb' } }),
    db.collection('animals').countDocuments({ status: 'active', reproStatus: 'pregnant' }),
    db.collection('animals').countDocuments({ status: 'active', reproStatus: 'lactating' }),
    db.collection('animals').countDocuments({ status: 'active', reproStatus: 'lamb' }),
    db.collection('lambings').find({ date: { $gte: season.start, $lte: season.end } }).toArray(),
    db.collection('treatments').countDocuments({ status: { $in: ['planned', 'in_progress'] } }),
    db.collection('treatments').find({ status: { $in: ['planned', 'in_progress'] } }).sort({ date: 1 }).limit(5).toArray(),
    db.collection('breeding_groups').find({ stage: { $ne: 'done' } }).sort({ expectedLambingDate: 1 }).limit(3).toArray(),
    db.collection('animals').countDocuments({ status: 'dead', updatedAt: { $gte: season.start } }),
  ]);

  const offspring = lambings.flatMap(l => l.offspring || []);
  const mothers = new Set(lambings.map(l => l.motherTag)).size;
  const bred = pregnant + lactating + await db.collection('animals').countDocuments({ status: 'active', sex: 'F', reproStatus: 'open' });

  const nextGroup = nextGroups.find(g => g.expectedLambingDate) || null;

  res.json({
    season: season.label,
    headcount,
    addedThisSeason,
    composition: {
      females: femalesAdult, pregnant, lactating, lambs,
      rams: await db.collection('animals').countDocuments({ status: 'active', sex: 'M', reproStatus: { $ne: 'lamb' } }),
    },
    lambing: {
      count: lambings.length,
      mothers,
      rate: bred ? +(mothers / bred * 100).toFixed(0) : 0,
      offspring: offspring.length,
      perMother: mothers ? +(offspring.length / mothers).toFixed(1) : 0,
    },
    mortality: {
      count: deaths,
      pct: headcount + deaths ? +(deaths / (headcount + deaths) * 100).toFixed(1) : 0,
    },
    treatments: { open: openTreatments, upcoming: upcomingTreatments },
    nextGroup: nextGroup ? {
      name: nextGroup.name,
      stage: nextGroup.stage,
      daysToLambing: daysBetween(now, nextGroup.expectedLambingDate),
      femaleCount: nextGroup.femaleCount,
    } : null,
    weaningSoon: await db.collection('animals').countDocuments({
      status: 'active', reproStatus: 'lamb',
      birthDate: { $lte: new Date(now.getTime() - 53 * 86400000), $gte: new Date(now.getTime() - 67 * 86400000) },
    }),
    generatedAt: now,
    horizon: in7,
  });
}));

module.exports = router;
