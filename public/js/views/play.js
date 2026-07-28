'use strict';

/**
 * Builds the consolidated Steward shell DOM — new dark navy design system.
 * All existing render.js DOM IDs are preserved exactly.
 */

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'hidden' && v) { e.hidden = true; continue; }
      if (k === 'textContent') { e.textContent = v; continue; }
      if (k === 'innerHTML') { e.innerHTML = v; continue; }
      if (k.startsWith('data-')) { e.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; continue; }
      if (k === 'style' && typeof v === 'string') { e.setAttribute('style', v); continue; }
      e.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') e.appendChild(document.createTextNode(child));
    else if (child) e.appendChild(child);
  }
  return e;
}

function buildCommitmentScreen() {
  const overlay = el('div', { id: 'commitment-screen', class: 'commitment-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'commitment-headline', hidden: true });
  overlay.innerHTML = `
    <div class="commitment-inner">
      <p class="commitment-eyebrow">The climb begins here.</p>
      <h2 class="commitment-headline" id="commitment-headline">Make the commitment.</h2>
      <p class="commitment-pledge">
        I will face my debt \u2014 session by session, pull by pull.<br>
        I will not look away. The number only goes down when I make it.
      </p>
      <div class="commitment-input-group">
        <label class="commitment-input-label" for="commitment-custom-input">What are you climbing for?</label>
        <input
          type="text"
          id="commitment-custom-input"
          class="commitment-custom-input"
          placeholder="Write your reason \u2014 keep it close."
          maxlength="120"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <button class="commitment-btn" type="button" id="commitment-confirm-btn">I\u2019m in. Start the game.</button>
    </div>
  `;
  return overlay;
}

function buildTopNav() {
  const nav = el('nav', { class: 'top-nav', id: 'top-nav' });
  nav.innerHTML = `
    <a href="/" class="nav-brand">
      <div class="nav-brand-icon">S</div>
      <span class="nav-brand-text">Steward</span>
    </a>
    <div class="nav-links">
      <a href="/" class="nav-link active">Dashboard</a>
      <button type="button" class="nav-link nav-link-btn" id="nav-how-it-works-btn">How it works</button>
    </div>
    <div class="nav-right">
      <span class="nav-badge" id="nav-stage-tag" hidden></span>
      <button class="nav-theme-btn" type="button" id="theme-toggle">\u263D Dark</button>
      <button class="nav-logout-btn" type="button" id="nav-logout-btn" title="Sign out">Sign out</button>
    </div>
  `;
  return nav;
}

function buildMilestoneBanner() {
  // role=status + aria-live=polite \u2014 milestone copy is announced to screen
  // readers when the banner appears (e.g. after a paydown crosses a threshold)
  // without stealing focus or interrupting the user.
  const banner = el('div', {
    class: 'milestone-banner',
    id: 'milestone-banner',
    role: 'status',
    'aria-live': 'polite',
    hidden: true,
  });
  // \uD83C\uDFAF (target) instead of \uD83C\uDFC6 (trophy) \u2014 this banner shows the *next goal*,
  // not an achievement. The label prefix "Next:" makes the framing explicit.
  banner.innerHTML = `
    <span class="milestone-icon" aria-hidden="true">\uD83C\uDFAF</span>
    <span class="milestone-label">Next:</span>
    <div class="milestone-text" id="milestone-text"></div>
    <button class="milestone-dismiss" id="milestone-dismiss" aria-label="Dismiss">\u00D7</button>
  `;
  return banner;
}

function buildStartGameScreen() {
  const screen = el('div', { id: 'start-game-screen', class: 'start-game-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'start-game-title' });
  screen.innerHTML = `
    <div class="start-screen">
      <div class="start-inner">
        <p class="start-brand">Steward</p>
        <div class="start-character-frame" aria-hidden="true">
          <div id="start-game-character"></div>
        </div>
        <h1 class="start-title" id="start-game-title">Begin the Climb.</h1>
        <p class="start-subtitle">Track your paydown. Every session moves the number.</p>
        <p class="start-commitment-quote" id="start-commitment-quote" hidden></p>
        <p class="start-clock" id="start-game-clock"></p>
        <button class="start-btn" type="button" id="start-game-btn">Start Session</button>
      </div>
    </div>
  `;
  return screen;
}

function buildLoadingScreen() {
  return el('div', { id: 'loading-screen', class: 'loading-screen' },
    el('div', { class: 'loading-inner' },
      el('div', { class: 'loading-spinner' }),
      el('p', { class: 'loading-text' }, 'Loading Steward\u2026'),
    ),
  );
}

function buildErrorScreen() {
  return el('div', { id: 'app-error-screen', class: 'app-error-screen', role: 'alert', 'aria-live': 'assertive' },
    el('div', { class: 'app-error-inner' },
      el('p', { class: 'app-error-title' }, 'Couldn\u2019t load Steward'),
      el('p', { class: 'app-error-text', id: 'app-error-text' }),
      el('p', { class: 'app-error-hint', innerHTML: 'We\u2019ll retry automatically. Check that the server is running (<code>npm start</code> in the steward folder).' }),
      el('button', { type: 'button', id: 'app-error-retry-btn', class: 'app-error-retry-btn', hidden: true }, 'Retry'),
    ),
  );
}

function buildHeroSection() {
  const section = el('section', { class: 'hero-section dashboard-only-section', id: 'hero-section' });
  section.innerHTML = `
    <!-- The dashboard's single semantic page title (visually hidden). The setup
         view carries its own <h1> in #setup-welcome, which is hidden once the
         climb starts, so exactly one <h1> is present in each view state. -->
    <h1 class="sr-only">Steward — your debt payoff dashboard</h1>
    <!-- Tier cards group: current + locked next -->
    <div class="tier-cards-stack">
      <div class="tier-cards-group">
        <div class="tier-card" data-state="rock_bottom" id="hero-state-card">
          <div class="tier-card-badge" id="card-badge-chip">01</div>
          <div class="tier-card-character-mount">
            <div id="hero-steward-mount"></div>
          </div>
          <div class="tier-card-footer">
            <div class="tier-card-gap" id="card-tier-gap-headline" title="The balance reduction needed to reach your next payoff stage.">\u2192 \u2014</div>
            <div class="tier-card-name" id="card-tier-name">Buried</div>
            <div class="tier-card-bar-track" title="In-stage progress \u2014 how far you are through this stage.">
              <div class="tier-card-bar-fill" id="card-bar-fill"></div>
            </div>
            <div class="tier-card-debt" id="card-footer-debt" title="Debt remaining \u2014 total of all balances you still owe.">\u2014 remaining</div>
          </div>
        </div>

        <div class="tier-card tier-card-locked" id="locked-next-card" data-state="broke" hidden>
          <div class="locked-blur-layer">
            <div class="tier-card-badge" id="locked-badge-chip">02</div>
            <div class="tier-card-footer">
              <div class="tier-card-name" id="locked-tier-name">Digging</div>
            </div>
          </div>
          <div class="locked-card-overlay">
            <span class="locked-stage-tag">NEXT STAGE</span>
            <svg class="locked-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p class="locked-amount" id="locked-gap-amount">\u2014</p>
            <p class="locked-cta">to unlock</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Hero story column: directive-first — what to do right now -->
    <div class="hero-story">
      <div class="hero-eyebrow-row">
        <div class="hero-stage-block">
          <p class="hero-stage-kicker">Your payoff stage</p>
          <p class="hero-stage-title" id="hero-stage-title">\u2014</p>
        </div>
        <p class="sr-only" id="hero-badge" hidden></p>
        <div class="streak-badge" id="streak-badge" hidden>
          \uD83D\uDD25 <span id="streak-count">0</span> in a row
        </div>
      </div>
      <p class="sr-only" id="hero-tier-label" aria-live="polite">Buried</p>

      <p class="hero-escape-primary" id="hero-escape-primary" aria-live="polite" title="The balance reduction needed to reach your next payoff stage.">\u2014</p>
      <p class="hero-cta-line" id="hero-primary-cta"><span class="val" id="stat-monthly-target">\u2014</span></p>
      <p class="hero-cta-sub" id="hero-cta-sub" hidden></p>
      <p class="hero-interest-ticker" id="hero-interest-ticker" hidden></p>
      <p class="interest-meter" id="interest-meter" hidden aria-live="off"></p>
      <!-- The ticker above updates ~8fps, so it stays aria-live="off" to avoid
           spamming a screen reader. This sibling carries a stable per-day summary
           that is only rewritten when the underlying figure changes. -->
      <p class="sr-only" id="interest-meter-a11y" aria-live="polite"></p>

      <span class="stat-sentinel" id="stat-debt-remaining" hidden></span>
      <span class="stat-sentinel" id="stat-net-worth" hidden></span>

      <div class="hero-daily-action" id="hero-daily-action">
        <div class="hero-daily-copy">
          <p class="hero-daily-eyebrow">Today's check-in</p>
          <p class="hero-daily-note" id="hero-daily-note">Confirm your balances to keep every recommendation honest.</p>
        </div>
        <div class="hero-daily-buttons">
          <button type="button" class="hero-daily-primary" id="hero-quick-update-btn">Check balances</button>
          <button type="button" class="hero-daily-secondary" id="hero-manage-accounts-btn">Manage accounts</button>
        </div>
      </div>

      <!-- In-stage position (secondary to the dollar headline; thin) -->
      <div class="stage-gap-section" title="In-stage progress — how far you are through the current stage. Resets when the next stage unlocks.">
        <p class="stage-gap-eyebrow">This stage</p>
        <div class="progress-bar progress-bar--hero" id="command-progress-widget" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill" id="command-progress-bar-fill" style="width:0%"></div>
        </div>
        <div class="progress-pct" id="progress-pct-label"></div>
      </div>

    </div>

    <!-- Motivational quote — spans the full hero width as a footer strip -->
    <div class="tier-quote-card" id="tier-quote-card">
      <p class="tier-quote-label" id="tier-quote-label">Buried</p>
      <p class="tier-quote-text" id="tier-quote-text">Do not make this beautiful. Make it smaller.</p>
    </div>
  `;
  return section;
}

function buildDebtReductionChart() {
  /* Wrapped in <details> so users can collapse the chart to compress the page.
     Open by default; the section-summary mirrors the original header layout. */
  const section = el('details', { class: 'section-panel dashboard-only-section section-collapsible', id: 'debt-chart-section', open: '' });
  section.innerHTML = `
    <summary class="section-summary chart-header" title="Total debt still owed, plotted across your most recent snapshots.">
      <h2 class="tc-section-label" style="margin:0;">Debt over time</h2>
      <span class="section-summary-meta">
        <span class="chart-current neg" id="stat-net-worth-chart">\u2014</span>
        <span class="chart-trend" id="chart-trend-delta" title="Change versus your locked starting debt (the dashed line). Down is paydown; up means debt grew."></span>
      </span>
    </summary>
    <div class="chart-wrap">
      <svg id="networth-chart-svg" viewBox="0 0 600 150" width="100%" height="150" preserveAspectRatio="none">
        <defs>
          <linearGradient id="nw-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#14a469" stop-opacity="0.16"/>
            <stop offset="100%" stop-color="#14a469" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path id="nw-area" d="" fill="url(#nw-grad)"/>
        <path id="nw-line" d="" fill="none" stroke="#14a469" stroke-width="2" stroke-linecap="round"/>
        <path id="nw-projection" d="" fill="none" stroke="#c8a84c" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="4 5" opacity="0.85"/>
        <circle id="nw-projection-dot" r="2.5" fill="#c8a84c" hidden/>
      </svg>
    </div>
    <div class="chart-x-labels" id="chart-x-labels"></div>
    <p class="chart-projection" id="chart-projection-label" hidden></p>
    <div class="whatif-section" id="whatif-section" hidden>
      <label class="whatif-label" for="whatif-slider">What if I add <span class="whatif-amount" id="whatif-amount">$100</span>/mo extra?</label>
      <input type="range" class="whatif-slider" id="whatif-slider" min="0" max="1000" step="25" value="100" aria-label="Extra monthly payment, dollars" />
      <p class="whatif-readout" id="whatif-readout" aria-live="polite"></p>
    </div>
    <p class="chart-memo">Latest 60 snapshots · line down = paydown · line up = balances grew</p>
  `;
  return section;
}

function buildSessionPanel() {
  const section = el('section', { class: 'section-panel session-card dashboard-only-section', id: 'session-card' });
  section.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;padding-top:4px;">
      <h2 class="tc-section-label" style="margin:0;" title="Net change in your debt since the previous balance check. Negative = you paid down; positive = balances grew.">Since your last check</h2>
      <span class="turn-since-label" id="turn-since-label"></span>
    </div>
    <div class="session-hero">
      <span class="session-net-val" id="this-turn-net">\u2014</span>
      <span class="session-net-label" id="this-turn-net-label">Net balance change</span>
    </div>
    <div id="this-turn-list"></div>
  `;
  return section;
}

function buildDebtAccountsPanel() {
  const section = el('section', { class: 'section-panel dashboard-only-section', id: 'debt-accounts-section' });
  section.innerHTML = `
    <div class="debt-accounts-head">
      <div class="debt-accounts-head-text">
        <h2 class="tc-section-label" style="margin:0;">Account breakdown</h2>
        <p class="tc-section-sublabel">View-only balances, rates, and trends. Use Balance check-in to make changes.</p>
      </div>
      <div class="debt-accounts-controls">
        <button class="apr-edit-btn" id="apr-edit-btn" type="button">APRs & terms</button>
        <div class="sort-toggle">
          <button class="sort-toggle-btn active" data-sort="balance">Balance</button>
          <button class="sort-toggle-btn" data-sort="apr">APR</button>
        </div>
      </div>
    </div>
    <div id="apr-form-panel" hidden></div>
    <p class="debt-apr-warning" id="debt-apr-warning" role="status" hidden></p>
    <div id="debt-accounts-list"></div>
    <div class="debt-total-row">
      <span class="debt-total-label">Total</span>
      <span class="debt-total-val" id="debt-total-val">\u2014</span>
    </div>
    <p class="debt-interest-line" id="debt-interest-line" hidden></p>
    <div class="game-start-grid" id="game-start-row" hidden>
      <span class="gs-label">Game start</span><span class="gs-value" id="game-start-date">—</span>
      <span class="gs-label">Starting balance</span><span class="gs-value" id="game-start-val">—</span>
      <span class="gs-label" id="game-start-progress-label" hidden>Progress</span><span class="gs-value" id="game-start-progress" hidden></span>
    </div>
    <div class="commitment-reason-wrap" id="commitment-reason-wrap" hidden>
      <p class="commitment-reason-display" id="commitment-reason-display"></p>
      <button class="commitment-reason-edit-btn" id="commitment-reason-edit-btn" type="button" title="Edit your reason" aria-label="Edit your reason">✎</button>
      <input type="text" class="commitment-reason-input" id="commitment-reason-input" maxlength="120" hidden autocomplete="off" spellcheck="false" aria-label="Your reason for climbing" />
    </div>
  `;
  // Wire the APR-edit and sort buttons via listeners instead of inline onclick
  // handlers, so the CSP can drop script-src 'unsafe-inline'. Bound on the
  // detached section; listeners survive insertion into the DOM.
  const aprBtn = section.querySelector('#apr-edit-btn');
  if (aprBtn) aprBtn.addEventListener('click', () => window.toggleAprForm && window.toggleAprForm());
  for (const btn of section.querySelectorAll('.sort-toggle-btn')) {
    btn.addEventListener('click', () => window.setDebtSortMode && window.setDebtSortMode(btn.dataset.sort));
  }
  return section;
}

function buildStageProgressDetail() {
  /* Collapsible — same pattern as the trend chart. */
  const section = el('details', { class: 'section-panel dashboard-only-section section-collapsible', id: 'stage-progress-section' });
  section.innerHTML = `
    <summary class="section-summary">
      <h2 class="tc-section-label" style="margin:0;">Progress details</h2>
      <span class="section-summary-meta lab-summary-hint">pace, interest &amp; history</span>
    </summary>
    <div id="progress-milestone-recent" class="milestone-recent-banner" hidden aria-live="polite"></div>
    <p class="progress-note" id="progress-stale-note" hidden style="font-size:12px;color:var(--amber);margin-bottom:12px;"></p>
    <div id="debt-free-banner" class="debt-free-banner" hidden>
      <div class="debt-free-main">
        <span class="debt-free-flag" aria-hidden="true">🏁</span>
        <div>
          <div class="debt-free-label">Projected debt-free</div>
          <div class="debt-free-date" id="debt-free-date">—</div>
        </div>
      </div>
      <div class="debt-free-sub" id="debt-free-sub"></div>
      <div class="payoff-forecast" id="payoff-forecast" hidden></div>
    </div>
    <ul class="sp-grid" id="progress-detail-bullets" aria-label="Session progress">
      <li id="progress-bullet-paid"></li>
      <li id="progress-bullet-turn"></li>
      <li id="progress-bullet-newdebt"></li>
      <li id="progress-bullet-interest"></li>
      <li id="progress-bullet-avgmonth"></li>
      <li id="progress-bullet-direction"></li>
    </ul>
    <button type="button" id="reclassify-debt-btn" class="reclassify-link" hidden>Some of that was interest or a debt you forgot to log? Reclassify it →</button>
    <p class="progress-note" id="progress-debt-direction" hidden style="font-size:12px;color:var(--text-2);margin-top:14px;"></p>
    <p id="progress-milestone-next" hidden style="font-size:12px;color:var(--gold);margin-top:14px;font-style:italic;"></p>
    <p id="progress-next-move" hidden style="font-size:12px;color:var(--text-2);margin-top:6px;"></p>
  `;
  return section;
}

/* "Pay this next" — the single recommended target (avalanche/snowball), with a
   toggle. Populated by renderPayThisNext() from stats.payoffPlan; hidden until
   there's a positive balance to attack. */
function buildPayThisNextCard() {
  const section = el('section', { class: 'section-panel dashboard-only-section pay-next-section', id: 'pay-next-section', hidden: true });
  section.innerHTML = `
    <div class="pay-next-head">
      <h2 class="tc-section-label" style="margin:0;">Pay this next</h2>
      <div class="pay-next-toggle" id="pay-next-toggle" role="group" aria-label="Payoff strategy">
        <button type="button" class="pay-next-tab" data-method="avalanche" title="Highest interest first — saves the most money">Save most</button>
        <button type="button" class="pay-next-tab" data-method="snowball" title="Smallest balance first — fastest win">Quick win</button>
      </div>
    </div>
    <div class="pay-next-target" id="pay-next-target">—</div>
    <div class="pay-next-reason" id="pay-next-reason"></div>
  `;
  return section;
}

function buildPaydownCalculator() {
  /* Collapsible tool — closed by default so the everyday view stays lean. */
  const section = el('details', { class: 'section-panel dashboard-only-section section-collapsible', id: 'paydown-calc-section' });
  section.innerHTML = `
    <summary class="section-summary" title="Convert a dollar paydown to a percent of your debt — and back.">
      <h2 class="tc-section-label" style="margin:0;">Paydown calculator</h2>
      <span class="section-summary-meta lab-summary-hint">$ ↔ %</span>
    </summary>
    <p class="tc-section-sublabel" id="calc-basis" style="margin-top:0;">Percentages are of your current debt.</p>
    <div class="calc-row">
      <label class="calc-field">
        <span class="calc-label">Pay down</span>
        <span class="calc-input-wrap"><span class="calc-affix">$</span>
          <input id="calc-dollars" class="calc-input" type="number" inputmode="decimal" min="0" step="any" placeholder="500" aria-label="Dollars to pay down" />
        </span>
      </label>
      <span class="calc-eq" aria-hidden="true">↔</span>
      <label class="calc-field">
        <span class="calc-label">Percent of debt</span>
        <span class="calc-input-wrap">
          <input id="calc-percent" class="calc-input" type="number" inputmode="decimal" min="0" step="any" placeholder="5" aria-label="Percent of current debt" />
          <span class="calc-affix calc-affix--suffix">%</span>
        </span>
      </label>
    </div>
    <p class="calc-avg-apr-row">Average APR on interest-bearing debt: <span id="calc-avg-apr" class="calc-avg-apr">—</span><button type="button" class="info-dot" aria-label="How is this calculated?" aria-expanded="false" data-explain="Balance-weighted average APR across the accounts that charge interest. Promotional 0% balances are left out, so this reflects the rate on debt that is actually costing you — not a blend across your whole balance.">ⓘ</button></p>
  `;
  return section;
}

/* Strategy Lab — plays avalanche / snowball / promo-aware / LP-optimal forward
   at a monthly budget and compares the outcomes. The optimal plan is a linear
   program solved locally (javascript-lp-solver); the model can be exported in
   IBM CPLEX LP format. Wiring lives in strategy-lab.js. */
function buildStrategyLab() {
  const section = el('details', { class: 'section-panel dashboard-only-section section-collapsible', id: 'strategy-lab-section' });
  section.innerHTML = `
    <summary class="section-summary" title="Compare payoff strategies — including promo-rate cliffs plain avalanche can't see.">
      <h2 class="tc-section-label" style="margin:0;">Strategy Lab</h2>
      <span class="section-summary-meta lab-summary-hint">which plan wins?</span>
    </summary>
    <p class="tc-section-sublabel" style="margin-top:0;">Plays each strategy forward month by month against your real balances, APRs, and promo deadlines — all on this device.</p>
    <div class="lab-apr-gate" id="lab-apr-gate" hidden>
      <p>Add at least one APR first. Without rates, Steward can compare balance order but cannot tell you which plan saves the most interest.</p>
      <button type="button" class="apr-edit-btn" id="lab-add-aprs-btn">Add APRs</button>
    </div>
    <div class="lab-controls">
      <label class="calc-field lab-budget-field">
        <span class="calc-label">Monthly budget</span>
        <span class="calc-input-wrap"><span class="calc-affix">$</span>
          <input id="lab-budget" class="calc-input" type="number" inputmode="decimal" min="1" step="any" placeholder="500" aria-label="Total dollars available for debt payments per month" />
        </span>
      </label>
      <button type="button" class="lab-run-btn" id="lab-run-btn">Compare strategies</button>
    </div>
    <p class="lab-note" id="lab-note" role="status" hidden></p>
    <div id="lab-results" hidden>
      <div class="lab-table-wrap">
        <table class="lab-table" aria-label="Strategy comparison">
          <thead><tr><th>Strategy</th><th>Debt-free</th><th>Interest</th><th>vs avalanche</th></tr></thead>
          <tbody id="lab-table-body"></tbody>
        </table>
      </div>
      <div class="lab-first-month" id="lab-first-month" hidden>
        <h3 class="lab-subhead">This month's winning allocation</h3>
        <div id="lab-first-month-list"></div>
      </div>
      <p class="lab-cliffs" id="lab-cliffs" hidden></p>
      <p class="lab-footer">Optimal plan = linear program solved locally · nothing leaves this device ·
        <a id="lab-lp-export" href="#" download title="The live optimization model in IBM CPLEX LP format — feed it to a real CPLEX installation, or any LP-format solver.">export model (.lp, CPLEX format)</a></p>
    </div>
  `;
  return section;
}

function buildCumulativePaydownTrophy() {
  const section = el('section', { class: 'section-panel dashboard-only-section', id: 'cumulative-trophy-section' });
  section.innerHTML = `
    <div class="trophy-row">
      <div class="trophy-icon" aria-hidden="true">\uD83C\uDFC6</div>
      <div class="trophy-body">
        <p class="trophy-label" title="Total balance you've cleared since you started. Interest is already reflected — the balance fell by this much after it was added, so it is not subtracted again.">Total paid down</p>
        <p class="trophy-val" id="stat-cumulative-paydown">\u2014</p>
        <p class="trophy-sub" id="cumulative-pct"></p>
        <p class="trophy-saved" id="trophy-interest-saved" title="How much less interest your balances cost each month now versus your starting balances \u2014 money your paydown is keeping from the bank." hidden></p>
      </div>
      <p class="trophy-context">Your balance reduction since the climb began.</p>
    </div>
  `;
  return section;
}

function buildManualEntryForm() {
  const section = el('section', { class: 'section-panel manual-entry-panel', id: 'manual-entry-panel' });
  section.innerHTML = `
    <div class="setup-welcome" id="setup-welcome">
      <p class="setup-eyebrow">Two minutes to a clear plan</p>
      <h1 class="setup-title">See what to pay first.</h1>
      <p class="setup-copy">Add every credit card, loan, and liability. Steward will total them, identify your first payoff target, and show the next milestone before you leave setup.</p>
      <div class="setup-steps" aria-label="First time setup steps">
        <span>1 · Add balances</span>
        <span>2 · See your target</span>
      </div>
    </div>
    <div class="manual-entry-heading">
      <div>
        <h2 class="tc-section-label" style="margin:0;">Balance check-in</h2>
        <p class="tc-section-sublabel">A quick balance check keeps your target, timeline, and progress accurate.</p>
      </div>
    </div>

    <!-- Saved debts list (shown when debts exist) -->
    <div id="saved-debts-list" class="saved-debts-list" style="display:none;">
      <div id="saved-debts-rows"></div>
      <div class="saved-debts-total">
        <span>Total Debt</span>
        <span id="saved-debts-total-val">$0</span>
      </div>
      <div class="manual-entry-actions">
        <button type="button" class="commitment-btn" id="quick-update-btn"
                title="Step through each account in seconds — Enter moves to the next.">Check balances</button>
        <button type="button" class="commitment-btn commitment-btn--ghost" id="update-balances-btn">Save edited balances</button>
        <button type="button" class="commitment-btn setup-start-btn" id="start-climb-btn" hidden>Show my payoff plan</button>
        <p class="data-strip-msg" id="snapshot-save-msg"></p>
        <button type="button" class="undo-last-btn" id="undo-last-btn" hidden>↶ Undo last update (entered the wrong amount?)</button>
      </div>
    </div>

    <!-- Add new debt form -->
    <details id="add-debt-section" class="add-debt-disclosure">
      <summary class="add-debt-summary">Manage accounts</summary>
      <form id="manual-snapshot-form" class="manual-entry-form" autocomplete="off">
        <div class="manual-entry-accounts">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <p class="manual-entry-sub-label" id="add-debt-heading">Add your debts</p>
            <button type="button" class="refresh-btn" id="add-debt-account-btn" aria-label="Add another debt account">+ Add Debt</button>
          </div>
          <div id="debt-accounts-entries"></div>
          <div class="setup-live-total" id="setup-live-total" hidden aria-live="polite">
            <span id="setup-live-total-label">Starting debt</span>
            <strong id="setup-live-total-value">$0</strong>
          </div>
          <p class="setup-payoff-promise" id="setup-payoff-promise" hidden></p>
          <p class="manual-entry-hint">Add each credit card, loan, or liability with its current balance.</p>
        </div>
        <div class="manual-entry-actions">
          <button type="submit" class="commitment-btn" id="save-snapshot-btn">Save balances</button>
        </div>
      </form>
    </details>
  `;
  return section;
}

function buildDataStrip() {
  /* Housekeeping drawer — snapshot freshness, version, backups. Diagnostic
     info most sessions never need, so it folds closed by default. */
  const section = el('details', { class: 'data-strip-details dashboard-only-section', id: 'data-sync-strip' });
  section.innerHTML = `
    <summary class="data-strip-summary">Data, backups &amp; app info</summary>
    <div class="data-strip" aria-label="Data sync">
    <div class="data-chip" title="The most recent time you saved a snapshot of your balances.">
      <span class="data-chip-k">Last snapshot</span>
      <span class="data-chip-v" id="data-last-snapshot">\u2014</span>
    </div>
    <div class="data-chip" title="Freshness \u2014 green when your data is recent, amber/red when it is stale and likely out of date.">
      <span class="data-chip-k">Freshness</span>
      <span class="data-chip-v fresh freshness-dot" id="freshness-badge">\u2014</span>
    </div>
    <div class="data-chip" title="App version (and deploy commit when hosted) \u2014 confirms which build you are running.">
      <span class="data-chip-k">Version</span>
      <span class="data-chip-v" id="app-version">\u2014</span>
    </div>
    <div class="data-chip" id="data-session-chip" hidden title="Time in this visit, and total focused time on Steward (the session tracker writes to this).">
      <span class="data-chip-k">Session</span>
      <span class="data-chip-v" id="data-session-time">\u2014</span>
    </div>
    <div class="data-strip-actions">
      <button type="button" class="refresh-btn" id="recalc-now-btn"
         title="Re-fetch your latest data and recompute every figure on this dashboard.">↻ Refresh</button>
      <a class="refresh-btn" id="export-csv-btn" href="/api/export?format=csv" download
         title="Snapshot history as CSV (with per-entry change + paid-since-start), opens in Excel/Sheets. Also: every card side-by-side over time \u2192 /api/export?format=csv&table=matrix \u00b7 long per-account history \u2192 /api/export?format=csv&table=accounts">\u2913 CSV</a>
      <a class="refresh-btn" id="export-data-btn" href="/api/export" download
         title="Everything (snapshots, account history, settings) as a JSON file \u2014 your complete personal backup.">\u2913 JSON</a>
      <button type="button" class="refresh-btn" id="import-data-btn"
         title="Restore everything from a JSON backup you exported earlier. Replaces your current data.">\u21a5 Restore</button>
      <button type="button" class="refresh-btn" id="push-reminders-btn" hidden>\ud83d\udd15 Enable reminders</button>
      <input type="file" id="import-data-file" accept="application/json,.json" hidden />
    </div>
    </div>
  `;
  return section;
}


/* "Ask the Steward" — suggested-question chips that query the AI about the
   user's own numbers. Hidden until initAskSteward() confirms AI is configured
   (and only on an active climb). Built collapsed; wiring lives in steward-ai.js. */
const ASK_STEWARD_QUESTIONS = [
  'Explain why this account is first.',
  'Turn my next payment into a plan.',
  'What changed since my last update?',
  'Where am I losing the most to interest?',
];

function buildAskStewardPanel() {
  /* Collapsible — the chat/chip UI is tall, so it stays folded until asked for.
     steward-chat.js appends its UI inside this element (after the summary),
     so everything it builds participates in the same open/close fold. */
  const section = el('details', { class: 'section-panel dashboard-only-section ask-steward-panel section-collapsible', id: 'ask-steward-panel', hidden: true });
  section.innerHTML = `
    <summary class="section-summary">
      <h2 class="tc-section-label" style="margin:0;">Steward AI</h2>
      <span class="section-summary-meta lab-summary-hint">optional explanation &amp; help</span>
    </summary>
    <p class="tc-section-sublabel" style="margin-top:0;">Use it when you want an explanation, a second opinion, or a hands-free entry. Your core dashboard works without AI.</p>
    <div class="ask-steward-consent" id="ask-steward-consent">
      <p><strong>AI is optional.</strong> When enabled, Steward sends your account names, balances, rates, due dates, notes, and relevant memories to Anthropic to answer you. It stays off until you choose otherwise.</p>
      <button type="button" class="refresh-btn" id="ask-steward-consent-toggle" aria-pressed="false">Enable AI Steward</button>
      <span id="ask-steward-consent-msg" aria-live="polite"></span>
    </div>
    <div class="ask-steward-chips" id="ask-steward-chips" hidden>
      ${ASK_STEWARD_QUESTIONS.map(q => `<button type="button" class="ask-steward-chip">${q}</button>`).join('')}
    </div>
    <div class="ask-steward-answer" id="ask-steward-answer" hidden aria-live="polite"></div>
  `;
  return section;
}

function buildOptionalToolsPanel() {
  const section = el('details', {
    class: 'section-panel dashboard-only-section section-collapsible dashboard-tools-section',
    id: 'optional-tools-section',
  });
  section.innerHTML = `
    <summary class="section-summary">
      <h2 class="tc-section-label" style="margin:0;">Tools &amp; guidance</h2>
      <span class="section-summary-meta lab-summary-hint">calculator, strategy &amp; optional AI</span>
    </summary>
  `;
  const content = el('div', { class: 'dashboard-tools-content' });
  content.appendChild(buildPaydownCalculator());
  content.appendChild(buildStrategyLab());
  content.appendChild(buildAskStewardPanel());
  section.appendChild(content);
  return section;
}

/* Page-bottom sign-off. The 🧐 (monocle) mirrors the Steward's emblem — the
   hatted, monocled butler in the favicon — so the character bookends the page. */
function buildStewardFooter() {
  const footer = el('footer', { class: 'steward-footer', role: 'contentinfo' });
  footer.innerHTML = `
    <span class="steward-footer-emoji" aria-hidden="true">🧐</span>
    <span class="steward-footer-text">At your service — your Steward, every step of the climb.</span>
  `;
  return footer;
}

export function mountPlayShell(root) {
  root.textContent = '';

  root.appendChild(buildCommitmentScreen());
  root.appendChild(buildTopNav());
  root.appendChild(buildMilestoneBanner());
  root.appendChild(buildStartGameScreen());
  root.appendChild(buildLoadingScreen());
  root.appendChild(buildErrorScreen());

  const dashboard = el('main', { class: 'dashboard app-shell', id: 'dashboard' });
  dashboard.appendChild(buildHeroSection());

  /* Two columns on wide screens; below 1200px the wrappers collapse via
     display:contents so every panel flows in ONE column in DOM order. That
     makes DOM order the phone reading order, so panels are laid out as a
     single story — act, then review, then tools:
       column A (the story so far): pay this next → balance check-in → this turn →
       debt-remaining chart;
       column B (the record + tools): debt accounts → stage progress → trophy →
       calculator → strategy lab → ask the Steward.
     Balance: the two variable-height growers — the entry form (col A) and the
     debt-accounts table (col B) — sit in SEPARATE columns, so both stacks grow
     together whether there are 3 debts or 30. The tool panels at the end of
     col B are collapsed <details>, so they add little height until opened.
     Hero/strip/danger/footer stay full-width siblings. */
  const colA = el('div', { class: 'dash-col', id: 'dash-col-a' });
  colA.appendChild(buildPayThisNextCard());
  colA.appendChild(buildManualEntryForm());
  colA.appendChild(buildSessionPanel());
  colA.appendChild(buildDebtReductionChart());

  const colB = el('div', { class: 'dash-col', id: 'dash-col-b' });
  colB.appendChild(buildDebtAccountsPanel());
  colB.appendChild(buildStageProgressDetail());
  colB.appendChild(buildCumulativePaydownTrophy());
  colB.appendChild(buildOptionalToolsPanel());

  dashboard.appendChild(colA);
  dashboard.appendChild(colB);
  dashboard.appendChild(buildDataStrip());
  /* Danger zone \u2014 destructive actions tucked behind a disclosure so they can't be
     hit accidentally from the bottom of the dashboard. Each action has its own
     description block so the user understands the difference between "wipe my
     game data" and "delete my account entirely". Confirmation prompts in
     commitment.js are the second line of defence. */
  const dangerZone = el('details', { class: 'play-danger-zone', id: 'danger-zone-section' });
  dangerZone.innerHTML = `
    <summary class="play-danger-summary">Account &amp; danger zone</summary>
    <div class="play-danger-action" id="account-security-section">
      <p class="play-danger-action-title">Account security</p>
      <form class="account-pw-form" id="change-password-form" autocomplete="off" hidden>
        <input type="password" class="account-pw-input" id="cp-current" placeholder="Current password" autocomplete="current-password" maxlength="200" aria-label="Current password" />
        <input type="password" class="account-pw-input" id="cp-new" placeholder="New password (10+ chars)" autocomplete="new-password" maxlength="200" aria-label="New password" />
        <input type="password" class="account-pw-input" id="cp-confirm" placeholder="Confirm new password" autocomplete="new-password" maxlength="200" aria-label="Confirm new password" />
        <button type="submit" class="play-danger-btn" id="cp-submit">Change password</button>
      </form>
      <p class="account-security-msg" id="account-security-msg" aria-live="polite"></p>
      <button type="button" class="play-danger-btn" id="logout-others-btn"
        title="Signs out every other device or browser where you're logged in. This one stays signed in.">
        Sign out other devices
      </button>
    </div>
    <div class="play-danger-action">
      <p class="play-danger-action-title">Clear game data</p>
      <p class="play-danger-action-desc">
        Wipes snapshots, debt accounts, history, and your climb baseline.
        <strong>Your account, password, and email are preserved</strong> \u2014 you stay logged in and can start a fresh climb.
      </p>
      <button type="button" class="play-danger-btn play-danger-btn--warn" id="play-reset-btn">\u21BA Clear game data</button>
    </div>
    <div class="play-danger-action play-danger-action--critical">
      <p class="play-danger-action-title">Delete account</p>
      <p class="play-danger-action-desc">
        Permanently deletes your username, password, email, sessions, AND all game data.
        <strong>This cannot be undone.</strong> You'll be logged out and redirected to the sign-in page.
      </p>
      <button type="button" class="play-danger-btn play-danger-btn--danger" id="play-delete-account-btn">Delete account</button>
    </div>
  `;
  dashboard.appendChild(dangerZone);
  dashboard.appendChild(buildStewardFooter());

  const heroQuickUpdate = dashboard.querySelector('#hero-quick-update-btn');
  if (heroQuickUpdate) {
    heroQuickUpdate.addEventListener('click', () => {
      const quickUpdate = document.getElementById('quick-update-btn');
      if (quickUpdate && !quickUpdate.hidden) {
        quickUpdate.click();
        return;
      }
      const panel = document.getElementById('manual-entry-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const heroManageAccounts = dashboard.querySelector('#hero-manage-accounts-btn');
  if (heroManageAccounts) {
    heroManageAccounts.addEventListener('click', () => {
      const disclosure = document.getElementById('add-debt-section');
      if (disclosure && 'open' in disclosure) disclosure.open = true;
      const panel = document.getElementById('manual-entry-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        const addButton = document.getElementById('add-debt-account-btn');
        if (addButton) addButton.focus({ preventScroll: true });
      }, 350);
    });
  }

  root.appendChild(dashboard);

  /* Sticky floating action — scrolls back to the manual-entry panel.
     Hidden by default; initStickyUpdateFab() shows it when the panel scrolls
     out of view and at least one saved debt exists. */
  const fab = el('button', {
    type: 'button',
    class: 'fab-update-balances',
    id: 'fab-update-balances',
    'aria-label': 'Check account balances',
    title: 'Check account balances',
    hidden: true,
  });
  fab.innerHTML = '<span class="fab-icon" aria-hidden="true">⚡</span><span class="fab-label">Check balances</span>';
  root.appendChild(fab);
}

