'use strict';

/**
 * End-to-end API tests against a real (in-memory) MongoDB.
 * Run with: npm test
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.USE_MEMORY_DB = '1';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test1234';

const { start } = require('../server');
const { close } = require('../lib/db');

let server, base, cookie;

async function req(method, path, body, opts = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie && !opts.noCookie) headers.Cookie = cookie;
  const res = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && /didi_token=[^;]/.test(setCookie)) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  return { status: res.status, data };
}

before(async () => {
  server = await start();
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  await close();
});

test('healthz reports ok with a live database', async () => {
  const { status, data } = await req('GET', '/healthz');
  assert.equal(status, 200);
  assert.equal(data.status, 'ok');
});

test('protected endpoints reject anonymous callers', async () => {
  const { status } = await req('GET', '/api/animals', undefined, { noCookie: true });
  assert.equal(status, 401);
});

test('login rejects bad credentials', async () => {
  const { status } = await req('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert.equal(status, 401);
});

test('login succeeds and issues a session cookie', async () => {
  const { status, data } = await req('POST', '/api/auth/login', { username: 'admin', password: 'test1234' });
  assert.equal(status, 200);
  assert.equal(data.user.role, 'admin');
  assert.ok(cookie, 'expected an auth cookie');
});

test('creates, reads, updates and lists an animal', async () => {
  const create = await req('POST', '/api/animals', {
    tag: '1247', sex: 'F', breed: 'אסף', groupName: 'אמהות ב׳',
    birthDate: '2023-02-14', ministryId: 'IL-384-1247',
  });
  assert.equal(create.status, 201);
  assert.equal(create.data.animal.tag, '1247');

  const dup = await req('POST', '/api/animals', { tag: '1247', sex: 'F' });
  assert.equal(dup.status, 409, 'duplicate tags must be rejected');

  const read = await req('GET', '/api/animals/1247');
  assert.equal(read.status, 200);
  assert.equal(read.data.animal.groupName, 'אמהות ב׳');
  assert.ok(read.data.animal.ageYears > 0);

  const upd = await req('PUT', '/api/animals/1247', { groupName: 'אמהות א׳', sex: 'F' });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.animal.groupName, 'אמהות א׳');

  const list = await req('GET', '/api/animals?q=1247');
  assert.equal(list.data.total, 1);
});

test('weighing event updates the animal last weight', async () => {
  const ev = await req('POST', '/api/animals/1247/events', {
    type: 'weighing', date: '2026-07-12', payload: { weightKg: 68 },
  });
  assert.equal(ev.status, 201);
  const { data } = await req('GET', '/api/animals/1247');
  assert.equal(data.animal.lastWeightKg, 68);
  assert.equal(data.events.length, 1);
});

test('positive pregnancy check sets expected lambing 150 days after mating', async () => {
  await req('POST', '/api/animals/1247/events', {
    type: 'pregnancy_check', date: '2026-05-28',
    payload: { result: 'positive', method: 'אולטרסאונד', matingDate: '2026-04-04' },
  });
  const { data } = await req('GET', '/api/animals/1247');
  assert.equal(data.animal.reproStatus, 'pregnant');
  const expected = new Date(data.animal.expectedLambingDate);
  assert.equal(expected.toISOString().slice(0, 10), '2026-09-01');
});

test('registering a lambing creates the lambs and flips the mother status', async () => {
  const res = await req('POST', '/api/lambings', {
    motherTag: '1247', date: '2026-07-18',
    difficulty: 'normal',
    offspring: [
      { tag: '2101', sex: 'M', weightKg: 4.4, status: 'alive' },
      { tag: '2102', sex: 'F', weightKg: 4.1, status: 'alive' },
    ],
  });
  assert.equal(res.status, 201);

  const lamb = await req('GET', '/api/animals/2101');
  assert.equal(lamb.status, 200, 'newborn should be registered in the flock book');
  assert.equal(lamb.data.animal.motherTag, '1247');
  assert.equal(lamb.data.animal.reproStatus, 'lamb');

  const mother = await req('GET', '/api/animals/1247');
  assert.equal(mother.data.animal.reproStatus, 'lactating');
  assert.equal(mother.data.animal.expectedLambingDate, null);
  assert.equal(mother.data.offspring.length, 2);
  assert.equal(mother.data.stats.offspringCount, 2);
});

test('lambing stats aggregate the season correctly', async () => {
  const { data } = await req('GET', '/api/lambings/stats?from=2026-01-01&to=2026-12-31');
  assert.equal(data.lambings, 1);
  assert.equal(data.offspring, 2);
  assert.equal(data.offspringPerMother, 2);
  assert.equal(data.avgBirthWeight, 4.25);
  assert.equal(data.offspringMortality, 0);
});

test('lambing with an unknown mother is rejected', async () => {
  const { status } = await req('POST', '/api/lambings', {
    motherTag: 'no-such-ewe', offspring: [{ sex: 'F' }],
  });
  assert.equal(status, 400);
});

test('breeding group defaults expected lambing to mating start + 150 days', async () => {
  const res = await req('POST', '/api/breeding/groups', {
    name: 'קבוצה ג׳', rams: ['איל 108'], femaleCount: 38, pregnantCount: 34,
    matingStart: '2026-03-01', matingEnd: '2026-03-20', stage: 'pre_lambing',
  });
  assert.equal(res.status, 201);
  assert.equal(new Date(res.data.group.expectedLambingDate).toISOString().slice(0, 10), '2026-07-29');
  assert.equal(res.data.group.conceptionRate, 89);

  const forecast = await req('GET', '/api/breeding/forecast');
  assert.equal(forecast.data.activeGroups, 1);
  assert.equal(forecast.data.totalExpected, 34);
});

test('dashboard returns a consistent snapshot', async () => {
  const { status, data } = await req('GET', '/api/dashboard');
  assert.equal(status, 200);
  assert.ok(data.headcount >= 3, 'ewe + 2 lambs');
  assert.equal(data.composition.lambs, 2);
  assert.ok(data.season.includes('–'));
});

test('viewer role cannot write', async () => {
  await req('POST', '/api/auth/users', { username: 'ro', name: 'צופה', role: 'viewer', password: 'test1234' });
  const adminCookie = cookie;
  await req('POST', '/api/auth/login', { username: 'ro', password: 'test1234' });

  const denied = await req('POST', '/api/animals', { tag: '9999', sex: 'F' });
  assert.equal(denied.status, 403);

  const allowed = await req('GET', '/api/animals');
  assert.equal(allowed.status, 200, 'viewers may still read');

  const adminOnly = await req('GET', '/api/auth/users');
  assert.equal(adminOnly.status, 403, 'viewers may not manage users');

  cookie = adminCookie;
});

test('deleting an animal removes its events', async () => {
  await req('POST', '/api/animals', { tag: 'tmp-1', sex: 'F' });
  await req('POST', '/api/animals/tmp-1/events', { type: 'note', note: 'בדיקה' });
  const del = await req('DELETE', '/api/animals/tmp-1');
  assert.equal(del.status, 200);
  const gone = await req('GET', '/api/animals/tmp-1');
  assert.equal(gone.status, 404);
});

test('feed: deliveries and consumption compute live stock per type', async () => {
  const inRes = await req('POST', '/api/feed', { feedType: 'תערובת', direction: 'in', quantityKg: 1000, cost: 2500, date: '2026-07-01' });
  assert.equal(inRes.status, 201);
  await req('POST', '/api/feed', { feedType: 'תערובת', direction: 'out', quantityKg: 300, date: '2026-07-10' });
  const { data } = await req('GET', '/api/feed/stock');
  const row = data.stock.find(s => s.feedType === 'תערובת');
  assert.ok(row, 'expected a תערובת stock row');
  assert.equal(row.stockKg, 700);
  assert.equal(row.cost, 2500);
});

test('feed rejects a non-positive quantity', async () => {
  const { status } = await req('POST', '/api/feed', { feedType: 'שחת', direction: 'in', quantityKg: 0 });
  assert.equal(status, 400);
});

test('sale marks its animals sold and books revenue', async () => {
  await req('POST', '/api/animals', { tag: 'sell-1', sex: 'M' });
  await req('POST', '/api/animals', { tag: 'sell-2', sex: 'M' });
  const res = await req('POST', '/api/sales', {
    buyer: 'אטליז מרכזי', date: '2026-07-15',
    animalTags: ['sell-1', 'sell-2'], totalWeightKg: 100, pricePerKg: 30,
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.sale.total, 3000);

  const a = await req('GET', '/api/animals/sell-1');
  assert.equal(a.data.animal.status, 'sold');

  const stats = await req('GET', '/api/sales/stats?from=2026-01-01&to=2026-12-31');
  assert.equal(stats.data.revenue, 3000);
  assert.equal(stats.data.heads, 2);
});

test('sale total can be given explicitly, and cancelling reactivates animals', async () => {
  const res = await req('POST', '/api/sales', { buyer: 'x', date: '2026-07-16', animalTags: ['sell-1'], total: 500 });
  assert.equal(res.data.sale.total, 500);
  const del = await req('DELETE', `/api/sales/${res.data.sale._id}`);
  assert.equal(del.status, 200);
  const a = await req('GET', '/api/animals/sell-1');
  assert.equal(a.data.animal.status, 'active', 'cancelling a sale should reactivate the animal');
});

test('purchase registers new animals in the flock and books the cost', async () => {
  const res = await req('POST', '/api/purchases', {
    seller: 'משק גידור', date: '2026-07-05', total: 4800,
    animals: [{ tag: 'buy-1', sex: 'F', weightKg: 55 }, { tag: 'buy-2', sex: 'F' }],
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.createdCount, 2);

  const a = await req('GET', '/api/animals/buy-1');
  assert.equal(a.data.animal.origin, 'purchased');
  assert.equal(a.data.animal.status, 'active');

  const stats = await req('GET', '/api/purchases/stats?from=2026-01-01&to=2026-12-31');
  assert.equal(stats.data.cost, 4800);
});

test('finance summary nets income against expenses across modules', async () => {
  await req('POST', '/api/finance/transactions', { kind: 'income', category: 'סובסידיה', amount: 1000, date: '2026-07-20' });
  await req('POST', '/api/finance/transactions', { kind: 'expense', category: 'ציוד', amount: 200, date: '2026-07-20' });
  const { data } = await req('GET', '/api/finance/summary?from=2026-01-01&to=2026-12-31');
  // income: sales 3000 (the explicit-total 500 sale was cancelled) + manual 1000
  // expense: feed 2500 + purchase 4800 + manual 200 (treatments have no cost here)
  assert.equal(data.totalIncome, 4000);
  assert.equal(data.totalExpense, 7500);
  assert.equal(data.net, -3500);
});

test('treatment stores medical fields and cost', async () => {
  const res = await req('POST', '/api/breeding/treatments', {
    title: 'חיסון', type: 'vaccination', date: '2026-07-18',
    medication: 'מחומשת', dose: '2 מ״ל', withdrawalDays: 7, cost: 120,
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.treatment.withdrawalDays, 7);
  assert.equal(res.data.treatment.cost, 120);
});

test('viewer cannot write to the new modules', async () => {
  const adminCookie = cookie;
  await req('POST', '/api/auth/login', { username: 'ro', password: 'test1234' });
  const feed = await req('POST', '/api/feed', { feedType: 'x', direction: 'in', quantityKg: 5 });
  assert.equal(feed.status, 403);
  const sale = await req('POST', '/api/sales', { animalTags: ['sell-2'], total: 100 });
  assert.equal(sale.status, 403);
  cookie = adminCookie;
});

test('auth config reports whether Google sign-in is configured', async () => {
  const { status, data } = await req('GET', '/api/auth/config', undefined, { noCookie: true });
  assert.equal(status, 200);
  assert.ok('googleClientId' in data);
});

test('google sign-in rejects a missing or invalid credential', async () => {
  const missing = await req('POST', '/api/auth/google', {}, { noCookie: true });
  assert.equal(missing.status, 400);
  // With no GOOGLE_CLIENT_ID configured in tests, a supplied token is refused.
  const bad = await req('POST', '/api/auth/google', { credential: 'not-a-real-token' }, { noCookie: true });
  assert.equal(bad.status, 401);
});

test('unknown API routes return a JSON 404', async () => {
  const { status, data } = await req('GET', '/api/nope');
  assert.equal(status, 404);
  assert.ok(data.error);
});
