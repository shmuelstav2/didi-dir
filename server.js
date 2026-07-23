'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { connect, getDb, DB_NAME } = require('./lib/db');
const { readUser } = require('./lib/auth');
const { hashPassword } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 8080;
const ENV_LABEL = process.env.ENV_LABEL || 'dev';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(readUser);

// --- health ---
app.get('/healthz', async (req, res) => {
  const started = Date.now();
  try {
    await getDb().command({ ping: 1 });
    const ms = Date.now() - started;
    // The `mongo` block matches the lulim-monitoring dashboard's healthz
    // convention so this app can be probed by the same uptime dashboard.
    res.json({
      status: 'ok', env: ENV_LABEL, db: DB_NAME,
      mongo: { ok: true, ms },
      mongoMs: ms, uptimeSec: Math.round(process.uptime()),
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded', env: ENV_LABEL,
      mongo: { ok: false, error: err.message },
      error: err.message,
    });
  }
});

app.get('/api/version', (req, res) => {
  res.json({
    name: 'didi-dir',
    version: require('./package.json').version,
    env: ENV_LABEL,
    commit: process.env.GIT_COMMIT || 'local',
  });
});

// --- API ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/animals', require('./routes/animals'));
app.use('/api/lambings', require('./routes/lambings'));
app.use('/api/breeding', require('./routes/breeding'));
app.use('/api/dashboard', require('./routes/dashboard'));

// --- static UI ---
const PUBLIC_DIR = path.join(__dirname, 'public');
// maxAge 0 + ETag: the browser revalidates every asset, so a deploy is never
// served as a mix of new HTML and stale JS. Unchanged files still return 304.
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  maxAge: 0,
  etag: true,
  setHeaders: res => res.setHeader('Cache-Control', 'no-cache'),
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, req.user ? 'app.html' : 'login.html'));
});

app.get('/app', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'לא נמצא' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.stack || err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'שגיאת שרת' });
});

/** Creates the first admin so a fresh deployment is never locked out. */
async function bootstrapAdmin() {
  const db = getDb();
  const count = await db.collection('users').countDocuments();
  if (count > 0) return;
  const username = (process.env.ADMIN_USER || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'didi2026!';
  await db.collection('users').insertOne({
    username,
    name: process.env.ADMIN_NAME || 'מנהל מערכת',
    role: 'admin',
    passwordHash: await hashPassword(password),
    createdAt: new Date(),
  });
  console.log(`[bootstrap] created initial admin user "${username}"`);
}

async function start() {
  await connect();
  await bootstrapAdmin();
  if (process.env.SEED_ON_START === '1') {
    await require('./scripts/seed').seed({ quiet: true });
  }
  return new Promise(resolve => {
    const server = app.listen(PORT, () => {
      console.log(`[didi-dir] listening on :${PORT} (${ENV_LABEL})`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}

module.exports = { app, start };
