/**
 * Market Intel v2 — Map command center
 *
 * MAP STABILITY CONTRACT
 * ----------------------
 * Hub (or hash) picks the starting metro/preset/center ONCE at boot via
 * bootFromHash() → flyToAnchor(). After that:
 *
 *   applyFilters()  NEVER calls map.setView / flyTo / fitBounds
 *   radius change   → redraw rings + refresh KPIs/share/table only
 *   brand/closed/junk/search/state/metro filters → same, no camera move
 *
 * Intentional geographic jumps ONLY via:
 *   - Hub → map (initial boot)
 *   - Preset buttons (jumpToPreset)
 *   - "Recenter on ring" (user panned away)
 *   - Reset (national view)
 *   - Back to hub (navigation)
 *   - Explicit site row click (gentle setView on that site)
 */
(function () {
  'use strict';
  const DATA = window.MARKETINTEL_OVERRIDE || window.MARKETINTEL;
  if (!DATA || !DATA.snapshots || !DATA.snapshots.length) {
    document.body.innerHTML = '<p style="padding:40px;color:#f87171;font-family:sans-serif">Missing data/sites.js</p>';
    return;
  }
  const meta = DATA.meta || {};
  const snapshot = DATA.snapshots[DATA.snapshots.length - 1];
  const allSites = snapshot.sites || [];
  const brandsMeta = meta.brands || [];
  const brandColor = Object.fromEntries(brandsMeta.map(b => [b.name, b.color]));
  const presets = meta.presets || {};

  const state = {
    brands: new Set(brandsMeta.map(b => b.name)),
    hideClosed: true, hideJunk: true, geoOnly: true,
    stateFilter: '', metroFilter: '', search: '', tableSearch: '',
    radius: 10, useRadius: false, center: null, activePreset: null,
    shareMetric: 'enrolled', sortKey: 'enrolled', sortDir: -1,
    selectedId: null, filtered: [],
    /** Anchor locked after hub/boot — filter/radius changes must not move camera. */
    anchorLocked: false,
    mapExpanded: false,
  };

  // var (not let): clearRings/drawRings may run during boot; avoid TDZ
  var ringLayers = [];
  var centerMarker = null;

  const fmt = new Intl.NumberFormat('en-US');
  const fmtMoney = (n) => {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + fmt.format(Math.round(n));
  };
  const fmtNum = (n) => (n == null || isNaN(n) ? '—' : fmt.format(n));
  const fmtPct = (n) => (n == null || isNaN(n) ? '—' : n.toFixed(1) + '%');
  function haversine(aLat, aLng, bLat, bLng) {
    const R = 3958.7613, p = Math.PI / 180;
    const dla = (bLat - aLat) * p, dlo = (bLng - aLng) * p;
    const h = Math.sin(dla / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dlo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function siteLatLng(s) {
    const lat = s.lat ?? s.latitude ?? null;
    const lng = s.lng ?? s.longitude ?? null;
    if (lat != null && lng != null && !isNaN(+lat) && !isNaN(+lng)) {
      return { lat: +lat, lng: +lng, precision: s.geo_precision || 'zip_centroid' };
    }
    return null;
  }
  function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fillClass(pct) {
    if (pct == null || isNaN(pct)) return '';
    if (pct > 50) return 'fill-good';
    if (pct >= 30) return 'fill-mid';
    return 'fill-bad';
  }
  function isUrbanAir(s) {
    return s.brand === 'Urban Air' || s.revenue_note === 'urban_air_pass_pricing_excluded';
  }

  function parseHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    const q = new URLSearchParams(raw);
    return {
      preset: q.get('preset') || '',
      metro: q.get('metro') || '',
      brand: q.get('brand') || '',
      r: q.get('r') ? +q.get('r') : null,
      lat: q.get('lat') ? +q.get('lat') : null,
      lng: q.get('lng') ? +q.get('lng') : null,
    };
  }

  document.getElementById('asOfChip').innerHTML =
    'As of <strong>' + esc(snapshot.as_of || meta.as_of || '—') + '</strong>';

  const brandChecks = document.getElementById('brandChecks');
  brandsMeta.forEach(b => {
    const lab = document.createElement('label');
    lab.innerHTML = '<input type="checkbox" value="' + esc(b.name) + '" checked /><span class="swatch" style="color:' + b.color + ';background:' + b.color + '"></span><span>' + esc(b.name) + '</span>';
    brandChecks.appendChild(lab);
  });
  const states = [...new Set(allSites.map(s => s.state).filter(Boolean))].sort();
  const metros = [...new Set(allSites.map(s => s.metro).filter(Boolean))].sort();
  const stateSel = document.getElementById('stateFilter');
  const metroSel = document.getElementById('metroFilter');
  states.forEach(st => { const o = document.createElement('option'); o.value = st; o.textContent = st; stateSel.appendChild(o); });
  metros.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; metroSel.appendChild(o); });

  const presetBtns = document.getElementById('presetBtns');
  Object.entries(presets).forEach(([label, p]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label.split(',')[0];
    btn.title = label + ' (intentional jump)';
    btn.dataset.preset = label;
    btn.addEventListener('click', () => jumpToPreset(label, p));
    presetBtns.appendChild(btn);
  });

  function setActivePreset(label) {
    state.activePreset = label;
    document.querySelectorAll('#presetBtns button').forEach(b => {
      b.classList.toggle('active', b.dataset.preset === label);
    });
  }

  const legend = document.getElementById('legend');
  brandsMeta.forEach(b => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px';
    row.innerHTML = '<span class="swatch" style="color:' + b.color + ';background:' + b.color + '"></span><span>' + esc(b.name) + '</span><span style="color:var(--dim);font-size:10px;margin-left:auto">' + esc(b.note || (b.revenue === false ? 'pass $ excl.' : '')) + '</span>';
    legend.appendChild(row);
  });

  // —— Leaflet map ——
  const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([39.5, -98], 4);

  const esriDark = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ', maxZoom: 16, errorTileUrl: '' }
  );
  const esriRef = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    { attribution: '', maxZoom: 16, opacity: 0.9, pane: 'overlayPane' }
  );
  let basemapOk = true;
  esriDark.on('tileerror', function onEsriFail() {
    if (!basemapOk) return;
    basemapOk = false;
    console.warn('[MarketIntel] Esri dark tiles failed — falling back to OSM + invert');
    map.removeLayer(esriDark);
    map.removeLayer(esriRef);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19, className: 'osm-fallback-tiles',
    }).addTo(map);
    const style = document.createElement('style');
    style.textContent = '.leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(1.05)}.leaflet-tile-pane img.osm-fallback-tiles,.osm-fallback-tiles{filter:none}';
    document.head.appendChild(style);
  });
  esriDark.addTo(map);
  esriRef.addTo(map);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 42, spiderfyOnMaxZoom: true,
  });
  map.addLayer(cluster);


  function clearRings() {
    ringLayers.forEach(l => map.removeLayer(l));
    ringLayers = [];
    if (centerMarker) { map.removeLayer(centerMarker); centerMarker = null; }
  }

  /** Redraw radius rings only — never moves the camera. */
  function drawRings() {
    clearRings();
    if (!state.center) return;
    const { lat, lng } = state.center;
    [5, 10, 15, 25].forEach(mi => {
      const isActive = mi === state.radius;
      const circle = L.circle([lat, lng], {
        radius: mi * 1609.344,
        color: isActive ? '#38bdf8' : '#3a4a66',
        weight: isActive ? 2.5 : 1,
        opacity: isActive ? 0.9 : 0.45,
        dashArray: isActive ? null : '4 6',
        fillColor: '#38bdf8',
        fillOpacity: isActive && state.useRadius ? 0.07 : 0.02,
        interactive: false,
      });
      circle.addTo(map);
      ringLayers.push(circle);
    });
    centerMarker = L.circleMarker([lat, lng], {
      radius: 6, color: '#e8eef7', weight: 2,
      fillColor: '#38bdf8', fillOpacity: 1,
    }).addTo(map);
    ringLayers.push(centerMarker);
  }

  function updateCenterPill() {
    const pill = document.getElementById('centerPill');
    if (!state.center) {
      pill.innerHTML = '<span class="dim">Center:</span> not set — open from hub or pick a preset';
      return;
    }
    const n = state.useRadius ? (' · <strong style="color:var(--accent2)">' + state.filtered.length + ' in ring</strong>') : '';
    pill.innerHTML =
      '<span class="dim">Center:</span> ' + esc(state.center.label) +
      ' · <span class="dim">' + state.radius + ' mi</span>' + n;
  }

  function updateScopeBanner() {
    const el = document.getElementById('scopeBanner');
    if (state.activePreset) el.textContent = state.activePreset + (state.useRadius ? ' · ' + state.radius + ' mi' : '');
    else if (state.metroFilter) el.textContent = state.metroFilter + (state.useRadius ? ' · ' + state.radius + ' mi' : '');
    else if (state.center) el.textContent = state.center.label + (state.useRadius ? ' · ' + state.radius + ' mi' : '');
    else el.textContent = '';
  }

  /**
   * Set analytic center (ring origin). Does NOT move the map camera.
   * Camera moves only via flyToAnchor / jumpToPreset / recenter / reset / row click.
   */
  function setCenter(lat, lng, label) {
    state.center = { lat, lng, label: label || (lat.toFixed(4) + ', ' + lng.toFixed(4)) };
    if (!label || !presets[label]) {
      if (!(state.activePreset && presets[state.activePreset] &&
          Math.abs(presets[state.activePreset].lat - lat) < 0.001 &&
          Math.abs(presets[state.activePreset].lng - lng) < 0.001)) {
        setActivePreset(null);
      }
    }
    drawRings();
    updateCenterPill();
    updateScopeBanner();
    updateRecenterVisibility();
  }

  /** Intentional camera move to current center + suitable zoom for radius. */
  function flyToAnchor(opts) {
    if (!state.center) return;
    const zoom = (opts && opts.zoom) || zoomForRadius(state.radius);
    map.setView([state.center.lat, state.center.lng], zoom, { animate: !(opts && opts.instant) });
    state.anchorLocked = true;
    updateRecenterVisibility();
  }

  function zoomForRadius(mi) {
    if (mi <= 5) return 12;
    if (mi <= 10) return 11;
    if (mi <= 15) return 10;
    return 9;
  }

  function jumpToPreset(label, p) {
    setCenter(p.lat, p.lng, label);
    state.useRadius = true;
    document.getElementById('useRadius').checked = true;
    setActivePreset(label);
    // Intentional geographic jump
    flyToAnchor();
    applyFilters(); // no camera move inside
  }

  function metroCentroid(metroName) {
    const pts = allSites.filter(s => s.metro === metroName).map(siteLatLng).filter(Boolean);
    if (!pts.length) return null;
    const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    const lng = pts.reduce((a, p) => a + p.lng, 0) / pts.length;
    return { lat, lng };
  }

  map.on('click', (e) => {
    setCenter(e.latlng.lat, e.latlng.lng, 'Map click');
    applyFilters();
  });

  map.on('moveend', () => updateRecenterVisibility());

  function updateRecenterVisibility() {
    const btn = document.getElementById('btnRecenter');
    if (!state.center) { btn.hidden = true; return; }
    const c = map.getCenter();
    const dist = haversine(c.lat, c.lng, state.center.lat, state.center.lng);
    // Show when user has panned ~> 2 miles from ring center
    btn.hidden = dist < 2;
  }

  document.getElementById('btnRecenter').addEventListener('click', () => {
    flyToAnchor({ instant: false });
  });

  document.getElementById('btnExpandMap').addEventListener('click', () => {
    state.mapExpanded = !state.mapExpanded;
    const col = document.getElementById('centerCol');
    col.classList.toggle('map-expanded', state.mapExpanded);
    document.getElementById('btnExpandMap').textContent = state.mapExpanded ? 'Show table' : 'Enlarge map';
    softInvalidate();
    setTimeout(softInvalidate, 200);
  });

  const markerById = new Map();
  function makeIcon(s) {
    const c = s.color || brandColor[s.brand] || '#888';
    const closed = s.likely_closed ? ' closed' : '';
    return L.divIcon({
      className: '',
      html: '<div class="marker-dot' + closed + '" style="--c:' + c + '" title="' + (s.geo_precision || 'zip_centroid') + '"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
  }
  function rebuildMarkers(list) {
    cluster.clearLayers();
    markerById.clear();
    const layers = [];
    list.forEach(s => {
      const ll = siteLatLng(s);
      if (!ll) return;
      const m = L.marker([ll.lat, ll.lng], { icon: makeIcon(s), title: s.name });
      m.bindPopup(
        '<strong>' + esc(s.name) + '</strong><br/>' +
        esc(s.brand) + ' · ' + esc(s.zip || '') + '<br/>' +
        'Enrolled ' + fmtNum(s.enrolled) + ' / ' + fmtNum(s.capacity) +
        ' · Fill ' + fmtPct(s.fill_pct) + '<br/>' +
        '<span style="color:#8b9bb4;font-size:11px">' + esc(ll.precision || s.geo_precision || 'zip_centroid') + '</span>'
      );
      m.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        // Update ring center only — do NOT fly (keeps metro anchored)
        setCenter(ll.lat, ll.lng, s.name);
        openDrawer(s);
        state.selectedId = s.id;
        applyFilters();
      });
      markerById.set(s.id, m);
      layers.push(m);
    });
    cluster.addLayers(layers);
  }

  function matchesFilters(s) {
    if (!state.brands.has(s.brand)) return false;
    if (state.hideClosed && s.likely_closed) return false;
    if (state.hideJunk && s.is_junk) return false;
    if (state.geoOnly && !siteLatLng(s)) return false;
    if (state.stateFilter && s.state !== state.stateFilter) return false;
    if (state.metroFilter && s.metro !== state.metroFilter) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const blob = (s.name + ' ' + s.city + ' ' + s.metro + ' ' + s.zip + ' ' + s.brand + ' ' + s.state).toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (state.useRadius && state.center) {
      const ll = siteLatLng(s);
      if (!ll) return false;
      if (haversine(state.center.lat, state.center.lng, ll.lat, ll.lng) > state.radius) return false;
    }
    return true;
  }

  /**
   * CRITICAL: refresh markers/KPIs/share/table/rings WITHOUT moving the map.
   * No setView, no flyTo, no fitBounds — ever.
   */
  function applyFilters() {
    state.filtered = allSites.filter(matchesFilters);
    rebuildMarkers(state.filtered);
    updateKPIs(state.filtered);
    updateShare(state.filtered);
    renderTable(state.filtered);
    drawRings();
    updateCenterPill();
    updateScopeBanner();
    requestAnimationFrame(() => { try { map.invalidateSize({ animate: false }); } catch (_) {} });
  }

  function updateKPIs(list) {
    const sites = list.length;
    const enrolled = list.reduce((a, s) => a + (s.enrolled || 0), 0);
    const capacity = list.reduce((a, s) => a + (s.capacity || 0), 0);
    const fill = capacity > 0 ? (enrolled / capacity) * 100 : null;
    const monthly = list.reduce((a, s) => a + (s.est_monthly_rev || 0), 0);
    const annual = list.reduce((a, s) => a + (s.est_annual_rev || 0), 0);
    const closedN = list.filter(s => s.likely_closed).length;
    const live = list.filter(s => (s.n_classes || 0) > 0).length;
    document.getElementById('kSites').textContent = fmtNum(sites);
    document.getElementById('kSitesSub').textContent = live + ' with live classes' + (closedN ? (' · ' + closedN + ' closed') : '');
    document.getElementById('kEnrolled').textContent = fmtNum(enrolled);
    document.getElementById('kEnrolledSub').textContent = 'across filtered sites';
    document.getElementById('kCapacity').textContent = fmtNum(capacity);
    document.getElementById('kFill').textContent = fmtPct(fill);
    document.getElementById('kMonthly').textContent = fmtMoney(monthly);
    document.getElementById('kAnnual').textContent = fmtMoney(annual);
  }

  function updateShare(list) {
    const metric = state.shareMetric;
    const by = {};
    brandsMeta.forEach(b => { by[b.name] = { brand: b.name, color: b.color, value: 0 }; });
    list.forEach(s => {
      if (!by[s.brand]) return;
      if (metric === 'enrolled') by[s.brand].value += (s.enrolled || 0);
      else if (metric === 'sites') by[s.brand].value += 1;
      else if (metric === 'revenue') by[s.brand].value += (s.est_annual_rev || 0);
    });
    const rows = Object.values(by).sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0) || 1;
    document.getElementById('shareBars').innerHTML = rows.map(r => {
      const pct = (r.value / total) * 100;
      const valLabel = metric === 'revenue' ? fmtMoney(r.value) : fmtNum(r.value);
      return '<div class="share-row">' +
        '<div class="top"><span class="brand-name"><span class="swatch" style="display:inline-block;vertical-align:middle;margin-right:6px;background:' + r.color + ';color:' + r.color + '"></span>' + esc(r.brand) + '</span>' +
        '<span class="pct">' + pct.toFixed(1) + '% · ' + valLabel + '</span></div>' +
        '<div class="bar"><i style="width:' + pct.toFixed(2) + '%;background:' + r.color + ';--bar-c:' + r.color + '"></i></div></div>';
    }).join('');
    const note = document.getElementById('shareNote');
    if (metric === 'revenue') note.textContent = 'ESTIMATED annual tuition revenue share (enrolled × monthly list price × 12). Urban Air excluded — pass pricing is not MA tuition.';
    else if (metric === 'enrolled') note.textContent = 'Enrollment share. Urban Air reports 0 live classes / 0 enrolled this pull (membership model).';
    else note.textContent = 'Site-count share among filtered operators. Closed parks hidden by default.';
    document.getElementById('shareScope').textContent = state.useRadius && state.center
      ? (state.radius + ' mi of ' + state.center.label)
      : 'current filters';
  }

  function renderTable(list) {
    let rows = list.slice();
    const q = state.tableSearch.toLowerCase();
    if (q) rows = rows.filter(s => (s.name + ' ' + s.brand + ' ' + s.metro + ' ' + s.zip).toLowerCase().includes(q));
    rows.sort((a, b) => {
      const ka = a[state.sortKey], kb = b[state.sortKey];
      if (ka == null && kb == null) return 0;
      if (ka == null) return 1;
      if (kb == null) return -1;
      if (typeof ka === 'string') return ka.localeCompare(kb) * state.sortDir;
      return (ka - kb) * state.sortDir;
    });
    document.getElementById('tableCount').textContent = rows.length;
    const max = 500;
    const slice = rows.slice(0, max);
    document.getElementById('sitesTbody').innerHTML = slice.map(s => {
      const sel = s.id === state.selectedId ? ' selected' : '';
      const closedCls = s.likely_closed ? ' row-closed' : '';
      const closed = s.likely_closed ? ' <span class="closed-tag">CLOSED</span>' : '';
      const fc = fillClass(s.fill_pct);
      let priceCell;
      if (isUrbanAir(s)) {
        priceCell = '<td class="num price-pass" title="Urban Air pass pricing — excluded from tuition revenue">' +
          (s.price_low != null ? ('$' + s.price_low) : '—') +
          '<span class="pass-hint">pass</span></td>';
      } else {
        priceCell = '<td class="num">' + (s.price_low != null ? ('$' + s.price_low) : '—') + '</td>';
      }
      return '<tr data-id="' + esc(s.id) + '" class="' + sel + closedCls + '">' +
        '<td class="sticky-col sticky-1"><span class="pill"><span class="swatch" style="background:' + (s.color || brandColor[s.brand] || '#888') + ';color:' + (s.color || '#888') + ';width:8px;height:8px"></span>' + esc(s.brand) + '</span></td>' +
        '<td class="sticky-col sticky-2" title="' + esc(s.name) + '">' + esc(s.name) + closed + '</td>' +
        '<td>' + esc(s.metro || '—') + '</td>' +
        '<td>' + esc(s.state || '—') + '</td>' +
        '<td class="num">' + esc(s.zip || '—') + '</td>' +
        '<td class="num">' + fmtNum(s.enrolled) + '</td>' +
        '<td class="num">' + fmtNum(s.capacity) + '</td>' +
        '<td class="num ' + fc + '">' + fmtPct(s.fill_pct) + '</td>' +
        priceCell +
        '<td class="num">' + (s.est_monthly_rev != null ? fmtMoney(s.est_monthly_rev) : '—') + '</td>' +
        '<td class="num">' + fmtNum(s.n_classes) + '</td></tr>';
    }).join('') + (rows.length > max ? '<tr><td colspan="11" style="color:var(--dim);text-align:center">Showing ' + max + ' of ' + rows.length + '</td></tr>' : '');
  }

  document.getElementById('sitesTbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const s = allSites.find(x => x.id === tr.dataset.id);
    if (!s) return;
    state.selectedId = s.id;
    const ll = siteLatLng(s);
    if (ll) {
      setCenter(ll.lat, ll.lng, s.name);
      // Explicit user selection of a site — gentle intentional view nudge (not a national fitBounds)
      map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 11));
      const m = markerById.get(s.id);
      if (m) m.openPopup();
    }
    openDrawer(s);
    renderTable(state.filtered);
  });
  document.querySelectorAll('#sitesTable th').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (state.sortKey === k) state.sortDir *= -1;
      else { state.sortKey = k; state.sortDir = (k === 'name' || k === 'brand' || k === 'metro' || k === 'state') ? 1 : -1; }
      renderTable(state.filtered);
    });
  });

  function revenueNoteLabel(s) {
    if (s.revenue_eligible) return 'ESTIMATED from enrolled × monthly list price (not audited)';
    if (s.revenue_note === 'urban_air_pass_pricing_excluded') return 'Urban Air jump-pass pricing — excluded from tuition revenue';
    if (s.revenue_note === 'missing_price_or_enrollment') return 'Missing price or enrollment — no estimate';
    return s.revenue_note || 'Not estimated';
  }
  function openDrawer(s) {
    document.getElementById('dName').textContent = s.name;
    document.getElementById('dBrand').innerHTML =
      '<span class="swatch" style="display:inline-block;vertical-align:middle;margin-right:6px;background:' + (s.color || brandColor[s.brand] || '#888') + '"></span>' + s.brand +
      (s.likely_closed ? ' · <span class="closed-tag">LIKELY CLOSED</span>' : '');
    const ll = siteLatLng(s);
    const revEligible = !!s.revenue_eligible;
    const items = [
      { k: 'Zip', v: s.zip || '—' },
      { k: 'State / Metro', v: (s.state || '—') + ' · ' + (s.metro || '—') },
      { k: 'Phone', v: s.phone || '—' },
      { k: 'Geo', v: ll ? (ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4) + ' (' + (s.geo_precision || ll.precision || 'zip_centroid') + ')') : 'ungeocoded', sm: true },
      { k: 'Enrolled', v: fmtNum(s.enrolled) },
      { k: 'Capacity', v: fmtNum(s.capacity) },
      { k: 'Fill %', v: fmtPct(s.fill_pct) },
      { k: 'Live classes', v: fmtNum(s.n_classes) },
      { k: 'List price', v: s.price_low != null ? ('$' + s.price_low + ' / ' + (s.billing_interval || '?')) : '—' },
      { k: 'Price product', v: s.price_low_name || '—', sm: true },
      {
        k: 'Revenue estimate', wide: true, rev: true,
        v: s.est_monthly_rev != null
          ? (fmtMoney(s.est_monthly_rev) + ' / mo · ' + (s.est_annual_rev != null ? fmtMoney(s.est_annual_rev) + ' / yr' : '—'))
          : '—',
        good: revEligible && s.est_monthly_rev != null,
        explain: revenueNoteLabel(s) + (s.est_weekly_rev != null ? ' · Weekly ≈ ' + fmtMoney(s.est_weekly_rev) : ''),
      },
    ];
    document.getElementById('drawerGrid').innerHTML = items.map(it => {
      let extra = '';
      if (it.explain) extra = '<div class="rev-explain">' + esc(it.explain) + '</div>';
      return '<div class="dl-item' + (it.wide ? ' wide' : '') + (it.rev ? ' rev-block' : '') + '">' +
        '<div class="k">' + esc(it.k) + '</div>' +
        '<div class="v' + (it.sm ? ' sm' : '') + (it.good ? ' good' : '') + '">' + esc(it.v) + '</div>' +
        extra + '</div>';
    }).join('');
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawerBackdrop').classList.add('open');
  }
  function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawerBackdrop').classList.remove('open');
  }
  document.getElementById('drawerClose').onclick = closeDrawer;
  document.getElementById('drawerBackdrop').onclick = closeDrawer;

  // —— Filter listeners: NEVER move camera ——
  brandChecks.addEventListener('change', () => {
    state.brands = new Set([...brandChecks.querySelectorAll('input:checked')].map(i => i.value));
    applyFilters();
  });
  document.getElementById('hideClosed').addEventListener('change', e => { state.hideClosed = e.target.checked; applyFilters(); });
  document.getElementById('hideJunk').addEventListener('change', e => { state.hideJunk = e.target.checked; applyFilters(); });
  document.getElementById('geoOnly').addEventListener('change', e => { state.geoOnly = e.target.checked; applyFilters(); });
  stateSel.addEventListener('change', e => { state.stateFilter = e.target.value; applyFilters(); });
  metroSel.addEventListener('change', e => { state.metroFilter = e.target.value; applyFilters(); });
  let searchTimer;
  document.getElementById('searchFilter').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value.trim(); applyFilters(); }, 180);
  });
  document.getElementById('tableSearch').addEventListener('input', e => {
    state.tableSearch = e.target.value.trim();
    renderTable(state.filtered);
  });
  document.getElementById('useRadius').addEventListener('change', e => {
    state.useRadius = e.target.checked;
    applyFilters(); // redraw ring fill + KPIs — no fly
  });
  document.getElementById('radiusBtns').addEventListener('click', e => {
    const btn = e.target.closest('button[data-r]');
    if (!btn) return;
    state.radius = +btn.dataset.r;
    document.querySelectorAll('#radiusBtns button').forEach(b => b.classList.toggle('active', b === btn));
    applyFilters(); // redraw rings only — camera stays put
  });
  document.getElementById('shareTabs').addEventListener('click', e => {
    const btn = e.target.closest('button[data-m]');
    if (!btn) return;
    state.shareMetric = btn.dataset.m;
    document.querySelectorAll('#shareTabs button').forEach(b => b.classList.toggle('active', b === btn));
    updateShare(state.filtered);
  });

  /** Intentional national jump. */
  document.getElementById('btnReset').addEventListener('click', () => {
    state.brands = new Set(brandsMeta.map(b => b.name));
    brandChecks.querySelectorAll('input').forEach(i => { i.checked = true; });
    state.hideClosed = true; document.getElementById('hideClosed').checked = true;
    state.hideJunk = true; document.getElementById('hideJunk').checked = true;
    state.geoOnly = true; document.getElementById('geoOnly').checked = true;
    state.stateFilter = ''; stateSel.value = '';
    state.metroFilter = ''; metroSel.value = '';
    state.search = ''; document.getElementById('searchFilter').value = '';
    state.tableSearch = ''; document.getElementById('tableSearch').value = '';
    state.useRadius = false; document.getElementById('useRadius').checked = false;
    state.center = null; clearRings();
    state.anchorLocked = false;
    setActivePreset(null);
    updateCenterPill();
    updateScopeBanner();
    document.getElementById('btnRecenter').hidden = true;
    map.setView([39.5, -98], 4); // intentional national jump
    applyFilters();
  });

  function softInvalidate() {
    try { map.invalidateSize({ animate: false }); } catch (_) {}
  }

  /**
   * Hub picks starting metro ONCE. Parse hash and fly once, then lock.
   * Supported: #preset=...&r=10 | #metro=Houston | #brand=Snapology | #lat=&lng=
   */
  function bootFromHash() {
    const h = parseHash();

    if (h.r && [5, 10, 15, 25].includes(h.r)) {
      state.radius = h.r;
      document.querySelectorAll('#radiusBtns button').forEach(b => {
        b.classList.toggle('active', +b.dataset.r === h.r);
      });
    }

    if (h.brand) {
      const match = brandsMeta.find(b => b.name.toLowerCase() === h.brand.toLowerCase());
      if (match) {
        state.brands = new Set([match.name]);
        brandChecks.querySelectorAll('input').forEach(i => { i.checked = i.value === match.name; });
      }
    }

    // Preset (featured Houston Heights etc.) — intentional one-time fly
    if (h.preset && presets[h.preset]) {
      jumpToPreset(h.preset, presets[h.preset]);
      return;
    }
    // Fuzzy preset match
    if (h.preset) {
      const key = Object.keys(presets).find(k => k.toLowerCase() === h.preset.toLowerCase() ||
        k.toLowerCase().includes(h.preset.toLowerCase()));
      if (key) { jumpToPreset(key, presets[key]); return; }
    }

    // Explicit lat/lng
    if (h.lat != null && h.lng != null && !isNaN(h.lat) && !isNaN(h.lng)) {
      setCenter(h.lat, h.lng, h.metro || 'Hub pin');
      state.useRadius = true;
      document.getElementById('useRadius').checked = true;
      if (h.metro) { state.metroFilter = h.metro; metroSel.value = h.metro; }
      flyToAnchor();
      applyFilters();
      return;
    }

    // Metro card from hub — center on metro centroid once
    if (h.metro) {
      state.metroFilter = h.metro;
      metroSel.value = h.metro;
      const c = metroCentroid(h.metro);
      if (c) {
        setCenter(c.lat, c.lng, h.metro);
        state.useRadius = false; // metro filter scopes; radius optional
        document.getElementById('useRadius').checked = false;
        flyToAnchor({ zoom: 10 });
      }
      applyFilters();
      return;
    }

    // Brand-only or bare map — national, no fly lock needed
    applyFilters();
  }

  bootFromHash();
  softInvalidate();
  setTimeout(softInvalidate, 100);
  setTimeout(softInvalidate, 400);
  window.addEventListener('resize', softInvalidate);
  console.info('[MarketIntel map-v2] sites', allSites.length, 'anchorLocked', state.anchorLocked);
})();
