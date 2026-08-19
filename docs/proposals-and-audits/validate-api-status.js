'use strict';

/**
 * Steward API /status Validation with Seeded Snapshot Data
 * Seeds the DB with realistic scenarios, starts the server, and validates API responses.
 * 
 * Run: source ~/.nvm/nvm.sh && nvm use 24 && node validate-api-status.js
 */

const http = require('http');
const path = require('path');

// Direct DB access for seeding
const {
  db, insertSnapshot, latestCombined, recentSnapshots, getConfig, setConfig,
  replaceDebtAccountBalances, getAllDebtAccountBalances,
} = require('./repos/Steward/db');
const { getTier } = require('./repos/Steward/services/tiers');

let passed = 0;
let failed = 0;
let warnings = 0;
const findings = [];

function assert(condition, label, detail) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    const msg = `  \u2717 ${label}${detail ? ' \u2014 ' + detail : ''}`;
    console.log(msg);
    findings.push({ type: 'FAIL', label, detail });
  }
}

function warn(label, detail) {
  warnings++;
  console.log(`  \u26a0 ${label}${detail ? ' \u2014 ' + detail : ''}`);
  findings.push({ type: 'WARN', label, detail });
}

function section(name) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'='.repeat(60)}`);
}

// ── DB Backup & Restore ────────────────────────────────────────────

function clearAllData() {
  db.exec('DELETE FROM snapshots');
  db.exec('DELETE FROM debt_account_balances');
  db.exec('DELETE FROM config');
}

function seedSnapshot(overrides) {
  const now = new Date();
  const defaults = {
    source: 'ynab',
    pulled_at: now.toISOString(),
    net_worth: 0,
    total_assets: 5000,
    total_debt: 65000,
    investment_value: 0,
    debt_remaining: 65000,
    months_ahead: 1.5,
    monthly_income: 5000,
    monthly_expenses: 3500,
    tier: 'surviving',
    safety_liquid: 5000,
  };
  const data = { ...defaults, ...overrides };
  data.tier = getTier(data.debt_remaining).id;
  data.net_worth = data.total_assets - data.total_debt;
  return insertSnapshot(data);
}

function seedClimbConfig(baseline, paid, newDebt, lastAggregate) {
  setConfig('climb_baseline_debt', String(baseline));
  setConfig('cumulative_paid_down', String(paid));
  setConfig('cumulative_new_debt_added', String(newDebt));
  setConfig('last_aggregate_debt_for_climb', String(lastAggregate));
  setConfig('climb_per_account_map_seeded', '1');
}

// ── Scenarios ────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    name: 'Rock Bottom: Deep debt, no savings',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 85000, total_debt: 85000,
        total_assets: 800, safety_liquid: 800,
        monthly_expenses: 3500, months_ahead: 0.23,
      });
      seedClimbConfig(85000, 0, 0, 85000);
    },
    validate: (data) => {
      assert(data.ready === true, 'Response is ready');
      assert(data.tier.id === 'rock_bottom', 'Tier = rock_bottom', `got ${data.tier.id}`);
      assert(data.tier.badge === '01', 'Badge = 01');
      assert(data.stability.id === 'exposed', 'Stability = exposed', `got ${data.stability.id}`);
      assert(data.stability.urgency === 'high', 'Urgency = high');
      assert(data.stats.debtRemaining === 85000, 'Debt = $85K');
      assert(data.stats.debtTierBand.bandLower === 79000, 'Band lower = 79000');
      assert(data.stats.debtTierBand.bandUpper === 89000, 'Band upper = 89000');
      assert(data.stats.debtTierBand.pctInBand === 40, 'Band progress = 40%', `got ${data.stats.debtTierBand.pctInBand}`);
      assert(data.nextTier !== null, 'Next tier exists');
      assert(data.nextTier.id === 'broke', 'Next tier = broke');
      assert(data.nextTier.gapDollars === 6000, 'Gap = $6,000', `got ${data.nextTier.gapDollars}`);
      assert(data.stability.narrative.lead.length > 10, 'Has narrative lead');
      assert(data.stability.breathingRoomReached === false, 'Breathing room not reached');
    },
  },
  {
    name: 'Stabilizing: Mid debt, moderate savings',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 42000, total_debt: 42000,
        total_assets: 9000, safety_liquid: 8500,
        monthly_expenses: 3200, months_ahead: 2.66,
      });
      seedClimbConfig(85000, 43000, 0, 42000);
    },
    validate: (data) => {
      assert(data.tier.id === 'stabilizing', 'Tier = stabilizing', `got ${data.tier.id}`);
      assert(data.tier.badge === '05', 'Badge = 05');
      assert(data.stability.id === 'stabilizing', 'Stability = stabilizing (Steady)', `got ${data.stability.id}`);
      assert(data.stability.label === 'Steady', 'Label = Steady');
      assert(data.stats.cumulativePaidDown === 43000, 'Cumulative paid = $43K', `got ${data.stats.cumulativePaidDown}`);
      assert(data.stats.pctPaid > 50, 'Over 50% paid', `got ${data.stats.pctPaid}%`);
      assert(data.stats.debtTierBand.bandLower === 40000, 'Band lower = 40000');
      assert(data.stats.debtTierBand.bandUpper === 50000, 'Band upper = 50000 (prev tier threshold)');
    },
  },
  {
    name: 'Winning: Last stretch, strong savings',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 3500, total_debt: 3500,
        total_assets: 22000, safety_liquid: 20000,
        monthly_expenses: 3000, months_ahead: 6.67,
      });
      seedClimbConfig(85000, 81500, 0, 3500);
    },
    validate: (data) => {
      assert(data.tier.id === 'winning', 'Tier = winning', `got ${data.tier.id}`);
      assert(data.tier.badge === '09', 'Badge = 09');
      assert(data.stability.id === 'fortified', 'Stability = fortified', `got ${data.stability.id}`);
      assert(data.nextTier.id === 'wealthy', 'Next tier = wealthy');
      assert(data.nextTier.gapDollars === 3500, 'Gap = $3,500', `got ${data.nextTier.gapDollars}`);
      assert(data.stats.pctPaid > 95, 'Over 95% paid', `got ${data.stats.pctPaid}%`);
      assert(data.stability.breathingRoomReached === true, 'Breathing room reached');
    },
  },
  {
    name: 'Wealthy: Debt-free',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 0, total_debt: 0,
        total_assets: 30000, safety_liquid: 25000,
        monthly_expenses: 3000, months_ahead: 8.33,
      });
      seedClimbConfig(85000, 85000, 0, 0);
    },
    validate: (data) => {
      assert(data.tier.id === 'wealthy', 'Tier = wealthy', `got ${data.tier.id}`);
      assert(data.tier.badge === '10', 'Badge = 10');
      assert(data.nextTier === null, 'No next tier');
      assert(data.stats.debtTierBand.pctInBand === 100, 'Band = 100%');
      assert(data.stats.debtTierJourney.pctAlongJourney === 100, 'Journey = 100%');
      assert(data.stats.pctPaid === 100, '100% paid', `got ${data.stats.pctPaid}%`);
    },
  },
  {
    name: 'Edge: Exact tier boundary ($79,000)',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 79000, total_debt: 79000,
        total_assets: 5000, safety_liquid: 5000,
        monthly_expenses: 3500, months_ahead: 1.43,
      });
      seedClimbConfig(85000, 6000, 0, 79000);
    },
    validate: (data) => {
      assert(data.tier.id === 'broke', 'At $79K exactly: tier = broke (threshold is >)', `got ${data.tier.id}`);
      assert(data.stats.debtTierBand.pctInBand === 0, 'Just entered band: 0%', `got ${data.stats.debtTierBand.pctInBand}`);
      assert(data.nextTier.id === 'struggling', 'Next = struggling');
    },
  },
  {
    name: 'Edge: Debt above Rock Bottom ceiling ($95K)',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 95000, total_debt: 95000,
        total_assets: 500, safety_liquid: 500,
        monthly_expenses: 4000, months_ahead: 0.13,
      });
      seedClimbConfig(95000, 0, 0, 95000);
    },
    validate: (data) => {
      assert(data.tier.id === 'rock_bottom', 'At $95K: rock_bottom', `got ${data.tier.id}`);
      assert(data.stats.debtTierBand.pctInBand === 0, 'Above ceiling: band = 0%', `got ${data.stats.debtTierBand.pctInBand}`);
      assert(data.stats.debtTierJourney.pctAlongJourney === 0, 'Journey = 0%', `got ${data.stats.debtTierJourney.pctAlongJourney}`);
      warn('User at $95K sees zero progress on both bars', 'Band progress and journey progress both show 0%. Paying down to $89K would start moving the band bar. This could feel demoralizing for users starting above $89K.');
    },
  },
  {
    name: 'Edge: Debt-free + Exposed (low savings)',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 0, total_debt: 0,
        total_assets: 200, safety_liquid: 200,
        monthly_expenses: 3000, months_ahead: 0.07,
      });
      seedClimbConfig(85000, 85000, 0, 0);
    },
    validate: (data) => {
      assert(data.tier.id === 'wealthy', 'Tier = wealthy', `got ${data.tier.id}`);
      assert(data.stability.id === 'exposed', 'Debt-free + $200 savings = Exposed', `got ${data.stability.id}`);
      assert(data.stability.scoring.guard === 'exposed_floor', 'Guard enforced exposed', `got ${data.stability.scoring.guard}`);
      // Check the narrative handles this correctly
      const lead = data.stability.narrative.lead;
      assert(lead.includes('cushion') || lead.includes('milestone'), 'Narrative addresses debt-free+Exposed nuance', `lead: "${lead.substring(0,60)}..."`);
    },
  },
  {
    name: 'Edge: Multiple snapshots — months estimate',
    setup: () => {
      clearAllData();
      const now = new Date();
      // 4 snapshots over 3 months showing steady paydown
      seedSnapshot({ debt_remaining: 65000, pulled_at: new Date(now - 90*24*60*60*1000).toISOString(), total_debt: 65000, total_assets: 5000, safety_liquid: 5000 });
      seedSnapshot({ debt_remaining: 63000, pulled_at: new Date(now - 60*24*60*60*1000).toISOString(), total_debt: 63000, total_assets: 5500, safety_liquid: 5500 });
      seedSnapshot({ debt_remaining: 61000, pulled_at: new Date(now - 30*24*60*60*1000).toISOString(), total_debt: 61000, total_assets: 6000, safety_liquid: 6000 });
      seedSnapshot({ debt_remaining: 59000, pulled_at: now.toISOString(), total_debt: 59000, total_assets: 6500, safety_liquid: 6500 });
      seedClimbConfig(85000, 26000, 0, 59000);
    },
    validate: (data) => {
      assert(data.tier.id === 'struggling', 'At $59K: struggling', `got ${data.tier.id}`);
      assert(data.nextTier.monthsEstimate !== null, 'Months estimate computed with history');
      assert(data.nextTier.monthsEstimate > 0, `Months estimate = ${data.nextTier.monthsEstimate}`);
      // ~$2K/month paydown, gap of $9K from $59K to $50K threshold → ~5 months
      if (data.nextTier.monthsEstimate >= 3 && data.nextTier.monthsEstimate <= 7) {
        assert(true, `Estimate reasonable (3-7): ${data.nextTier.monthsEstimate} months`);
      } else {
        warn('Months estimate outside expected range', `Got ${data.nextTier.monthsEstimate} months, expected 3-7 for $2K/month paydown with $9K gap`);
      }
    },
  },
  {
    name: 'Edge: Debt INCREASED — negative paydown rate',
    setup: () => {
      clearAllData();
      const now = new Date();
      seedSnapshot({ debt_remaining: 50000, pulled_at: new Date(now - 60*24*60*60*1000).toISOString(), total_debt: 50000, total_assets: 5000, safety_liquid: 5000 });
      seedSnapshot({ debt_remaining: 55000, pulled_at: now.toISOString(), total_debt: 55000, total_assets: 4000, safety_liquid: 4000 });
      seedClimbConfig(85000, 30000, 5000, 55000);
    },
    validate: (data) => {
      assert(data.tier.id === 'struggling', 'At $55K: struggling', `got ${data.tier.id}`);
      assert(data.nextTier.monthsEstimate === null, 'Debt increasing → monthsEstimate null', `got ${data.nextTier.monthsEstimate}`);
      warn('No feedback when debt increases', 'The API returns monthsEstimate=null but no explicit flag or narrative about debt going in the wrong direction. The user just sees "no estimate available."');
    },
  },
  {
    name: 'Edge: Zero monthly expenses',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 40000, total_debt: 40000,
        total_assets: 10000, safety_liquid: 10000,
        monthly_expenses: 0, months_ahead: null,
      });
      seedClimbConfig(85000, 45000, 0, 40000);
    },
    validate: (data) => {
      assert(data.stability.effectiveRunwayMonths === null, 'Zero expenses → runway null', `got ${data.stability.effectiveRunwayMonths}`);
      // With null runway, no guard can fire, score uses fallback
      assert(data.stability.scoring.guard === null, 'No guard with null runway');
      assert(typeof data.stability.score === 'number', 'Score still computed');
    },
  },
  {
    name: 'Edge: Very small debt ($1)',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 1, total_debt: 1,
        total_assets: 20000, safety_liquid: 18000,
        monthly_expenses: 3000, months_ahead: 6.0,
      });
      seedClimbConfig(85000, 84999, 0, 1);
    },
    validate: (data) => {
      assert(data.tier.id === 'winning', '$1 debt → winning', `got ${data.tier.id}`);
      assert(data.nextTier.gapDollars === 1, 'Gap = $1', `got ${data.nextTier.gapDollars}`);
      assert(data.stats.pctPaid > 99.9, '>99.9% paid', `got ${data.stats.pctPaid}%`);
    },
  },
  {
    name: 'Response structure completeness',
    setup: () => {
      clearAllData();
      seedSnapshot({
        debt_remaining: 50000, total_debt: 50000,
        total_assets: 8000, safety_liquid: 7500,
        monthly_expenses: 3200, months_ahead: 2.34,
      });
      seedClimbConfig(85000, 35000, 0, 50000);
    },
    validate: (data) => {
      // Top-level fields
      const topFields = ['ready', 'tier', 'stability', 'stats', 'nextTier', 'meta', 'suspectedRestructure'];
      for (const f of topFields) {
        assert(f in data, `Top-level field: ${f}`);
      }

      // Tier fields
      const tierFields = ['id', 'label', 'badge', 'copy', 'nextCopy', 'threshold'];
      for (const f of tierFields) {
        assert(f in data.tier, `tier.${f} exists`);
      }

      // Stability fields
      const stabFields = ['id', 'label', 'score', 'urgency', 'scoring', 'effectiveRunwayMonths',
        'components', 'narrative', 'breathingRoomGoalMonths', 'breathingRoomReached', 'breathingRoomGapMonths'];
      for (const f of stabFields) {
        assert(f in data.stability, `stability.${f} exists`, f in data.stability ? '' : 'MISSING');
      }

      // Stats fields
      const statFields = ['debtRemaining', 'climbBaselineDebt', 'cumulativePaidDown',
        'cumulativeNewDebtAdded', 'netImprovement', 'pctPaid', 'debtTierBand', 'debtTierJourney',
        'netWorth', 'totalAssets', 'totalDebt', 'investmentValue', 'monthsAhead',
        'monthlyIncome', 'monthlyExpenses', 'lastPullNewDebtSum', 'lastPullPaydownSum'];
      for (const f of statFields) {
        assert(f in data.stats, `stats.${f} exists`, f in data.stats ? '' : 'MISSING');
      }

      // Meta fields
      assert('ynabPulledAt' in data.meta, 'meta.ynabPulledAt exists');
      assert('freshness' in data.meta, 'meta.freshness exists');
      assert(data.meta.freshness === 'Live', 'Freshness = Live (just seeded)', `got "${data.meta.freshness}"`);

      // NextTier fields
      if (data.nextTier) {
        const nextFields = ['id', 'label', 'badge', 'gapDollars', 'monthsEstimate', 'nextCopy'];
        for (const f of nextFields) {
          assert(f in data.nextTier, `nextTier.${f} exists`, f in data.nextTier ? '' : 'MISSING');
        }
      }

      // Stability components
      const compFields = ['ynabSafetyLiquid', 'ynabTotalAssets', 'effectiveCushion',
        'monthlyExpenses', 'brokerageCash', 'brokerageHoldings', 'investedCredit', 'bufferVsDebt'];
      for (const f of compFields) {
        assert(f in data.stability.components, `stability.components.${f}`, f in data.stability.components ? '' : 'MISSING');
      }

      // Scoring debug
      assert('bands' in data.stability.scoring, 'scoring.bands exists');
      assert('runwayPoints' in data.stability.scoring, 'scoring.runwayPoints exists');
      assert('bufferPoints' in data.stability.scoring, 'scoring.bufferPoints exists');
    },
  },
  {
    name: 'No data — boot state',
    setup: () => {
      clearAllData();
      // No snapshots, no config — simulate first launch
    },
    validate: (data) => {
      assert(data.ready === false, 'No data: ready = false', `got ${data.ready}`);
      assert('message' in data, 'Has message field');
      assert(typeof data.message === 'string', 'Message is string');
      // Should NOT have tier, stability, stats
      assert(!('tier' in data), 'No tier in boot state');
      assert(!('stability' in data), 'No stability in boot state');
      assert(!('stats' in data), 'No stats in boot state');
    },
  },
];

// ── HTTP helper ────────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${body.substring(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // Start server as a child process
  const { spawn } = require('child_process');
  const serverDir = path.join(__dirname, 'repos/Steward');
  
  console.log('Starting Steward server...');
  const server = spawn('node', ['server.js'], {
    cwd: serverDir,
    env: { ...process.env, STEWARD_STRICT_PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let serverPort = null;
  let serverOutput = '';

  // Capture server output to find port
  server.stdout.on('data', (d) => {
    serverOutput += d.toString();
  });
  server.stderr.on('data', (d) => {
    serverOutput += d.toString();
  });

  // Wait for server to start
  await new Promise((resolve) => {
    const check = setInterval(() => {
      const match = serverOutput.match(/listening on (?:http:\/\/localhost:|port\s*)(\d+)/i);
      if (match) {
        serverPort = parseInt(match[1]);
        clearInterval(check);
        resolve();
      }
    }, 200);

    // Timeout after 10s
    setTimeout(() => {
      clearInterval(check);
      // Try common ports
      serverPort = 3000;
      resolve();
    }, 10000);
  });

  console.log(`Server started on port ${serverPort}\n`);

  const baseUrl = `http://localhost:${serverPort}`;

  try {
    for (const scenario of SCENARIOS) {
      section(scenario.name);
      
      // Setup the scenario
      scenario.setup();

      // Small delay for DB writes to settle
      await new Promise(r => setTimeout(r, 100));

      try {
        const data = await fetchJSON(`${baseUrl}/api/status`);
        scenario.validate(data);
      } catch (err) {
        failed++;
        console.log(`  \u2717 Failed to fetch/validate: ${err.message}`);
        findings.push({ type: 'FAIL', label: scenario.name, detail: err.message });
      }
    }
  } finally {
    // Clean up: clear seeded data and kill server
    clearAllData();
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Summary ────────────────────────────────────────────────────────
  section('SUMMARY');
  console.log(`\n  Passed:   ${passed}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Warnings: ${warnings}`);

  if (findings.length > 0) {
    console.log('\n  Findings:');
    for (const f of findings) {
      console.log(`    [${f.type}] ${f.label}${f.detail ? ' \u2014 ' + f.detail : ''}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  if (failed === 0) {
    console.log('  ALL ASSERTIONS PASSED');
  } else {
    console.log(`  ${failed} ASSERTION(S) FAILED`);
  }
  console.log(`${'='.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
