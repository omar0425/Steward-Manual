# Cutscene video (private)

Drop the milestone cutscene here as:

    media/cutscene.mp4

This folder is **outside** `public/`, so it is NOT served as a static file.
The clip is streamed only through the authenticated route
`GET /api/cutscene/video`, which returns it **only** to the account
`LoudFlipFlopz` and 404s for everyone else (logged-out requests are blocked by
the `/api` session gate). So no one else can play it or open the file directly.

It plays fullscreen, once, every 75th login for that account.

Notes:
- Use a web-friendly **H.264 / AAC `.mp4`** so every browser can play it.
- Keep it reasonably sized — it streams to the dashboard (range requests are
  supported, so seeking works).
- Until this file exists, the cutscene shows a small "reel isn't loaded yet"
  card instead of a black screen, so nothing breaks.
- To change the filename/path, edit `CUTSCENE_VIDEO_PATH` in `routes/api.js`
  (and `VIDEO_SRC` in `public/js/cutscene.js` if the route changes).
- To change who gets it or the cadence, edit `CUTSCENE_USERNAME` /
  `CUTSCENE_EVERY` in `services/cutscene.js`.
- Committing a large binary to git is optional; you can also place the file on
  the server/volume at this path out-of-band.
