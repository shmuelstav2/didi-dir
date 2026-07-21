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

test('unknown API routes return a JSON 404', async () => {
  const { status, data } = await req('GET', '/api/nope');
  assert.equal(status, 404);
  assert.ok(data.error);
});
