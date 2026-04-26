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
    </div>
    <div class="nav-right">
      <span class="nav-badge" id="nav-stage-tag">Classic</span>
      <button class="nav-theme-btn" type="button" id="theme-toggle">\u263D Dark</button>
    </div>
  `;
  return nav;
}

function buildMilestoneBanner() {
  const banner = el('div', { class: 'milestone-banner', id: 'milestone-banner', hidden: true });
  banner.innerHTML = `
    <span class="milestone-icon">\uD83C\uDFC6</span>
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
        <p class="start-footer">
          <a href="/showcase">View all 10 stages</a>
        </p>
      </div>
    </div>
  `;
  return screen;
}

function buildLoadingScreen() {
  return el('div', { id: 'loading-screen', class: 'loading-screen' },
    el('div', { class: 'loading-inner' },
      el('div', { class: 'loading-spinner' }),
      el('p', { class: 'loading-text' }, 'Enter your numbers to get started\u2026'),
      el('p', { class: 'loading-cta' },
        el('button', { type: 'button', class: 'loading-sync-btn', id: 'loading-sync-btn' }, 'Add Your Debts'),
      ),
    ),
  );
}

function buildErrorScreen() {
  return el('div', { id: 'app-error-screen', class: 'app-error-screen', role: 'alert', 'aria-live': 'assertive' },
    el('div', { class: 'app-error-inner' },
      el('p', { class: 'app-error-title' }, 'Couldn\u2019t load Steward'),
      el('p', { class: 'app-error-text', id: 'app-error-text' }),
      el('p', { class: 'app-error-hint', innerHTML: 'We\u2019ll retry automatically. Check that the server is running (<code>npm start</code> in the steward folder).' }),
    ),
  );
}

function buildHeroSection() {
  const section = el('section', { class: 'hero-section', id: 'hero-section' });
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
            <div class="tier-card-gap" id="card-tier-gap-headline">\u2192 \u2014</div>
            <div class="tier-card-name" id="card-tier-name">Buried</div>
            <div class="tier-card-bar-track">
              <div class="tier-card-bar-fill" id="card-bar-fill"></div>
            </div>
            <div class="tier-card-debt" id="card-footer-debt">\u2014 remaining</div>
          </div>
        </div>

        <div class="tier-card tier-card-locked" id="locked-next-card" data-state="broke" hidden>
          <div class="locked-blur-layer">
            <div class="tier-card-badge" id="locked-badge-chip">02</div>
            <div class="tier-card-footer">
              <div class="tier-card-name" id="locked-tier-name">Pushing</div>
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
          \uD83D\uDD25 <span id="streak-count">0</span> day streak
        </div>
      </div>
      <p class="sr-only" id="hero-tier-label" aria-live="polite">Buried</p>

      <p class="hero-escape-primary" id="hero-escape-primary" aria-live="polite">\u2014</p>
      <p class="hero-cta-line" id="hero-primary-cta">Kill <span class="val" id="stat-daily-target">\u2014</span> today</p>

      <span class="stat-sentinel" id="stat-debt-remaining" hidden></span>
      <span class="stat-sentinel" id="stat-net-worth" hidden></span>

      <!-- In-stage position (secondary to the dollar headline; thin) -->
      <div class="stage-gap-section">
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

      <div class="hero-links">
        <a href="/showcase" class="hero-link">View all 10 stages</a>
      </div>
    </div>
  `;
  return section;
}

function buildNetWorthChart() {
  const section = el('section', { class: 'section-panel' });
  section.innerHTML = `
    <div class="chart-header">
      <p class="section-label">Net Worth Trend</p>
      <span>
        <span class="chart-current neg" id="stat-net-worth-chart">\u2014</span>
        <span class="chart-trend" id="chart-trend-delta"></span>
      </span>
    </div>
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
      </svg>
    </div>
    <div class="chart-x-labels" id="chart-x-labels"></div>
    <p class="chart-memo">Net worth trend · latest 60 snapshots</p>
  `;
  return section;
}

function buildSessionPanel() {
  const section = el('section', { class: 'section-panel session-card', id: 'session-card' });
  section.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
      <p class="tc-section-label" style="margin:0;">This Turn</p>
      <span class="turn-since-label" id="turn-since-label"></span>
    </div>
    <div class="session-hero">
      <span class="session-net-val" id="this-turn-net">\u2014</span>
      <span class="session-net-label">Net this turn</span>
    </div>
    <div id="this-turn-list"></div>
  `;
  return section;
}

function buildDebtAccountsPanel() {
  const section = el('section', { class: 'section-panel' });
  section.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <p class="tc-section-label" style="margin:0;">Debt Accounts</p>
      <div style="display:flex;align-items:center;gap:8px;">
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
    <div class="game-start-row" id="game-start-row" hidden>
      <span class="game-start-label">Game start</span>
      <span class="game-start-meta" id="game-start-meta"></span>
      <span class="game-start-val" id="game-start-val"></span>
    </div>
    <p class="commitment-reason-display" id="commitment-reason-display" hidden></p>
  `;
  return section;
}

function buildStageProgressDetail() {
  const section = el('section', { class: 'section-panel' });
  section.innerHTML = `
    <p class="tc-section-label" style="margin-bottom:20px;">Stage progress</p>
    <p class="progress-note" id="progress-restructure-note" hidden style="font-size:12px;color:var(--text-2);margin-bottom:12px;"></p>
    <p class="progress-note" id="progress-stale-note" hidden style="font-size:12px;color:var(--amber);margin-bottom:12px;"></p>
    <ul class="sp-grid" id="progress-detail-bullets" aria-label="Session progress">
      <li id="progress-bullet-paid"></li>
      <li id="progress-bullet-turn"></li>
      <li id="progress-bullet-newdebt"></li>
      <li id="progress-bullet-direction"></li>
    </ul>
    <p class="progress-note" id="progress-debt-direction" hidden style="font-size:12px;color:var(--text-2);margin-top:14px;"></p>
    <p id="progress-milestone-next" hidden style="font-size:12px;color:var(--gold);margin-top:14px;font-style:italic;"></p>
    <p id="progress-next-move" hidden style="font-size:12px;color:var(--text-2);margin-top:6px;"></p>
  `;
  return section;
}

function buildCumulativePaydownTrophy() {
  const section = el('section', { class: 'section-panel' });
  section.innerHTML = `
    <div class="trophy-row">
      <div class="trophy-icon" aria-hidden="true">\uD83D\uDC80</div>
      <div class="trophy-body">
        <p class="trophy-label">Total Cleared</p>
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
        <p class="data-strip-msg" id="snapshot-save-msg"></p>
      </div>
    </div>

    <!-- Add new debt form -->
    <div id="add-debt-section">
      <form id="manual-snapshot-form" class="manual-entry-form" autocomplete="off">
        <div class="manual-entry-accounts">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <p class="manual-entry-sub-label" id="add-debt-heading">Add your debts</p>
            <button type="button" class="refresh-btn" id="add-debt-account-btn">+ Add Account</button>
          </div>
          <div id="debt-accounts-entries"></div>
          <p class="manual-entry-hint">Add each credit card, loan, or liability with its current balance.</p>
        </div>
        <div class="manual-entry-actions">
          <button type="submit" class="commitment-btn" id="save-snapshot-btn">Save Debts</button>
        </div>
      </form>
    </div>
  `;
  return section;
}

function buildDataStrip() {
  const section = el('section', { class: 'data-strip', 'aria-label': 'Data sync' });
  section.innerHTML = `
    <div class="data-chip">
      <span class="data-chip-k">Last snapshot</span>
      <span class="data-chip-v" id="data-last-snapshot">\u2014</span>
    </div>
    <div class="data-chip">
      <span class="data-chip-k">Freshness</span>
      <span class="data-chip-v fresh freshness-dot" id="freshness-badge">\u2014</span>
    </div>
    <div class="data-strip-actions">
      <button class="refresh-btn" type="button" id="refresh-update-btn" onclick="document.getElementById('manual-entry-panel').scrollIntoView({behavior:'smooth'})">\u270e Update Numbers</button>
    </div>
    <p class="data-strip-msg" id="refresh-msg"></p>
    <p class="data-strip-foot">Manual edition \u00b7 Enter your numbers and save a snapshot whenever your balances change</p>
  `;
  return section;
}

function buildSentinelDiv() {
  const div = el('div', {
    style: 'position:absolute;width:0;height:0;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;',
    'aria-hidden': 'true',
  });
  div.innerHTML = `
    <span id="stat-investments">\u2014</span>
    <span id="stat-brok-sub"></span>
    <span id="stat-debt-paid">\u2014</span>
    <span id="paid-down-feedback" hidden></span>
    <span id="board-axes-hint"></span>
    <span id="board-runway-line"></span>
    <span id="board-guard-note" hidden></span>
    <span id="board-stability-note"></span>
    <span id="board-debt-axis"></span>
    <span id="board-liquidity-pill-sentinel"></span>
    <span id="hero-guard-hint" hidden></span>
    <span id="hero-live-pill"></span>
    <span id="hero-stat-paid">\u2014</span>
    <span id="hero-stat-runway">\u2014</span>
    <span id="hero-stability-lead-sentinel"></span>
    <span id="hero-mood-copy-sentinel"></span>
    <span id="hero-climb-summary" hidden>
      <span id="hero-climb-line-new-debt"></span>
      <span id="hero-climb-line-paydown"></span>
      <span id="hero-climb-line-net"></span>
    </span>
    <div id="vnext-hero-turn-accounts" hidden>
      <ul id="vnext-hero-turn-accounts-list"></ul>
      <span id="vnext-hero-turn-accounts-net"></span>
    </div>
    <p id="hero-tier-behavior" hidden></p>
    <p id="hero-tier-copy" hidden></p>
    <div class="hero-progress-sentinel" aria-hidden="true" hidden>
      <p id="progress-story-lead"></p>
      <p id="progress-lifetime-climb"></p>
      <p id="progress-story-delta"></p>
      <p id="progress-story-pace"></p>
      <p id="progress-story-hint"></p>
      <p id="progress-story-projection" hidden></p>
      <p id="progress-story-projection-debtfree" hidden></p>
    </div>
    <div id="climb-last-pull-summary" hidden>
      <div id="progress-last-pull-accounts" style="display:flex;flex-direction:column;gap:3px;"></div>
      <p id="progress-last-pull-net-line"></p>
      <p id="progress-last-pull-lifetime-line"></p>
    </div>
    <span id="next-tier-current" hidden></span>
    <span id="next-tier-target" hidden></span>
    <span id="board-tier-gap-label" hidden></span>
    <span id="board-tier-gap-headline" hidden></span>
    <span id="stat-months-to-next" hidden></span>
    <span id="data-session-time" hidden></span>
    <span id="card-bar-inband-pct" hidden></span>
    <span id="progress-stale-note" hidden></span>
    <span id="progress-restructure-note" hidden></span>
    <span id="progress-story-pace" hidden></span>
    <span id="progress-debt-direction" hidden></span>
    <span id="vnext-inband-pct-readout" hidden></span>
    <span id="vnext-progress-finish-cue" hidden></span>
    <span id="hero-axes-hint" hidden></span>
    <span id="hero-phase-pill" hidden></span>
    <span id="streak-line" hidden></span>
    <div id="vnext-nw-climb-chart-wrap" hidden></div>
    <span id="vnext-nw-climb-empty" hidden></span>
    <div id="vnext-nw-climb-legend" hidden>
      <span id="vnext-nw-climb-latest"></span>
      <span id="vnext-nw-climb-change"></span>
    </div>
    <span id="hero-liq-runway" hidden></span>
  `;
  return div;
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
  dashboard.appendChild(buildNetWorthChart());
  dashboard.appendChild(buildSessionPanel());
  dashboard.appendChild(buildDebtAccountsPanel());
  dashboard.appendChild(buildStageProgressDetail());
  dashboard.appendChild(buildCumulativePaydownTrophy());
  dashboard.appendChild(buildDataStrip());
  dashboard.appendChild(buildSentinelDiv());
  dashboard.appendChild(
    el('div', { class: 'play-meta-actions', style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:16px 0;' },
      el('button', { type: 'button', class: 'refresh-btn', id: 'play-clear-local-btn', style: 'opacity:0.5;' }, 'Clear local session'),
      el('button', { type: 'button', class: 'refresh-btn', id: 'play-reset-btn', style: 'opacity:0.5;' }, '\u21BA Reset game'),
    ),
  );

  root.appendChild(dashboard);
}
