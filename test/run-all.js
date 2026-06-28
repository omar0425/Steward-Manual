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
require('./pace-projection.test');
require('./forecast.test');
require('./invariants.test');
require('./contrast.test');
require('./payoff-plan.test');
require('./corrected-series.test');
require('./zzz-climb-metrics-apply.test');
require('./admin-restore.test');
require('./cutscene.test');
require('./cutscene-route.test');
