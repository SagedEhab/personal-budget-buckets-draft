// Analytics rules for the Insights & Reports service (pure functions, unit-testable).
const { round2 } = require('pb-common');

const pctChange = (now, before) => (before > 0 ? round2(((now - before) / before) * 100) : null);

// Month-end projection with a simple run-rate: spent so far / days elapsed * days in month
function projectMonthEnd(spent, daysElapsed, daysInMonth) {
  if (daysElapsed <= 0) return spent;
  return round2((spent / daysElapsed) * daysInMonth);
}

// Least-squares slope of a series (change per month). Direction is "stable" when the
// slope is within 5% of the average, so small noise is not reported as a trend.
function trend(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, direction: 'stable' };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  const slope = den === 0 ? 0 : num / den;
  const threshold = Math.abs(yMean) * 0.05;
  const direction = Math.abs(slope) <= threshold ? 'stable' : slope > 0 ? 'rising' : 'falling';
  return { slope: round2(slope), direction };
}

// CSV with protection against spreadsheet formula injection: cells starting with = + - @
// (or tab/CR) are prefixed with ' so Excel shows them as text instead of running them.
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

module.exports = { pctChange, projectMonthEnd, trend, csvCell, toCsv };
