(function () {
  'use strict';
  async function boot() {
  const DATA = window.MARKETINTEL_OVERRIDE || window.MARKETINTEL;
  if (!DATA || !DATA.snapshots || !DATA.snapshots.length) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif;color:#c53030">Missing data/sites.js — rebuild with scripts/build_dashboard_data.py</p>';
    return;
  }

  const meta = DATA.meta || {};
  const snapshot = DATA.snapshots[DATA.snapshots.length - 1];
  const allSites = snapshot.sites || [];
  let brandsMeta = meta.brands || [];
  try {
    const br = await fetch('data/brands.json');
    if (br.ok) {
      const bj = await br.json();
      if (Array.isArray(bj) && bj.length) brandsMeta = bj;
    }
  } catch (e) { /* keep meta.brands */ }
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

  function sumKnown(list, key) {
    let sum = 0, known = 0;
    for (const s of list) {
      const v = s[key];
      if (v != null && v !== '' && !isNaN(+v)) { sum += +v; known++; }
    }
    return known ? sum : null;
  }
  function kpiOf(list) {
    const sites = list.length;
    // null enroll/Est.$ stay unknown — never coerce to 0 (My Gym / SE / web / GHL)
    const enrolled = sumKnown(list, 'enrolled');
    const capacity = sumKnown(list, 'capacity');
    const monthly = sumKnown(list, 'est_monthly_rev');
    const annual = sumKnown(list, 'est_annual_rev');
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
  const covEl = document.getElementById('coverageChip');
  if (covEl) {
    const cov = meta.coverage_enrolled_known_vs_total;
    if (cov && cov.n_total) {
      covEl.innerHTML = 'Enroll known <strong>' + esc(String(cov.n_known)) + ' / ' + esc(String(cov.n_total)) +
        '</strong> (' + esc(String(cov.pct_known)) + '%) · unknowns in denom, not zero';
      covEl.hidden = false;
    }
  }
  document.getElementById('brandCountChip').innerHTML = '<strong>' + (meta.n_brands || brandsMeta.length) + '</strong> brands';
  document.getElementById('siteCountChip').innerHTML = '<strong>' + fmtNum(visible.length) + '</strong> open sites';

  // —— National KPIs ——
  const nat = kpiOf(visible);
  document.getElementById('kSites').textContent = fmtNum(nat.sites);
  document.getElementById('kSitesSub').textContent = nat.live + ' with live classes';
  document.getElementById('kEnrolled').textContent = fmtNum(nat.enrolled);
  document.getElementById('kCapacity').textContent = fmtNum(nat.capacity);
  document.getElementById('kMonthly').textContent = fmtMoney(nat.monthly);
  document.getElementById('kAnnual').textContent = fmtMoney(nat.annual);
  document.getElementById('kBrands').textContent = String(meta.n_brands || brandsMeta.length);

  const platLabel = { unleashed: 'Unleashed', iclasspro: 'iClassPro', jackrabbit: 'Jackrabbit', pike13: 'Pike13',
    teamunify: 'TeamUnify', daxko: 'Daxko', activenet: 'ActiveNet', sportsengine: 'SportsEngine',
    mygym: 'My Gym', web_discovery: 'Web', leadconnector: 'LeadConnector' };

  // —— Enrollment trend (running log: data/enrollment_log.json) ——
  async function renderEnrollTrend() {
    const host = document.getElementById('enrollTrend');
    if (!host) return;
    let log = null;
    try {
      const r = await fetch('data/enrollment_log.json');
      if (r.ok) log = await r.json();
    } catch (e) { /* no log yet */ }
    if (!log || !Array.isArray(log.rows) || !log.rows.length) return;
    const rows = log.rows;
    const dates = (log.dates || [...new Set(rows.map(r => r.date))]).slice().sort();
    const all = d => rows.find(r => r.date === d && r.platform === 'ALL');
    const series = dates.map(d => ({ d, a: all(d) })).filter(x => x.a);
    if (!series.length) return;
    const last = series[series.length - 1].a, lastDate = series[series.length - 1].d;
    const pct = v => (v == null ? '—' : v.toFixed(1) + '%');
    const S = 'font:13px/1.4 system-ui,sans-serif;';
    // Chart: enrolled_total_fresh only (sites re-read in that date's pull). Unleashed's stale total is NOT in it.
    const W = 520, H = 170, pl = 56, pr = 18, pt = 16, pb = 30;
    const vals = series.map(x => x.a.enrolled_total_fresh).filter(v => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.25, hi * 0.05, 1);
    const y0 = Math.max(0, lo - pad), y1 = hi + pad;
    const xAt = i => pl + (series.length === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (series.length - 1));
    const yAt = v => pt + (H - pt - pb) * (1 - (v - y0) / (y1 - y0));
    const pts = series.map((x, i) => x.a.enrolled_total_fresh == null ? null : [xAt(i), yAt(x.a.enrolled_total_fresh), x]);
    const line = pts.filter(Boolean).map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px" role="img" aria-label="Fresh enrolled total by pull date">' +
      [0, 0.5, 1].map(f => { const v = y0 + (y1 - y0) * f, y = yAt(v);
        return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="#cbd5e0" stroke-dasharray="3 3"/>' +
          '<text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#718096">' + fmt.format(Math.round(v)) + '</text>'; }).join('') +
      (pts.filter(Boolean).length > 1 ? '<polyline points="' + line + '" fill="none" stroke="#2b6cb0" stroke-width="2.5"/>' : '') +
      pts.filter(Boolean).map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4.5" fill="#2b6cb0"/>' +
        '<text x="' + p[0] + '" y="' + (p[1] - 10) + '" text-anchor="middle" font-size="12" font-weight="600" fill="#1a202c">' + fmt.format(p[2].a.enrolled_total_fresh) + '</text>' +
        '<text x="' + p[0] + '" y="' + (H - 10) + '" text-anchor="middle" font-size="11" fill="#718096">' + esc(p[2].d) + '</text>').join('') +
      '</svg>';
    const covRows = series.map(x => '<tr><td>' + esc(x.d) + '</td>' +
      '<td style="text-align:right"><strong>' + fmtNum(x.a.sites_known) + ' / ' + fmtNum(x.a.sites_total) + '</strong> (' + pct(x.a.coverage_pct) + ')</td>' +
      '<td style="text-align:right">' + fmtNum(x.a.sites_known_fresh) + '</td>' +
      '<td style="text-align:right">' + fmtNum(x.a.enrolled_total) + '</td>' +
      '<td style="text-align:right">' + fmtNum(x.a.enrolled_total_fresh) + '</td></tr>').join('');
    const plat = rows.filter(r => r.date === lastDate && r.platform !== 'ALL')
      .sort((a, b) => (b.sites_known - a.sites_known) || (b.sites_total - a.sites_total));
    const byDesign = new Set(log.unknown_by_design || []);
    const platRows = plat.map(r => {
      const prev = rows.find(q => q.platform === r.platform && q.date === (series.length > 1 ? series[series.length - 2].d : null));
      let note = '';
      if (byDesign.has(r.platform)) note = 'unknown by design (no public seat counts) — not 0';
      else if (log.not_refreshed && log.not_refreshed[r.platform]) note = log.not_refreshed[r.platform] + ' — excluded from the fresh line';
      const dlt = (prev && prev.enrolled_total_fresh != null && r.enrolled_total_fresh != null)
        ? (r.enrolled_total_fresh - prev.enrolled_total_fresh) : null;
      return '<tr><td>' + esc(platLabel[r.platform] || r.platform) + '</td>' +
        '<td style="text-align:right">' + fmtNum(r.sites_known) + ' / ' + fmtNum(r.sites_total) + '</td>' +
        '<td style="text-align:right">' + pct(r.coverage_pct) + '</td>' +
        '<td style="text-align:right">' + fmtNum(r.enrolled_total) + '</td>' +
        '<td style="text-align:right">' + fmtNum(r.enrolled_total_fresh) + '</td>' +
        '<td style="text-align:right">' + (dlt == null ? '—' : (dlt > 0 ? '+' : '') + fmt.format(dlt)) + '</td>' +
        '<td style="color:#718096">' + esc(note) + '</td></tr>';
    }).join('');
    const th = 'text-align:right;padding:4px 8px;border-bottom:1px solid #cbd5e0;font-weight:600;';
    host.innerHTML =
      '<h3 class="section">Enrollment trend<span class="section-count">running log · ' + series.length + ' pull' + (series.length === 1 ? '' : 's') + ' · fills weekly</span></h3>' +
      '<div class="card" style="padding:16px;' + S + '">' +
      '<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">' +
        '<div style="flex:1 1 360px"><div style="font-weight:600;margin-bottom:4px">Fresh enrolled total (sites re-read in that pull)</div>' + svg + '</div>' +
        '<div style="flex:1 1 360px"><div style="font-weight:600;margin-bottom:4px">Coverage: sites with known enrollment / all sites</div>' +
        '<table style="border-collapse:collapse;width:100%"><thead><tr><th style="' + th + 'text-align:left">Pull</th><th style="' + th + '">Known / total</th><th style="' + th + '">Fresh sites</th><th style="' + th + '">Enrolled (all known)</th><th style="' + th + '">Enrolled (fresh)</th></tr></thead><tbody>' + covRows + '</tbody></table>' +
        '<div style="color:#718096;margin-top:6px">Unknown sites stay in the denominator and are never counted as 0. “All known” includes rows carried from an earlier pull (e.g. Unleashed 102,060, not refreshed since before Oct 10) — it is not charted.</div></div>' +
      '</div>' +
      '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">By platform · ' + esc(lastDate) + '</summary>' +
      '<table style="border-collapse:collapse;width:100%;margin-top:6px"><thead><tr><th style="' + th + 'text-align:left">Platform</th><th style="' + th + '">Known / total</th><th style="' + th + '">%</th><th style="' + th + '">Enrolled</th><th style="' + th + '">Fresh</th><th style="' + th + '">Δ fresh vs prior</th><th style="' + th + 'text-align:left">Note</th></tr></thead><tbody>' + platRows + '</tbody></table></details>' +
      ((log.notes && log.notes[lastDate]) ? '<div style="color:#718096;margin-top:8px">' + esc(log.notes[lastDate]) + '</div>' : '') +
      '</div>';
    host.hidden = false;
  }
  renderEnrollTrend();

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
    .sort((a, b) => (b.k.enrolled ?? -1) - (a.k.enrolled ?? -1) || b.k.sites - a.k.sites);

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
    if (typeof renderBrands === 'function') renderBrands(e.target.value);
  });

  // —— Brand cards ——
  const nBrandsAll = meta.n_brands || brandsMeta.length;
  const brandEl = document.getElementById('brandCards');
  const brandCountEl = document.getElementById('brandCount');
  // Same display name can be several brand_ids (one per platform feed): label them so they read as distinct rows.
  const nameCount = new Map();
  brandsMeta.forEach(b => nameCount.set(b.name, (nameCount.get(b.name) || 0) + 1));
  const siteByBrand = new Map();
  visible.forEach(s => {
    const key = s.brand_id != null ? 'id:' + s.brand_id : 'name:' + s.brand;
    if (!siteByBrand.has(key)) siteByBrand.set(key, []);
    siteByBrand.get(key).push(s);
  });
  function brandCard(b) {
    const list = siteByBrand.get(b.id != null ? 'id:' + b.id : 'name:' + b.name) || [];
    const k = kpiOf(list);
    const sitesN = (b.sites != null ? b.sites : k.sites);
    // Brand-grain null enroll/Est.$ must show — (not 0 from site-sum || 0)
    const enrolledDisp = ('enrolled' in b) ? fmtNum(b.enrolled) : fmtNum(k.enrolled);
    const annualDisp = ('est_annual_rev' in b)
      ? (b.revenue === false ? 'n/a' : fmtMoney(b.est_annual_rev))
      : (b.revenue === false ? 'n/a' : fmtMoney(k.annual));
    const revNote = b.revenue === false
      ? 'Pass pricing excluded from tuition $'
      : (b.note || 'Tuition estimate when priced');
    const factsHref = 'programs.html#brand=' + encodeURIComponent(b.name);
    const dup = nameCount.get(b.name) > 1 && b.platform
      ? '<span class="pill" title="Same name appears on more than one platform feed">' + esc(platLabel[b.platform] || b.platform) + '</span>' : '';
    return '<div class="card brand-card" style="--brand-c:' + b.color + '">' +
      '<h2><a href="' + factsHref + '" style="color:inherit;text-decoration:none">' + esc(b.name) + '</a></h2>' +
      '<div class="card-meta"><span class="pill" style="background:' + b.color + '22;color:#1a202c">' + sitesN + ' sites</span>' + dup + '</div>' +
      '<div class="card-stats">' +
      '<div class="row"><span class="k">Enrolled</span><span class="v">' + enrolledDisp + '</span></div>' +
      '<div class="row"><span class="k">Est. annual</span><span class="v rev">' + annualDisp + '</span></div>' +
      '</div>' +
      '<div class="card-foot">' +
        '<span>' + esc(revNote) + '</span>' +
        '<span style="display:flex;gap:10px">' +
          '<a class="go" href="' + factsHref + '">Facts →</a>' +
          '<a class="go" href="' + mapHref({ brand: b.name }) + '">Map →</a>' +
        '</span>' +
      '</div>' +
      '</div>';
  }
  function renderBrands(q) {
    const needle = (q || '').trim().toLowerCase();
    const rows = needle
      ? brandsMeta.filter(b => (b.name || '').toLowerCase().includes(needle) ||
          (b.platform || '').toLowerCase().includes(needle) ||
          (b.category || '').toLowerCase().includes(needle) ||
          (b.states || []).some(st => String(st).toLowerCase() === needle))
      : brandsMeta;
    brandCountEl.textContent = needle ? '(' + rows.length + ' of ' + nBrandsAll + ')' : '(' + nBrandsAll + ')';
    brandEl.innerHTML = rows.length
      ? rows.map(brandCard).join('')
      : '<div class="empty">No brands match "' + esc(q) + '".</div>';
  }
  renderBrands('');

  // National map CTA
  document.getElementById('openMapBtn').href = 'map.html';

  console.info('[MarketIntel hub] visible', visible.length, 'metros', metroRows.length);
  }
  boot();
})();