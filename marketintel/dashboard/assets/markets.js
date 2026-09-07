/* markets.js — Market Command view.
   Reads window.MARKETINTEL_MARKETS (built by scripts/build_markets.py).
   Every metric rendered here is defined in METRICS.md. */
(function () {
  'use strict';

  const D = window.MARKETINTEL_MARKETS;
  if (!D || !D.markets) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:system-ui;color:#c53030">' +
      'Missing data/markets.js — run <code>python3 scripts/build_markets.py</code></p>';
    return;
  }

  const META = D.meta, MARKETS = Object.values(D.markets), NAT = D.national, TA = D.trade_areas;

  // ---------------------------------------------------------------- format
  const nf = new Intl.NumberFormat('en-US');
  const n0 = v => (v == null || isNaN(v)) ? null : nf.format(Math.round(v));
  const money = v => {
    if (v == null || isNaN(v)) return null;
    const a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  };
  const pctv = (v, dp) => (v == null || isNaN(v)) ? null : (v * 100).toFixed(dp == null ? 1 : dp) + '%';
  const dash = v => (v == null || v === '') ? '—' : v;
  const esc = t => String(t == null ? '' : t)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CAT_LABEL = {
    __all__: 'All categories', gymnastics: 'Gymnastics', martial_arts: 'Martial arts',
    adventure: 'Adventure parks', stem: 'STEM', ninja: 'Ninja', cheer_dance: 'Cheer & dance'
  };
  const CAT_ORDER = ['__all__', 'gymnastics', 'martial_arts', 'ninja', 'cheer_dance', 'stem', 'adventure'];
  const CAT_VAR = { gymnastics: 1, martial_arts: 2, adventure: 3, stem: 4, ninja: 5, cheer_dance: 6 };
  const catColor = c => c && CAT_VAR[c] ? 'var(--series-' + CAT_VAR[c] + ')' : 'var(--text-muted)';

  let cat = 'gymnastics';

  const cellOf = m => (cat === '__all__' ? m.total : (m.categories || {})[cat]);
  const CONF_RANK = { A: 3, B: 2, C: 1, N: 0 };

  // ---------------------------------------------------------------- chips
  (function chips() {
    const p = META.plausibility || {};
    const bits = [
      ['As of', META.as_of],
      ['Week', (META.week && META.week.from) + ' → ' + (META.week && META.week.to)],
      ['Markets', n0(META.n_markets)],
      ['Trade areas', n0(META.n_trade_areas)],
      ['Sites unassigned to a market', n0(META.unassigned_sites)],
    ].map(([k, v]) => '<span class="chip">' + esc(k) + ' <strong>' + esc(v) + '</strong></span>').join('');
    const warn = p.flagged_sites
      ? '<span class="chip warn">' + p.flagged_sites + ' sites held back by the plausibility guard '
        + '<strong>' + pctv(p.enrolled_excluded_pct, 1) + ' of enrollment</strong></span>'
      : '';
    document.getElementById('chips').innerHTML = bits + warn;
  })();

  // ---------------------------------------------------------------- tabs
  const panels = { 'tab-markets': 'p-markets', 'tab-trade': 'p-trade', 'tab-quality': 'p-quality' };
  Object.keys(panels).forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      Object.entries(panels).forEach(([t, p]) => {
        const on = t === id;
        document.getElementById(t).setAttribute('aria-selected', String(on));
        document.getElementById(p).hidden = !on;
      });
      if (id === 'tab-trade') renderTrade();
      if (id === 'tab-quality') renderQuality();
    });
  });

  // ---------------------------------------------------------------- pills
  (function pills() {
    const host = document.getElementById('catPills');
    CAT_ORDER.filter(c => c === '__all__' || NAT[c]).forEach(c => {
      const b = document.createElement('button');
      b.className = 'pill'; b.type = 'button';
      b.setAttribute('aria-pressed', String(c === cat));
      b.innerHTML = (c === '__all__' ? '' :
        '<span class="dot" style="background:' + catColor(c) + '"></span>') + esc(CAT_LABEL[c] || c);
      b.addEventListener('click', () => {
        cat = c;
        host.querySelectorAll('.pill').forEach((el, i) =>
          el.setAttribute('aria-pressed', String(CAT_ORDER.filter(x => x === '__all__' || NAT[x])[i] === c)));
        renderTiles(); renderScatter(); renderMarketTable();
      });
      host.appendChild(b);
    });
  })();

  // ---------------------------------------------------------------- tiles
  function tile(label, value, sub, na) {
    return '<div class="tile"><div class="label">' + esc(label) + '</div>' +
      '<div class="value' + (na ? ' na' : '') + '">' + esc(value == null ? '—' : value) + '</div>' +
      '<div class="sub">' + (sub || '') + '</div></div>';
  }

  function renderTiles() {
    const c = NAT[cat] || NAT.__all__;
    const rows = MARKETS.map(cellOf).filter(Boolean);
    const kids = MARKETS.reduce((a, m) => a + ((cellOf(m) && m.demand.kids_0_14) || 0), 0);
    const rank = rows.filter(r => r.confidence === 'A' || r.confidence === 'B').length;
    const notPub = c.enrollment_model === 'not_published';

    const pen = notPub ? null : (() => {
      const e = rows.filter(r => r.confidence === 'A' || r.confidence === 'B')
        .reduce((a, r) => a + r.enrolled, 0);
      const k = MARKETS.filter(m => { const x = cellOf(m); return x && (x.confidence === 'A' || x.confidence === 'B'); })
        .reduce((a, m) => a + (m.demand.kids_0_14 || 0), 0);
      return k ? e / k : null;
    })();

    document.getElementById('tiles').innerHTML =
      tile('Markets with supply', n0(rows.length),
        rank + ' rankable (confidence A/B)') +
      tile('Sites observed', n0(c.sites),
        n0(c.brands) + ' distinct operators') +
      tile('Children 0–14 in those metros', n0(kids),
        'ACS 2023 5-year') +
      tile('Enrolled students', notPub ? 'n/a' : n0(c.enrolled),
        notPub ? 'this category bills by pass, not enrollment'
               : 'coverage ' + dash(pctv(c.cov_enrollment, 0)) + ' of sites', notPub) +
      tile('Observed penetration', notPub ? 'n/a' : dash(pctv(pen, 2)),
        notPub ? '—' : 'of children in rankable metros · a floor', notPub) +
      tile('Fill rate', dash(pctv(c.fill_rate, 0)),
        c.fill_rate == null ? 'too few sites report both sides'
          : n0(c.capacity - c.enrolled) + ' open seats seen') +
      tile('Median price', c.price_median == null ? null : '$' + c.price_median,
        'per month · IQR $' + dash(c.price_p25) + '–$' + dash(c.price_p75)) +
      tile('Est. annual tuition', money(c.est_annual_rev),
        'revenue coverage ' + dash(pctv(c.cov_revenue, 0)) + ' of sites');
  }

  // ---------------------------------------------------------------- scatter
  function renderScatter() {
    const host = document.getElementById('scatter');
    const pts = MARKETS.map(m => ({ m, c: cellOf(m) }))
      .filter(x => x.c && x.c.kids_per_site && x.c.fill_rate != null &&
                   (x.c.confidence === 'A' || x.c.confidence === 'B') && !x.c.low_observed_supply);
    if (pts.length < 4) {
      host.innerHTML = '<div class="empty">Not enough markets report both utilization and demand in this category to plot.</div>';
      return;
    }
    const W = 940, H = 430, P = { t: 18, r: 26, b: 46, l: 62 };
    const xs = pts.map(p => Math.log10(p.c.kids_per_site));
    const ys = pts.map(p => p.c.fill_rate);
    const xmin = Math.min(...xs) - .06, xmax = Math.max(...xs) + .06;
    const ymin = Math.max(0, Math.min(...ys) - .05), ymax = Math.min(1, Math.max(...ys) + .05);
    const X = v => P.l + (Math.log10(v) - xmin) / (xmax - xmin) * (W - P.l - P.r);
    const Y = v => H - P.b - (v - ymin) / (ymax - ymin) * (H - P.t - P.b);
    const med = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    const mx = med(pts.map(p => p.c.kids_per_site)), my = med(ys);
    const rmax = Math.max(...pts.map(p => p.m.demand.kids_0_14 || 1));
    const R = k => 4 + 20 * Math.sqrt((k || 1) / rmax);

    // ~6 ticks on nice 1/2/5 × 10^n stops inside the plotted range
    const lo = Math.pow(10, xmin), hi = Math.pow(10, xmax), xticks = [];
    for (let e = 0; e <= 8; e++) {
      [1, 2, 5].forEach(mant => {
        const v = mant * Math.pow(10, e);
        if (v >= lo && v <= hi) xticks.push(v);
      });
    }
    if (xticks.length < 3) {                     // narrow range — fall back to quarters
      xticks.length = 0;
      for (let i = 0; i <= 4; i++) {
        const v = Math.pow(10, xmin + (xmax - xmin) * i / 4);
        const step = Math.pow(10, Math.floor(Math.log10(v)) - 1);
        xticks.push(Math.round(v / step) * step);   // 2 significant figures
      }
    }
    const yticks = []; for (let v = 0; v <= 1.0001; v += .1) if (v >= ymin && v <= ymax) yticks.push(v);

    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market map: children per site against fill rate">';
    yticks.forEach(v => { s += '<line class="grid" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>' +
      '<text class="tick" x="' + (P.l - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(v * 100) + '%</text>'; });
    xticks.forEach(v => { s += '<text class="tick" x="' + X(v).toFixed(1) + '" y="' + (H - P.b + 18) + '" text-anchor="middle">' + n0(v) + '</text>'; });
    s += '<line class="axis" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + (H - P.b) + '" y2="' + (H - P.b) + '"/>';
    s += '<line class="axis" x1="' + P.l + '" x2="' + P.l + '" y1="' + P.t + '" y2="' + (H - P.b) + '"/>';
    // quadrant reference lines at the medians
    s += '<line class="axis" stroke-dasharray="4 4" x1="' + X(mx).toFixed(1) + '" x2="' + X(mx).toFixed(1) + '" y1="' + P.t + '" y2="' + (H - P.b) + '"/>';
    s += '<line class="axis" stroke-dasharray="4 4" x1="' + P.l + '" x2="' + (W - P.r) + '" y1="' + Y(my).toFixed(1) + '" y2="' + Y(my).toFixed(1) + '"/>';
    s += '<text class="qlab" x="' + (W - P.r - 6) + '" y="' + (P.t + 14) + '" text-anchor="end">underserved &amp; full →</text>';
    s += '<text class="axlab" x="' + ((W + P.l - P.r) / 2) + '" y="' + (H - 8) + '" text-anchor="middle">Children 0–14 per observed site (log) — further right = thinner supply</text>';
    s += '<text class="axlab" transform="translate(16,' + ((H - P.b + P.t) / 2) + ') rotate(-90)" text-anchor="middle">Fill rate of incumbents</text>';

    const sorted = [...pts].sort((a, b) => (b.m.demand.kids_0_14 || 0) - (a.m.demand.kids_0_14 || 0));
    sorted.forEach(p => {
      const fill = p.c.confidence === 'A' ? 'var(--seq-550)' : 'var(--seq-250)';
      s += '<circle class="pt" data-id="' + esc(p.m.market_id) + '" cx="' + X(p.c.kids_per_site).toFixed(1) +
        '" cy="' + Y(p.c.fill_rate).toFixed(1) + '" r="' + R(p.m.demand.kids_0_14).toFixed(1) +
        '" fill="' + fill + '" fill-opacity=".78"><title>' + esc(p.m.market_name) + ' — ' +
        n0(p.c.kids_per_site) + ' children per site, ' + pctv(p.c.fill_rate, 0) + ' full, ' +
        p.c.sites + ' sites</title></circle>';
    });
    // label the ten largest, the only ones with room
    sorted.slice(0, 10).forEach(p => {
      s += '<text class="ptlab" x="' + (X(p.c.kids_per_site) + R(p.m.demand.kids_0_14) + 5).toFixed(1) +
        '" y="' + (Y(p.c.fill_rate) + 4).toFixed(1) + '">' +
        esc(p.m.market_name.split(/[-,]/)[0]) + '</text>';
    });
    s += '</svg>';
    host.innerHTML = s;
    host.querySelectorAll('circle.pt').forEach(el =>
      el.addEventListener('click', () => openDrawer(el.getAttribute('data-id'))));
  }

  // ---------------------------------------------------------------- market table
  const M_COLS = [
    { k: 'market_name', h: 'Market', cls: 'name', get: r => r.m.market_name,
      cell: r => '<td class="name">' + esc(r.m.market_name) + '</td>' },
    { k: 'confidence', h: 'Conf', get: r => CONF_RANK[r.c.confidence] || 0,
      cell: r => '<td><span class="badge ' + r.c.confidence + '">' + r.c.confidence + '</span></td>' },
    { k: 'sites', h: 'Sites', num: 1, get: r => r.c.sites },
    { k: 'brands', h: 'Operators', num: 1, get: r => r.c.brands },
    { k: 'kids_0_14', h: 'Children 0–14', num: 1, get: r => r.m.demand.kids_0_14, fmt: n0 },
    { k: 'kids_per_site', h: 'Children / site', num: 1, get: r => r.c.kids_per_site, fmt: n0 },
    { k: 'penetration_observed', h: 'Penetration', num: 1, get: r => r.c.penetration_observed,
      fmt: v => pctv(v, 2) },
    { k: 'fill_rate', h: 'Fill', num: 1, get: r => r.c.fill_rate, fmt: v => pctv(v, 0) },
    { k: 'price_median', h: 'Median $/mo', num: 1, get: r => r.c.price_median,
      fmt: v => v == null ? null : '$' + v },
    { k: 'price_index', h: 'Price idx', num: 1, get: r => r.c.price_index, fmt: v => v == null ? null : v.toFixed(0) },
    { k: 'hhi', h: 'HHI', num: 1, get: r => r.c.hhi, fmt: n0 },
    { k: 'top_brand', h: 'Leader', get: r => r.c.top_brand,
      cell: r => '<td class="name">' + esc(dash(r.c.top_brand)) +
        (r.c.top_brand_share ? ' <span class="dim">' + pctv(r.c.top_brand_share, 0) + '</span>' : '') + '</td>' },
    { k: 'est_annual_rev', h: 'Est. annual $', num: 1, get: r => r.c.est_annual_rev, fmt: money },
    { k: 'whitespace', h: 'Whitespace', num: 1, get: r => r.c.whitespace,
      cell: r => '<td class="num">' + meter(r.c.whitespace, 100) + '</td>' },
  ];
  let mSort = { k: 'whitespace', dir: -1 };

  function meter(v, max) {
    if (v == null) return '<span class="dim">—</span>';
    const w = Math.max(2, Math.min(100, (v / max) * 100));
    return '<span class="meter"><span class="bar"><i style="width:' + w.toFixed(0) + '%"></i></span>' +
      '<span class="n">' + (v >= 100 ? Math.round(v) : v.toFixed(v < 10 ? 1 : 0)) + '</span></span>';
  }

  function marketRows() {
    const q = document.getElementById('mSearch').value.trim().toLowerCase();
    const minConf = CONF_RANK[document.getElementById('mConf').value];
    const minSites = +document.getElementById('mMinSites').value;
    const hideLow = document.getElementById('mHideLow').value === 'hide';
    return MARKETS.map(m => ({ m, c: cellOf(m) }))
      .filter(r => r.c)
      .filter(r => (CONF_RANK[r.c.confidence] || 0) >= minConf)
      .filter(r => r.c.sites >= minSites)
      .filter(r => !(hideLow && r.c.low_observed_supply))
      .filter(r => !q || (r.m.market_name + ' ' + (r.m.state || '')).toLowerCase().includes(q));
  }

  function renderMarketTable() {
    const rows = marketRows();
    const col = M_COLS.find(c => c.k === mSort.k) || M_COLS[0];
    rows.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;               // nulls always last, either direction
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * mSort.dir;
    });
    let h = '<thead><tr>' + M_COLS.map(c =>
      '<th data-k="' + c.k + '"' + (c.num ? ' class="num"' : '') +
      (mSort.k === c.k ? ' aria-sort="' + (mSort.dir === 1 ? 'ascending' : 'descending') + '"' : '') +
      '>' + esc(c.h) + '</th>').join('') + '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="' + M_COLS.length + '"><div class="empty">No markets match these filters.</div></td></tr>';
    rows.forEach(r => {
      h += '<tr data-id="' + esc(r.m.market_id) + '"' + (r.c.confidence === 'C' ? ' class="lowconf"' : '') + '>';
      M_COLS.forEach(c => {
        if (c.cell) { h += c.cell(r); return; }
        const v = c.get(r), t = c.fmt ? c.fmt(v) : (v == null ? null : String(v));
        h += '<td class="' + (c.num ? 'num ' : '') + (t == null ? 'dim' : '') + '">' + esc(dash(t)) + '</td>';
      });
      h += '</tr>';
    });
    const t = document.getElementById('mTable');
    t.innerHTML = h + '</tbody>';
    t.querySelectorAll('thead th').forEach(th => th.addEventListener('click', () => {
      const k = th.getAttribute('data-k');
      mSort = { k, dir: mSort.k === k ? -mSort.dir : -1 };
      renderMarketTable();
    }));
    t.querySelectorAll('tbody tr[data-id]').forEach(tr =>
      tr.addEventListener('click', () => openDrawer(tr.getAttribute('data-id'))));

    const c = NAT[cat] || NAT.__all__;
    document.getElementById('mNote').innerHTML =
      '<strong>' + rows.length + ' markets shown.</strong> ' +
      'Penetration is enrolled students divided by resident children 0–14 — a <em>floor</em>, since ' +
      'off-platform independents are not in the universe. Price index is 100 = the national ' +
      (cat === '__all__' ? 'all-category' : esc(CAT_LABEL[cat] || cat)) + ' median of $' +
      dash(c.price_median) + '. HHI over 2,500 is a concentrated market; under 1,500 is fragmented, ' +
      'and fragmentation is the reading you can trust — missing independents can only push it lower.';
  }

  ['mSearch', 'mConf', 'mMinSites', 'mHideLow'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderMarketTable);
  });

  // ---------------------------------------------------------------- drawer
  const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim');
  function closeDrawer() { drawer.hidden = true; scrim.hidden = true; }
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  function kv(pairs) {
    return '<dl class="kv">' + pairs.filter(Boolean).map(([k, v]) =>
      '<dt>' + esc(k) + '</dt><dd>' + (v == null ? '<span class="dim">—</span>' : esc(v)) + '</dd>').join('') + '</dl>';
  }

  function openDrawer(id) {
    const m = D.markets[id]; if (!m) return;
    const c = cellOf(m) || m.total, d = m.demand;
    let h = '<button class="btn-ghost close" type="button" id="dClose">Close</button>';
    h += '<h3>' + esc(m.market_name) + '</h3>';
    h += '<div class="who">' + esc(CAT_LABEL[cat] || cat) + ' · ' + esc(m.market_type) +
      ' · confidence <span class="badge ' + c.confidence + '">' + c.confidence + '</span></div>';

    h += '<h4>Demand</h4>' + kv([
      ['Population', n0(d.pop)],
      ['Children 0–14', n0(d.kids_0_14)],
      ['Children 0–4', n0(d.kids_0_4)],
      ['Households with children', n0(d.hh_with_kids)],
      ['Median household income', d.median_hh_income ? '$' + n0(d.median_hh_income) : null],
      ['Income index (100 = US)', d.income_index],
    ]);

    h += '<h4>Supply and utilization</h4>' + kv([
      ['Sites observed', n0(c.sites)],
      ['Operators', n0(c.brands)],
      ['Enrolled', c.enrollment_model === 'not_published' ? 'not published' : n0(c.enrolled)],
      ['Seats observed', n0(c.capacity)],
      ['Fill rate', pctv(c.fill_rate, 0)],
      ['Sites at 90%+ full', n0(c.sites_at_capacity)],
      ['Children per site', n0(c.kids_per_site)],
      ['Sites per 100k children', c.sites_per_100k_kids],
      ['Penetration (observed)', pctv(c.penetration_observed, 2)],
      ['Penetration (coverage-adjusted)', pctv(c.penetration_adjusted, 2)],
      ['Est. annual tuition', money(c.est_annual_rev)],
      ['Annual spend per child', c.spend_per_kid ? '$' + c.spend_per_kid : null],
      ['Annual spend per enrolled', c.spend_per_enrolled ? '$' + n0(c.spend_per_enrolled) : null],
    ]);

    if (c.price_median != null) {
      const lo = c.price_p25, hi = c.price_p75, md = c.price_median;
      const span = Math.max(hi - lo, 1), pad = span * .35;
      const a = lo - pad, b = hi + pad, pos = v => ((v - a) / (b - a) * 100);
      h += '<h4>Price band (monthly equivalent)</h4><div class="priceband">' +
        '<div class="rail"></div>' +
        '<div class="iqr" style="left:' + pos(lo).toFixed(1) + '%;width:' + (pos(hi) - pos(lo)).toFixed(1) + '%"></div>' +
        '<div class="med" style="left:' + pos(md).toFixed(1) + '%"></div>' +
        '<div class="lab" style="left:0">$' + lo + '</div>' +
        '<div class="lab" style="right:0">$' + hi + '</div></div>' +
        '<div class="dim" style="font-size:12px">Median <strong>$' + md + '</strong>' +
        (c.price_index ? ' · index ' + c.price_index + ' vs national' : '') +
        (c.price_headroom ? ' · $' + c.price_headroom + ' of headroom to the local 75th percentile' : '') + '</div>';
    }

    if (c.brand_mix && c.brand_mix.length) {
      h += '<h4>Operator mix (by enrolled)</h4>';
      const top = c.brand_mix[0];
      c.brand_mix.forEach(b => {
        const w = top.enrolled ? (b.enrolled / top.enrolled) * 100 : 0;
        h += '<div class="mixrow"><span class="mixname">' + esc(b.brand) + '</span>' +
          '<span class="num dim">' + (b.share != null ? pctv(b.share, 0) : b.sites + ' site' + (b.sites > 1 ? 's' : '')) + '</span>' +
          '<span class="track"><i style="width:' + Math.max(1, w).toFixed(0) + '%"></i></span></div>';
      });
      h += '<div class="dim" style="font-size:12px;margin-top:8px">' +
        (c.hhi ? 'HHI ' + n0(c.hhi) + ' — ' + (c.hhi > 2500 ? 'concentrated' : c.hhi > 1500 ? 'moderately concentrated' : 'fragmented')
               : 'Too few operators report enrollment here to compute concentration.') +
        (c.cr4 ? ' · top four hold ' + pctv(c.cr4, 0) : '') + '</div>';
    }

    if (c.whitespace != null) {
      h += '<h4>Whitespace ' + c.whitespace + ' / 100</h4>' +
        '<div class="dim" style="font-size:12.5px">Percentile blend of ' +
        esc((c.whitespace_components_used || []).join(', ')) +
        ', ranked against other ' + esc(CAT_LABEL[cat] || cat).toLowerCase() +
        ' markets. A screening rank, not a forecast.</div>';
    }

    h += '<h4>What this rests on</h4>' + kv([
      ['Sites reporting enrollment', pctv(c.cov_enrollment, 0)],
      ['Sites with a price', pctv(c.cov_price, 0)],
      ['Sites revenue-eligible', pctv(c.cov_revenue, 0)],
      ['Sites geocoded to a street address', pctv(c.cov_street_geo, 0)],
      ['Enrollment from published figures', pctv(c.pct_enrolled_quotable, 0)],
    ]);
    if (c.low_observed_supply) {
      h += '<p class="note"><strong>Coverage gap, not whitespace.</strong> This is a large metro ' +
        'where we can see fewer than four sites. Treat the thin supply as missing data until a ' +
        'targeted pull says otherwise.</p>';
    }

    drawer.innerHTML = h;
    drawer.hidden = false; scrim.hidden = false;
    drawer.scrollTop = 0;
    document.getElementById('dClose').addEventListener('click', closeDrawer);
  }

  // ---------------------------------------------------------------- trade areas
  const T_COLS = [
    { k: 'zcta', h: 'ZIP', get: r => r.zcta },
    { k: 'cbsa_name', h: 'Metro', cls: 'name', get: r => r.cbsa_name,
      cell: r => '<td class="name">' + esc(r.cbsa_name) + '</td>' },
    { k: 'ta_whitespace', h: 'Whitespace', num: 1, get: r => r.ta_whitespace,
      cell: r => '<td class="num">' + meter(r.ta_whitespace, 100) + '</td>' },
    { k: 'kids_0_14', h: 'Children 0–14', num: 1, get: r => r.kids_0_14, fmt: n0 },
    { k: 'hh_with_kids', h: 'HH with kids', num: 1, get: r => r.hh_with_kids, fmt: n0 },
    { k: 'median_hh_income', h: 'Median income', num: 1, get: r => r.median_hh_income, fmt: v => v ? '$' + n0(v) : null },
    { k: 'sites_5mi', h: 'Sites ≤5 mi', num: 1, get: r => r.sites_5mi },
    { k: 'sites_10mi', h: 'Sites ≤10 mi', num: 1, get: r => r.sites_10mi },
    { k: 'kids_per_site_10mi', h: 'Children / site (10 mi)', num: 1, get: r => r.kids_per_site_10mi, fmt: n0 },
    { k: 'fill_10mi', h: 'Fill ≤10 mi', num: 1, get: r => r.fill_10mi, fmt: v => pctv(v, 0) },
    { k: 'nearest_competitor_mi', h: 'Nearest site', num: 1, get: r => r.nearest_competitor_mi,
      fmt: v => v == null ? null : v.toFixed(1) + ' mi' },
  ];
  let tSort = { k: 'ta_whitespace', dir: -1 }, tInit = false;

  function renderTrade() {
    if (!tInit) {
      const sel = document.getElementById('tMetro');
      const names = [...new Set(TA.map(r => r.cbsa_name))].sort();
      sel.innerHTML = '<option value="">All metros</option>' +
        names.map(n => '<option>' + esc(n) + '</option>').join('');
      ['tMetro', 'tKids', 'tMax10', 'tInc', 'tSearch'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderTrade);
      });
      tInit = true;
    }
    const metro = document.getElementById('tMetro').value;
    const minKids = +document.getElementById('tKids').value;
    const max10 = +document.getElementById('tMax10').value;
    const minInc = +document.getElementById('tInc').value;
    const q = document.getElementById('tSearch').value.trim();

    let rows = TA.filter(r => (!metro || r.cbsa_name === metro) &&
      (r.kids_0_14 || 0) >= minKids && r.sites_10mi <= max10 &&
      (r.median_hh_income || 0) >= minInc && (!q || r.zcta.startsWith(q)));

    const col = T_COLS.find(c => c.k === tSort.k) || T_COLS[0];
    rows.sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * tSort.dir;
    });
    const shown = rows.slice(0, 300);

    let h = '<thead><tr>' + T_COLS.map(c =>
      '<th data-k="' + c.k + '"' + (c.num ? ' class="num"' : '') +
      (tSort.k === c.k ? ' aria-sort="' + (tSort.dir === 1 ? 'ascending' : 'descending') + '"' : '') +
      '>' + esc(c.h) + '</th>').join('') + '</tr></thead><tbody>';
    if (!shown.length) h += '<tr><td colspan="' + T_COLS.length + '"><div class="empty">No trade areas match these filters.</div></td></tr>';
    shown.forEach(r => {
      h += '<tr>';
      T_COLS.forEach(c => {
        if (c.cell) { h += c.cell(r); return; }
        const v = c.get(r), t = c.fmt ? c.fmt(v) : (v == null ? null : String(v));
        h += '<td class="' + (c.num ? 'num ' : '') + (t == null ? 'dim' : '') + '">' + esc(dash(t)) + '</td>';
      });
      h += '</tr>';
    });
    const t = document.getElementById('tTable');
    t.innerHTML = h + '</tbody>';
    t.querySelectorAll('thead th').forEach(th => th.addEventListener('click', () => {
      const k = th.getAttribute('data-k');
      tSort = { k, dir: tSort.k === k ? -tSort.dir : -1 };
      renderTrade();
    }));
    document.querySelector('#p-trade .sec .hint').textContent =
      rows.length.toLocaleString() + ' trade areas match' +
      (rows.length > 300 ? ' — showing the top 300 by the current sort.' : '.');
  }

  // ---------------------------------------------------------------- quality
  function renderQuality() {
    const p = META.plausibility || {}, nat = NAT.__all__;
    document.getElementById('qTiles').innerHTML =
      tile('Sites held back', n0(p.flagged_sites), 'flagged by the plausibility guard, not deleted') +
      tile('Enrollment held back', n0(p.enrolled_excluded),
        pctv(p.enrolled_excluded_pct, 1) + ' of observed enrollment') +
      tile('Revenue held back', money(p.revenue_excluded), 'would have inflated the headline') +
      tile('Sites with no market', n0(META.unassigned_sites), 'no usable ZIP or coordinates') +
      tile('Enrollment coverage', pctv(nat.cov_enrollment, 0), 'of enrollment-reporting sites') +
      tile('Street-level geocoding', pctv(nat.cov_street_geo, 0), 'the rest are ZIP or city centroids');

    const ex = p.examples || [];
    let h = '<thead><tr><th>Operator</th><th>Site</th><th class="num">Enrolled</th>' +
      '<th class="num">Seats</th><th class="num">Price</th><th class="num">Est. annual $</th>' +
      '<th>Platform</th><th>Evidence</th><th>Guard tripped</th></tr></thead><tbody>';
    ex.forEach(r => {
      h += '<tr><td class="name">' + esc(r.brand) + '</td><td class="name">' + esc(r.name) + '</td>' +
        '<td class="num">' + esc(dash(n0(r.enrolled))) + '</td>' +
        '<td class="num">' + esc(dash(n0(r.capacity))) + '</td>' +
        '<td class="num">' + esc(r.price == null ? '—' : '$' + r.price) + '</td>' +
        '<td class="num">' + esc(dash(money(r.est_annual_rev))) + '</td>' +
        '<td>' + esc(r.platform) + '</td><td>' + esc(r.evidence_tier) + '</td>' +
        '<td>' + esc((r.flags || []).join(', ')) + '</td></tr>';
    });
    document.getElementById('qTable').innerHTML = h + '</tbody>';

    const em = META.enrollment_model_by_category || {};
    document.getElementById('qCov').innerHTML = CAT_ORDER.filter(c => c !== '__all__' && NAT[c]).map(c => {
      const x = NAT[c];
      const v = x.cov_enrollment;
      return '<div class="mixrow"><span class="mixname"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
        catColor(c) + ';margin-right:6px"></span>' + esc(CAT_LABEL[c]) + ' <span class="dim">' + x.sites + ' sites</span></span>' +
        '<span class="num dim">' + (em[c] === 'not_published' ? 'n/a' : dash(pctv(v, 0))) + '</span>' +
        '<span class="track"><i style="width:' + ((v || 0) * 100).toFixed(0) + '%"></i></span></div>';
    }).join('') +
      '<div class="dim" style="font-size:12px;margin-top:10px">Adventure parks and STEM sell passes and ' +
      'short workshops rather than standing enrollment, so a 0% reading there is the billing model, ' +
      'not a data gap — they are excluded from coverage scoring rather than penalised by it.</div>';
  }

  // ---------------------------------------------------------------- go
  renderTiles(); renderScatter(); renderMarketTable();
})();
