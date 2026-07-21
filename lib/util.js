'use strict';

/** Lambing season runs Oct 1 → Sep 30. Returns {start, end, label}. */
function currentSeason(now = new Date()) {
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 9 ? y : y - 1; // month 9 = October
  const start = new Date(Date.UTC(startYear, 9, 1));
  const end = new Date(Date.UTC(startYear + 1, 8, 30, 23, 59, 59));
  return { start, end, label: `${startYear}–${startYear + 1}` };
}

const GESTATION_DAYS = 150;

/** UTC-stable: avoids DST/timezone drift that local setDate() introduces. */
function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 86400000);
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function ageYears(birthDate) {
  if (!birthDate) return null;
  return +(daysBetween(birthDate, new Date()) / 365.25).toFixed(1);
}

function num(v, fallback = null) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function clean(str) {
  return String(str === null || str === undefined ? '' : str).trim();
}

/** Wraps an async route so rejections reach the error handler. */
function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { currentSeason, GESTATION_DAYS, addDays, daysBetween, toDate, ageYears, num, clean, wrap };
