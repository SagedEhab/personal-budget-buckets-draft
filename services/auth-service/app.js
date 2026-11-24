// Auth service Express app (shared team component). Used by server.js (PC) and lambda.js (Lambda).
try { require('dotenv').config({ quiet: true }); } catch { /* dotenv is optional */ }
const { createApp, createLogger } = require('pb-common');
const { createAuthRoutes } = require('./routes/auth');

const logger = createLogger('auth');
const auth = createAuthRoutes(logger);

const app = createApp({
  service: 'auth',
  logger,
  mount: (a) => a.use('/api/auth', auth.router)
});

app.locals.createUser = auth.createUser; // used by scripts/seed-admin.js and the tests
module.exports = app;
