'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { getDb } = require('./db');

const COOKIE = 'didi_token';
const TTL_DAYS = 14;

function googleClientId() {
  return (process.env.GOOGLE_CLIENT_ID || '').trim();
}

/** Emails allowed to sign in with Google, as "email" or "email:role". */
function googleAllowlist() {
  const map = {};
  for (const raw of (process.env.GOOGLE_ALLOWED_EMAILS || '').split(',')) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    const [email, role] = entry.split(':');
    map[email] = ['admin', 'manager', 'viewer'].includes(role) ? role : 'manager';
  }
  return map;
}

let _oauth = null;
function oauthClient() {
  if (!_oauth) _oauth = new OAuth2Client(googleClientId());
  return _oauth;
}

/** Verifies a Google ID token; returns {email, name, sub} or throws. */
async function verifyGoogleToken(credential) {
  const clientId = googleClientId();
  if (!clientId) throw new Error('התחברות Google אינה מוגדרת');
  const ticket = await oauthClient().verifyIdToken({ idToken: credential, audience: clientId });
  const p = ticket.getPayload();
  if (!p || !p.email) throw new Error('אסימון Google לא תקין');
  if (!p.email_verified) throw new Error('כתובת האימייל ב-Google אינה מאומתת');
  return { email: String(p.email).toLowerCase(), name: p.name || p.email, sub: p.sub };
}

/**
 * Resolves a verified Google identity to a user. Matches an existing user by
 * email or username; otherwise provisions one only if the email is allowlisted.
 */
async function userFromGoogle({ email, name }) {
  const users = getDb().collection('users');
  let user = await users.findOne({ $or: [{ email }, { username: email }] });
  if (user) return user;

  const role = googleAllowlist()[email];
  if (!role) return null; // not a known user and not allowlisted
  const doc = {
    username: email, email, name: name || email, role,
    passwordHash: '', // Google-only account
    createdAt: new Date(),
  };
  await users.insertOne(doc);
  return doc;
}

function secret() {
  return process.env.JWT_SECRET || 'didi-dir-dev-secret-change-me';
}

function sign(user) {
  return jwt.sign(
    { sub: String(user._id), username: user.username, name: user.name, role: user.role },
    secret(),
    { expiresIn: `${TTL_DAYS}d` }
  );
}

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax' });
}

/** Populates req.user when a valid token is present. Never rejects. */
function readUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    try {
      req.user = jwt.verify(token, secret());
    } catch (_) {
      req.user = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'נדרשת התחברות' });
  next();
}

/** admin + manager may write; viewer is read-only. */
function requireWrite(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'נדרשת התחברות' });
  if (req.user.role === 'viewer') return res.status(403).json({ error: 'אין הרשאת כתיבה' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'נדרשת התחברות' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'נדרשת הרשאת מנהל מערכת' });
  next();
}

async function verifyCredentials(username, password) {
  const user = await getDb().collection('users').findOne({ username: String(username || '').trim().toLowerCase() });
  if (!user) return null;
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  return ok ? user : null;
}

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
}

module.exports = {
  COOKIE, sign, setCookie, clearCookie, readUser,
  requireAuth, requireWrite, requireAdmin,
  verifyCredentials, hashPassword,
  googleClientId, verifyGoogleToken, userFromGoogle,
};
