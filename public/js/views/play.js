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
    <!-- Tier cards group: current + locked next -->
    <div class="tier-cards-stack">
      <div class="tier-cards-group">
        <div class="tier-card" data-state="rock_bottom" id="hero-state-card">
          <div class="tier-card-badge" id="card-badge-chip">01</div>
          <div class="tier-card-character-mount">
            <div id="hero-steward-mount"></div>
          </div>
          <div class="tier-card-footer">
            <div class="tier-card-gap" id="card-tier-gap-headline" title="Escape gap \u2014 dollars left to unlock the next payoff stage.">\u2192 \u2014</div>
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
      <div class="tier-quote-card" id="tier-quote-card">
        <p class="tier-quote-label" id="tier-quote-label">Buried</p>
        <p class="tier-quote-text" id="tier-quote-text">Do not make this beautiful. Make it smaller.</p>
      </div>
    </div>

    <!-- Hero story column: directive-first — what to do right now -->
    <div class="hero-story">
      <div class="hero-eyebrow-row">
        <div class="hero-stage-block">
          <p class="hero-stage-kicker">Stage</p>
          <p class="hero-stage-title" id="hero-stage-title">\u2014</p>
        </div>
        <p class="sr-only" id="hero-badge" hidden></p>
        <div class="streak-badge" id="streak-badge" hidden>
          \uD83D\uDD25 <span id="streak-count">0</span> in a row
        </div>
      </div>
      <p class="sr-only" id="hero-tier-label" aria-live="polite">Buried</p>

      <p class="hero-escape-primary" id="hero-escape-primary" aria-live="polite" title="Escape gap \u2014 dollars left to unlock the next payoff stage. Not your total debt; the next threshold.">\u2014</p>
      <p class="hero-cta-line" id="hero-primary-cta">Clear <span class="val" id="stat-monthly-target">\u2014</span> this month</p>
      <p class="hero-cta-sub" id="hero-cta-sub" hidden></p>
      <p class="hero-interest-ticker" id="hero-interest-ticker" hidden></p>

      <span class="stat-sentinel" id="stat-debt-remaining" hidden></span>
      <span class="stat-sentinel" id="stat-net-worth" hidden></span>

      <!-- In-stage position (secondary to the dollar headline; thin) -->
      <div class="stage-gap-section" title="In-stage progress — how far you are through the current stage. Resets when the next stage unlocks.">
        <div class="progress-bar progress-bar--hero" id="command-progress-widget" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill" id="command-progress-bar-fill" style="width:0%"></div>
        </div>
        <div class="progress-pct" id="progress-pct-label"></div>
      </div>

      <!-- 10-stage journey — context; reads after the directive + in-stage bar -->
      <div class="journey-section">
        <div class="journey-label">
          <span>Your journey</span>
          <span>Stage 01 of 10</span>
        </div>
        <div class="journey-bar" id="journey-bar">
          <div class="jb-fill" style="width:0%"></div>
        </div>
      </div>
    </div>
  `;
  return section;
}

function buildDebtReductionChart() {
  /* Wrapped in <details> so users can collapse the chart to compress the page.
     Open by default; the section-summary mirrors the original header layout. */
  const section = el('details', { class: 'section-panel dashboard-only-section section-collapsible', open: '' });
  section.innerHTML = `
    <summary class="section-summary chart-header" title="Total debt still owed, plotted across your most recent snapshots.">
      <span class="section-label">Debt Remaining</span>
      <span class="section-summary-meta">
        <span class="chart-current neg" id="stat-net-worth-chart">\u2014</span>
        <span class="chart-trend" id="chart-trend-delta" title="Change since the first snapshot in this window. Down is paydown; up means debt grew."></span>
      </span>
    </summary>
    <div class="chart-wrap">
      <svg id="networth-chart-svg" viewBox="0 0 600 110" width="100%" height="110" preserveAspectRatio="none">
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
      <label class="whatif-label" for="whatif-slider">What if I add <span class="whatif-amount" id="whatif-amount">$0</span>/mo extra?</label>
      <input type="range" class="whatif-slider" id="whatif-slider" min="0" max="1000" step="25" value="0" aria-label="Extra monthly payment, dollars" />
      <p class="whatif-readout" id="whatif-readout" aria-live="polite"></p>
    </div>
    <p class="chart-memo">Latest 60 snapshots · line down = paydown · line up = balances grew</p>
  `;
  return section;
}

function buildSessionPanel() {
  const section = el('section', { class: 'section-panel session-card dashboard-only-section', id: 'session-card' });
  section.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
      <p class="tc-section-label" style="margin:0;" title="This Turn — net change in your debt since the previous snapshot. Negative = you paid down; positive = balances grew.">This Turn</p>
      <span class="turn-since-label" id="turn-since-label"></span>
    </div>
    <div class="session-hero">
      <span class="session-net-val" id="this-turn-net">\u2014</span>
      <span class="session-net-label" id="this-turn-net-label">Net this turn</span>
    </div>
    <div id="this-turn-list"></div>
  `;
  return section;
}

function buildDebtAccountsPanel() {
  const section = el('section', { class: 'section-panel dashboard-only-section' });
  section.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;">
      <div style="min-width:0;">
        <p class="tc-section-label" style="margin:0;">Debt Accounts</p>
        <p class="tc-section-sublabel">Read-only overview · update balances in the Your Debts panel</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button class="apr-edit-btn" id="apr-edit-btn" type="button" onclick="window.toggleAprForm()">Edit APRs</button>
        <div class="sort-toggle">
          <button class="sort-toggle-btn active" data-sort="balance" onclick="window.setDebtSortMode('balance')">Balance</button>
          <button class="sort-toggle-btn" data-sort="apr" onclick="window.setDebtSortMode('apr')">APR</button>
        </div>
      </div>
    </div>
    <div id="apr-form-panel" hidden></div>
    <div id="debt-accounts-list"></div>
    <div class="debt-total-row">
      <span class="debt-total-label">Total</span>
      <span class="debt-total-val" id="debt-total-val">\u2014</span>
    </div>
    <p class="debt-interest-line" id="debt-interest-line" hidden></p>
    <div class="game-start-row" id="game-start-row" hidden>
      <span class="game-start-label">Game start</span>
      <span class="game-start-meta" id="game-start-meta"></span>
      <span class="game-start-val" id="game-start-val"></span>
    </div>
    <div class="commitment-reason-wrap" id="commitment-reason-wrap" hidden>
      <p class="commitment-reason-display" id="commitment-reason-display"></p>
      <button class="commitment-reason-edit-btn" id="commitment-reason-edit-btn" type="button" title="Edit your reason" aria-label="Edit your reason">✎</button>
      <input type="text" class="commitment-reason-input" id="commitment-reason-input" maxlength="120" hidden autocomplete="off" spellcheck="false" />
    </div>
  `;
  return section;
}

function buildStageProgressDetail() {
  /* Collapsible — same pattern as the trend chart. */
  const section = el('details', { class: 'section-panel dashboard-only-section section-collapsible', open: '' });
  section.innerHTML = `
    <summary class="section-summary">
      <span class="tc-section-label" style="margin:0;">Stage progress</span>
    </summary>
    <div id="progress-milestone-recent" class="milestone-recent-banner" hidden aria-live="polite"></div>
    <p class="progress-note" id="progress-stale-note" hidden style="font-size:12px;color:var(--amber);margin-bottom:12px;"></p>
    <ul class="sp-grid" id="progress-detail-bullets" aria-label="Session progress">
      <li id="progress-bullet-paid"></li>
      <li id="progress-bullet-turn"></li>
      <li id="progress-bullet-newdebt"></li>
      <li id="progress-bullet-interest"></li>
      <li id="progress-bullet-direction"></li>
    </ul>
    <button type="button" id="reclassify-debt-btn" class="reclassify-link" hidden>Some of that was interest or a debt you forgot to log? Reclassify it →</button>
    <p class="progress-note" id="progress-debt-direction" hidden style="font-size:12px;color:var(--text-2);margin-top:14px;"></p>
    <p id="progress-milestone-next" hidden style="font-size:12px;color:var(--gold);margin-top:14px;font-style:italic;"></p>
    <p id="progress-next-move" hidden style="font-size:12px;color:var(--text-2);margin-top:6px;"></p>
  `;
  return section;
}

function buildCumulativePaydownTrophy() {
  const section = el('section', { class: 'section-panel dashboard-only-section', id: 'cumulative-trophy-section' });
  section.innerHTML = `
    <div class="trophy-row">
      <div class="trophy-icon" aria-hidden="true">\uD83C\uDFC6</div>
      <div class="trophy-body">
        <p class="trophy-label" title="Total Cleared — every dollar paid against principal since tracking began. Never decreases, even if new debt is added.">Total Cleared</p>
        <p class="trophy-val" id="stat-cumulative-paydown">\u2014</p>
        <p class="trophy-sub" id="cumulative-pct"></p>
      </div>
      <p class="trophy-context">This number only goes up. New debt doesn\u2019t reduce it \u2014 it tracks every dollar paid against the principal. Permanent record.</p>
    </div>
  `;
  return section;
}

function buildManualEntryForm() {
  const section = el('section', { class: 'section-panel manual-entry-panel', id: 'manual-entry-panel' });
  section.innerHTML = `
    <div class="setup-welcome" id="setup-welcome">
      <p class="setup-eyebrow">Welcome to Steward</p>
      <h1 class="setup-title">Start with every debt.</h1>
      <p class="setup-copy">Add each credit card, loan, and liability first. Steward will lock that total as your starting line only when you press Start Climb.</p>
      <div class="setup-steps" aria-label="First time setup steps">
        <span>Add debts</span>
        <span>Review total</span>
        <span>Start climb</span>
      </div>
    </div>
    <p class="tc-section-label" style="margin-bottom:16px;">Your Debts</p>

    <!-- Saved debts list (shown when debts exist) -->
    <div id="saved-debts-list" class="saved-debts-list" style="display:none;">
      <div id="saved-debts-rows"></div>
      <div class="saved-debts-total">
        <span>Total Debt</span>
        <span id="saved-debts-total-val">$0</span>
      </div>
      <div class="manual-entry-actions">
        <button type="button" class="commitment-btn" id="update-balances-btn">Update Balances</button>
        <button type="button" class="commitment-btn setup-start-btn" id="start-climb-btn" hidden>Start Climb</button>
        <p class="data-strip-msg" id="snapshot-save-msg"></p>
      </div>
    </div>

    <!-- Add new debt form -->
    <div id="add-debt-section">
      <form id="manual-snapshot-form" class="manual-entry-form" autocomplete="off">
        <div class="manual-entry-accounts">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <p class="manual-entry-sub-label" id="add-debt-heading">Add your debts</p>
            <button type="button" class="refresh-btn" id="add-debt-account-btn" aria-label="Add another debt account">+ Add Account</button>
          </div>
          <div id="debt-accounts-entries"></div>
          <p class="manual-entry-hint">Add each credit card, loan, or liability with its current balance.</p>
        </div>
        <div class="manual-entry-actions">
          <button type="submit" class="commitment-btn" id="save-snapshot-btn">Save Debts</button>
          <button type="button" class="commitment-btn setup-start-btn" id="start-climb-empty-btn" hidden>Start Climb</button>
        </div>
      </form>
    </div>
  `;
  return section;
}

function buildDataStrip() {
  const section = el('section', { class: 'data-strip dashboard-only-section', 'aria-label': 'Data sync' });
  section.innerHTML = `
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
    <div class="data-strip-actions">
      <a class="refresh-btn" id="export-csv-btn" href="/api/export?format=csv" download
         title="Your snapshot history as a CSV \u2014 opens straight into Excel / Google Sheets. Per-account history: /api/export?format=csv&table=accounts">\u2913 CSV</a>
      <a class="refresh-btn" id="export-data-btn" href="/api/export" download
         title="Everything (snapshots, account history, settings) as a JSON file \u2014 your complete personal backup.">\u2913 JSON</a>
    </div>
  `;
  return section;
}


/* "Ask the Steward" — suggested-question chips that query the AI about the
   user's own numbers. Hidden until initAskSteward() confirms AI is configured
   (and only on an active climb). Built collapsed; wiring lives in steward-ai.js. */
const ASK_STEWARD_QUESTIONS = [
  'Which debt should I pay first?',
  'When could I be debt-free?',
  'How am I doing?',
  'What is interest costing me?',
];

function buildAskStewardPanel() {
  const section = el('section', { class: 'section-panel dashboard-only-section ask-steward-panel', id: 'ask-steward-panel', hidden: true });
  section.innerHTML = `
    <p class="tc-section-label" style="margin:0 0 4px;">Ask the Steward</p>
    <p class="tc-section-sublabel">Answers drawn from your own numbers.</p>
    <div class="ask-steward-chips" id="ask-steward-chips">
      ${ASK_STEWARD_QUESTIONS.map(q => `<button type="button" class="ask-steward-chip">${q}</button>`).join('')}
    </div>
    <div class="ask-steward-answer" id="ask-steward-answer" hidden aria-live="polite"></div>
  `;
  return section;
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
  dashboard.appendChild(buildManualEntryForm());
  dashboard.appendChild(buildDebtReductionChart());
  dashboard.appendChild(buildSessionPanel());
  dashboard.appendChild(buildAskStewardPanel());
  dashboard.appendChild(buildDebtAccountsPanel());
  dashboard.appendChild(buildStageProgressDetail());
  dashboard.appendChild(buildCumulativePaydownTrophy());
  dashboard.appendChild(buildDataStrip());
  /* Danger zone \u2014 destructive actions tucked behind a disclosure so they can't be
     hit accidentally from the bottom of the dashboard. Each action has its own
     description block so the user understands the difference between "wipe my
     game data" and "delete my account entirely". Confirmation prompts in
     commitment.js are the second line of defence. */
  const dangerZone = el('details', { class: 'play-danger-zone' });
  dangerZone.innerHTML = `
    <summary class="play-danger-summary">Account &amp; danger zone</summary>
    <div class="play-danger-action" id="account-security-section">
      <p class="play-danger-action-title">Account security</p>
      <form class="account-pw-form" id="change-password-form" autocomplete="off" hidden>
        <input type="password" class="account-pw-input" id="cp-current" placeholder="Current password" autocomplete="current-password" maxlength="200" />
        <input type="password" class="account-pw-input" id="cp-new" placeholder="New password (10+ chars)" autocomplete="new-password" maxlength="200" />
        <input type="password" class="account-pw-input" id="cp-confirm" placeholder="Confirm new password" autocomplete="new-password" maxlength="200" />
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

  root.appendChild(dashboard);

  /* Sticky floating action — scrolls back to the manual-entry panel.
     Hidden by default; initStickyUpdateFab() shows it when the panel scrolls
     out of view and at least one saved debt exists. */
  const fab = el('button', {
    type: 'button',
    class: 'fab-update-balances',
    id: 'fab-update-balances',
    'aria-label': 'Scroll to update balances',
    title: 'Update your balances',
    hidden: true,
  });
  fab.innerHTML = '<span class="fab-icon" aria-hidden="true">✎</span><span class="fab-label">Update balances</span>';
  root.appendChild(fab);
}

