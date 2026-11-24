// Insights & Reports service Express app (owner: [TEAMMATE 2]).
try { require('dotenv').config({ quiet: true }); } catch { /* dotenv is optional */ }
const { createApp, createLogger } = require('pb-common');
const { createInsightRoutes } = require('./routes/insights');

const logger = createLogger('insights');

module.exports = createApp({
  service: 'insights',
  logger,
  mount: (app) => app.use('/api/insights', createInsightRoutes(logger))
});
