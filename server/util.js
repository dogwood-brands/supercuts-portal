'use strict';
// Shared helpers: errors, validation, dates. No I/O here.

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (message, code = 'invalid_request') => new HttpError(400, code, message);
const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, 'unauthorized', message);
const forbidden = (message = 'You do not have access to that.') => new HttpError(403, 'forbidden', message);
const notFound = (message = 'We could not find that.') => new HttpError(404, 'not_found', message);
const conflict = (message) => new HttpError(409, 'conflict', message);

const TZ = 'America/Los_Angeles';
const nowIso = () => new Date().toISOString();
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Calendar date (YYYY-MM-DD) in the company's home time zone. */
const todayLocal = (d = new Date()) => dayFmt.format(d);
const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const weekday = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
const mondayOf = (ymd) => addDays(ymd, -((weekday(ymd) + 6) % 7));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

// ---- validation -----------------------------------------------------------
// Each validator returns a clean value or throws a 400 with a sentence a person can act on.
const v = {
  str(value, name, { max = 200, min = 0, required = true, trim = true } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw bad(`${name} is required.`);
      return null;
    }
    if (typeof value !== 'string') throw bad(`${name} must be text.`);
    const s = trim ? value.trim() : value;
    if (!s && required) throw bad(`${name} is required.`);
    if (!s) return null;
    if (s.length < min) throw bad(`${name} must be at least ${min} characters.`);
    if (s.length > max) throw bad(`${name} must be ${max} characters or fewer.`);
    return s;
  },
  int(value, name, { min = -2147483648, max = 2147483647, required = true } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw bad(`${name} is required.`);
      return null;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n)) throw bad(`${name} must be a whole number.`);
    if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}.`);
    return n;
  },
  num(value, name, { min = -1e12, max = 1e12, required = true } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw bad(`${name} is required.`);
      return null;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) throw bad(`${name} must be a number.`);
    if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}.`);
    return n;
  },
  oneOf(value, name, options, { required = true } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw bad(`${name} is required.`);
      return null;
    }
    if (!options.includes(value)) throw bad(`${name} must be one of: ${options.join(', ')}.`);
    return value;
  },
  date(value, name, { required = true } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw bad(`${name} is required.`);
      return null;
    }
    if (!isDate(value)) throw bad(`${name} must be a date in YYYY-MM-DD form.`);
    return value;
  },
  bool(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
  },
  /** Local URL produced by this app (uploads or bundled media), or an https link when allowExternal. */
  url(value, name, { required = false, allowExternal = false } = {}) {
    const s = v.str(value, name, { max: 500, required });
    if (s === null) return null;
    if (/^\/(uploads|media)\/[A-Za-z0-9._\/-]+$/.test(s) && !s.includes('..')) return s;
    if (allowExternal && /^https:\/\/[^\s<>"']+$/.test(s)) return s;
    throw bad(`${name} is not a link we can use.`);
  },
};

const idParam = (req, key = 'id') => {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n) || n < 1) throw notFound();
  return n;
};

const json = (s, fallback) => {
  if (s === null || s === undefined) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

const encodeCursor = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const decodeCursor = (s) => {
  if (!s) return null;
  try { return JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')); } catch { throw bad('That page link is no longer valid.'); }
};
const limitParam = (req, def = 20, max = 50) => {
  const n = Number(req.query.limit);
  if (!Number.isInteger(n) || n < 1) return def;
  return Math.min(n, max);
};

const round1 = (n) => Math.round(n * 10) / 10;
const pctChange = (cur, prev) => (prev > 0 ? round1(((cur - prev) / prev) * 100) : null);

module.exports = {
  HttpError, bad, unauthorized, forbidden, notFound, conflict,
  TZ, nowIso, todayLocal, addDays, daysInMonth, weekday, mondayOf, isDate,
  v, idParam, json, encodeCursor, decodeCursor, limitParam, round1, pctChange,
};
