'use strict';

const express = require('express');
const { getDb } = require('../lib/db');
const auth = require('../lib/auth');
const { wrap, clean } = require('../lib/util');

const router = express.Router();

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await auth.verifyCredentials(username, password);
  if (!user) return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
  auth.setCookie(res, auth.sign(user));
  await getDb().collection('users').updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });
  res.json({ user: { username: user.username, name: user.name, role: user.role } });
}));

/** Public: tells the login page whether to render the Google button. */
router.get('/config', (req, res) => {
  res.json({ googleClientId: auth.googleClientId() });
});

router.post('/google', wrap(async (req, res) => {
  const credential = (req.body || {}).credential;
  if (!credential) return res.status(400).json({ error: 'חסר אסימון Google' });
  let identity;
  try {
    identity = await auth.verifyGoogleToken(credential);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
  const user = await auth.userFromGoogle(identity);
  if (!user) return res.status(403).json({ error: `הכתובת ${identity.email} אינה מורשית. פנו למנהל המערכת.` });
  auth.setCookie(res, auth.sign(user));
  await getDb().collection('users').updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });
  res.json({ user: { username: user.username, name: user.name, role: user.role } });
}));

router.post('/logout', (req, res) => {
  auth.clearCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'לא מחובר' });
  res.json({ user: { username: req.user.username, name: req.user.name, role: req.user.role } });
});

router.post('/password', auth.requireAuth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (clean(newPassword).length < 4) return res.status(400).json({ error: 'סיסמה חדשה חייבת להיות באורך 4 תווים לפחות' });
  const user = await auth.verifyCredentials(req.user.username, currentPassword);
  if (!user) return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
  await getDb().collection('users').updateOne(
    { _id: user._id },
    { $set: { passwordHash: await auth.hashPassword(newPassword) } }
  );
  res.json({ ok: true });
}));

// --- user management (admin) ---
router.get('/users', auth.requireAdmin, wrap(async (req, res) => {
  const users = await getDb().collection('users')
    .find({}, { projection: { passwordHash: 0 } })
    .sort({ username: 1 }).toArray();
  res.json({ users });
}));

router.post('/users', auth.requireAdmin, wrap(async (req, res) => {
  const username = clean(req.body.username).toLowerCase();
  const name = clean(req.body.name) || username;
  const role = ['admin', 'manager', 'viewer'].includes(req.body.role) ? req.body.role : 'viewer';
  const password = clean(req.body.password);
  if (!username || password.length < 4) return res.status(400).json({ error: 'שם משתמש וסיסמה (4+ תווים) נדרשים' });
  const exists = await getDb().collection('users').findOne({ username });
  if (exists) return res.status(409).json({ error: 'שם המשתמש כבר קיים' });
  const doc = { username, name, role, passwordHash: await auth.hashPassword(password), createdAt: new Date() };
  await getDb().collection('users').insertOne(doc);
  delete doc.passwordHash;
  res.status(201).json({ user: doc });
}));

router.delete('/users/:username', auth.requireAdmin, wrap(async (req, res) => {
  const username = clean(req.params.username).toLowerCase();
  if (username === req.user.username) return res.status(400).json({ error: 'אי אפשר למחוק את המשתמש שאיתו מחוברים' });
  const r = await getDb().collection('users').deleteOne({ username });
  if (!r.deletedCount) return res.status(404).json({ error: 'משתמש לא נמצא' });
  res.json({ ok: true });
}));

module.exports = router;
