# Cutscene video

Drop the milestone cutscene here as:

    public/videos/cutscene.mp4

It's served at `/videos/cutscene.mp4` and played fullscreen, once, every 75th
login **for the account `LoudFlipFlopz` only** (see `services/cutscene.js` and
`public/js/cutscene.js`).

Notes:
- Use a web-friendly **H.264 / AAC `.mp4`** so every browser can play it.
- Keep it short and reasonably sized — it loads on the dashboard.
- Until this file exists, the cutscene shows a small "reel isn't loaded yet"
  card instead of a black screen, so nothing breaks.
- To change the filename/path, edit `VIDEO_SRC` in `public/js/cutscene.js`.
- To change who gets it or the cadence, edit `CUTSCENE_USERNAME` /
  `CUTSCENE_EVERY` in `services/cutscene.js`.
