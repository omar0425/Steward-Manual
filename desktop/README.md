# Steward Desktop

The Steward web app in its own window, with a **system-tray icon** — a real
desktop app on your bar. It's a thin shell around the hosted app (your Railway
deployment), so it's always exactly as up to date as production and your data
stays in one place. Nothing is bundled or duplicated.

## Install on your machine (Windows)

From a machine with Node installed:

```bat
cd desktop
npm install
npm run dist
```

That produces `desktop\dist\Steward Setup 1.0.0.exe`. Run it — one-click
install, and you get:

- **Desktop shortcut** + Start-menu entry
- **Tray icon** (your bar): left-click toggles the window, right-click for the
  menu
- **Close button hides to the tray** instead of quitting — Quit lives in the
  tray menu
- **"Start when I log in"** toggle in the tray menu
- Launching it twice just focuses the running window

macOS: `npm run dist:mac` → a `.dmg` in `desktop/dist/`. Linux:
`npm run dist:linux` → an AppImage.

To try it without installing anything permanent: `npm start`.

## Updates

Two layers, two behaviors:

- **The app's content** (dashboard, Strategy Lab, chat — everything in the
  window) is the hosted site, so it is always current with production. No
  action ever needed.
- **The shell itself** (icon, tray, window behavior) auto-updates from this
  repo's GitHub Releases: checked at launch and every 6 hours, downloaded in
  the background, installed on the next quit. "Check for updates" in the tray
  menu forces a check. Each "Desktop installer" workflow run publishes release
  `v1.0.<run>` with the installer and the `latest.yml` manifest the updater
  polls.

Permanent download link for fresh installs (always the newest build):
`https://github.com/omar0425/Steward-Manual/releases/latest/download/Steward.Setup.exe`

## Pointing it somewhere else

By default the shell loads the production app. To use a different URL (e.g. a
local dev server), either set the `STEWARD_URL` environment variable or create
`desktop/steward-desktop.json`:

```json
{ "url": "http://localhost:3000" }
```

## Notes

- The window is a sandboxed browser shell — the page gets no Node/filesystem
  access. External links (anything off your Steward origin) open in your
  default browser.
- The lightest-weight alternative, no build step at all: Steward is already an
  installable PWA — in Chrome/Edge on the dashboard, ⋮ menu → *Cast, save and
  share* → *Install page as app*. You get a desktop + taskbar app in three
  clicks; the Electron shell adds the tray icon, hide-to-tray, and the
  start-on-login toggle on top of that.
