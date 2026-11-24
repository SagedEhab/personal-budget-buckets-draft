// Auth service (SHARED team component): registration, login, profile and admin user management.
// Table PBUsers (env USERS_TABLE):
//   pk USER#<id>        sk PROFILE  -> the user profile (role, status, password hash, lockout state)
//   pk EMAIL#<email>    sk EMAIL    -> e-mail uniqueness index pointing at the user id
const crypto = require('crypto');
const express = require('express');
const {
  createStore, createAuth, issueToken, validate, wrap, errors, checkId
} = require('pb-common');
const { hashPassword, verifyPassword, dummyVerify } = require('../lib/passwords');

const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD'];
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const TOKEN_TTL_SEC = Number(process.env.TOKEN_TTL_SEC) || 3600;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;
const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;

const registerSchema = {
  name: { type: 'string', required: true, minLength: 2, maxLength: 60 },
  email: { type: 'string', required: true, maxLength: 120, pattern: EMAIL, lower: true, patternMessage: 'email is not a valid e-mail address.' },
  password: { type: 'string', required: true, trim: false, pattern: PASSWORD, patternMessage: 'password must be 10-128 characters and contain a letter and a digit.' },
  baseCurrency: { type: 'string', enum: CURRENCIES, upper: true, default: 'EGP' }
};
const loginSchema = {
  email: { type: 'string', required: true, maxLength: 120, lower: true },
  password: { type: 'string', required: true, trim: false, maxLength: 128 }
};
const profileSchema = {
  name: { type: 'string', minLength: 2, maxLength: 60 },
  baseCurrency: { type: 'string', enum: CURRENCIES, upper: true }
};
const statusSchema = { status: { type: 'string', required: true, enum: ['active', 'disabled'] } };

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, status: u.status,
    baseCurrency: u.baseCurrency, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null
  };
}

function createAuthRoutes(logger) {
  const users = createStore('USERS_TABLE');
  // This service owns the users table, so it checks account status and role there directly.
  const { requireAuth, requireRole } = createAuth(logger, {
    cache: false,
    lookupUser: async (req) => {
      const u = await users.get(`USER#${req.user.id}`, 'PROFILE');
      return u ? { status: u.status, role: u.role } : null;
    }
  });
  const router = express.Router();

  async function createUser({ name, email, password, baseCurrency = 'EGP', role = 'user' }) {
    const id = crypto.randomUUID();
    const claimed = await users.put({ pk: `EMAIL#${email}`, sk: 'EMAIL', userId: id }, { ifNotExists: true });
    if (!claimed) return null;
    const user = {
      pk: `USER#${id}`, sk: 'PROFILE', id, name, email, role, status: 'active', baseCurrency,
      passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null,
      createdAt: new Date().toISOString()
    };
    await users.put(user);
    return user;
  }

  // 1. Register a standard user (role is always "user": it cannot be chosen by the client)
  router.post('/register', wrap(async (req, res) => {
    const input = validate(req.body, registerSchema);
    const user = await createUser(input);
    if (!user) throw errors.conflict('EMAIL_TAKEN', 'An account with this e-mail already exists.');
    logger.info('USER_REGISTERED', { requestId: req.requestId, userId: user.id });
    const token = await issueToken(user, { expiresInSec: TOKEN_TTL_SEC });
    res.status(201).json({ user: publicUser(user), token, expiresIn: TOKEN_TTL_SEC });
  }));

  // 2. Login with lockout after repeated failures
  router.post('/login', wrap(async (req, res) => {
    const { email, password } = validate(req.body, loginSchema);
    const index = await users.get(`EMAIL#${email}`, 'EMAIL');
    const user = index ? await users.get(`USER#${index.userId}`, 'PROFILE') : null;
    const fail = () => errors.unauthorized('E-mail or password is incorrect.');

    if (!user) {
      await dummyVerify(password); // same timing as a real check: no account enumeration
      logger.warn('LOGIN_FAILED', { requestId: req.requestId, reason: 'unknown_email', ip: req.ip });
      logger.metric('FailedLogins', 1);
      throw fail();
    }
    if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) {
      logger.warn('LOGIN_BLOCKED_LOCKED', { requestId: req.requestId, userId: user.id, ip: req.ip });
      const e = errors.unprocessable('ACCOUNT_LOCKED', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
      e.status = 429;
      throw e;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failedLogins = (user.failedLogins || 0) + 1;
      const lock = failedLogins >= MAX_FAILED_LOGINS;
      await users.update(user.pk, user.sk, {
        failedLogins: lock ? 0 : failedLogins,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null
      });
      logger.warn(lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', { requestId: req.requestId, userId: user.id, attempt: failedLogins, ip: req.ip });
      logger.metric('FailedLogins', 1);
      throw fail();
    }
    if (user.status !== 'active') {
      logger.warn('LOGIN_BLOCKED_DISABLED', { requestId: req.requestId, userId: user.id });
      throw errors.forbidden('This account has been disabled. Contact the administrator.');
    }
    const updated = await users.update(user.pk, user.sk, {
      failedLogins: 0, lockedUntil: null, lastLoginAt: new Date().toISOString()
    });
    logger.info('LOGIN_SUCCEEDED', { requestId: req.requestId, userId: user.id, role: user.role });
    const token = await issueToken(updated, { expiresInSec: TOKEN_TTL_SEC });
    res.status(200).json({ token, expiresIn: TOKEN_TTL_SEC, user: publicUser(updated) });
  }));

  // 3. Own profile
  router.get('/me', requireAuth, wrap(async (req, res) => {
    const user = await users.get(`USER#${req.user.id}`, 'PROFILE');
    if (!user) throw errors.notFound('User');
    res.status(200).json(publicUser(user));
  }));

  // 4. Update own profile (name, base currency) -> new token with the new claims
  router.patch('/me', requireAuth, wrap(async (req, res) => {
    const changes = validate(req.body, profileSchema, { partial: true });
    const user = await users.update(`USER#${req.user.id}`, 'PROFILE', { ...changes, updatedAt: new Date().toISOString() });
    if (!user) throw errors.notFound('User');
    logger.info('PROFILE_UPDATED', { requestId: req.requestId, userId: user.id, fields: Object.keys(changes) });
    const token = await issueToken(user, { expiresInSec: TOKEN_TTL_SEC });
    res.status(200).json({ user: publicUser(user), token, expiresIn: TOKEN_TTL_SEC });
  }));

  // 5. Admin: list users (no password hashes are ever returned)
  router.get('/users', requireAuth, requireRole('admin'), wrap(async (req, res) => {
    const items = await users.scan({ prefix: 'PROFILE' });
    const list = items.filter((u) => u.pk.startsWith('USER#')).map(publicUser)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.status(200).json({ items: list, count: list.length });
  }));

  // 6. Admin: enable / disable an account
  router.patch('/users/:id/status', requireAuth, requireRole('admin'), wrap(async (req, res) => {
    const id = checkId(req.params.id, 'user id');
    const { status } = validate(req.body, statusSchema);
    if (id === req.user.id) throw errors.conflict('CANNOT_CHANGE_SELF', 'Administrators cannot disable their own account.');
    const user = await users.update(`USER#${id}`, 'PROFILE', { status, updatedAt: new Date().toISOString() });
    if (!user) throw errors.notFound('User');
    logger.info('USER_STATUS_CHANGED', { requestId: req.requestId, adminId: req.user.id, userId: id, status });
    res.status(200).json(publicUser(user));
  }));

  return { router, createUser, users };
}

module.exports = { createAuthRoutes, CURRENCIES };
