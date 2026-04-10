# Rolleston Zone Planner — PWA

A mobile-first Progressive Web App for drawing and managing custom geographic zones around the Rolleston / Selwyn District area of Canterbury, New Zealand.

## Features

- **Interactive map** — Leaflet.js + OpenStreetMap tiles (no API key required)
- **Draw zones** — tap or click to draw custom polygons on the map
- **Edit zones** — drag the entire polygon to move it; drag individual vertices to reshape; rename, recolour, or delete
- **Zone list** — drag-to-reorder with smooth animation (SortableJS); inline edit and delete (trash icon)
- **Address search** — local-first fuzzy search against 16,507 Rolleston addresses (instant, offline-capable); Nominatim API fallback for addresses not in local DB
- **Zone detection** — automatically shows which zone a searched address belongs to
- **Camera OCR (Phase 2)** — use device camera to photograph a letterbox, street sign, or address label; Tesseract.js reads the text locally (no server or API) and presents recognised words as selectable tokens; tap tokens to build an address phrase and confirm to search
- **PWA** — installable on Android via Chrome install prompt; installable on iOS via Safari → Share → Add to Home Screen; service worker for offline caching of app shell

## File structure

| File | Description |
|------|-------------|
| `index.html` | App shell, meta tags, all script/style references |
| `app.js` | All application logic (~1600 lines) |
| `style.css` | All styles (~1400 lines) |
| `sw.js` | Service worker — caches app shell for offline use |
| `manifest.json` | PWA manifest (name, icons, display mode, theme colour) |
| `rolleston-addresses.json` | 16,507 Rolleston addresses with lat/lon (3 MB, from OpenStreetMap) |

## Running locally

```bash
cd /path/to/地图工具V2-—-移动端+本地数据+区域编辑+PWA
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
| [SortableJS](https://sortablejs.github.io/Sortable/) | Drag-to-reorder zone list (touch-native fallback mode) |
| [Tesseract.js](https://tesseract.projectnaptha.com/) | Local OCR — runs entirely in browser, no server needed |
| OpenStreetMap / Nominatim | Map tiles and online address geocoding (free, no API key) |

## Address data

`rolleston-addresses.json` was extracted from OpenStreetMap via the Overpass API. It contains street addresses for the Rolleston area, Selwyn District, Canterbury, New Zealand — including house numbers, street names, and coordinates.

## Known limitations / Phase 3 backlog

- Search-result address registration (saving a searched address into a zone) is deferred to Phase 3
- Zone area calculation / statistics not yet implemented
- No multi-user / sync — zones are stored in `localStorage` only
