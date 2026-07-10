    // Dev gallery: bust the module cache on every load so edits always show up
    // with a plain refresh (no version bumping, no server restart).
    const bust = '?t=' + Date.now();
    const { loadCharacterTemplate } = await import('/js/template-loader.js' + bust);
    const { mountHeroCharacterInto } = await import('/js/character.js' + bust);
    const { TIER_FLOW, tierQuote } = await import('/js/tiers.js' + bust);

    await loadCharacterTemplate();

    const grid = document.getElementById('grid');
    TIER_FLOW.forEach((tier, idx) => {
      const card = document.createElement('div');
      card.className = 'ag-card';
      const fill = Math.round(((idx + 0.5) / 10) * 100);
      card.innerHTML = `
        <div class="tier-card hero-tier-card" data-state="${tier.id}">
          <div class="tier-card-badge">${tier.badge}</div>
          <div class="tier-card-character-mount"><div class="ag-mount"></div></div>
          <div class="tier-card-footer">
            <div class="tier-card-name">${tier.label}</div>
            <div class="tier-card-bar-track"><div class="tier-card-bar-fill" style="width:${fill}%"></div></div>
            <div class="tier-card-debt">Stage ${tier.badge} of 10 · ${tier.phase}</div>
          </div>
        </div>
        <div class="ag-quote"><span class="lab">${tier.label}</span><p>${tierQuote(tier.id) || ''}</p></div>
      `;
      const tc = card.querySelector('.tier-card');
      tc.style.setProperty('--state-accent', tier.accent);
      tc.style.setProperty('--state-accent-soft', tier.soft);
      tc.style.setProperty('--state-accent-strong', tier.strong);
      tc.style.setProperty('--state-progress-start', tier.start);
      tc.style.setProperty('--state-progress-end', tier.end);
      grid.appendChild(card);
      mountHeroCharacterInto(card.querySelector('.ag-mount'), tier.id);
    });

    document.getElementById('reveal').addEventListener('change', (e) => {
      document.body.classList.toggle('reveal-props', e.target.checked);
    });
    document.getElementById('pause').addEventListener('change', (e) => {
      document.body.classList.toggle('is-paused', e.target.checked);
    });
