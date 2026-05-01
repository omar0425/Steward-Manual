'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Run node:test suites in-process. `node --test` starts a child process per
// test file, which can fail with EPERM in locked-down Windows sandboxes.
const tmpDb = path.join(os.tmpdir(), `steward-test-runner-${process.pid}-${Date.now()}.db`);
process.env.STEWARD_DB_PATH = tmpDb;

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
require('./debt-sync-validation.test');
require('./debt-sync-debug-api.test');
require('./api-state-machine.test');
require('./api-snapshot.test');
require('./zzz-climb-metrics-apply.test');
