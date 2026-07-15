'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Run node:test suites in-process. `node --test` starts a child process per
// test file, which can fail with EPERM in locked-down Windows sandboxes.
const tmpDb = path.join(os.tmpdir(), `steward-test-runner-${process.pid}-${Date.now()}.db`);
process.env.STEWARD_DB_PATH = tmpDb;
// Disables the per-IP register limiter (all test requests share 127.0.0.1).
process.env.NODE_ENV = 'test';

test.after(() => {
  for (const file of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    try {
      fs.unlinkSync(file);
    } catch (_) {
      /* ignore */
    }
  }
});

require('./tiers-debt-band.test');
require('./climb-metrics.test');
require('./api-state-machine.test');
require('./api-snapshot.test');
require('./auth-password-reset.test');
require('./account-security.test');
require('./inactivity-nudge.test');
require('./steward-ai-paydown.test');
require('./steward-ai-pace.test');
require('./classify-debt.test');
require('./verify-account.test');
require('./payoff-math.test');
require('./roadmap-features.test');
// Shares the runner's DB via BOTH the API router and direct db requires, so it
// must run before admin-restore (which cache-clears ../db and rebinds it to an
// isolated file — direct reads after that point see the wrong database).
require('./cutscene-accumulator.test');
require('./steward-chat.test');
require('./steward-ai-tools.test');
require('./bug-reports.test');
require('./nicknames.test');
require('./pace-projection.test');
require('./forecast.test');
require('./invariants.test');
require('./property-invariants.test');
require('./schema-migration.test');
require('./first-balance-origin.test');
require('./payoff-optimizer.test');
require('./payoff-plan-compare.test');
require('./chat-archives.test');
require('./contrast.test');
require('./payoff-plan.test');
require('./audit-metrics.test');
require('./corrected-series.test');
require('./zzz-climb-metrics-apply.test');
require('./admin-restore.test');
require('./cutscene.test');
require('./cutscene-route.test');
// Kept last: these rebind the DB to their own isolated file (like admin-restore),
// so they must not run before suites that share the runner's DB.
require('./audit-fixes.test');
require('./invariants-fuzz.test');
