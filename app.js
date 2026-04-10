(function () {
  'use strict';

  // ════════════════════════════════════════════════
  //  CONSTANTS
  // ════════════════════════════════════════════════
  const COLORS = [
    '#4361ee', '#ef476f', '#06d6a0', '#ffd166', '#cc5de8',
    '#ff922b', '#20c997', '#f06595', '#74c0fc', '#a9e34b',
    '#e599f7', '#63e6be', '#ffa94d', '#845ef7', '#ff8787'
  ];

  const STORAGE_KEY = 'nz-zone-planner-v2';
  const ROLLESTON_CENTER = [-43.591, 172.379];

  // ════════════════════════════════════════════════
  //  STATE
  // ════════════════════════════════════════════════
  let zones = [];          // { id, name, notes, color, latlngs, matchCount }
  let colorIndex = 0;
  let pendingLayer = null;
  let pendingColor = COLORS[0];
  let editModeActive = false;
  let selectedZoneId = null;
  let addressDB = [];
  let isOnline = navigator.onLine;
  let nominatimTimer = null;
  let isMobile = window.innerWidth <= 768;

  // Draw handler reference
  let polygonDrawHandler = null;
  let isDrawing = false;

  // Edit sheet state
  let editingZoneId = null;
  let editSelectedColor = COLORS[0];

  // ════════════════════════════════════════════════
  //  UTILITY
  // ════════════════════════════════════════════════
  function nextColor() {
    const c = COLORS[colorIndex % COLORS.length];
    colorIndex++;
    return c;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  // ════════════════════════════════════════════════
  //  TOAST NOTIFICATIONS
  // ════════════════════════════════════════════════
  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 3000);
  }

  // ════════════════════════════════════════════════
  //  OFFLINE DETECTION
  // ════════════════════════════════════════════════
  const offlineIndicator = document.getElementById('offline-indicator');

  function updateOnlineStatus() {
    isOnline = navigator.onLine;
    offlineIndicator.style.display = isOnline ? 'none' : 'block';
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // ════════════════════════════════════════════════
  //  MAP SETUP
  // ════════════════════════════════════════════════
  const map = L.map('map', {
    center: ROLLESTON_CENTER,
    zoom: 13,
    zoomControl: false
  });

  // Zoom control always at topleft
  L.control.zoom({ position: 'topleft' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Feature groups
  const drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  const markerLayer = new L.FeatureGroup();
  map.addLayer(markerLayer);

  // ════════════════════════════════════════════════
  //  LEAFLET DRAW — hidden toolbar, custom button
  // ════════════════════════════════════════════════
  const drawControl = new L.Control.Draw({
    position: 'topright',
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: { color: '#2e2117', weight: 2, fillOpacity: 0.2 }
      },
      polyline: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false
    },
    edit: false
  });
  map.addControl(drawControl);

  // Hide the Leaflet.Draw toolbar — we use our own button
  if (drawControl._container) {
    drawControl._container.style.display = 'none';
  }

  // Also hide after a tick (Leaflet adds it async sometimes)
  setTimeout(() => {
    if (drawControl._container) drawControl._container.style.display = 'none';
    // Hide any residual draw toolbars
    document.querySelectorAll('.leaflet-draw').forEach(el => { el.style.display = 'none'; });
  }, 100);

  // ── Custom draw button ──
  const fabDraw = document.getElementById('fab-draw');

  const fabFinish = document.getElementById('fab-finish');

  function startDrawing() {
    if (isDrawing) { stopDrawing(); return; }
    isDrawing = true;
    polygonDrawHandler = new L.Draw.Polygon(map, drawControl.options.draw.polygon);
    polygonDrawHandler.enable();
    fabDraw.textContent = 'Cancel Draw';
    fabDraw.classList.add('drawing-active');
    document.body.classList.add('is-drawing');
    toast('Tap map to add points — tap Finish when done (min 3 points)', 'info');
  }

  function stopDrawing() {
    if (polygonDrawHandler) {
      polygonDrawHandler.disable();
      polygonDrawHandler = null;
    }
    isDrawing = false;
    fabDraw.textContent = 'Draw Zone';
    fabDraw.classList.remove('drawing-active');
    document.body.classList.remove('is-drawing');
  }

  // Finish button — completes the polygon programmatically
  fabFinish.addEventListener('click', function () {
    if (!isDrawing || !polygonDrawHandler) return;
    // Leaflet.Draw requires at least 3 points to finish
    try {
      polygonDrawHandler._finishShape();
    } catch (e) {
      toast('Add at least 3 points before finishing', 'warn');
    }
  });

  fabDraw.addEventListener('click', function () {
    if (isDrawing) {
      stopDrawing();
    } else {
      startDrawing();
    }
  });

  // Edit control — added/removed dynamically
  let editControl = null;

  // ── Whole-polygon drag ──────────────────────────────────────────
  // Uses Pointer Events API (covers mouse + touch + stylus uniformly).
  // On drag-start we disable Leaflet.Draw vertex editing so vertex
  // markers don't desync; on drag-end we re-enable it so markers
  // are rebuilt at the new position.
  let _polygonDragState = null;

  function _getClientXY(e) {
    // Pointer / mouse / touch → {x, y} in client coords
    if (e.clientX !== undefined) return { x: e.clientX, y: e.clientY };
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: 0, y: 0 };
  }

  function _getContainerPoint(e) {
    const { x, y } = _getClientXY(e);
    const rect = map.getContainer().getBoundingClientRect();
    return L.point(x - rect.left, y - rect.top);
  }

  // Temporarily suspend Leaflet.Draw vertex editing so markers don't
  // conflict with our manual setLatLngs calls.
  function _suspendVertexEdit() {
    drawnItems.eachLayer(layer => {
      if (layer.editing && layer.editing.enabled()) {
        layer.editing.disable();
      }
    });
  }

  // Re-enable vertex editing after drag; this rebuilds markers at
  // the layer's current (post-drag) coordinates.
  function _resumeVertexEdit() {
    drawnItems.eachLayer(layer => {
      if (layer.editing && !layer.editing.enabled()) {
        layer.editing.enable();
      }
    });
  }

  function _onPolyPointerDown(e) {
    if (!editModeActive) return;
    const orig = e.originalEvent || e;
    // Ignore clicks on vertex/midpoint handles
    const tgt = orig.target;
    if (tgt && (tgt.classList.contains('leaflet-edit-marker') ||
                tgt.classList.contains('leaflet-touch-icon') ||
                tgt.closest && tgt.closest('.leaflet-edit-marker'))) return;

    const layer = e.target || this;
    map.dragging.disable();
    _suspendVertexEdit();

    const startPt = _getContainerPoint(orig);
    const raw = layer.getLatLngs();
    const cloneLatLngs = raw.map(ring =>
      Array.isArray(ring) ? ring.map(ll => L.latLng(ll.lat, ll.lng)) : L.latLng(raw.lat, raw.lng)
    );
    _polygonDragState = { layer, startPt, startLatLngs: cloneLatLngs, moved: false };

    // Use native pointer/touch events on document for reliable tracking
    document.addEventListener('pointermove', _onPolyPointerMove, { passive: false });
    document.addEventListener('pointerup',   _onPolyPointerUp,   { once: true });
    document.addEventListener('touchmove',   _onPolyPointerMove, { passive: false });
    document.addEventListener('touchend',    _onPolyPointerUp,   { once: true, passive: false });

    orig.preventDefault && orig.preventDefault();
    orig.stopPropagation && orig.stopPropagation();
  }

  function _onPolyPointerMove(e) {
    if (!_polygonDragState) return;
    e.preventDefault && e.preventDefault();
    const { layer, startPt, startLatLngs } = _polygonDragState;
    const currentPt = _getContainerPoint(e);
    const dx = currentPt.x - startPt.x;
    const dy = currentPt.y - startPt.y;

    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return; // ignore micro-jitter
    _polygonDragState.moved = true;

    const originLL = map.containerPointToLatLng(L.point(0, 0));
    const deltaLL  = map.containerPointToLatLng(L.point(dx, dy));
    const dLat = deltaLL.lat - originLL.lat;
    const dLng = deltaLL.lng - originLL.lng;

    const newLatLngs = startLatLngs.map(ring =>
      Array.isArray(ring)
        ? ring.map(ll => L.latLng(ll.lat + dLat, ll.lng + dLng))
        : L.latLng(ring.lat + dLat, ring.lng + dLng)
    );
    layer.setLatLngs(newLatLngs);
    layer.redraw();
  }

  function _onPolyPointerUp(e) {
    if (!_polygonDragState) return;
    const { layer, moved } = _polygonDragState;

    if (moved) {
      // Commit new position to zone data
      const zoneId = layer._zoneId;
      if (zoneId) {
        const zone = zones.find(z => z.id === zoneId);
        if (zone) {
          zone.latlngs = extractLatLngs(layer.getLatLngs());
          saveState();
        }
      }
    }

    map.dragging.enable();
    _resumeVertexEdit();        // rebuild vertex markers at new position

    document.removeEventListener('pointermove', _onPolyPointerMove);
    document.removeEventListener('touchmove',   _onPolyPointerMove);
    _polygonDragState = null;
  }

  function _attachPolygonDrag(layer) {
    // Listen on the SVG element via Leaflet's cross-env event wrapper
    layer.on('mousedown', _onPolyPointerDown);
    // For touch we attach directly to the DOM element (Leaflet may swallow touchstart)
    if (layer._path) {
      layer._path.addEventListener('touchstart', function (e) {
        _onPolyPointerDown.call(layer, { originalEvent: e, target: layer });
      }, { passive: false });
    }
  }

  function _detachPolygonDrag(layer) {
    layer.off('mousedown', _onPolyPointerDown);
    map.dragging.enable();
  }

  function enablePolygonDrag() {
    drawnItems.eachLayer(layer => _attachPolygonDrag(layer));
  }
  function disablePolygonDrag() {
    drawnItems.eachLayer(layer => _detachPolygonDrag(layer));
    if (_polygonDragState) {
      document.removeEventListener('pointermove', _onPolyPointerMove);
      document.removeEventListener('touchmove',   _onPolyPointerMove);
      _polygonDragState = null;
    }
  }
  // ───────────────────────────────────────────────────────────────

  function enableEditMode() {
    if (editControl) return;
    editControl = new L.Control.Draw({
      position: 'topright',
      draw: false,
      edit: {
        featureGroup: drawnItems,
        remove: true,
        edit: true
      }
    });
    map.addControl(editControl);

    // Programmatically click the edit button
    const editBtn = document.querySelector('.leaflet-draw-edit-edit');
    if (editBtn) editBtn.click();

    enablePolygonDrag();
  }

  function disableEditMode() {
    const saveBtn = document.querySelector('.leaflet-draw-actions-bottom a[title="Save changes"]') ||
                    document.querySelector('.leaflet-draw-actions a[title="Save changes"]') ||
                    document.querySelector('.leaflet-draw-actions li:first-child a');
    if (saveBtn) saveBtn.click();

    disablePolygonDrag();

    if (editControl) {
      map.removeControl(editControl);
      editControl = null;
    }
  }

  // Draw created event
  map.on(L.Draw.Event.CREATED, function (e) {
    stopDrawing();
    pendingLayer = e.layer;
    // Default color is next in rotation
    pendingColor = COLORS[colorIndex % COLORS.length];
    showModal();
  });

  // Edit events — sync zone data when vertices are moved
  map.on(L.Draw.Event.EDITED, function (e) {
    e.layers.eachLayer(function (layer) {
      const zoneId = layer._zoneId;
      if (!zoneId) return;
      const zone = zones.find(z => z.id === zoneId);
      if (!zone) return;
      const raw = layer.getLatLngs();
      zone.latlngs = extractLatLngs(raw);
    });
    saveState();
    renderZoneLists();
    toast('Zones updated', 'success');
  });

  // Delete via Leaflet.Draw
  map.on(L.Draw.Event.DELETED, function (e) {
    e.layers.eachLayer(function (layer) {
      const zoneId = layer._zoneId;
      if (zoneId) {
        zones = zones.filter(z => z.id !== zoneId);
      }
    });
    saveState();
    renderZoneLists();
    toast('Zone(s) deleted', 'warning');
  });

  function extractLatLngs(raw) {
    if (Array.isArray(raw[0]) && raw[0][0] && typeof raw[0][0].lat === 'number') {
      return raw[0].map(ll => [ll.lat, ll.lng]);
    }
    if (Array.isArray(raw[0]) && Array.isArray(raw[0][0])) {
      return raw[0].map(ll => [ll.lat, ll.lng]);
    }
    if (raw[0] && typeof raw[0].lat === 'number') {
      return raw.map(ll => [ll.lat, ll.lng]);
    }
    return raw;
  }

  // ════════════════════════════════════════════════
  //  COLOR SWATCH HELPERS
  // ════════════════════════════════════════════════
  function buildColorSwatches(containerId, selectedColor, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = COLORS.map(c => `
      <button
        class="color-swatch${c === selectedColor ? ' selected' : ''}"
        style="background:${c}"
        data-color="${c}"
        aria-label="Colour ${c}"
        type="button"
      ></button>
    `).join('');

    container.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', function () {
        container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        this.classList.add('selected');
        onSelect(this.dataset.color);
      });
    });
  }

  // ════════════════════════════════════════════════
  //  ZONE MANAGEMENT
  // ════════════════════════════════════════════════
  function addZoneToMap(zone) {
    const polygon = L.polygon(zone.latlngs, {
      color: zone.color,
      weight: 2,
      fillColor: zone.color,
      fillOpacity: 0.18,
      dashArray: '5, 5'
    });
    polygon._zoneId = zone.id;

    polygon.bindTooltip(zone.name, {
      permanent: false,
      direction: 'center',
      className: 'zone-tooltip'
    });

    polygon.on('click', function () {
      selectZone(zone.id);
    });

    drawnItems.addLayer(polygon);
  }

  function selectZone(id) {
    selectedZoneId = id;
    renderZoneLists();

    const zone = zones.find(z => z.id === id);
    if (zone) {
      const bounds = L.latLngBounds(zone.latlngs.map(ll => L.latLng(ll[0], ll[1])));
      map.fitBounds(bounds, { padding: [50, 50] });

      drawnItems.eachLayer(function (layer) {
        if (layer._zoneId === id) {
          layer.setStyle({ weight: 4, dashArray: null, fillOpacity: 0.3 });
        } else if (layer._zoneId) {
          const z = zones.find(zz => zz.id === layer._zoneId);
          if (z) layer.setStyle({ weight: 2, dashArray: '5, 5', fillOpacity: 0.18 });
        }
      });
    }
  }

  function deleteZone(id) {
    zones = zones.filter(z => z.id !== id);
    drawnItems.eachLayer(function (layer) {
      if (layer._zoneId === id) drawnItems.removeLayer(layer);
    });
    if (selectedZoneId === id) selectedZoneId = null;
    saveState();
    renderZoneLists();
    toast('Zone deleted', 'warning');
  }

  function focusZone(id) {
    selectZone(id);
    if (isMobile) {
      setDrawerOpen(false);
    }
  }

  // ════════════════════════════════════════════════
  //  POINT-IN-POLYGON (RAY CASTING)
  // ════════════════════════════════════════════════
  function pointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function detectZone(lat, lng) {
    for (const zone of zones) {
      if (pointInPolygon([lat, lng], zone.latlngs)) {
        return zone;
      }
    }
    return null;
  }

  // ════════════════════════════════════════════════
  //  ZONE LIST RENDERING
  // ════════════════════════════════════════════════
  function renderZoneLists() {
    renderZoneListTo('zone-list-desktop', 'zone-count-desktop');
    renderZoneListTo('zone-list-mobile', 'zone-count-mobile');
  }

  function renderZoneListTo(containerId, countId) {
    const container = document.getElementById(containerId);
    const countEl = document.getElementById(countId);
    if (!container || !countEl) return;

    countEl.textContent = zones.length;

    if (zones.length === 0) {
      container.innerHTML = '<div id="no-zones">No zones yet.<br>Tap "Draw Zone" on the map to get started.</div>';
      return;
    }

    container.innerHTML = zones.map(z => `
      <div class="zone-card ${selectedZoneId === z.id ? 'selected' : ''}" data-zone-id="${z.id}">
        <div class="zone-card-top">
          <span class="zone-drag-handle" title="Drag to reorder">
            <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden="true">
              <circle cx="3" cy="2.5" r="1.2" fill="currentColor"/><circle cx="7" cy="2.5" r="1.2" fill="currentColor"/>
              <circle cx="3" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/>
              <circle cx="3" cy="11.5" r="1.2" fill="currentColor"/><circle cx="7" cy="11.5" r="1.2" fill="currentColor"/>
            </svg>
          </span>
          <div class="zone-color-dot" style="background:${z.color}"></div>
          <div class="zone-name" data-zone-id="${z.id}">${escapeHtml(z.name)}</div>
          <div class="zone-card-actions">
            <button class="zone-edit-btn" data-zone-edit="${z.id}" title="Edit zone">Edit</button>
            <button class="zone-delete" data-zone-delete="${z.id}" title="Delete zone" aria-label="Delete zone">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        ${z.notes ? `<div class="zone-notes-preview">${escapeHtml(z.notes)}</div>` : ''}
      </div>
    `).join('');

    // Event delegation
    container.querySelectorAll('.zone-card').forEach(card => {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.zone-delete') || e.target.closest('.zone-edit-btn')) return;
        focusZone(this.dataset.zoneId);
      });
    });

    container.querySelectorAll('.zone-delete').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteZone(this.dataset.zoneDelete);
      });
    });

    container.querySelectorAll('.zone-edit-btn').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openEditSheet(this.dataset.zoneEdit);
      });
    });

    // Double-click zone name to rename inline
    container.querySelectorAll('.zone-name').forEach(nameEl => {
      nameEl.addEventListener('dblclick', function () {
        const zoneId = this.dataset.zoneId;
        const zone = zones.find(z => z.id === zoneId);
        if (!zone) return;

        const input = document.createElement('input');
        input.className = 'zone-name-input';
        input.value = zone.name;
        this.replaceWith(input);
        input.focus();
        input.select();

        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== zone.name) {
            zone.name = newName;
            drawnItems.eachLayer(function (layer) {
              if (layer._zoneId === zoneId) {
                layer.unbindTooltip();
                layer.bindTooltip(zone.name, { permanent: false, direction: 'center', className: 'zone-tooltip' });
              }
            });
            saveState();
          }
          renderZoneLists();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') renderZoneLists();
        });
      });
    });

    // ── SortableJS drag-to-reorder ──────────────────────────────
    if (typeof Sortable !== 'undefined') {
      Sortable.create(container, {
        animation: 150,
        handle: '.zone-drag-handle',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        forceFallback: false,
        fallbackTolerance: 5,
        delay: 150,
        delayOnTouchOnly: true,
        touchStartThreshold: 3,
        preventOnFilter: true,
        onStart: function () {
          // Tell drawer swipe handler to stand down while a sort drag is live
          if (drawer) drawer.dataset.sortDragging = '1';
        },
        onEnd: function (evt) {
          if (drawer) delete drawer.dataset.sortDragging;
          const newOrder = Array.from(container.querySelectorAll('.zone-card'))
            .map(el => el.dataset.zoneId);
          zones.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
          saveState();
          renderZoneLists();
        }
      });
    }
    // ────────────────────────────────────────────────────────────
  }

  // ════════════════════════════════════════════════
  //  LOCAL ADDRESS DATABASE
  // ════════════════════════════════════════════════
  function loadAddressDB() {
    fetch('rolleston-addresses.json')
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          addressDB = data;
          if (addressDB.length > 0) {
            toast(`Loaded ${addressDB.length} local addresses`, 'success');
          }
        }
      })
      .catch(() => {
        console.log('No local address database found — using online search only');
        addressDB = [];
      });
  }

  function searchLocalAddresses(query) {
    if (!addressDB.length || !query) return [];
    const q = query.toLowerCase();
    const results = [];

    for (const addr of addressDB) {
      const display = (addr.display || '').toLowerCase();
      if (!display) continue;

      const idx = display.indexOf(q);
      if (idx === -1) continue;

      let score = 1000 - idx;
      if (idx === 0) score += 500;
      if (display.length < 60) score += 100;
      if (idx === 0 || display[idx - 1] === ' ' || display[idx - 1] === ',') score += 200;

      results.push({ ...addr, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 8);
  }

  // ════════════════════════════════════════════════
  //  ADDRESS SEARCH (LOCAL + ONLINE FALLBACK)
  // ════════════════════════════════════════════════
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const acList = document.getElementById('autocomplete-list');

  searchInput.addEventListener('input', function () {
    const q = searchInput.value.trim();
    searchClear.style.display = q.length > 0 ? 'flex' : 'none';

    if (q.length < 2) {
      acList.style.display = 'none';
      clearTimeout(nominatimTimer);
      return;
    }

    const localResults = searchLocalAddresses(q);
    showAutocomplete(localResults.map(r => ({
      display_name: r.display,
      lat: r.lat,
      lon: r.lon,
      source: 'local'
    })), []);

    clearTimeout(nominatimTimer);
    if (localResults.length < 3 && isOnline && q.length >= 3) {
      nominatimTimer = setTimeout(() => {
        searchOnline(q, localResults.map(r => ({
          display_name: r.display,
          lat: r.lat,
          lon: r.lon,
          source: 'local'
        })));
      }, 400);
    }
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') acList.style.display = 'none';
  });

  searchClear.addEventListener('click', function () {
    searchInput.value = '';
    searchClear.style.display = 'none';
    acList.style.display = 'none';
    searchInput.focus();
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#search-wrapper')) acList.style.display = 'none';
  });

  async function searchOnline(query, existingLocalItems) {
    try {
      const loadingHtml = '<div class="ac-loading">Searching online…</div>';
      if (acList.innerHTML.indexOf('ac-loading') === -1) {
        acList.insertAdjacentHTML('beforeend', loadingHtml);
        acList.style.display = 'block';
      }

      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=nz&limit=6&addressdetails=1&viewbox=172.1,-43.7,172.6,-43.4&bounded=0`;
      const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const results = await resp.json();

      const onlineItems = (results || []).map(r => ({
        display_name: r.display_name,
        lat: r.lat,
        lon: r.lon,
        source: 'online'
      }));

      const filtered = onlineItems.filter(online => {
        return !existingLocalItems.some(local =>
          Math.abs(parseFloat(local.lat) - parseFloat(online.lat)) < 0.0001 &&
          Math.abs(parseFloat(local.lon) - parseFloat(online.lon)) < 0.0001
        );
      });

      const combined = [...existingLocalItems, ...filtered].slice(0, 8);
      showAutocomplete(
        combined.filter(r => r.source === 'local'),
        combined.filter(r => r.source === 'online')
      );
    } catch (err) {
      console.error('Online search error:', err);
      const loading = acList.querySelector('.ac-loading');
      if (loading) loading.remove();
    }
  }

  function showAutocomplete(localItems, onlineItems) {
    const all = [...localItems, ...onlineItems];
    if (all.length === 0) {
      acList.style.display = 'none';
      return;
    }

    acList.innerHTML = all.map((r, i) => `
      <div class="ac-item" data-idx="${i}">
        <span class="ac-item-text">${escapeHtml(r.display_name)}</span>
        <span class="ac-badge ${r.source}">${r.source}</span>
      </div>
    `).join('');

    acList.style.display = 'block';

    acList.querySelectorAll('.ac-item').forEach((el, i) => {
      el.addEventListener('click', function () {
        selectSearchResult(all[i]);
        acList.style.display = 'none';
      });
    });
  }

  function selectSearchResult(result) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const address = result.display_name;

    searchInput.value = address;
    searchClear.style.display = 'flex';

    const zone = detectZone(lat, lng);
    const markerColor = zone ? zone.color : '#9a8b7d';

    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<svg width="28" height="40" viewBox="0 0 28 40">
        <path d="M14 0 C6.27 0 0 6.27 0 14 C0 24.5 14 40 14 40 S28 24.5 28 14 C28 6.27 21.73 0 14 0Z" fill="${markerColor}" stroke="rgba(255,252,247,0.9)" stroke-width="2"/>
        <circle cx="14" cy="14" r="6" fill="rgba(255,252,247,0.95)" opacity="0.9"/>
      </svg>`,
      iconSize: [28, 40],
      iconAnchor: [14, 40],
      popupAnchor: [0, -40]
    });

    markerLayer.clearLayers();

    const marker = L.marker([lat, lng], { icon })
      .bindPopup(`<b>${escapeHtml(address)}</b><br>${zone
        ? '<span style="color:' + zone.color + ';font-weight:700">Zone: ' + escapeHtml(zone.name) + '</span>'
        : '<span style="color:#9a8b7d">Not in any zone</span>'}`)
      .addTo(markerLayer);

    marker.openPopup();
    map.setView([lat, lng], Math.max(map.getZoom(), 15));

    if (zone) {
      zone.matchCount++;
      saveState();
      renderZoneLists();
    }

    showResultBanner(address, zone);
    toast(zone ? `Matched: ${zone.name}` : 'Not in any zone', zone ? 'success' : 'warning');

    if (isMobile) {
      setDrawerOpen(false);
    }

    if (isMobile) searchInput.blur();
  }

  // ════════════════════════════════════════════════
  //  RESULT BANNER
  // ════════════════════════════════════════════════
  function showResultBanner(address, zone) {
    const banner = document.getElementById('zone-result-banner');
    const shortAddr = address.length > 50 ? address.substring(0, 47) + '…' : address;

    if (zone) {
      banner.className = 'in-zone';
      banner.innerHTML = `${escapeHtml(shortAddr)} — <span style="color:${zone.color};font-weight:700">${escapeHtml(zone.name)}</span>`;
    } else {
      banner.className = 'no-zone';
      banner.textContent = `${shortAddr} — Not in any zone`;
    }

    banner.style.display = 'block';

    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => { banner.style.display = 'none'; }, 6000);
  }

  // ════════════════════════════════════════════════
  //  EDIT MODE TOGGLE
  // ════════════════════════════════════════════════
  const fabEdit = document.getElementById('fab-edit');

  fabEdit.addEventListener('click', function () {
    editModeActive = !editModeActive;
    fabEdit.classList.toggle('active', editModeActive);
    fabEdit.textContent = editModeActive ? 'Done' : 'Edit';

    if (editModeActive) {
      enableEditMode();
      toast('Edit mode on — drag vertices to reshape, drag zone body to move', 'info');
    } else {
      disableEditMode();
      toast('Edit mode off', 'info');
    }
  });

  // ════════════════════════════════════════════════
  //  CREATE ZONE MODAL
  // ════════════════════════════════════════════════
  const modalOverlay = document.getElementById('modal-overlay');
  const modalInput = document.getElementById('modal-input');
  const modalNotes = document.getElementById('modal-notes');
  const modalConfirm = document.getElementById('modal-confirm');
  const modalCancel = document.getElementById('modal-cancel');

  // Track modal selected color
  let modalSelectedColor = COLORS[0];

  function showModal() {
    modalInput.value = '';
    modalNotes.value = '';
    modalSelectedColor = COLORS[colorIndex % COLORS.length];
    buildColorSwatches('modal-color-swatches', modalSelectedColor, function (c) {
      modalSelectedColor = c;
    });
    modalOverlay.classList.add('active');
    setTimeout(() => modalInput.focus(), 100);
  }

  function hideModal() {
    modalOverlay.classList.remove('active');
    pendingLayer = null;
  }

  modalCancel.addEventListener('click', hideModal);
  modalConfirm.addEventListener('click', confirmZone);

  modalInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') confirmZone();
    if (e.key === 'Escape') hideModal();
  });

  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) hideModal();
  });

  function confirmZone() {
    const name = modalInput.value.trim();
    if (!name) { modalInput.focus(); return; }
    if (!pendingLayer) { hideModal(); return; }

    const raw = pendingLayer.getLatLngs ? pendingLayer.getLatLngs() : null;
    if (!raw) { hideModal(); return; }

    const latlngs = extractLatLngs(raw);

    const zone = {
      id: generateId(),
      name: name,
      notes: modalNotes.value.trim(),
      color: modalSelectedColor,
      latlngs: latlngs,
      matchCount: 0
    };

    // Advance colorIndex so next zone auto-picks the next colour
    colorIndex++;

    zones.push(zone);
    addZoneToMap(zone);
    saveState();
    renderZoneLists();
    hideModal();
    toast(`Zone "${name}" created`, 'success');
  }

  // ════════════════════════════════════════════════
  //  EDIT SHEET
  // ════════════════════════════════════════════════
  const editSheetOverlay = document.getElementById('edit-sheet-overlay');
  const editNameInput = document.getElementById('edit-name-input');
  const editNotesInput = document.getElementById('edit-notes-input');
  const editSheetConfirm = document.getElementById('edit-sheet-confirm');
  const editSheetCancel = document.getElementById('edit-sheet-cancel');

  function openEditSheet(zoneId) {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    editingZoneId = zoneId;
    editSelectedColor = zone.color;

    editNameInput.value = zone.name;
    editNotesInput.value = zone.notes || '';

    buildColorSwatches('edit-color-swatches', editSelectedColor, function (c) {
      editSelectedColor = c;
    });

    editSheetOverlay.classList.add('active');
    setTimeout(() => editNameInput.focus(), 100);
  }

  function closeEditSheet() {
    editSheetOverlay.classList.remove('active');
    editingZoneId = null;
  }

  editSheetCancel.addEventListener('click', closeEditSheet);

  editSheetConfirm.addEventListener('click', function () {
    const name = editNameInput.value.trim();
    if (!name) { editNameInput.focus(); return; }

    const zone = zones.find(z => z.id === editingZoneId);
    if (!zone) { closeEditSheet(); return; }

    zone.name = name;
    zone.notes = editNotesInput.value.trim();
    zone.color = editSelectedColor;

    // Update the map polygon colour + tooltip
    drawnItems.eachLayer(function (layer) {
      if (layer._zoneId === editingZoneId) {
        layer.setStyle({ color: zone.color, fillColor: zone.color });
        layer.unbindTooltip();
        layer.bindTooltip(zone.name, { permanent: false, direction: 'center', className: 'zone-tooltip' });
      }
    });

    saveState();
    renderZoneLists();
    closeEditSheet();
    toast(`Zone "${name}" updated`, 'success');
  });

  editNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') editSheetConfirm.click();
    if (e.key === 'Escape') closeEditSheet();
  });

  editSheetOverlay.addEventListener('click', function (e) {
    if (e.target === editSheetOverlay) closeEditSheet();
  });

  // ════════════════════════════════════════════════
  //  EXPORT / IMPORT
  // ════════════════════════════════════════════════
  function exportZones() {
    const data = JSON.stringify({ zones, version: 2 }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zone-planner-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Zones exported', 'success');
  }

  function importZones() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (ev) {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.zones && Array.isArray(data.zones)) {
            let added = 0;
            data.zones.forEach(z => {
              if (!zones.find(existing => existing.id === z.id)) {
                // Ensure notes field exists for compatibility
                if (!z.notes) z.notes = '';
                zones.push(z);
                addZoneToMap(z);
                added++;
              }
            });
            saveState();
            renderZoneLists();
            toast(`Imported ${added} zone(s)`, 'success');
          } else {
            toast('Invalid file format', 'error');
          }
        } catch (err) {
          toast('Failed to parse JSON file', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function clearAll() {
    if (!confirm('Clear all zones and markers? This cannot be undone.')) return;
    zones = [];
    colorIndex = 0;
    selectedZoneId = null;
    drawnItems.clearLayers();
    markerLayer.clearLayers();
    document.getElementById('zone-result-banner').style.display = 'none';
    saveState();
    renderZoneLists();
    toast('All zones cleared', 'warning');
  }

  // ════════════════════════════════════════════════
  //  PERSISTENCE
  // ════════════════════════════════════════════════
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ zones, colorIndex }));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.zones) {
          zones = data.zones.map(z => ({ notes: '', ...z })); // ensure notes field
          colorIndex = data.colorIndex || zones.length;
          zones.forEach(z => addZoneToMap(z));
          return true;
        }
      }
    } catch (e) {
      console.error('Failed to load state', e);
    }
    return false;
  }

  // ════════════════════════════════════════════════
  //  DEMO DATA
  // ════════════════════════════════════════════════
  function loadDemoData() {
    const demoZones = [
      {
        id: 'demo-rolleston-north',
        name: 'Rolleston North',
        notes: '',
        color: '#4361ee',
        latlngs: [
          [-43.5755, 172.3580],
          [-43.5755, 172.3900],
          [-43.5870, 172.3900],
          [-43.5870, 172.3580]
        ],
        matchCount: 0
      },
      {
        id: 'demo-rolleston-south',
        name: 'Rolleston South',
        notes: '',
        color: '#06d6a0',
        latlngs: [
          [-43.5920, 172.3580],
          [-43.5920, 172.3850],
          [-43.6050, 172.3850],
          [-43.6050, 172.3580]
        ],
        matchCount: 0
      },
      {
        id: 'demo-faringdon',
        name: 'Faringdon',
        notes: '',
        color: '#ffd166',
        latlngs: [
          [-43.5870, 172.3620],
          [-43.5870, 172.3790],
          [-43.5920, 172.3790],
          [-43.5920, 172.3620]
        ],
        matchCount: 0
      },
      {
        id: 'demo-izone',
        name: 'Izone Business Park',
        notes: '',
        color: '#cc5de8',
        latlngs: [
          [-43.5830, 172.3900],
          [-43.5830, 172.4080],
          [-43.5960, 172.4080],
          [-43.5960, 172.3900]
        ],
        matchCount: 0
      }
    ];

    demoZones.forEach(z => {
      zones.push(z);
      addZoneToMap(z);
    });

    colorIndex = demoZones.length;
    saveState();
    renderZoneLists();
  }

  // ════════════════════════════════════════════════
  //  SIDEBAR / DRAWER CONTROLS
  // ════════════════════════════════════════════════
  const sidebar = document.getElementById('sidebar');
  const drawer = document.getElementById('drawer');

  // Desktop sidebar toggle button
  const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
  if (btnSidebarToggle) {
    btnSidebarToggle.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      setTimeout(() => map.invalidateSize(), 350);
    });
  }

  document.getElementById('sidebar-close').addEventListener('click', function () {
    sidebar.classList.remove('open');
    setTimeout(() => map.invalidateSize(), 350);
  });

  // Helper: open/close drawer and sync body class (so FABs can hide)
  function setDrawerOpen(open) {
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    document.body.classList.toggle('drawer-open', open);
  }
  function toggleDrawer() {
    setDrawerOpen(!drawer.classList.contains('open'));
  }

  const drawerHandle = document.getElementById('drawer-handle');
  if (drawerHandle) {
    drawerHandle.addEventListener('click', toggleDrawer);
  }

  const drawerPeek = document.getElementById('drawer-peek');
  if (drawerPeek) {
    drawerPeek.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      toggleDrawer();
    });
  }

  // Drawer swipe gesture
  let touchStartY = 0;
  let touchDeltaY = 0;
  if (drawer) {
    drawer.addEventListener('touchstart', function (e) {
      if (drawer.dataset.sortDragging) return; // sort drag in progress, ignore
      // Only initiate swipe if touch starts on the handle or non-interactive area
      const tgt = e.target;
      if (tgt.closest('.zone-drag-handle') || tgt.closest('.zone-card-actions')) return;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    drawer.addEventListener('touchmove', function (e) {
      if (drawer.dataset.sortDragging || !touchStartY) return;
      touchDeltaY = e.touches[0].clientY - touchStartY;
    }, { passive: true });

    drawer.addEventListener('touchend', function () {
      if (drawer.dataset.sortDragging) return;
      if (touchDeltaY < -40) {
        setDrawerOpen(true);
      } else if (touchDeltaY > 60) { // raised threshold to reduce accidental closes
        setDrawerOpen(false);
      }
      touchDeltaY = 0;
      touchStartY = 0;
    });
  }

  // Button wiring (desktop)
  document.getElementById('btn-export').addEventListener('click', exportZones);
  document.getElementById('btn-import').addEventListener('click', importZones);
  document.getElementById('btn-clear').addEventListener('click', clearAll);

  // Button wiring (mobile)
  document.getElementById('btn-export-mobile').addEventListener('click', exportZones);
  document.getElementById('btn-import-mobile').addEventListener('click', importZones);
  document.getElementById('btn-clear-mobile').addEventListener('click', clearAll);

  // ════════════════════════════════════════════════
  //  RESPONSIVE HANDLING
  // ════════════════════════════════════════════════
  function handleResize() {
    const wasMobile = isMobile;
    isMobile = window.innerWidth <= 768;

    if (wasMobile !== isMobile) {
      sidebar.classList.remove('open');
      setDrawerOpen(false);
      setTimeout(() => map.invalidateSize(), 350);
    }
  }

  window.addEventListener('resize', handleResize);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      document.body.style.height = window.visualViewport.height + 'px';
    });
  }

  // ════════════════════════════════════════════════
  //  CAMERA OCR
  // ════════════════════════════════════════════════
  let cameraStream = null;
  let tesseractWorker = null;

  async function initTesseract() {
    if (tesseractWorker) return tesseractWorker;
    try {
      const { createWorker } = Tesseract;
      tesseractWorker = await createWorker('eng');
    } catch (err) {
      console.error('Tesseract init failed:', err);
      throw err;
    }
    return tesseractWorker;
  }

  function openCamera() {
    document.getElementById('camera-overlay').classList.add('active');
    // Reset viewfinder visibility in case it was hidden by a previous failure
    document.getElementById('camera-viewfinder').style.display = '';
    document.getElementById('btn-capture').style.display = '';
    startCameraStream();
  }

  function closeCamera() {
    document.getElementById('camera-overlay').classList.remove('active');
    stopCameraStream();
    // Reset status
    const statusEl = document.getElementById('ocr-status');
    statusEl.style.display = 'none';
    statusEl.textContent = '';
    // Reset token panel back to initial state for next open
    document.getElementById('ocr-result-panel').style.display = 'none';
    document.getElementById('ocr-token-area').innerHTML = '';
    document.getElementById('ocr-preview-text').textContent = '';
    document.getElementById('ocr-confirm-btn').disabled = true;
    ocrSelectedTokens = [];
    // Restore camera UI elements
    document.getElementById('camera-viewfinder').style.display = '';
    document.getElementById('camera-actions').style.display = '';
    document.getElementById('camera-hint').style.display = '';
  }

  async function startCameraStream() {
    const video = document.getElementById('camera-video');
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      video.srcObject = cameraStream;
    } catch (err) {
      // getUserMedia failed (iOS Safari, permissions denied, etc.) — hide viewfinder, only show gallery
      document.getElementById('camera-viewfinder').style.display = 'none';
      document.getElementById('btn-capture').style.display = 'none';
      toast('Camera not available — use "Choose from Gallery" instead', 'warn');
    }
  }

  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    const video = document.getElementById('camera-video');
    video.srcObject = null;
  }

  // ── OCR token selection state ────────────────────────────────
  let ocrSelectedTokens = []; // ordered array of token text values

  function showOCRTokenPanel(rawText) {
    // Group by LINE — each non-empty line becomes one selectable chip.
    // This avoids the problem of Tesseract inserting spaces inside words,
    // which causes character-level splitting to produce garbage tokens.
    const lines = rawText
      .split(/[\r\n]+/)
      .map(l => l.replace(/\s+/g, ' ').trim())   // normalise internal whitespace
      .filter(l => l.length >= 3 && /[A-Za-z0-9]/.test(l)); // drop noise lines

    if (lines.length === 0) {
      const statusEl = document.getElementById('ocr-status');
      statusEl.style.display = 'block';
      statusEl.textContent = 'No readable text found. Try again with better lighting.';
      return;
    }

    ocrSelectedTokens = [];

    document.getElementById('camera-viewfinder').style.display = 'none';
    document.getElementById('camera-actions').style.display = 'none';
    document.getElementById('camera-hint').style.display = 'none';
    document.getElementById('ocr-status').style.display = 'none';
    const panel = document.getElementById('ocr-result-panel');
    panel.style.display = 'flex';

    const tokenArea = document.getElementById('ocr-token-area');
    tokenArea.innerHTML = '';

    // NZ address heuristic: line contains a leading number + word(s)
    const looksLikeAddr = (l) => /^\d{1,4}\s+[A-Za-z]/.test(l) ||
                                  /\b(Street|St|Road|Rd|Drive|Dr|Avenue|Ave|Lane|Ln|Place|Pl|Way|Court|Ct|Crescent|Cr|Terrace|Tce)\b/i.test(l);

    lines.forEach(line => {
      const btn = document.createElement('button');
      btn.className = 'ocr-token';
      btn.textContent = line;
      btn.dataset.value = line;
      btn.type = 'button';

      if (looksLikeAddr(line)) {
        btn.classList.add('selected');
        ocrSelectedTokens.push(line);
      }

      btn.addEventListener('click', function () {
        const v = this.dataset.value;
        if (this.classList.contains('selected')) {
          this.classList.remove('selected');
          ocrSelectedTokens = ocrSelectedTokens.filter(t => t !== v);
        } else {
          this.classList.add('selected');
          const allBtns = Array.from(tokenArea.querySelectorAll('.ocr-token.selected'));
          ocrSelectedTokens = allBtns.map(b => b.dataset.value);
        }
        updateOCRPreview();
      });

      tokenArea.appendChild(btn);
    });

    // If nothing auto-selected, select the first line as a best guess
    if (ocrSelectedTokens.length === 0 && lines.length > 0) {
      const first = tokenArea.querySelector('.ocr-token');
      if (first) {
        first.classList.add('selected');
        ocrSelectedTokens = [first.dataset.value];
      }
    }

    updateOCRPreview();
  }

  function updateOCRPreview() {
    const preview = document.getElementById('ocr-preview-text');
    const confirmBtn = document.getElementById('ocr-confirm-btn');
    const text = ocrSelectedTokens.join(' ');
    preview.textContent = text || '—';
    confirmBtn.disabled = ocrSelectedTokens.length === 0;
  }

  async function captureAndOCR(imageSource) {
    const statusEl = document.getElementById('ocr-status');
    statusEl.style.display = 'block';
    statusEl.textContent = 'Recognising text…';

    // Stop live camera stream while processing
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }

    try {
      const worker = await initTesseract();
      const { data: { text } } = await worker.recognize(imageSource);
      statusEl.style.display = 'none';
      showOCRTokenPanel(text);
    } catch (err) {
      statusEl.textContent = 'Recognition failed. Please try again.';
      console.error('OCR error:', err);
    }
  }

  // Confirm button: fill search bar and close overlay
  document.getElementById('ocr-confirm-btn').addEventListener('click', function () {
    const address = ocrSelectedTokens.join(' ').trim();
    if (!address) return;
    document.getElementById('search-input').value = address;
    closeCamera();
    document.getElementById('search-input').dispatchEvent(new Event('input', { bubbles: true }));
    toast('Address filled — tap a result to locate', 'success');
  });

  // Clear token selection
  document.getElementById('ocr-clear-btn').addEventListener('click', function () {
    ocrSelectedTokens = [];
    document.querySelectorAll('.ocr-token.selected').forEach(b => b.classList.remove('selected'));
    updateOCRPreview();
  });

  // Wire up camera button
  document.getElementById('btn-camera').addEventListener('click', openCamera);
  document.getElementById('camera-close').addEventListener('click', closeCamera);

  document.getElementById('btn-capture').addEventListener('click', function () {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    captureAndOCR(canvas);
  });

  document.getElementById('btn-gallery').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) captureAndOCR(file);
  });

  // ════════════════════════════════════════════════
  //  SERVICE WORKER REGISTRATION
  // ════════════════════════════════════════════════
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        console.log('SW registered:', reg.scope);
      }).catch(err => {
        console.warn('SW registration failed:', err);
      });
    });
  }

  // ════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════
  loadAddressDB();
  const hasState = loadState();

  if (!hasState || zones.length === 0) {
    loadDemoData();
  }

  renderZoneLists();

  setTimeout(() => map.invalidateSize(), 100);

  // Click on map to deselect zone
  map.on('click', function () {
    if (selectedZoneId) {
      selectedZoneId = null;
      renderZoneLists();
      drawnItems.eachLayer(function (layer) {
        if (layer._zoneId) {
          const z = zones.find(zz => zz.id === layer._zoneId);
          if (z) layer.setStyle({ weight: 2, dashArray: '5, 5', fillOpacity: 0.18 });
        }
      });
    }
  });

})();
