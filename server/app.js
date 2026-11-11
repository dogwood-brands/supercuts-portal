'use strict';
// Builds the express app around an open database. index.js starts it; tests build their own.
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('./auth');
const { makeRbac } = require('./rbac');
const { makeShapes } = require('./shape');
const { makeKpi } = require('./kpi');
const { HttpError, nowIso, notFound } = require('./util');
const { EXT_MIME } = require('./routes/content');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');

function createApp({ db, uploadsDir = path.join(ROOT, 'data', 'uploads'), publicDir = path.join(ROOT, 'public'), config = {}, log = console } = {}) {
  const cfg = { loginLimit: 10, apiLimitPerMinute: 900, ...config };
  const app = express();
  app.set('trust proxy', 1); // one hop: the Cloudflare tunnel
  app.disable('x-powered-by');
  app.set('etag', 'strong');

  const insertAudit = db.prepare('INSERT INTO audit_log (actor_id, action, target_type, target_id, meta_json, ip, created_at) VALUES (?,?,?,?,?,?,?)');
  const insertNote = db.prepare('INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?,?,?,?,?,?)');
  const ctx = {
    db, uploadsDir, config: cfg,
    rbac: makeRbac(db), shapes: makeShapes(db), kpi: makeKpi(db),
    /** Records a sensitive action. Never throws: an audit failure must not fail the request it describes. */
    audit(req, action, targetType = null, targetId = null, meta = null, actorId = undefined) {
      try {
        insertAudit.run(actorId !== undefined ? actorId : req?.user?.id ?? null, action, targetType, targetId, meta ? JSON.stringify(meta).slice(0, 4000) : null, req?.ip || null, nowIso());
      } catch (e) { log.error('audit failed', action, e.message); }
    },
    notify(userId, kind, title, body = null, link = null) {
      try { insertNote.run(userId, kind, String(title).slice(0, 200), body ? String(body).slice(0, 400) : null, link, nowIso()); } catch (e) { log.error('notify failed', e.message); }
    },
  };

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'https:'],
        frameSrc: ['https://academy.dogwoodbrands.com', 'https://www.youtube-nocookie.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(compression());

  app.get('/healthz', (req, res) => {
    let dbState = 'ok';
    try { db.prepare('SELECT 1').get(); } catch { dbState = 'error'; }
    res.status(dbState === 'ok' ? 200 : 503).json({ ok: dbState === 'ok', version: pkg.version, db: dbState });
  });

  // ---- API ----------------------------------------------------------------
  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(rateLimit({
    windowMs: 60 * 1000, limit: cfg.apiLimitPerMinute, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res, next) => next(new HttpError(429, 'slow_down', 'You are going a little fast. Give it a moment and try again.')),
  }));
  // The two bulk-import routes bring their own, larger body parser.
  const json = express.json({ limit: '256kb' });
  api.use((req, res, next) => (/^\/admin\/(import\/dsr|users\/import)$/.test(req.path) ? next() : json(req, res, next)));
  api.use(auth.sessionMiddleware(db));
  api.use(auth.csrfGuard);
  api.use(require('./routes/auth')(ctx)); // login, logout and invite acceptance are reachable signed out
  api.use(auth.requireAuth);
  api.use(require('./routes/feed')(ctx));
  api.use(require('./routes/salons')(ctx));
  api.use(require('./routes/ops')(ctx));
  api.use(require('./routes/hr')(ctx));
  api.use(require('./routes/content')(ctx));
  api.use(require('./routes/admin')(ctx));
  api.use((req, res, next) => next(notFound('That address does not exist.')));
  app.use('/api', api);

  // ---- uploads (signed-in people only) --------------------------------------
  app.get('/uploads/:name', auth.sessionMiddleware(db), (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'unauthorized', 'Please sign in to continue.'));
    const m = /^([a-f0-9]{32})\.(jpg|png|webp)$/.exec(req.params.name);
    if (!m) return next(notFound());
    const file = path.join(uploadsDir, req.params.name);
    if (!fs.existsSync(file)) return next(notFound());
    res.set({ 'Content-Type': EXT_MIME[m[2]], 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
    res.sendFile(file);
  });

  // ---- static app ---------------------------------------------------------
  // No build step and no hashed file names, so code and styles always revalidate (cheap 304s).
  app.use(express.static(publicDir, {
    index: false,
    setHeaders(res, file) {
      const rel = path.relative(publicDir, file).split(path.sep).join('/');
      if (rel.startsWith('fonts/')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else if (rel.startsWith('media/')) res.set('Cache-Control', 'public, max-age=2592000');
      else res.set('Cache-Control', 'no-cache');
      if (rel === 'sw.js') res.set('Service-Worker-Allowed', '/');
    },
  }));
  // Single-page app: any other GET that is not a file request gets the shell.
  app.get('*', (req, res, next) => {
    if (path.extname(req.path)) return next(notFound());
    const index = path.join(publicDir, 'index.html');
    if (!fs.existsSync(index)) return res.type('text/plain').send('SC Portal API is running. The web app has not been installed yet.');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(index);
  });

  // ---- errors: one JSON shape, never a stack trace ---------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = 500;
    let code = 'server_error';
    let message = 'Something went wrong on our side. Please try again.';
    if (err instanceof HttpError) ({ status, code, message } = err);
    else if (err?.type === 'entity.too.large') { status = 400; code = 'too_large'; message = 'That is too large to send. Try a smaller file.'; }
    else if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) { status = 400; code = 'invalid_request'; message = 'We could not read that request.'; }
    else if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') { status = 409; code = 'conflict'; message = 'That already exists.'; }
    else log.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: { code, message } });
  });

  app.locals.ctx = ctx;
  return app;
}

module.exports = { createApp };
