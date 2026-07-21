'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

const COOKIE = 'didi_token';
const TTL_DAYS = 14;

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
};
