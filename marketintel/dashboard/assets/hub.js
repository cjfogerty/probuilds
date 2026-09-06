(function () {
  'use strict';
  const DATA = window.MARKETINTEL_OVERRIDE || window.MARKETINTEL;
  if (!DATA || !DATA.snapshots || !DATA.snapshots.length) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif;color:#c53030">Missing data/sites.js — rebuild with scripts/build_dashboard_data.py</p>';
    return;
  }

  const meta = DATA.meta || {};
  const snapshot = DATA.snapshots[DATA.snapshots.length - 1];
  const allSites = snapshot.sites || [];
  const brandsMeta = meta.brands || [];
  const presets = meta.presets || {};

  const fmt = new Intl.NumberFormat('en-US');
  const fmtMoney = (n) => {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + fmt.format(Math.round(n));
  };
  const fmtNum = (n) => (n == null || isNaN(n) ? '—' : fmt.format(n));

  function haversine(aLat, aLng, bLat, bLng) {
    const R = 3958.7613, p = Math.PI / 180;
    const dla = (bLat - aLat) * p, dlo = (bLng - aLng) * p;
    const h = Math.sin(dla / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dlo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function siteLatLng(s) {
    const lat = s.lat ?? s.latitude ?? null;
    const lng = s.lng ?? s.longitude ?? null;
    if (lat != null && lng != null && !isNaN(+lat) && !isNaN(+lng)) return { lat: +lat, lng: +lng };
    return null;
  }
  function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /** Default visibility: hide closed + junk (same rules as map). */
  function isVisible(s) {
    if (s.likely_closed) return false;
    if (s.is_junk) return false;
    return true;
  }

  const visible = allSites.filter(isVisible);

  function kpiOf(list) {
    const sites = list.length;
    const enrolled = list.reduce((a, s) => a + (s.enrolled || 0), 0);
    const capacity = list.reduce((a, s) => a + (s.capacity || 0), 0);
    const monthly = list.reduce((a, s) => a + (s.est_monthly_rev || 0), 0);
    const annual = list.reduce((a, s) => a + (s.est_annual_rev || 0), 0);
    const brands = [...new Set(list.map(s => s.brand).filter(Boolean))];
    const live = list.filter(s => (s.n_classes || 0) > 0).length;
    return { sites, enrolled, capacity, monthly, annual, brands, live };
  }

  function mapHref(params) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') q.set(k, v);
    });
    const hash = q.toString();
    return 'map.html' + (hash ? '#' + hash : '');
  }

  // —— Header chips ——
  document.getElementById('asOfChip').innerHTML = 'As of <strong>' + esc(snapshot.as_of || meta.as_of || '—') + '</strong>';
  document.getElementById('weekChip').innerHTML =
    'Week <strong>' + esc(snapshot.week_start || meta.week?.from || '—') + '</strong> → <strong>' + esc(snapshot.week_end || meta.week?.to || '—') + '</strong>';
  document.getElementById('brandCountChip').innerHTML = '<strong>' + brandsMeta.length + '</strong> brands';
  document.getElementById('siteCountChip').innerHTML = '<strong>' + fmtNum(visible.length) + '</strong> open sites';

  // —— National KPIs ——
  const nat = kpiOf(visible);
  document.getElementById('kSites').textContent = fmtNum(nat.sites);
  document.getElementById('kSitesSub').textContent = nat.live + ' with live classes';
  document.getElementById('kEnrolled').textContent = fmtNum(nat.enrolled);
  document.getElementById('kCapacity').textContent = fmtNum(nat.capacity);
  document.getElementById('kMonthly').textContent = fmtMoney(nat.monthly);
  document.getElementById('kAnnual').textContent = fmtMoney(nat.annual);
  document.getElementById('kBrands').textContent = String(brandsMeta.length);

  // —— Featured: Houston Heights 10mi ——
  const hhKey = Object.keys(presets).find(k => /houston heights/i.test(k));
  const featEl = document.getElementById('featuredCards');
  if (hhKey && presets[hhKey]) {
    const p = presets[hhKey];
    const inRing = visible.filter(s => {
      const ll = siteLatLng(s);
      return ll && haversine(p.lat, p.lng, ll.lat, ll.lng) <= 10;
    });
    const k = kpiOf(inRing);
    const dots = k.brands.map(b => {
      const c = brandsMeta.find(x => x.name === b)?.color || '#888';
      return '<span class="dot" style="background:' + c + '" title="' + esc(b) + '"></span>';
    }).join('');
    featEl.innerHTML =
      '<a class="card featured" href="' + mapHref({ preset: hhKey, r: 10 }) + '">' +
      '<h2>Houston Heights · 10 mi</h2>' +
      '<div class="card-meta"><span class="pill radius">Featured ring</span><span class="pill live">' + k.sites + ' sites</span></div>' +
      '<div class="card-stats">' +
      '<div class="row"><span class="k">Enrolled</span><span class="v">' + fmtNum(k.enrolled) + '</span></div>' +
      '<div class="row"><span class="k">Est. annual tuition</span><span class="v rev">' + fmtMoney(k.annual) + '</span></div>' +
      '<div class="row"><span class="k">Est. monthly</span><span class="v rev">' + fmtMoney(k.monthly) + '</span></div>' +
      '</div>' +
      '<div class="brand-dots">' + dots + '</div>' +
      '<div class="card-foot"><span>Urban Air pass $ excluded</span><span class="go">Open map →</span></div>' +
      '</a>';
  } else {
    featEl.innerHTML = '<div class="empty">No Houston Heights preset in data.</div>';
  }

  // —— Metro cards ——
  const byMetro = new Map();
  visible.forEach(s => {
    const m = (s.metro || '').trim();
    if (!m) return;
    if (!byMetro.has(m)) byMetro.set(m, []);
    byMetro.get(m).push(s);
  });

  const metroRows = [...byMetro.entries()]
    .map(([metro, list]) => ({ metro, list, k: kpiOf(list) }))
    .sort((a, b) => b.k.enrolled - a.k.enrolled || b.k.sites - a.k.sites);

  document.getElementById('metroCount').textContent = '(' + metroRows.length + ')';

  function renderMetros(q) {
    const needle = (q || '').trim().toLowerCase();
    const filtered = needle
      ? metroRows.filter(r => r.metro.toLowerCase().includes(needle) ||
          r.k.brands.some(b => b.toLowerCase().includes(needle)))
      : metroRows;
    const el = document.getElementById('metroCards');
    if (!filtered.length) {
      el.innerHTML = '<div class="empty">No metros match "' + esc(q) + '".</div>';
      return;
    }
    // Show top 24 by default when no search; all when searching
    const slice = needle ? filtered : filtered.slice(0, 24);
    el.innerHTML = slice.map(r => {
      const dots = r.k.brands.map(b => {
        const c = brandsMeta.find(x => x.name === b)?.color || '#888';
        return '<span class="dot" style="background:' + c + '" title="' + esc(b) + '"></span>';
      }).join('');
      return '<a class="card" href="' + mapHref({ metro: r.metro }) + '">' +
        '<h2>' + esc(r.metro) + '</h2>' +
        '<div class="card-meta"><span class="pill">' + r.k.sites + ' sites</span>' +
        (r.k.live ? '<span class="pill live">' + r.k.live + ' live</span>' : '') + '</div>' +
        '<div class="card-stats">' +
        '<div class="row"><span class="k">Enrolled</span><span class="v">' + fmtNum(r.k.enrolled) + '</span></div>' +
        '<div class="row"><span class="k">Est. annual</span><span class="v rev">' + fmtMoney(r.k.annual) + '</span></div>' +
        '</div>' +
        '<div class="brand-dots">' + dots + '</div>' +
        '<div class="card-foot"><span>' + r.k.brands.length + ' brands</span><span class="go">Map →</span></div>' +
        '</a>';
    }).join('') + (!needle && filtered.length > 24
      ? '<div class="empty">Showing top 24 of ' + filtered.length + ' metros — use search for more.</div>'
      : '');
  }
  renderMetros('');

  document.getElementById('hubSearch').addEventListener('input', (e) => {
    renderMetros(e.target.value);
  });

  // —— Brand cards ——
  document.getElementById('brandCount').textContent = '(' + brandsMeta.length + ')';
  const brandEl = document.getElementById('brandCards');
  brandEl.innerHTML = brandsMeta.map(b => {
    const list = visible.filter(s => s.brand === b.name);
    const k = kpiOf(list);
    const revNote = b.revenue === false
      ? 'Pass pricing excluded from tuition $'
      : (b.note || 'Tuition estimate when priced');
    const factsHref = 'programs.html#brand=' + encodeURIComponent(b.name);
    return '<div class="card brand-card" style="--brand-c:' + b.color + '">' +
      '<h2><a href="' + factsHref + '" style="color:inherit;text-decoration:none">' + esc(b.name) + '</a></h2>' +
      '<div class="card-meta"><span class="pill" style="background:' + b.color + '22;color:#1a202c">' + k.sites + ' sites</span></div>' +
      '<div class="card-stats">' +
      '<div class="row"><span class="k">Enrolled</span><span class="v">' + fmtNum(k.enrolled) + '</span></div>' +
      '<div class="row"><span class="k">Est. annual</span><span class="v rev">' +
        (b.revenue === false ? 'n/a' : fmtMoney(k.annual)) + '</span></div>' +
      '</div>' +
      '<div class="card-foot">' +
        '<span>' + esc(revNote) + '</span>' +
        '<span style="display:flex;gap:10px">' +
          '<a class="go" href="' + factsHref + '">Facts →</a>' +
          '<a class="go" href="' + mapHref({ brand: b.name }) + '">Map →</a>' +
        '</span>' +
      '</div>' +
      '</div>';
  }).join('');

  // National map CTA
  document.getElementById('openMapBtn').href = 'map.html';

  console.info('[MarketIntel hub] visible', visible.length, 'metros', metroRows.length);
})();
