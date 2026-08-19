# Steward — Full Product Roadmap

Everything discussed across our sessions, organized into phases. Each phase builds on the previous one.

---

## What You Have Today (Already Built)

**Estimated value: ~$25,000-30,000**

- Node.js server with Express routing
- YNAB API integration (account sync, snapshots, cron scheduling)
- Public.com brokerage integration
- SQLite database with snapshot history
- 10-tier debt tracking system with climb metrics
- Percentage-based tiers (works for ANY debt amount — $5K or $500K)
- Stability / breathing room calculations
- Momentum streak tracking
- Payoff milestone notifications
- Responsive dashboard with dark mode (WCAG AA compliant)
- Unified hero section (position + progress in one block)
- Net worth chart (full-width, high contrast)
- Debt list showing all accounts (paid-off debts crossed out)
- Tier cards (current + next, with locked/dimmed next tier)
- Tier-up animation (glow/pulse on level-up)
- Character art system (10 tiers)
- Commitment screen with onboarding flow
- Windows batch/VBS launchers
- 8 PRs of hardening, bug fixes, and refinements

---

## Phase 0: Merge Current Work (Do This Now)

**Cost: $0 | Time: 10 minutes**

Merge your open PRs in this order:
1. PR #4 — Consolidation Phase 1
2. PR #5 — Behavior hardening (5 fixes)
3. PR #6 — Streak, breathing room, milestones
4. PR #7 — Full consolidation + responsive + dark mode + net worth chart
5. PR #8 — Dashboard refinement + percentage-based tiers + debt list

All rebased and CI-green. Merge top to bottom.

---

## Phase 1: Original Character Design (Do This Before Going Public)

**Cost: $5-10 (AI-generated) or $100-300 (freelance artist) or $500-1,500 (professional)**

**Why first:** The current character is too close to Monopoly's Rich Uncle Pennybags. Hasbro is aggressive about IP. You need a unique character before any public launch.

**Options:**
- Climber/mountaineer (fits the "climb" metaphor)
- Knight with armor upgrades per tier (rags → full plate)
- Builder constructing a house brick by brick
- Modern suit character with a distinct face (no monocle, no top hat)

**Deliverable:** 10 character illustrations (one per tier), consistent style, distinct from any existing IP.

---

## Phase 2: Multi-User Core

**Cost: $175-245 | Monthly cost after: ~$5-15/mo**

| Feature | What it does | Estimate |
|---------|-------------|----------|
| Magic Link auth | Email-based passwordless login, session tokens, logout | $30-40 |
| Plaid integration | Replace YNAB — users connect their own banks directly, pull balances/debts automatically | $50-70 |
| Per-user data isolation | Each user gets own data (snapshots, config, debt accounts, tier progress) | $30-40 |
| Manual debt entry | Form to add/edit/delete debts not in Plaid (medical bills, personal loans, etc.) | $25-35 |
| User settings page | Connect/disconnect bank, manage manual debts, view profile | $15-25 |
| Server hardening | HTTPS, CSRF, rate limiting, secure sessions | $15-20 |
| Deployment | Docker + deploy to your private server, environment config | $10-15 |

**Key decision:** Plaid replaces YNAB. Users no longer need a $99/yr YNAB subscription — Plaid connects directly to their banks. Removes huge friction.

**Monthly costs at this phase:**
- Plaid: Free for first 100 connections, ~$0.30/connection after
- Hosting: $5-10/mo (DigitalOcean, Railway, or Fly.io)
- Magic Link: Free for first 1,000 logins/mo

---

## Phase 3: Mobile (PWA)

**Cost: $20-30 | Monthly cost: $0**

Make the web app installable on Android and iPhone:
- Add manifest.json + service worker
- "Add to Home Screen" prompt
- App icon on home screen, full-screen experience
- Works offline for cached data

Users tap "Install" from their phone's browser → looks and feels like a native app. No App Store needed. The dashboard is already responsive.

---

## Phase 4: Engagement Features

**Cost: $40-60**

| Feature | Estimate |
|---------|----------|
| Push notifications (tier-up alerts, streak reminders) | $25-35 |
| Weekly email digest (progress summary) | $15-25 |

These keep users coming back. The tier-up notification is the key dopamine hit.

---

## Phase 5: Monetization

**Cost: $40-60**

| Feature | Estimate |
|---------|----------|
| Stripe subscription integration | $25-35 |
| Free tier vs premium tier (paywall advanced features) | $15-25 |

### Pricing Tiers

| Plan | Price | Best for |
|------|-------|----------|
| Monthly | $2.99/mo | People who want to try it first |
| Annual | $24.99/yr ($2.08/mo) | Committed users, lower churn |
| Lifetime | $79 one-time | Power users, early adopters |

**Free tier:** Basic dashboard, 2 bank connections, manual debt entry
**Premium:** Unlimited bank connections, push notifications, weekly digests, shareable tier cards, what-if calculator

### Lifetime Pricing Strategy

$79 lifetime = ~27 months of $2.99/mo (standard formula: monthly x 24-36 months).

**Recommended rollout:**
1. **Launch:** Offer lifetime at $79 to first 100-200 users (early adopter reward, builds community, cash injection for marketing)
2. **After 200 users:** Remove lifetime option, keep monthly + annual only
3. **Black Friday / special events:** Bring back lifetime briefly as a promotion

**Why $79:**
- Under $80 (psychological threshold)
- Attracts serious, committed users
- Front-loads revenue to fund growth
- Creates loyal early adopter community

**Trade-off:** Lifetime deals give you cash now but reduce recurring revenue later. That's why you cap it at 100-200 seats — enough to fund marketing, then switch to recurring for sustainable income.

---

## Phase 6: Growth Features

**Cost: $25-45**

| Feature | Estimate |
|---------|----------|
| Shareable tier card export (PNG for social media) | $10-15 |
| Referral system ("Invite a friend, both get 1 month free") | $15-30 |

These turn your users into your marketing team.

---

## Phase 7: Polish & Launch

**Cost: $45-70**

| Feature | Estimate |
|---------|----------|
| 3-screen onboarding walkthrough | $15-20 |
| Landing page (marketing site) | $15-25 |
| Terms of service / privacy policy page | $5-10 |
| Domain setup, SSL, monitoring, error tracking | $10-15 |

---

## Phase 8: Product Hunt Launch

**Cost: $0 | Time: 1 day of prep**

Launch on Product Hunt once you have ~50 users. The gamification angle stands out. One good launch day = 500-2,000 signups.

---

## Future Phases (After Revenue)

| Feature | Estimate | When |
|---------|----------|------|
| Native iOS/Android apps (React Native or Capacitor) | $270-395 | After 500+ users |
| What-If Calculator ("If I pay $X extra/month...") | $5-7 | Any time |
| Tier History Timeline (visual climb history) | $10-12 | Any time |
| Card gradients (unique visual per tier) | $5-7 | Any time |
| Micro-interactions (hover effects, transitions) | $5-7 | Any time |
| Tier-up celebration (confetti, sound) | $5-7 | Any time |

---

## Customer Acquisition Plan (Free → Paid)

**Free (start immediately):**
1. Reddit — r/debtfree (196K), r/personalfinance (19M), r/povertyfinance (1.3M). Share your journey with screenshots. Don't pitch — let people ask.
2. TikTok/Reels — Screen record the tier-up animation. "I went from Rock Bottom to Stable." Debt content is huge on TikTok.
3. Debt-free communities — Dave Ramsey groups, YNAB forums, Facebook Debt Free Community (~300K members).
4. Product Hunt launch (Phase 8)
5. SEO/Blog — "Best debt payoff tracker," "gamified debt payoff app." 5-10 articles, they compound.

**Paid (once you have revenue):**
6. Google Ads — "debt payoff app" keywords, ~$1-3 CPC. $100/mo gets you started.
7. Micro-influencer partnerships — Personal finance YouTubers/TikTokers, $100-500 per post.

**Built into the product:**
8. Shareable tier cards (Phase 6) — free marketing every time someone levels up
9. Referral system (Phase 6) — "Invite a friend, both get 1 month free"
10. The tier-up animation IS the marketing — if it feels good, people screen-record and share it

---

## IP Protection

| Protection | Cost | Priority |
|------------|------|----------|
| Unique character design (Phase 1) | $5-1,500 | **Do before going public** |
| Trademark "Steward" for financial software | $250-350 (USPTO) | High — do before launch |
| Keep repo private | $0 | Already done |
| Copyright notice in footer | $0 | Add now |
| Provisional patent (behavioral tier system) | $150-200 DIY, $1,500-3,000 with lawyer | Consider after traction |
| NDAs for collaborators | $0-50 (templates online) | If you bring on partners |

---

## Business Setup (Before Accepting Payments)

### Do You Need an LLC?

**Short answer:** Not to build or test, but **yes before you accept your first payment.**

**Without an LLC (sole proprietor):**
- If someone sues (data breach, refund dispute, anything), they can go after your personal assets — bank accounts, car, house
- Your personal SSN is on everything (Stripe, taxes, bank accounts)
- You're personally liable for everything

**With an LLC:**
- Personal assets are protected — liability is limited to the business entity
- You get an EIN (like a business SSN) — use that for Stripe, taxes, bank accounts
- Looks more professional to users and partners
- Required by some payment processors for certain volumes

**Cost & timeline:**

| State | Filing fee | Time |
|-------|-----------|------|
| Wyoming | $100 | Same day online |
| Delaware | $90 | 1-2 weeks |
| Most states | $100-300 | Same day to 2 weeks |

**How to do it:**
1. File online at your state's Secretary of State website (or use a service like LegalZoom for ~$79 + state fee)
2. Get an EIN from the IRS (free, takes 5 minutes at irs.gov)
3. Open a business bank account (keeps personal and business money separate)
4. Use the EIN for Stripe, taxes, and all business transactions

**When:** Do this in Phase 5 (Monetization), before you connect Stripe and start charging users. You do NOT need it for building, testing, or even getting free users.

### Error Tracking & Monitoring

Add before launch to catch bugs before users report them:

| Tool | What it does | Cost |
|------|-------------|------|
| Sentry | Catches JavaScript errors, shows exact stack trace + user context | Free (5,000 errors/mo) |
| UptimeRobot | Pings your server every 5 min, emails you if it goes down | Free (50 monitors) |
| Automated DB backups | Daily cron job copies SQLite database to a backup location | Free (5-line script) |

**Build cost to add all three: ~$5-10**

With these in place, you'll know about problems before users even report them. Sentry tells you exactly what broke, on which page, for which user — you don't have to guess.

---

## Shutdown Protection (If You Need to Close)

Your risk is very low at this scale. Here's how to protect yourself:

### Terms of Service (Required — Phase 7)

Add this clause to your TOS:

> *"Steward is provided as-is. In the event the service is discontinued, subscribers will receive 30 days' notice and the ability to export their data. No refunds will be issued for lifetime purchases after 12 months of active service."*

Users accept TOS at signup. This is standard for every SaaS product.

### Shutdown FAQ (Add to your site)

> **What happens if Steward shuts down?**
> We'll give at least 30 days' notice and provide a full data export (CSV/JSON of all your snapshots, debt history, and tier progress). If you purchased a lifetime plan and have had access for 12+ months, we consider the purchase fulfilled.

### What Other Apps Do When They Shut Down

| Approach | How it works |
|----------|-------------|
| 30-60 day notice | Email all users, give them time to export data |
| Data export | Let users download snapshot history as CSV/JSON |
| Open source it | Release the code so power users can self-host |
| Sell the app | SaaS businesses sell for 3-5x annual revenue on Acquire.com |

### Why You Shouldn't Worry

- Operating costs are $6-50/mo — you can keep it running with zero revenue
- No team to pay, no office, no investors
- If you lose interest, put it on autopilot (no new features, just keep server running) for $6/mo
- If you have enough users to worry about lawsuits, you have enough users to sell the business instead
- Nobody will sue over $79 — and your TOS covers you anyway
- **Worst realistic case:** You stop paying hosting, app goes offline, users move on. Life goes on.

### Exit Options (If You Want Out)

| Scenario | What to do | Expected value |
|----------|-----------|---------------|
| < 100 users | Just shut it down, email notice | $0 |
| 100-500 users | Sell on Acquire.com | $5,000-20,000 |
| 500-2,000 users | Sell at 3x annual revenue | $50,000-200,000 |
| 2,000+ users | Sell at 4-5x annual revenue or keep running | $200,000+ |

Even shutting down is a non-event. And if Steward is making money, you can always sell it instead of closing it.

---

## Total Cost Summary

| Phase | Cost | Running Total |
|-------|------|---------------|
| Phase 0: Merge PRs | $0 | $0 |
| Phase 1: Character design | $5-300 | $5-300 |
| Phase 2: Multi-user (Magic Link + Plaid) | $175-245 | $180-545 |
| Phase 3: PWA (mobile) | $20-30 | $200-575 |
| Phase 4: Engagement | $40-60 | $240-635 |
| Phase 5: Monetization | $40-60 | $280-695 |
| Phase 6: Growth features | $25-45 | $305-740 |
| Phase 7: Polish & launch | $45-70 | $350-810 |
| **Total to commercial launch** | **$350-810** | |

**Monthly operating costs:** $15-50/mo (Plaid + hosting + email service)

---

## Revenue Projections

| Users | Monthly Revenue ($7/mo) | Monthly Costs | Monthly Profit |
|-------|------------------------|---------------|----------------|
| 50 | $350 | ~$30 | $320 |
| 100 | $700 | ~$50 | $650 |
| 500 | $3,500 | ~$100 | $3,400 |
| 1,000 | $7,000 | ~$200 | $6,800 |

At 50 paying users you're profitable. At 100 users you've recouped the entire build cost in 1 month.

---

*Generated from all conversations in the Steward development sessions.*
*Last updated: April 2026*
