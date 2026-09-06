(function () {
  const DATA = window.MARKETINTEL_PRODUCTS;
  if (!DATA || !Array.isArray(DATA.products)) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif">Missing window.MARKETINTEL_PRODUCTS — load data/products.js</p>';
    return;
  }

  const PAGE_SIZE = 200;
  const BILLING_ORDER = [
    'perpetual_monthly',
    'membership_pass_monthly',
    'prepaid_term_membership',
    'term_session',
    'one_off_per_lesson',
    'one_off_package',
    'unknown',
  ];
  const allProducts = DATA.products;
  const meta = DATA.meta || {};

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function fmtDec(n, d) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + fmtDec(n, n < 100 && n % 1 ? 2 : 0);
  }

  // site → billing models
  const siteModels = new Map();
  allProducts.forEach((p) => {
    const sid = p.site_id;
    if (!siteModels.has(sid)) siteModels.set(sid, new Set());
    siteModels.get(sid).add(p.billing_model || 'unknown');
  });
  function isMultiSite(sid) {
    const s = siteModels.get(sid);
    return !!(s && s.size >= 2);
  }

  const state = {
    brand: '',
    billing: '',
    type: '',
    metro: '',
    siteId: '',
    evidence: '',
    hideRetail: true,
    multiOnly: false,
    publishedOnlyEst: true,
    search: '',
    sortKey: 'site',
    sortDir: 'asc',
    shown: PAGE_SIZE,
  };

  document.getElementById('asOfChip').innerHTML =
    'As of <strong>' + esc(meta.as_of || '—') + '</strong>';
  const w = meta.week || {};
  document.getElementById('weekChip').innerHTML =
    'Pull week <strong>' + esc(w.from || '—') + '</strong> → <strong>' + esc(w.to || '—') + '</strong>';
  document.getElementById('skuCountChip').textContent = fmtNum(meta.n_skus || allProducts.length) + ' SKUs';
  document.getElementById('siteCountChip').textContent = fmtNum(meta.n_sites) + ' sites';
  document.getElementById('enrollChip').textContent =
    (meta.n_with_enroll || 0) === 0
      ? 'enrolled_or_sold: none — stickers only'
      : 'enrolled_or_sold on ' + fmtNum(meta.n_with_enroll);
  const ov = document.getElementById('overlapChip');
  if (ov) {
    ov.textContent =
      'catalog∩classline sites: ' + fmtNum(meta.site_overlap_catalog_classline || 0);
  }

  function isRetail(p) {
    const t = +p.product_type_id;
    return t === 3 || t === 4 || p.product_type_label === 'merch' || p.product_type_label === 'cafe';
  }

  function filtered() {
    let list = allProducts.slice();
    if (state.hideRetail) list = list.filter((p) => !isRetail(p));
    if (state.multiOnly) list = list.filter((p) => isMultiSite(p.site_id));
    if (state.brand) list = list.filter((p) => p.brand === state.brand);
    if (state.billing) list = list.filter((p) => (p.billing_model || '') === state.billing);
    if (state.type) list = list.filter((p) => String(p.product_type_id) === state.type);
    if (state.metro) list = list.filter((p) => (p.metro || '') === state.metro);
    if (state.siteId) list = list.filter((p) => p.site_id === state.siteId);
    if (state.evidence) {
      if (state.evidence === 'class_line_*') {
        list = list.filter((p) => String(p.evidence_tier || '').startsWith('class_line'));
      } else {
        list = list.filter((p) => (p.evidence_tier || '') === state.evidence);
      }
    }
    const needle = state.search.trim().toLowerCase();
    if (needle) {
      list = list.filter((p) => {
        const hay = [p.sku_name, p.site_name, p.brand, p.metro, p.billing_model, p.product_type_label, p.program_name, p.evidence_tier, p.platform]
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });
    }
    return list;
  }

  function enrollCountsForEst(p) {
    if (!p.revenue_rollable) return false;
    const enroll = p.enrolled_or_sold;
    if (enroll == null || isNaN(+enroll) || +enroll <= 0) return false;
    if (p.price == null || isNaN(+p.price)) return false;
    // Catalog never contributes Est. $ (sticker only)
    if ((p.evidence_tier || '') === 'product_catalog') return false;
    if (state.publishedOnlyEst) {
      return (p.evidence_tier || '') === 'class_line_published';
    }
    // Include modeled + published; still skip schedule_only (no enroll) and catalog
    return (
      (p.evidence_tier || '') === 'class_line_published' ||
      (p.evidence_tier || '') === 'class_line_modeled'
    );
  }

  function productRev(p) {
    const enroll = p.enrolled_or_sold;
    const price = p.price;
    if (enrollCountsForEst(p)) {
      const monthly = +enroll * +price;
      return { monthly, annual: monthly * 12, sticker: null, estEligible: true };
    }
    return {
      monthly: null,
      annual: null,
      sticker: price != null && !isNaN(+price) ? +price : null,
      estEligible: false,
    };
  }

  function aggregate(list) {
    const sites = new Set();
    const multi = new Set();
    const billing = {};
    const types = {};
    let priceSum = 0;
    let priceN = 0;
    let monthly = 0;
    let monthlyN = 0;
    let annual = 0;
    let enrollN = 0;
    const evidence = {};

    list.forEach((p) => {
      sites.add(p.site_id);
      if (isMultiSite(p.site_id)) multi.add(p.site_id);
      const bm = p.billing_model || 'unknown';
      billing[bm] = (billing[bm] || 0) + 1;
      const tl = p.product_type_label || String(p.product_type_id || '?');
      types[tl] = (types[tl] || 0) + 1;
      const ev = p.evidence_tier || 'unknown';
      evidence[ev] = (evidence[ev] || 0) + 1;
      if (p.price != null && !isNaN(+p.price)) {
        priceSum += +p.price;
        priceN++;
      }
      if (p.enrolled_or_sold != null) enrollN++;
      const rev = productRev(p);
      if (rev.monthly != null) {
        monthly += rev.monthly;
        monthlyN++;
        annual += rev.annual;
      }
    });

    const catalogN = evidence.product_catalog || 0;
    const classlineN =
      (evidence.class_line_modeled || 0) +
      (evidence.class_line_published || 0) +
      (evidence.class_line_schedule_only || 0);

    return {
      skus: list.length,
      sites: sites.size,
      multi: multi.size,
      billing,
      types,
      evidence,
      catalogN,
      classlineN,
      avgPrice: priceN ? priceSum / priceN : null,
      priceN,
      estMonthly: monthlyN ? monthly : null,
      estAnnual: monthlyN ? annual : null,
      monthlyN,
      enrollN,
    };
  }

  function sortRows(list) {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const num = new Set(['price', 'term', 'enroll', 'est']);
    return list.slice().sort((a, b) => {
      let av, bv;
      switch (key) {
        case 'brand':
          av = a.brand;
          bv = b.brand;
          break;
        case 'site':
          av = a.site_name;
          bv = b.site_name;
          break;
        case 'metro':
          av = a.metro;
          bv = b.metro;
          break;
        case 'sku':
          av = a.sku_name;
          bv = b.sku_name;
          break;
        case 'type':
          av = a.product_type_label;
          bv = b.product_type_label;
          break;
        case 'billing':
          av = a.billing_model;
          bv = b.billing_model;
          break;
        case 'price':
          av = a.price;
          bv = b.price;
          break;
        case 'unit':
          av = a.price_unit;
          bv = b.price_unit;
          break;
        case 'term':
          av = a.term_months;
          bv = b.term_months;
          break;
        case 'enroll':
          av = a.enrolled_or_sold;
          bv = b.enrolled_or_sold;
          break;
        case 'est':
          av = productRev(a).monthly;
          bv = productRev(b).monthly;
          break;
        case 'evidence':
          av = a.evidence_tier;
          bv = b.evidence_tier;
          break;
        default:
          av = a.site_name;
          bv = b.site_name;
      }
      if (num.has(key) || key === 'est') {
        av = av == null || isNaN(+av) ? -Infinity : +av;
        bv = bv == null || isNaN(+bv) ? -Infinity : +bv;
        if (av === bv) return String(a.sku_name || '').localeCompare(String(b.sku_name || ''));
        return (av - bv) * dir;
      }
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' });
      if (cmp === 0) return String(a.sku_name || '').localeCompare(String(b.sku_name || ''));
      return cmp * dir;
    });
  }

  function fillSelect(id, values, current, allLabel) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const opts = values.slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));
    sel.innerHTML =
      '<option value="">' +
      esc(allLabel) +
      '</option>' +
      opts
        .map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>')
        .join('');
    if (current && opts.some((o) => o.value === current)) sel.value = current;
    else {
      sel.value = '';
      return '';
    }
    return sel.value;
  }

  function populateFilters() {
    const base = allProducts.filter((p) => (state.hideRetail ? !isRetail(p) : true));
    const brands = [...new Set(base.map((p) => p.brand).filter(Boolean))];
    state.brand =
      fillSelect(
        'brandFilter',
        brands.map((b) => ({ value: b, label: b })),
        state.brand,
        'All brands'
      ) || '';

    let pool = base;
    if (state.brand) pool = pool.filter((p) => p.brand === state.brand);

    const billCounts = {};
    pool.forEach((p) => {
      const m = p.billing_model || 'unknown';
      billCounts[m] = (billCounts[m] || 0) + 1;
    });
    const billOpts = BILLING_ORDER.filter((m) => billCounts[m]).concat(
      Object.keys(billCounts).filter((m) => !BILLING_ORDER.includes(m))
    );
    state.billing =
      fillSelect(
        'billingFilter',
        billOpts.map((m) => ({ value: m, label: m + ' (' + billCounts[m] + ')' })),
        state.billing,
        'All billing models'
      ) || '';

    const typeCounts = {};
    pool.forEach((p) => {
      const k = String(p.product_type_id);
      typeCounts[k] = (typeCounts[k] || 0) + 1;
    });
    state.type =
      fillSelect(
        'typeFilter',
        Object.keys(typeCounts)
          .sort()
          .map((k) => {
            const sample = pool.find((p) => String(p.product_type_id) === k);
            const lab = (sample && sample.product_type_label) || k;
            return { value: k, label: lab + ' (' + k + ') · ' + typeCounts[k] };
          }),
        state.type,
        'All types'
      ) || '';

    const metros = [...new Set(pool.map((p) => p.metro).filter(Boolean))];
    state.metro =
      fillSelect(
        'metroFilter',
        metros.map((m) => ({ value: m, label: m })),
        state.metro,
        'All metros'
      ) || '';

    let sitePool = pool;
    if (state.metro) sitePool = sitePool.filter((p) => p.metro === state.metro);
    const siteMap = new Map();
    sitePool.forEach((p) => {
      if (!siteMap.has(p.site_id))
        siteMap.set(p.site_id, p.site_name + (isMultiSite(p.site_id) ? ' · multi' : ''));
    });
    state.siteId =
      fillSelect(
        'siteFilter',
        [...siteMap.entries()]
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([v, label]) => ({ value: v, label })),
        state.siteId,
        'All locations'
      ) || '';

    const evCounts = {};
    pool.forEach((p) => {
      const e = p.evidence_tier || 'unknown';
      evCounts[e] = (evCounts[e] || 0) + 1;
    });
    const evOrder = [
      'product_catalog',
      'class_line_modeled',
      'class_line_published',
      'class_line_schedule_only',
    ];
    const evOpts = [
      { value: 'class_line_*', label: 'All class-line (*)' },
      ...evOrder.filter((e) => evCounts[e]).map((e) => ({ value: e, label: e + ' (' + evCounts[e] + ')' })),
      ...Object.keys(evCounts)
        .filter((e) => !evOrder.includes(e))
        .sort()
        .map((e) => ({ value: e, label: e + ' (' + evCounts[e] + ')' })),
    ];
    const evSel = document.getElementById('evidenceFilter');
    if (evSel) {
      const cur = state.evidence;
      evSel.innerHTML =
        '<option value="">All evidence tiers</option>' +
        evOpts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('');
      if (cur && (cur === 'class_line_*' || evCounts[cur])) evSel.value = cur;
      else {
        evSel.value = '';
        state.evidence = '';
      }
    }
  }

  function scopeLabel() {
    const parts = [];
    if (state.brand) parts.push(state.brand);
    if (state.billing) parts.push(state.billing);
    if (state.type) parts.push('type ' + state.type);
    if (state.metro) parts.push(state.metro);
    if (state.siteId) {
      const p = allProducts.find((x) => x.site_id === state.siteId);
      parts.push(p ? p.site_name : '1 location');
    }
    if (state.evidence) parts.push('evidence: ' + state.evidence);
    if (state.hideRetail) parts.push('membership/prepaid');
    if (state.multiOnly) parts.push('multi-billing only');
    if (state.publishedOnlyEst) parts.push('Est. $ published-only');
    else parts.push('Est. $ incl. modeled');
    if (state.search.trim()) parts.push('“' + state.search.trim() + '”');
    return parts.length ? parts.join(' · ') : 'All catalog SKUs';
  }

  function renderChips() {
    const chips = document.getElementById('filterChips');
    const clearBtn = document.getElementById('clearFilters');
    const items = [];
    if (state.brand) items.push({ k: 'brand', label: 'brand: ' + state.brand });
    if (state.billing) items.push({ k: 'billing', label: 'billing: ' + state.billing });
    if (state.type) items.push({ k: 'type', label: 'type: ' + state.type });
    if (state.metro) items.push({ k: 'metro', label: 'metro: ' + state.metro });
    if (state.siteId) {
      const p = allProducts.find((x) => x.site_id === state.siteId);
      items.push({ k: 'site', label: 'site: ' + (p ? p.site_name : state.siteId) });
    }
    if (state.evidence) items.push({ k: 'evidence', label: 'evidence: ' + state.evidence });
    if (state.search.trim()) items.push({ k: 'search', label: 'search: ' + state.search.trim() });
    if (!items.length) {
      chips.hidden = true;
      chips.innerHTML = '';
      clearBtn.hidden = true;
      return;
    }
    chips.hidden = false;
    clearBtn.hidden = false;
    chips.innerHTML = items
      .map(
        (it) =>
          '<button type="button" class="filter-chip" data-k="' +
          esc(it.k) +
          '">' +
          esc(it.label) +
          ' ×</button>'
      )
      .join('');
    chips.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-k');
        if (k === 'brand') state.brand = '';
        if (k === 'billing') state.billing = '';
        if (k === 'type') state.type = '';
        if (k === 'metro') state.metro = '';
        if (k === 'site') state.siteId = '';
        if (k === 'evidence') state.evidence = '';
        if (k === 'search') {
          state.search = '';
          document.getElementById('prodSearch').value = '';
        }
        state.shown = PAGE_SIZE;
        populateFilters();
        refresh();
      });
    });
  }

  function renderGrid(el, counts, order) {
    if (!el) return;
    const keys = (order || Object.keys(counts)).filter((k) => counts[k]);
    Object.keys(counts).forEach((k) => {
      if (!keys.includes(k)) keys.push(k);
    });
    el.innerHTML = keys
      .map((k) => {
        const rollable = k === 'perpetual_monthly' || k === 'membership_pass_monthly';
        return (
          '<button type="button" class="billing-card ' +
          (rollable ? 'rollable' : 'non-rollable') +
          '" data-k="' +
          esc(k) +
          '"><div class="bm-name">' +
          esc(k) +
          '</div><div class="bm-count">' +
          fmtNum(counts[k]) +
          '</div></button>'
        );
      })
      .join('');
  }

  function renderKpis(agg) {
    document.getElementById('scopeName').textContent = scopeLabel();
    document.getElementById('kSkus').textContent = fmtNum(agg.skus);
    document.getElementById('kSkusSub').textContent = state.hideRetail
      ? 'membership + prepaid (retail hidden)'
      : 'incl. merch/cafe';
    document.getElementById('kSites').textContent = fmtNum(agg.sites);
    document.getElementById('kSitesSub').textContent =
      fmtNum(meta.n_multi_billing_sites) + ' multi in full cut';
    document.getElementById('kMulti').textContent = fmtNum(agg.multi);
    document.getElementById('kAvgPrice').textContent =
      agg.avgPrice != null ? '$' + fmtDec(agg.avgPrice, agg.avgPrice < 20 ? 2 : 0) : '—';
    document.getElementById('kAvgPriceSub').textContent =
      fmtNum(agg.priceN) + ' priced SKUs · sticker not revenue';
    document.getElementById('kMonthly').textContent = fmtMoney(agg.estMonthly);
    document.getElementById('kMonthlySub').textContent = agg.monthlyN
      ? fmtNum(agg.monthlyN) +
        (state.publishedOnlyEst
          ? ' published enroll×price'
          : ' modeled+published enroll×price')
      : state.publishedOnlyEst
        ? 'no published enroll in scope (toggle off to include modeled)'
        : 'needs enrolled_or_sold';
    document.getElementById('kAnnual').textContent = fmtMoney(agg.estAnnual);
    document.getElementById('kEnroll').textContent = fmtNum(agg.enrollN);
    const kCat = document.getElementById('kCatalog');
    if (kCat) kCat.textContent = fmtNum(agg.catalogN);
    const kCl = document.getElementById('kClassline');
    if (kCl) kCl.textContent = fmtNum(agg.classlineN);
    const kClSub = document.getElementById('kClasslineSub');
    if (kClSub) {
      const e = agg.evidence || {};
      kClSub.textContent =
        fmtNum(e.class_line_modeled || 0) +
        ' modeled · ' +
        fmtNum(e.class_line_published || 0) +
        ' published · ' +
        fmtNum(e.class_line_schedule_only || 0) +
        ' schedule';
    }
    renderGrid(document.getElementById('billingGrid'), agg.billing, BILLING_ORDER);
    renderGrid(document.getElementById('typeGrid'), agg.types, null);

    document.querySelectorAll('#billingGrid [data-k]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.billing = btn.getAttribute('data-k') || '';
        state.shown = PAGE_SIZE;
        populateFilters();
        refresh();
      });
    });
  }

  function updatePager(shown, total) {
    const truncated = total > 0 && shown < total;
    const banner = document.getElementById('tableTruncationBanner');
    const bannerText = document.getElementById('tableTruncationText');
    const footer = document.getElementById('tableFooter');
    const showing = document.getElementById('tableShowing');
    const more = document.getElementById('loadMoreBtn');
    const all = document.getElementById('showAllBtn');
    const label = 'Showing ' + fmtNum(shown) + ' of ' + fmtNum(total);
    if (banner) {
      banner.hidden = !truncated;
      banner.classList.toggle('is-truncated', truncated);
      if (bannerText) bannerText.textContent = label + ' SKUs — use Load more or Show all';
    }
    if (footer) {
      footer.hidden = total === 0;
      footer.classList.toggle('is-truncated', truncated);
      if (showing) showing.textContent = label;
    }
    if (more) more.hidden = !truncated;
    if (all) all.hidden = !truncated;
  }

  let cached = [];

  function renderTable(sorted) {
    const body = document.getElementById('factsBody');
    const total = sorted.length;
    const limit = Number.isFinite(state.shown) ? state.shown : total;
    const slice = sorted.slice(0, Math.min(limit, total));
    document.getElementById('tableCount').textContent = '(' + fmtNum(total) + ')';
    document.querySelectorAll('.sort-btn').forEach((btn) => {
      const k = btn.getAttribute('data-sort');
      btn.setAttribute(
        'aria-sort',
        k === state.sortKey ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      );
    });
    updatePager(slice.length, total);
    if (!slice.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="12">No SKUs match the current filters.</td></tr>';
      return;
    }
    body.innerHTML = slice
      .map((p) => {
        const rev = productRev(p);
        const multi = isMultiSite(p.site_id);
        const billCls = p.revenue_rollable ? 'rollable' : 'non-rollable';
        const estCell =
          rev.monthly != null
            ? fmtMoney(rev.monthly)
            : rev.sticker != null
              ? '<span title="catalog sticker — not revenue">$' +
                fmtDec(rev.sticker, rev.sticker < 20 ? 2 : 0) +
                '<span class="partial-tag">sticker</span></span>'
              : '—';
        return (
          '<tr>' +
          '<td class="brand-cell">' +
          esc(p.brand) +
          '</td>' +
          '<td class="name-cell">' +
          esc(p.site_name) +
          (multi ? ' <span class="bill-pill rollable" title="≥2 billing models at this site">multi</span>' : '') +
          '</td>' +
          '<td>' +
          esc(p.metro || '—') +
          '</td>' +
          '<td class="program-cell">' +
          esc(p.sku_name) +
          '</td>' +
          '<td>' +
          esc(p.product_type_label || p.product_type_id) +
          '</td>' +
          '<td><span class="bill-pill ' +
          billCls +
          '">' +
          esc(p.billing_model) +
          '</span></td>' +
          '<td class="num">' +
          (p.price != null ? '$' + fmtDec(p.price, p.price < 20 ? 2 : 0) : '—') +
          '</td>' +
          '<td>' +
          esc(p.price_unit || '—') +
          '</td>' +
          '<td class="num">' +
          (p.term_months != null ? fmtDec(p.term_months, p.term_months % 1 ? 1 : 0) : '—') +
          '</td>' +
          '<td class="num">' +
          (p.enrolled_or_sold != null ? fmtNum(p.enrolled_or_sold) : '—') +
          '</td>' +
          '<td class="num rev-cell">' +
          estCell +
          '</td>' +
          '<td><span class="plat-pill">' +
          esc(p.evidence_tier) +
          '</span></td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function refresh() {
    const list = filtered();
    cached = sortRows(list);
    const agg = aggregate(list);
    renderChips();
    renderKpis(agg);
    renderTable(cached);
  }

  function clearAll() {
    state.brand = '';
    state.billing = '';
    state.type = '';
    state.metro = '';
    state.siteId = '';
    state.evidence = '';
    state.search = '';
    state.shown = PAGE_SIZE;
    document.getElementById('prodSearch').value = '';
    populateFilters();
    refresh();
  }

  document.getElementById('brandFilter').addEventListener('change', (e) => {
    state.brand = e.target.value;
    state.shown = PAGE_SIZE;
    populateFilters();
    refresh();
  });
  document.getElementById('billingFilter').addEventListener('change', (e) => {
    state.billing = e.target.value;
    state.shown = PAGE_SIZE;
    refresh();
  });
  document.getElementById('typeFilter').addEventListener('change', (e) => {
    state.type = e.target.value;
    state.shown = PAGE_SIZE;
    refresh();
  });
  document.getElementById('metroFilter').addEventListener('change', (e) => {
    state.metro = e.target.value;
    state.siteId = '';
    state.shown = PAGE_SIZE;
    populateFilters();
    refresh();
  });
  document.getElementById('siteFilter').addEventListener('change', (e) => {
    state.siteId = e.target.value;
    state.shown = PAGE_SIZE;
    refresh();
  });
  const evidenceFilter = document.getElementById('evidenceFilter');
  if (evidenceFilter) {
    evidenceFilter.addEventListener('change', (e) => {
      state.evidence = e.target.value;
      state.shown = PAGE_SIZE;
      refresh();
    });
  }
  document.getElementById('hideRetail').addEventListener('change', (e) => {
    state.hideRetail = !!e.target.checked;
    state.shown = PAGE_SIZE;
    populateFilters();
    refresh();
  });
  document.getElementById('multiOnly').addEventListener('change', (e) => {
    state.multiOnly = !!e.target.checked;
    state.shown = PAGE_SIZE;
    refresh();
  });
  const publishedOnlyEst = document.getElementById('publishedOnlyEst');
  if (publishedOnlyEst) {
    publishedOnlyEst.addEventListener('change', (e) => {
      state.publishedOnlyEst = !!e.target.checked;
      state.shown = PAGE_SIZE;
      refresh();
    });
  }
  document.getElementById('prodSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    state.shown = PAGE_SIZE;
    refresh();
  });
  document.getElementById('clearFilters').addEventListener('click', clearAll);
  document.getElementById('loadMoreBtn').addEventListener('click', () => {
    state.shown = (Number.isFinite(state.shown) ? state.shown : 0) + PAGE_SIZE;
    renderTable(cached);
  });
  document.getElementById('showAllBtn').addEventListener('click', () => {
    state.shown = Infinity;
    renderTable(cached);
  });
  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortKey = k;
        state.sortDir = ['brand', 'site', 'metro', 'sku', 'type', 'billing', 'unit', 'evidence'].includes(k)
          ? 'asc'
          : 'desc';
      }
      refresh();
    });
  });

  populateFilters();
  refresh();

  window.__PRODUCTS_DEBUG = { filtered, aggregate, productRev, meta, allProducts };
})();
