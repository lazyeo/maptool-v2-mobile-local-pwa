# Rolleston Zone Planner — PWA

A mobile-first Progressive Web App for drawing and managing custom geographic zones around the Rolleston / Selwyn District area of Canterbury, New Zealand.

## Features

- **Interactive map** — Leaflet.js + OpenStreetMap tiles (no API key required)
- **Draw zones** — tap or click to draw custom polygons on the map
- **Edit zones** — drag the entire polygon to move it; drag individual vertices to reshape; rename, recolour, or delete
- **Zone list** — drag-to-reorder with smooth animation (SortableJS); inline edit and delete (trash icon)
- **Address search** — local-first fuzzy search against the checked-in `rolleston-addresses.json` array (**16,507** records in the current file); Nominatim API fallback for addresses not in local DB
- **Zone detection** — automatically shows which zone a searched address belongs to
- **Address registration / point management** — searched addresses can be added into a zone, moved between zones, marked done/pending, reordered, and cleared when completed
- **Camera OCR** — use device camera to photograph a letterbox, street sign, or address label; Tesseract.js reads the text locally (no server or API) and presents recognised lines as selectable tokens; confirm to push back into address search
- **PWA** — installable on Android via Chrome install prompt; installable on iOS via Safari → Share → Add to Home Screen; service worker for offline caching of app shell

## File structure

| File | Description |
|------|-------------|
| `index.html` | App shell, meta tags, all script/style references |
| `app.js` | All application logic |
| `style.css` | All styles |
| `sw.js` | Service worker — caches app shell for offline use |
| `manifest.json` | PWA manifest (name, icons, display mode, theme colour) |
| `assets/` | PWA icon assets for browser tab, install prompt, and home-screen shortcuts |
| `default-zones.json` | Default zone/point bootstrap config used when localStorage is empty |
| `rolleston-addresses.json` | Current local address dataset used by `loadAddressDB()` |
| `ROLLESTON_DATA_REPORT.md` | Historical extraction notes + current-reality correction |

## Running locally

```bash
git clone https://github.com/lazyeo/maptool-v2-mobile-local-pwa.git
cd maptool-v2-mobile-local-pwa
python3 -m http.server 8765
# Open http://localhost:8765 in browser
```

## Mobile / real-device testing (HTTPS required)

Camera access and PWA install prompts require a secure context (HTTPS). Use Cloudflare Tunnel for a free temporary public URL:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:8765
# Outputs a URL like: https://xxx.trycloudflare.com
# Open that URL on your phone
```

## iOS PWA notes

- **Install:** Safari → Share button → "Add to Home Screen"
- iOS does **not** support the `beforeinstallprompt` event — there is no automatic install banner on iOS; users must add manually via Safari
- Safe-area insets (`env(safe-area-inset-top/bottom)`) are applied so the UI clears the notch and home indicator bar correctly
- Status bar style is set to `black-translucent` so the map extends under the status bar

## Tech stack

| Library | Purpose |
|---------|---------|
| [Leaflet.js](https://leafletjs.com/) | Map rendering |
| [Leaflet.draw](https://leaflet.github.io/Leaflet.draw/) | Polygon drawing & vertex editing |
| [SortableJS](https://sortablejs.github.io/Sortable/) | Drag-to-reorder zone list and points |
| [Tesseract.js](https://tesseract.projectnaptha.com/) | Local OCR — runs entirely in browser, no server needed |
| OpenStreetMap / Nominatim | Map tiles and online address geocoding (free, no API key) |

## Address data reality check

The repo previously contained conflicting statements about the local data file. The current checked-in implementation is the source of truth:

- `app.js -> loadAddressDB()` expects `rolleston-addresses.json` to be a **plain array**.
- The current `rolleston-addresses.json` in this repo is indeed a plain array and currently contains **16,507** records.
- Each record is shaped like the UI expects, with a `display` field plus address components and coordinates.
- Older documentation in this repo that described a 47-record `{ metadata, addresses: [] }` envelope does **not** match the checked-in file actually used by the app.

## Known limitations / backlog

- No multi-user / sync — zones are stored in `localStorage` only after initial bootstrap from `default-zones.json`
- Data pipeline provenance is not yet fully reconciled with the checked-in dataset
- The app is still a single-file-heavy prototype (`app.js`), so UI, storage, search, OCR, and map editing remain tightly coupled
