// Single-user session auth for the deployed app.
// No extra dependencies: password hashing and session signatures use node:crypto.
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const COOKIE = 'gst_session';
const MAX_AGE = 7 * 24 * 60 * 60; // 7 days, seconds
const FAIL_WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 10;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomPassword() {
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function hash(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64).toString('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export function createAuth(dataDir) {
  const file = path.join(dataDir, 'auth.json');
  fs.mkdirSync(dataDir, { recursive: true });

  function defaults() {
    const salt = crypto.randomBytes(16).toString('hex');
    const password = randomPassword();
    return {
      username: 'admin',
      salt,
      hash: hash(password, salt),
      secret: crypto.randomBytes(32).toString('hex'),
      version: 1,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      __password: password, // returned once for the first-run log, never persisted
    };
  }

  function load() {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg.username && cfg.salt && cfg.hash && cfg.secret) return cfg;
    } catch { /* first run */ }
    return defaults();
  }

  let cfg = load();
  if (cfg.__password) {
    const generated = cfg.__password; // shown once, never written to disk
    const fresh = { ...cfg };
    delete fresh.__password;
    cfg = fresh;
    save();
    console.log('\n============================================================');
    console.log('[auth] First-run admin credentials created:');
    console.log(`[auth]   username: ${cfg.username}`);
    console.log(`[auth]   password: ${generated}`);
    console.log('[auth] Change the password after logging in (Security menu).');
    console.log('============================================================\n');
  }

  function save() {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  }

  function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', cfg.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    if (!safeEqual(crypto.createHmac('sha256', cfg.secret).update(body).digest('base64url'), sig)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (p.u !== cfg.username || p.v !== cfg.version || !(p.exp > Date.now())) return null;
      return p;
    } catch { return null; }
  }

  function cookieOptions(req) {
    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: forwarded === 'https' || Boolean(req.secure),
      path: '/',
      maxAge: MAX_AGE * 1000,
    };
  }

  function issue(req, res) {
    const token = sign({ u: cfg.username, v: cfg.version, exp: Date.now() + MAX_AGE * 1000 });
    res.cookie(COOKIE, token, cookieOptions(req));
    return token;
  }

  const attempts = new Map();
  function limited(ip) {
    const now = Date.now();
    const rec = attempts.get(ip);
    if (!rec || now > rec.resetAt) {
      attempts.set(ip, { count: 0, resetAt: now + FAIL_WINDOW });
      return false;
    }
    return rec.count >= MAX_FAILS;
  }
  function failed(ip) {
    const now = Date.now();
    const rec = attempts.get(ip) || { count: 0, resetAt: now + FAIL_WINDOW };
    if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + FAIL_WINDOW; }
    rec.count += 1;
    attempts.set(ip, rec);
  }

  function requireAuth(req, res, next) {
    const urlPath = String(req.originalUrl || '').split('?')[0];
    if (urlPath === '/api/health') return next(); // keep uptime checks public
    const payload = verifyToken(readCookie(req, COOKIE));
    if (!payload) return res.status(401).json({ error: 'Please sign in', code: 'AUTH_REQUIRED' });
    req.user = { username: payload.u };
    return next();
  }

  const router = express.Router();

  router.post('/login', async (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (limited(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    // Always hash to keep timing similar for a wrong username vs wrong password.
    const candidate = hash(password, cfg.salt);
    const okUser = safeEqual(username, cfg.username);
    const okPass = safeEqual(candidate, cfg.hash);
    if (!okUser || !okPass) {
      failed(ip);
      await new Promise((r) => setTimeout(r, 250));
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    attempts.delete(ip);
    issue(req, res);
    return res.json({ ok: true, username: cfg.username, mustChangePassword: Boolean(cfg.mustChangePassword) });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ ok: true, username: req.user.username, mustChangePassword: Boolean(cfg.mustChangePassword) });
  });

  router.post('/password', requireAuth, (req, res) => {
    const current = String(req.body?.currentPassword || '');
    const nextPassword = String(req.body?.newPassword || '');
    if (!safeEqual(hash(current, cfg.salt), cfg.hash)) return res.status(401).json({ error: 'Current password is incorrect' });
    if (nextPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    if (nextPassword.length > 200) return res.status(400).json({ error: 'New password is too long' });
    cfg.salt = crypto.randomBytes(16).toString('hex');
    cfg.hash = hash(nextPassword, cfg.salt);
    cfg.version += 1;
    cfg.mustChangePassword = false;
    save();
    issue(req, res); // stay signed in with a freshly signed session
    res.json({ ok: true, username: cfg.username });
  });

  return { router, requireAuth, configFile: file };
}

export default createAuth;
