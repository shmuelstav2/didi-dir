'use strict';

/**
 * Seeds a realistic starting flock. Idempotent-ish: refuses to run when
 * animals already exist unless force:true is passed.
 */

const { connect, getDb, close } = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const { addDays, GESTATION_DAYS } = require('../lib/util');

// Deterministic PRNG so repeated seeds produce the same flock.
let _s = 20260721;
function rnd() {
  _s = (_s * 1103515245 + 12345) % 2147483648;
  return _s / 2147483648;
}
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function between(a, b) { return a + rnd() * (b - a); }
function intBetween(a, b) { return Math.floor(between(a, b + 1)); }

const BREEDS = ['אסף', 'אווסי', 'רומנוב', 'אסף'];
const EWE_GROUPS = ['אמהות א׳', 'אמהות ב׳', 'אמהות ג׳', 'עתודה'];

async function seed({ force = false, quiet = false } = {}) {
  const db = getDb();
  const log = (...a) => { if (!quiet) console.log(...a); };

  const existing = await db.collection('animals').countDocuments();
  if (existing > 0 && !force) {
    log(`[seed] skipped, ${existing} animals already present`);
    return { skipped: true };
  }
  if (force) {
    for (const c of ['animals', 'events', 'lambings', 'breeding_groups', 'treatments']) {
      await db.collection(c).deleteMany({});
    }
  }

  const now = new Date();
  const animals = [];
  const events = [];
  const lambings = [];

  // --- rams ---
  const rams = [];
  for (const n of [41, 91, 108, 113, 120]) {
    const tag = `איל ${n}`;
    rams.push(tag);
    animals.push({
      tag, name: '', sex: 'M', breed: pick(BREEDS),
      birthDate: addDays(now, -intBetween(700, 2000)),
      groupName: 'אילים', status: 'active', reproStatus: 'ram',
      ministryId: `IL-384-${n}`, motherTag: '', fatherTag: '', origin: 'own',
      lastWeightKg: +between(85, 110).toFixed(1), lastWeightDate: addDays(now, -intBetween(5, 60)),
      expectedLambingDate: null, notes: '', createdAt: addDays(now, -intBetween(400, 900)), updatedAt: now,
    });
  }

  // --- ewes ---
  const ewes = [];
  for (let i = 0; i < 212; i++) {
    const tag = String(700 + i * 4 + intBetween(0, 3));
    if (ewes.includes(tag)) continue;
    ewes.push(tag);
    const birth = addDays(now, -intBetween(500, 2400));
    const r = rnd();
    const reproStatus = r < 0.42 ? 'pregnant' : r < 0.78 ? 'lactating' : 'open';
    animals.push({
      tag, name: '', sex: 'F', breed: pick(BREEDS), birthDate: birth,
      groupName: pick(EWE_GROUPS), status: 'active', reproStatus,
      ministryId: `IL-384-${tag}`, motherTag: '', fatherTag: '', origin: rnd() < 0.85 ? 'own' : 'purchased',
      lastWeightKg: +between(52, 78).toFixed(1), lastWeightDate: addDays(now, -intBetween(3, 90)),
      expectedLambingDate: reproStatus === 'pregnant' ? addDays(now, intBetween(5, 120)) : null,
      notes: '', createdAt: addDays(now, -intBetween(300, 1200)), updatedAt: now,
    });
  }

  // --- lambings this season (Oct → today) + their lambs ---
  const seasonStart = new Date(Date.UTC(now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1, 9, 1));
  const daysSinceSeason = Math.max(30, Math.round((now - seasonStart) / 86400000));
  const lambingMothers = ewes.slice(0, 178);
  let lambSeq = 2100;

  for (const motherTag of lambingMothers) {
    const date = addDays(seasonStart, intBetween(0, daysSinceSeason - 1));
    const count = rnd() < 0.52 ? 2 : rnd() < 0.9 ? 1 : 3;
    const father = pick(rams);
    const offspring = [];
    for (let k = 0; k < count; k++) {
      const tag = String(++lambSeq);
      const dead = rnd() < 0.028;
      const sex = rnd() < 0.5 ? 'M' : 'F';
      const weightKg = +between(3.4, 5.2).toFixed(1);
      offspring.push({ tag, sex, weightKg, status: dead ? 'dead' : 'alive' });
      if (!dead) {
        animals.push({
          tag, name: '', sex, breed: 'אסף', birthDate: date,
          groupName: 'טלאים', status: 'active', reproStatus: 'lamb',
          ministryId: `IL-384-${tag}`, motherTag, fatherTag: father, origin: 'own',
          lastWeightKg: weightKg, lastWeightDate: date, expectedLambingDate: null,
          notes: '', createdAt: date, updatedAt: now,
        });
      }
    }
    const difficulty = rnd() < 0.9 ? 'normal' : rnd() < 0.6 ? 'watch' : 'hard';
    lambings.push({
      motherTag, fatherTag: father, date, offspring, difficulty,
      groupName: '', notes: '', createdBy: 'seed', createdAt: date,
    });
    events.push({
      animalTag: motherTag, type: 'lambing', date,
      payload: { offspringCount: count, offspringTags: offspring.map(o => o.tag), difficulty },
      note: '', createdBy: 'seed', createdAt: date,
    });
  }

  // --- a few history events per ewe so animal cards are not empty ---
  for (const tag of ewes.slice(0, 90)) {
    const wDate = addDays(now, -intBetween(3, 45));
    events.push({
      animalTag: tag, type: 'weighing', date: wDate,
      payload: { weightKg: +between(52, 78).toFixed(1) }, note: '', createdBy: 'seed', createdAt: wDate,
    });
    const vDate = addDays(now, -intBetween(40, 120));
    events.push({
      animalTag: tag, type: 'vaccination', date: vDate,
      payload: { vaccine: 'מחומשת' }, note: 'מנה שנתית', createdBy: 'seed', createdAt: vDate,
    });
    if (rnd() < 0.5) {
      const pDate = addDays(now, -intBetween(20, 80));
      events.push({
        animalTag: tag, type: 'pregnancy_check', date: pDate,
        payload: { result: rnd() < 0.85 ? 'positive' : 'negative', method: 'אולטרסאונד' },
        note: '', createdBy: 'seed', createdAt: pDate,
      });
    }
  }

  // --- breeding groups ---
  const groups = [
    { name: 'קבוצה ג׳', rams: ['איל 108', 'איל 91'], femaleCount: 38, pregnantCount: 34, offsetStart: -132, stage: 'pre_lambing' },
    { name: 'קבוצה ד׳', rams: ['איל 113'], femaleCount: 41, pregnantCount: 36, offsetStart: -95, stage: 'diagnosis' },
    { name: 'קבוצה ה׳', rams: ['איל 91', 'איל 120'], femaleCount: 44, pregnantCount: 0, offsetStart: -16, stage: 'mating' },
  ].map(g => {
    const matingStart = addDays(now, g.offsetStart);
    return {
      name: g.name, rams: g.rams, femaleCount: g.femaleCount, pregnantCount: g.pregnantCount,
      matingStart, matingEnd: addDays(matingStart, 20), stage: g.stage,
      expectedLambingDate: addDays(matingStart, GESTATION_DAYS),
      notes: '', createdAt: matingStart, updatedAt: now,
    };
  });

  // --- treatments ---
  const treatments = [
    { title: 'חיסון מחומשת', type: 'vaccination', groupName: 'אמהות ב׳', count: 45, date: addDays(now, 1), status: 'planned', medication: 'מחומשת', dose: '2 מ״ל', withdrawalDays: 0, cost: 680, notes: 'מנה שנתית' },
    { title: 'טיפול אנטיביוטי — דלקת עטין', type: 'antibiotic', groupName: '', count: 3, date: addDays(now, 0), status: 'in_progress', medication: 'פניצילין', dose: '5 מ״ל', withdrawalDays: 7, cost: 210, notes: '3 אמהות במעקב' },
    { title: 'תילוע עדר', type: 'deworming', groupName: 'אמהות א׳', count: 60, date: addDays(now, -6), status: 'done', medication: 'איברמקטין', dose: '1 מ״ל', withdrawalDays: 14, cost: 340, notes: '' },
    { title: 'גמילה מתוכננת', type: 'weaning', groupName: 'טלאים', count: 22, date: addDays(now, 4), status: 'planned', medication: '', dose: '', withdrawalDays: 0, cost: 0, notes: 'גיל 60 יום' },
    { title: 'חיסון לפני המלטה — קבוצה ג׳', type: 'vaccination', groupName: 'קבוצה ג׳', count: 38, date: addDays(now, -16), status: 'done', medication: 'מחומשת', dose: '2 מ״ל', withdrawalDays: 0, cost: 570, notes: '38/38 הושלם' },
  ].map(t => ({ ...t, animalTags: [], createdBy: 'seed', createdAt: now }));

  // --- feed records ---
  const feedRecords = [];
  for (const ft of ['תערובת', 'שחת', 'גרעינים']) {
    for (let k = 0; k < 4; k++) {
      feedRecords.push({
        date: addDays(now, -intBetween(2, 120)), feedType: ft, direction: 'in',
        quantityKg: intBetween(800, 3000), cost: intBetween(1800, 6500),
        supplier: pick(['ספקה חקלאית', 'מכון תערובת דרום', 'קואופ אזורי']), groupName: '',
        notes: '', createdBy: 'seed', createdAt: now,
      });
    }
    for (let k = 0; k < 6; k++) {
      feedRecords.push({
        date: addDays(now, -intBetween(1, 60)), feedType: ft, direction: 'out',
        quantityKg: intBetween(200, 900), cost: 0, supplier: '',
        groupName: pick(EWE_GROUPS), notes: '', createdBy: 'seed', createdAt: now,
      });
    }
  }

  // --- sales (this season) ---
  const soldTags = ewes.slice(190, 205);
  const salesDocs = [];
  for (let k = 0; k < 6; k++) {
    const tags = [String(++lambSeq), String(++lambSeq)];
    const kg = +between(60, 120).toFixed(1);
    const perKg = +between(28, 36).toFixed(2);
    salesDocs.push({
      date: addDays(seasonStart, intBetween(20, daysSinceSeason - 1)),
      buyer: pick(['אטליז מרכזי', 'סוחר בקר דרום', 'שוק העיר', 'מטבחיים אזורי']),
      animalTags: tags, extraHeads: 0,
      totalWeightKg: kg, pricePerKg: perKg, pricePerHead: 0,
      total: +(kg * perKg).toFixed(2), notes: '', createdBy: 'seed', createdAt: now,
    });
  }

  // --- purchases (this season) ---
  const purchaseDocs = [{
    date: addDays(seasonStart, 12), seller: 'משק גידור', newAnimals: [], extraHeads: 8,
    total: 9600, notes: 'רכש עתודה', createdBy: 'seed', createdAt: now,
  }];

  // --- manual transactions ---
  const txnDocs = [
    { kind: 'income', date: addDays(now, -30), category: 'סובסידיה', description: 'תמיכת משרד החקלאות', amount: 4200, createdBy: 'seed', createdAt: now },
    { kind: 'expense', date: addDays(now, -18), category: 'ציוד', description: 'מנורות חימום ומחיצות', amount: 1350, createdBy: 'seed', createdAt: now },
    { kind: 'expense', date: addDays(now, -9), category: 'עבודה', description: 'עוזר עונתי', amount: 2800, createdBy: 'seed', createdAt: now },
  ];

  await db.collection('animals').insertMany(animals);
  await db.collection('events').insertMany(events);
  await db.collection('lambings').insertMany(lambings);
  await db.collection('breeding_groups').insertMany(groups);
  await db.collection('treatments').insertMany(treatments);
  await db.collection('feed_records').insertMany(feedRecords);
  await db.collection('sales').insertMany(salesDocs);
  await db.collection('purchases').insertMany(purchaseDocs);
  await db.collection('transactions').insertMany(txnDocs);
  void soldTags;

  // demo users beyond the bootstrap admin
  const users = db.collection('users');
  for (const u of [
    { username: 'hadas', name: 'הדס', role: 'manager', password: 'didi2026!' },
    { username: 'viewer', name: 'צופה', role: 'viewer', password: 'didi2026!' },
  ]) {
    if (!(await users.findOne({ username: u.username }))) {
      await users.insertOne({
        username: u.username, name: u.name, role: u.role,
        passwordHash: await hashPassword(u.password), createdAt: now,
      });
    }
  }

  const summary = {
    animals: animals.length, events: events.length, lambings: lambings.length,
    groups: groups.length, treatments: treatments.length,
    feed: feedRecords.length, sales: salesDocs.length, purchases: purchaseDocs.length, transactions: txnDocs.length,
  };
  log('[seed] done', summary);
  return summary;
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  connect()
    .then(() => seed({ force }))
    .then(() => close())
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { seed };
