# Rolleston Zone Planner — PWA

A mobile-first Progressive Web App for drawing and managing custom geographic zones around the Rolleston / Selwyn District area of Canterbury, New Zealand.

## Features

- **Interactive map** — Leaflet.js + OpenStreetMap tiles (no API key required)
- **Draw zones** — tap or click to draw custom polygons on the map
- **Edit zones** — drag the entire polygon to move it; drag individual vertices to reshape; rename, recolour, or delete
- **Zone list** — drag-to-reorder with smooth animation (SortableJS); inline edit and delete
- **Address search** — local-first fuzzy search against 16,507 Rolleston addresses (instant, offline-capable); Nominatim API fallback for addresses not in local DB
- **Zone detection** — automatically shows which zone a searched address belongs to
- **Camera OCR** — use device camera to photograph a letterbox, street sign, or address label; Tesseract.js reads the text locally (no server or API) and presents recognised words as selectable tokens; tap tokens to build an address phrase and confirm to search
- **PWA** — installable on Android / iOS; service worker for offline caching of app shell

## Quick Start

```bash
git clone https://github.com/lazyeo/maptool-v2-mobile-local-pwa.git
cd maptool-v2-mobile-local-pwa
python3 -m http.server 8765
# Open http://localhost:8765
```

Any static file server works — `npx serve`, `php -S`, etc.

## Mobile / Real-Device Testing

Camera access and PWA install prompts require HTTPS. Use Cloudflare Tunnel for a free temporary public URL:

```bash
brew install cloudflared   # or: npm i -g cloudflared
cloudflared tunnel --url http://localhost:8765
# Outputs a URL like: https://xxx.trycloudflare.com
# Open that URL on your phone
```

## iOS PWA Notes

- **Install:** Safari → Share → "Add to Home Screen"
- iOS does not support `beforeinstallprompt` — no automatic install banner; users add manually via Safari
- Safe-area insets are applied so the UI clears the notch and home indicator

## Project Structure

| File | Description |
|------|-------------|
| `index.html` | App shell, meta tags, script/style references |
| `app.js` | Application logic (~1600 lines) |
| `style.css` | All styles (~1400 lines) |
| `sw.js` | Service worker — caches app shell for offline use |
| `manifest.json` | PWA manifest (name, icons, display mode, theme colour) |
| `rolleston-addresses.json` | 16,507 Rolleston addresses with lat/lon (3 MB, from OpenStreetMap) |
| `rolleston-statistics.json` | Address statistics by street and suburb |
| `process-rolleston-addresses.js` | Node.js script to re-extract addresses from Overpass API |
| `ROLLESTON_DATA_REPORT.md` | Data extraction methodology and coverage report |

## Tech Stack

| Library | Purpose |
|---------|---------|
| [Leaflet.js](https://leafletjs.com/) | Map rendering |
| [Leaflet.draw](https://leaflet.github.io/Leaflet.draw/) | Polygon drawing and vertex editing |
| [SortableJS](https://sortablejs.github.io/Sortable/) | Drag-to-reorder zone list |
| [Tesseract.js](https://tesseract.projectnaptha.com/) | Local OCR — runs in browser, no server needed |
| OpenStreetMap / Nominatim | Map tiles and online geocoding (free, no API key) |

## Address Data

`rolleston-addresses.json` was extracted from OpenStreetMap via the Overpass API. It covers the Rolleston area, Selwyn District, Canterbury, NZ — including house numbers, street names, and coordinates. Run `process-rolleston-addresses.js` to refresh the data.

## Storage

Zones are stored in `localStorage`. No backend, no sync, no account required.

## License

MIT
