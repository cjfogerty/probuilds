(function () {
  'use strict';

  const DATA = window.MARKETINTEL_OVERRIDE || window.MARKETINTEL;
  if (!DATA || !DATA.snapshots || !DATA.snapshots.length) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:sans-serif;color:#c53030">Missing data/sites.js — rebuild with scripts/build_dashboard_data.py</p>';
    return;
  }

  const meta = DATA.meta || {};
  const brandsMeta = meta.brands || [];
  const snapshot = DATA.snapshots[DATA.snapshots.length - 1];
  const allSites = snapshot.sites || [];

  const fmt = new Intl.NumberFormat('en-US');
  const fmtPct = (n, d) => {
    if (d == null || d === 0 || n == null || isNaN(n)) return '—';
    return Math.round((100 * n) / d) + '%';
  };
  const fmtNum = (n) => (n == null || isNaN(n) ? '—' : fmt.format(Math.round(n)));
  const fmtDec = (n, digits) => {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  };
  const fmtMoney = (n) => {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + fmt.format(Math.round(n));
  };

  function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  /** Default visibility: hide closed + junk (same rules as hub/map). */
  function isVisible(s) {
    if (s.likely_closed) return false;
    if (s.is_junk) return false;
    return true;
  }

  function isUrbanAir(s) {
    if (s.brand_id === 1 || s.brand_id === '1') return true;
    if (/^urban air$/i.test(s.brand || '')) return true;
    if (s.revenue_eligible === false && /urban.?air|pass.?pricing/i.test(s.revenue_note || '')) return true;
    const bm = brandsMeta.find((b) => b.name === s.brand);
    return !!(bm && bm.revenue === false);
  }

  function brandNameOf(s) {
    return (s.brand || s.brand_name || '').trim() || 'Unknown';
  }

  /** Program = program || program_name || brand; fallback flagged when no program field. */
  function programOf(s) {
    const raw = (s.program || s.program_name || '').trim();
    if (raw) return { name: raw, fallback: false };
    return { name: brandNameOf(s), fallback: true };
  }

  function unitBucket(intervalOrSite) {
    let v = intervalOrSite;
    if (v && typeof v === 'object') {
      v = v.price_unit || v.billing_interval || '';
    }
    v = String(v || '').toLowerCase().trim();
    if (v === 'monthly' || v === 'per_month') return 'monthly';
    if (v === 'per_lesson' || v === 'per_class' || v === 'each' || v === 'per_visit') return 'lesson';
    if (v === 'per_session' || v === 'per_package') return 'lesson'; // term/session sticker — not monthly×12
    return 'unknown';
  }

  function unitLabel(bucket) {
    if (bucket === 'monthly') return 'monthly';
    if (bucket === 'lesson') return 'per_lesson / each';
    return 'unknown';
  }

  /**
   * Per-site revenue contribution.
   * Prefer est_* when present. Monthly billing → solid monthly/annual.
   * per_lesson/each: list×enrolled with unit label only — do NOT blind-annualize
   * (SESSION_INVENTORY: don't annualize per_lesson as monthly×12).
   * Urban Air: membership_pass — excluded from tuition $ paths.
   */
  function siteRev(s) {
    if (isUrbanAir(s)) {
      return {
        monthly: null,
        annual: null,
        strength: 'excluded',
        note: 'UA membership_pass — excluded',
      };
    }
    const enrolled = s.enrolled;
    const price = s.price_low;
    const bucket = unitBucket(s);

    if (s.est_monthly_rev != null && !isNaN(+s.est_monthly_rev)) {
      const monthly = +s.est_monthly_rev;
      const annual =
        s.est_annual_rev != null && !isNaN(+s.est_annual_rev)
          ? +s.est_annual_rev
          : bucket === 'monthly'
            ? monthly * 12
            : null;
      return {
        monthly,
        annual,
        strength: bucket === 'monthly' ? 'solid' : annual != null ? 'partial' : 'partial',
        note: bucket === 'monthly' ? 'est_monthly' : 'est_* (non-monthly — weak annual)',
      };
    }

    if (enrolled == null || price == null || isNaN(+enrolled) || isNaN(+price)) {
      return { monthly: null, annual: null, strength: 'none', note: 'missing enroll or price' };
    }

    const listX = (+enrolled) * (+price);
    if (bucket === 'monthly') {
      return {
        monthly: listX,
        annual: listX * 12,
        strength: 'solid',
        note: 'enrolled × price_low (monthly)',
      };
    }
    if (bucket === 'lesson') {
      const assumed = s.lessons_per_month_assumed;
      const lessons =
        assumed != null && !isNaN(+assumed) && +assumed > 0
          ? +assumed
          : s.n_classes != null && +s.n_classes > 0 && +s.n_classes <= 40
            ? +s.n_classes
            : null;
      if (lessons != null) {
        const m = listX * lessons;
        return {
          monthly: m,
          annual: m * 12,
          strength: 'partial',
          note: 'per_lesson × ' + lessons + ' lessons/mo assumed (weak annualize)',
        };
      }
      // Prefer list×enrolled with unit label — do NOT blind-annualize
      return {
        monthly: null,
        annual: null,
        listPartial: listX,
        strength: 'partial',
        note: 'per_lesson/each — list×enrolled only; not annualized',
      };
    }
    return {
      monthly: null,
      annual: null,
      strength: 'none',
      note: 'billing unit unknown — do not annualize',
    };
  }

  function sessionStatusForSites(list) {
    const n = list.length || 1;
    const captured = list.filter((s) => s.session_dates_status === 'captured' || (s.session_start && s.session_end)).length;
    const missing = list.filter((s) => s.session_dates_status === 'missing').length;
    const na = list.filter((s) => s.session_dates_status === 'not_applicable').length;
    if (captured === n) return 'CAPTURED';
    if (captured > 0) return 'PARTIAL';
    if (missing > 0 && na === 0) return 'MISSING';
    if (na === n) return 'N/A';
    if (missing > 0) return 'MISSING';
    return 'MISSING';
  }

  function sessionHint(list) {
    const captured = list.filter((s) => s.session_dates_status === 'captured');
    if (captured.length) {
      // JR dates inferred from OpeningsJS session names — not published calendars
      const jr = captured.some((s) => String(s.platform || '').toLowerCase() === 'jackrabbit');
      return jr ? 'inferred from session labels' : 'session window captured';
    }
    const pike = list.some((s) => String(s.platform || '').toLowerCase() === 'pike13');
    if (pike) return 'course dates not pulled';
    if (list.some(isUrbanAir)) return 'membership_pass (not class sessions)';
    if (list.every((s) => s.session_dates_status === 'not_applicable' || s.session_model === 'ongoing_tuition')) {
      return 'ongoing — session dates N/A';
    }
    return '';
  }

  function sessionCoverageCounts(list) {
    let cap = 0, miss = 0, na = 0;
    list.forEach((s) => {
      const st = s.session_dates_status;
      if (st === 'captured' || (s.session_start && s.session_end)) cap++;
      else if (st === 'not_applicable') na++;
      else miss++;
    });
    return { captured: cap, missing: miss, notApplicable: na };
  }

  // —— State ——
  const state = {
    mode: 'brand', // brand | program
    hideClosed: true,
    search: '',
    platform: '',
    sortKey: 'sites',
    sortDir: 'desc',
    selectedKey: null,
  };

  // —— Chips / pull week (observation window ≠ session dates) ——
  const weekFrom = snapshot.week_start || meta.week?.from || '—';
  const weekTo = snapshot.week_end || meta.week?.to || '—';
  const pullWeekLabel = weekFrom + ' → ' + weekTo;

  document.getElementById('asOfChip').innerHTML =
    'As of <strong>' + esc(snapshot.as_of || meta.as_of || '—') + '</strong>';
  document.getElementById('weekChip').innerHTML =
    'Pull week <strong>' + esc(weekFrom) + '</strong> → <strong>' + esc(weekTo) + '</strong>';
  document.getElementById('pullWeekRange').textContent = pullWeekLabel;
  document.getElementById('pullWeekInline').textContent = pullWeekLabel;

  // —— Helpers ——
  function filteredSites() {
    let list = state.hideClosed ? allSites.filter(isVisible) : allSites.slice();
    if (state.platform) {
      const p = state.platform.toLowerCase();
      list = list.filter((s) => String(s.platform || '').toLowerCase() === p);
    }
    return list;
  }

  function entityKey(s) {
    if (state.mode === 'program') return programOf(s).name;
    return brandNameOf(s);
  }

  function aggregate(list) {
    const sites = list.length;
    const metros = new Set(list.map((s) => (s.metro || '').trim()).filter(Boolean));
    let enrolledSum = 0;
    let enrollSites = 0; // enrolled != null (includes 0)
    let enrollPositive = 0; // enrolled > 0 for avg
    let enrollPositiveSum = 0;
    let priceSites = 0;
    let priceSum = 0;
    let priceCountExUA = 0;
    let priceSumExUA = 0;
    let monthly = 0;
    let annual = 0;
    let monthlySites = 0;
    let annualSites = 0;
    let partialList = 0;
    let partialSites = 0;
    const units = { monthly: 0, lesson: 0, unknown: 0 };
    const platforms = new Set();
    let fallbackCount = 0;
    let uaSites = 0;

    list.forEach((s) => {
      platforms.add(String(s.platform || 'unknown').toLowerCase());
      if (state.mode === 'program' && programOf(s).fallback) fallbackCount++;
      if (isUrbanAir(s)) uaSites++;

      const bucket = unitBucket(s);
      units[bucket]++;

      if (s.enrolled != null && !isNaN(+s.enrolled)) {
        enrollSites++;
        enrolledSum += +s.enrolled;
        if (+s.enrolled > 0) {
          enrollPositive++;
          enrollPositiveSum += +s.enrolled;
        }
      }
      if (s.price_low != null && !isNaN(+s.price_low)) {
        priceSites++;
        priceSum += +s.price_low;
        if (!isUrbanAir(s)) {
          priceCountExUA++;
          priceSumExUA += +s.price_low;
        }
      }

      const rev = siteRev(s);
      if (rev.monthly != null) {
        monthly += rev.monthly;
        monthlySites++;
      }
      if (rev.annual != null) {
        annual += rev.annual;
        annualSites++;
      }
      if (rev.listPartial != null) {
        partialList += rev.listPartial;
        partialSites++;
      }
    });

    const dominantUnit =
      units.monthly >= units.lesson && units.monthly >= units.unknown
        ? 'monthly'
        : units.lesson >= units.unknown
          ? 'lesson'
          : 'unknown';

    // Spec: avg enrollment = sum(enrolled) / sites_with_enroll (enrolled != null, includes 0)
    const avgEnroll = enrollSites > 0 ? enrolledSum / enrollSites : null;
    const avgPrice = priceCountExUA > 0 ? priceSumExUA / priceCountExUA : null;

    const out = {
      sites,
      metros: metros.size,
      metroList: [...metros].sort(),
      enrolled: enrolledSum,
      enrollSites,
      enrollPositive,
      enrollCov: sites ? enrollSites / sites : null,
      priceSites,
      priceCov: sites ? priceSites / sites : null,
      avgEnroll,
      avgPrice,
      avgPriceAll: priceSites ? priceSum / priceSites : null,
      units,
      dominantUnit,
      platforms: [...platforms].sort(),
      estMonthly: monthlySites ? monthly : null,
      estAnnual: annualSites ? annual : null,
      monthlySites,
      annualSites,
      partialList: partialSites ? partialList : null,
      partialSites,
      fallbackCount,
      uaSites,
      sessionStatus: sessionStatusForSites(list),
      sessionHint: sessionHint(list),
    };
    const cov = sessionCoverageCounts(list);
    out.sessCov = cov;
    out.sessStartCap = cov.captured;
    out.sessStartMiss = cov.missing;
    out.sessEndCap = cov.captured;
    out.sessEndMiss = cov.missing;
    out.sessNA = cov.notApplicable;
    return out;
  }

  function buildEntities(sites) {
    const map = new Map();
    sites.forEach((s) => {
      const key = entityKey(s);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    const rows = [];
    map.forEach((list, name) => {
      const agg = aggregate(list);
      const isFallback =
        state.mode === 'program' && list.every((s) => programOf(s).fallback);
      rows.push({
        key: name,
        name,
        list,
        ...agg,
        isFallback,
        brands: [...new Set(list.map(brandNameOf))],
      });
    });
    return rows;
  }

  function applySearch(rows) {
    const needle = state.search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      if (r.name.toLowerCase().includes(needle)) return true;
      if (r.platforms.some((p) => p.includes(needle))) return true;
      if (r.metroList.some((m) => m.toLowerCase().includes(needle))) return true;
      if (r.brands.some((b) => b.toLowerCase().includes(needle))) return true;
      return false;
    });
  }

  function sortRows(rows) {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const numKeys = new Set([
      'sites',
      'metros',
      'enrolled',
      'avgEnroll',
      'enrollCov',
      'priceCov',
      'avgPrice',
      'estMonthly',
      'estAnnual',
    ]);
    return rows.slice().sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (key === 'platforms') {
        av = (a.platforms || []).join(',');
        bv = (b.platforms || []).join(',');
      }
      if (key === 'dominantUnit') {
        av = unitLabel(a.dominantUnit);
        bv = unitLabel(b.dominantUnit);
      }
      if (key === 'sessionStatus') {
        av = a.sessionStatus + (a.sessionHint || '');
        bv = b.sessionStatus + (b.sessionHint || '');
      }
      if (numKeys.has(key)) {
        av = av == null || isNaN(av) ? -Infinity : +av;
        bv = bv == null || isNaN(bv) ? -Infinity : +bv;
        if (av === bv) return a.name.localeCompare(b.name);
        return (av - bv) * dir;
      }
      av = String(av ?? '');
      bv = String(bv ?? '');
      const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' });
      if (cmp === 0) return a.name.localeCompare(b.name);
      return cmp * dir;
    });
  }

  function mapHrefForEntity(row) {
    const q = new URLSearchParams();
    if (state.mode === 'brand') {
      q.set('brand', row.name);
    } else if (row.brands.length === 1) {
      q.set('brand', row.brands[0]);
    } else if (row.brands.length) {
      q.set('q', row.name);
    }
    const hash = q.toString();
    return 'map.html' + (hash ? '#' + hash : '');
  }

  // —— Render KPIs for scope (national or selected) ——
  function renderKpis(agg, scopeLabel) {
    document.getElementById('scopeName').textContent = scopeLabel;
    document.getElementById('kSites').textContent = fmtNum(agg.sites);
    document.getElementById('kSitesSub').textContent =
      (agg.uaSites ? agg.uaSites + ' UA pass sites · ' : '') +
      (state.hideClosed ? 'open / non-junk' : 'incl. closed/junk');
    document.getElementById('kMetros').textContent = fmtNum(agg.metros);
    document.getElementById('kEnrolled').textContent = fmtNum(agg.enrolled);
    document.getElementById('kEnrollSub').textContent =
      fmtNum(agg.enrollSites) + ' sites with enroll field';
    document.getElementById('kAvgEnroll').textContent =
      agg.avgEnroll != null ? fmtDec(agg.avgEnroll, 1) : '—';
    document.getElementById('kEnrollCov').textContent = fmtPct(agg.enrollSites, agg.sites);
    document.getElementById('kPriceCov').textContent = fmtPct(agg.priceSites, agg.sites);
    document.getElementById('kAvgPrice').textContent =
      agg.avgPrice != null ? '$' + fmtDec(agg.avgPrice, 0) : '—';
    document.getElementById('kAvgPriceUnit').textContent =
      (agg.dominantUnit === 'monthly'
        ? '$/mo'
        : agg.dominantUnit === 'lesson'
          ? '$/lesson'
          : 'unit unknown') + ' · excl. Urban Air';

    const monthlyEl = document.getElementById('kMonthly');
    const annualEl = document.getElementById('kAnnual');
    monthlyEl.textContent = fmtMoney(agg.estMonthly);
    annualEl.textContent = fmtMoney(agg.estAnnual);

    let monthlySub = 'from est_* / monthly rule';
    let annualSub = 'monthly × 12 when solid';
    if (agg.partialSites) {
      monthlySub +=
        ' · ' +
        agg.partialSites +
        ' per_lesson partial (not in $)';
    }
    if (agg.annualSites < agg.monthlySites) {
      annualSub = 'weak when non-monthly';
    }
    document.getElementById('kMonthlySub').textContent = monthlySub;
    document.getElementById('kAnnualSub').textContent = annualSub;

    // Session strip for scope — CAPTURED / MISSING / N/A
    document.getElementById('sessStartCap').textContent = String(agg.sessStartCap);
    document.getElementById('sessStartMiss').textContent = fmtNum(agg.sessStartMiss);
    document.getElementById('sessEndCap').textContent = String(agg.sessEndCap);
    document.getElementById('sessEndMiss').textContent = fmtNum(agg.sessEndMiss);
    const na1 = document.getElementById('sessStartNA');
    const na2 = document.getElementById('sessEndNA');
    if (na1) na1.textContent = fmtNum(agg.sessNA);
    if (na2) na2.textContent = fmtNum(agg.sessNA);
    const startBlock = document.getElementById('sessStartBlock');
    const endBlock = document.getElementById('sessEndBlock');
    if (startBlock) {
      startBlock.classList.toggle('has-capture', (agg.sessStartCap || 0) > 0);
      startBlock.classList.toggle('missing', (agg.sessStartMiss || 0) > 0);
    }
    if (endBlock) {
      endBlock.classList.toggle('has-capture', (agg.sessEndCap || 0) > 0);
      endBlock.classList.toggle('missing', (agg.sessEndMiss || 0) > 0);
    }
    const gapChip = document.getElementById('sessionGapChip');
    if (gapChip) {
      gapChip.innerHTML =
        'Sessions: <strong>' +
        (agg.sessStartCap || 0) +
        '</strong> captured · ' +
        fmtNum(agg.sessStartMiss) +
        ' missing · ' +
        fmtNum(agg.sessNA) +
        ' n/a';
      gapChip.className =
        (agg.sessStartMiss || 0) > 0 || (agg.sessStartCap || 0) === 0 ? 'chip warn-soft' : 'chip';
    }
    const warn = document.getElementById('sessionWarn');
    if (warn) {
      const thin = !agg.sites || (agg.sessStartCap || 0) / agg.sites < 0.25;
      warn.hidden = !(thin || (agg.sessStartMiss || 0) > 0);
    }
  }

  function renderUnitPanel(agg) {
    const grid = document.getElementById('unitGrid');
    grid.innerHTML =
      '<div class="unit-cell monthly"><div class="uc-count">' +
      fmtNum(agg.units.monthly) +
      '</div><div class="uc-label">monthly ($/mo)</div></div>' +
      '<div class="unit-cell lesson"><div class="uc-count">' +
      fmtNum(agg.units.lesson) +
      '</div><div class="uc-label">per_lesson / each</div></div>' +
      '<div class="unit-cell unknown"><div class="uc-count">' +
      fmtNum(agg.units.unknown) +
      '</div><div class="uc-label">null / unknown</div></div>';
  }

  function renderUnitMixChart(agg) {
    const el = document.getElementById('unitMixChart');
    const total = agg.sites || 1;
    const parts = [
      { key: 'monthly', label: 'monthly', n: agg.units.monthly, color: '#48bb78' },
      { key: 'lesson', label: 'per_lesson / each', n: agg.units.lesson, color: '#4299e1' },
      { key: 'unknown', label: 'unknown', n: agg.units.unknown, color: '#ed8936' },
    ];
    const r = 54;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = parts
      .filter((p) => p.n > 0)
      .map((p) => {
        const len = (p.n / total) * c;
        const arc =
          '<circle cx="70" cy="70" r="' +
          r +
          '" fill="none" stroke="' +
          p.color +
          '" stroke-width="18" stroke-dasharray="' +
          len +
          ' ' +
          (c - len) +
          '" stroke-dashoffset="' +
          -offset +
          '" />';
        offset += len;
        return arc;
      })
      .join('');

    el.innerHTML =
      '<div class="donut-wrap">' +
      '<svg viewBox="0 0 140 140" aria-hidden="true">' +
      '<circle cx="70" cy="70" r="' +
      r +
      '" fill="none" stroke="#edf2f7" stroke-width="18" />' +
      arcs +
      '</svg>' +
      '<div class="donut-center"><div class="dn">' +
      fmtNum(agg.sites) +
      '</div><div class="dl">sites</div></div>' +
      '</div>' +
      '<div class="mix-legend">' +
      parts
        .map(
          (p) =>
            '<div class="ml-row"><span class="mix-swatch" style="background:' +
            p.color +
            '"></span><span>' +
            esc(p.label) +
            '</span><span class="ml-n">' +
            fmtNum(p.n) +
            '</span></div>'
        )
        .join('') +
      '</div>';
  }

  function renderBarChart(rows) {
    const el = document.getElementById('enrollBars');
    document.getElementById('chartModeLabel').textContent =
      state.mode === 'brand' ? '(brands)' : '(programs)';
    const top = rows
      .slice()
      .sort((a, b) => (b.enrolled || 0) - (a.enrolled || 0) || b.sites - a.sites)
      .slice(0, 12);
    if (!top.length) {
      el.innerHTML = '<div class="empty-row" style="padding:20px;color:var(--soft)">No entities to chart.</div>';
      return;
    }
    const max = Math.max(...top.map((r) => r.enrolled || 0), 1);
    el.innerHTML = top
      .map((r) => {
        const pct = Math.max(2, Math.round((100 * (r.enrolled || 0)) / max));
        const color =
          brandsMeta.find((b) => b.name === r.name || (r.brands && r.brands[0] === b.name))
            ?.color || 'var(--accent)';
        return (
          '<div class="bar-row" data-key="' +
          esc(r.key) +
          '" title="' +
          esc(r.name) +
          '">' +
          '<div class="bar-name">' +
          esc(r.name) +
          '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' +
          pct +
          '%;background:' +
          color +
          '"></div></div>' +
          '<div class="bar-val">' +
          fmtNum(r.enrolled) +
          '</div></div>'
        );
      })
      .join('');

    el.querySelectorAll('.bar-row').forEach((row) => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => selectEntity(row.getAttribute('data-key')));
    });
  }

  function platPills(platforms) {
    return (
      '<div class="plat-pills">' +
      platforms
        .map((p) => '<span class="plat-pill">' + esc(p) + '</span>')
        .join('') +
      '</div>'
    );
  }

  function sessionCell(row) {
    const st = row.sessionStatus || 'MISSING';
    const cls =
      st === 'CAPTURED' ? 'ok' :
      st === 'PARTIAL' ? 'partial' :
      st === 'N/A' ? 'na' : 'miss';
    let title = 'session_dates_status mix';
    if (row.sessionHint && row.sessionHint.indexOf('inferred') >= 0) title = 'Inferred from JR session names — not published calendars';
    let html = '<span class="sess-status ' + cls + '" title="' + esc(title) + '">' + esc(st) + '</span>';
    if (row.sessionHint) {
      html +=
        '<div style="font-size:0.65rem;color:var(--soft);margin-top:3px;max-width:130px;line-height:1.25">' +
        esc(row.sessionHint) +
        '</div>';
    }
    return html;
  }

  function renderTable(rows) {
    const body = document.getElementById('factsBody');
    const label = state.mode === 'brand' ? 'Brands' : 'Programs';
    document.getElementById('tableSectionTitle').childNodes[0].textContent = label + ' ';
    document.getElementById('tableCount').textContent = '(' + rows.length + ')';
    document.getElementById('entityCountChip').innerHTML =
      '<strong>' + rows.length + '</strong> ' + (state.mode === 'brand' ? 'brands' : 'programs');

    document.querySelectorAll('.sort-btn').forEach((btn) => {
      const k = btn.getAttribute('data-sort');
      if (k === state.sortKey) {
        btn.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      } else {
        btn.setAttribute('aria-sort', 'none');
      }
    });

    if (!rows.length) {
      body.innerHTML =
        '<tr class="empty-row"><td colspan="13">No ' +
        esc(label.toLowerCase()) +
        ' match the current filters.</td></tr>';
      return;
    }

    body.innerHTML = rows
      .map((r) => {
        const selected = state.selectedKey === r.key ? ' selected' : '';
        const fb = r.isFallback
          ? '<span class="fallback-badge" title="No program field — using brand">brand fallback</span>'
          : '';
        const unitBadge =
          '<span class="ubadge ' +
          r.dominantUnit +
          '">' +
          esc(unitLabel(r.dominantUnit)) +
          '</span>';
        const monthlyCell =
          r.estMonthly != null
            ? fmtMoney(r.estMonthly)
            : r.partialList != null
              ? '<span title="list×enrolled; not monthly">' +
                fmtMoney(r.partialList) +
                '<span class="partial-tag">partial</span></span>'
              : '—';
        const annualCell =
          r.estAnnual != null
            ? fmtMoney(r.estAnnual)
            : r.dominantUnit !== 'monthly' && r.partialList != null
              ? '<span class="partial-tag" title="Do not blind-annualize per_lesson">weak</span>'
              : '—';

        return (
          '<tr tabindex="0" data-key="' +
          esc(r.key) +
          '" class="' +
          selected.trim() +
          '">' +
          '<td class="name-cell">' +
          esc(r.name) +
          fb +
          '</td>' +
          '<td>' +
          platPills(r.platforms) +
          '</td>' +
          '<td class="num">' +
          fmtNum(r.sites) +
          '</td>' +
          '<td class="num">' +
          fmtNum(r.metros) +
          '</td>' +
          '<td class="num">' +
          fmtNum(r.enrolled) +
          '</td>' +
          '<td class="num">' +
          (r.avgEnroll != null ? fmtDec(r.avgEnroll, 1) : '—') +
          '</td>' +
          '<td class="num">' +
          fmtPct(r.enrollSites, r.sites) +
          '</td>' +
          '<td class="num">' +
          fmtPct(r.priceSites, r.sites) +
          '</td>' +
          '<td>' +
          unitBadge +
          '</td>' +
          '<td class="num">' +
          (r.avgPrice != null ? '$' + fmtDec(r.avgPrice, 0) : '—') +
          '</td>' +
          '<td class="num rev-cell">' +
          monthlyCell +
          '</td>' +
          '<td class="num rev-cell">' +
          annualCell +
          '</td>' +
          '<td>' +
          sessionCell(r) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    body.querySelectorAll('tr[data-key]').forEach((tr) => {
      const activate = () => selectEntity(tr.getAttribute('data-key'));
      tr.addEventListener('click', activate);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  function renderDetail(row) {
    const panel = document.getElementById('detailPanel');
    const clearBtn = document.getElementById('clearSelection');
    if (!row) {
      panel.hidden = true;
      clearBtn.hidden = true;
      document.getElementById('detailMapLink').href = 'map.html';
      return;
    }
    panel.hidden = false;
    clearBtn.hidden = false;
    document.getElementById('detailKicker').textContent =
      state.mode === 'brand' ? 'Brand' : 'Program';
    document.getElementById('detailName').innerHTML =
      esc(row.name) +
      (row.isFallback
        ? '<span class="fallback-badge">brand fallback</span>'
        : '');
    document.getElementById('detailMeta').innerHTML =
      platPills(row.platforms) +
      (row.sessionHint
        ? '<span class="plat-pill" style="background:#fff5f5;color:#c53030">' +
          esc(row.sessionHint) +
          '</span>'
        : '') +
      (row.uaSites
        ? '<span class="plat-pill" title="Urban Air jump-pass">membership_pass</span>'
        : '');

    document.getElementById('detailMapLink').href = mapHrefForEntity(row);

    const body = document.getElementById('detailBody');
    const stats = [
      { l: 'Sites', v: fmtNum(row.sites), s: row.uaSites ? row.uaSites + ' UA excluded from $' : '' },
      { l: 'Metros', v: fmtNum(row.metros), s: row.metroList.slice(0, 4).join(', ') + (row.metroList.length > 4 ? '…' : '') },
      { l: 'Total enrolled', v: fmtNum(row.enrolled), s: fmtPct(row.enrollSites, row.sites) + ' coverage' },
      { l: 'Avg enrolled / site', v: row.avgEnroll != null ? fmtDec(row.avgEnroll, 1) : '—', s: 'sum(enrolled) / sites with enroll' },
      { l: 'Avg price (excl UA)', v: row.avgPrice != null ? '$' + fmtDec(row.avgPrice, 0) : '—', s: fmtPct(row.priceSites, row.sites) + ' price coverage' },
      { l: 'Dominant unit', v: unitLabel(row.dominantUnit), s: row.units.monthly + ' mo · ' + row.units.lesson + ' lesson · ' + row.units.unknown + ' unk' },
      {
        l: 'Est. monthly',
        v: fmtMoney(row.estMonthly),
        s: row.partialSites
          ? row.partialSites + ' per_lesson sites not annualized'
          : 'tuition brands only',
        rev: true,
      },
      {
        l: 'Est. annualized',
        v: fmtMoney(row.estAnnual),
        s: row.estAnnual == null ? 'weak / — when non-monthly' : 'monthly × 12 when solid',
        rev: true,
      },
      {
        l: 'Session dates',
        v: row.sessionStatus,
        s:
          'CAPTURED ' +
          (row.sessCov ? row.sessCov.captured : 0) +
          ' / MISSING ' +
          (row.sessCov ? row.sessCov.missing : 0) +
          ' / N/A ' +
          (row.sessCov ? row.sessCov.notApplicable : 0) +
          (row.sessionHint ? ' — ' + row.sessionHint : ''),
      },
    ];
    if (state.mode === 'program' && row.brands.length) {
      stats.push({
        l: 'Brand(s)',
        v: row.brands.slice(0, 3).join(', ') + (row.brands.length > 3 ? '…' : ''),
        s: row.brands.length + ' brand name(s)',
      });
    }

    body.innerHTML = stats
      .map(
        (st) =>
          '<div class="detail-stat"><div class="ds-l">' +
          esc(st.l) +
          '</div><div class="ds-v' +
          (st.rev ? ' rev' : '') +
          '">' +
          st.v +
          '</div>' +
          (st.s ? '<div class="ds-s">' + esc(st.s) + '</div>' : '') +
          '</div>'
      )
      .join('');
  }

  let cachedRows = [];

  function selectEntity(key) {
    state.selectedKey = key;
    if (state.mode === 'brand' && key) {
      try {
        history.replaceState(null, '', '#brand=' + encodeURIComponent(key));
      } catch (_) {}
    } else if (state.mode === 'program' && key) {
      try {
        history.replaceState(null, '', '#program=' + encodeURIComponent(key));
      } catch (_) {}
    }
    refresh(false);
  }

  function clearSelection() {
    state.selectedKey = null;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (_) {}
    refresh(false);
  }

  function populatePlatformFilter(sites) {
    const sel = document.getElementById('platformFilter');
    const current = state.platform;
    const plats = [...new Set(sites.map((s) => String(s.platform || '').toLowerCase()).filter(Boolean))].sort();
    sel.innerHTML =
      '<option value="">All platforms</option>' +
      plats.map((p) => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('');
    sel.value = current;
  }

  function refresh(rebuildPlatforms) {
    const sites = filteredSites();
    if (rebuildPlatforms !== false) {
      // Rebuild from all (respecting hideClosed only) so filter options stay stable
      const base = state.hideClosed ? allSites.filter(isVisible) : allSites;
      populatePlatformFilter(base);
    }

    let rows = buildEntities(sites);
    rows = applySearch(rows);
    rows = sortRows(rows);
    cachedRows = rows;

    const scopeSites = state.selectedKey
      ? sites.filter((s) => entityKey(s) === state.selectedKey)
      : sites;
    const scopeAgg = aggregate(scopeSites);
    const scopeLabel = state.selectedKey
      ? (state.mode === 'brand' ? 'Brand: ' : 'Program: ') + state.selectedKey
      : 'National (all visible)';

    renderKpis(scopeAgg, scopeLabel);
    renderUnitPanel(scopeAgg);
    renderUnitMixChart(scopeAgg);
    renderBarChart(rows);
    renderTable(rows);

    const selectedRow = state.selectedKey
      ? rows.find((r) => r.key === state.selectedKey) ||
        // selected may be filtered out of search — still show from full entity build
        buildEntities(sites).find((r) => r.key === state.selectedKey)
      : null;
    renderDetail(selectedRow || null);

    // If selection filtered away entirely from base sites
    if (state.selectedKey && !selectedRow) {
      const fromAll = buildEntities(
        (state.hideClosed ? allSites.filter(isVisible) : allSites).filter(
          (s) => !state.platform || String(s.platform || '').toLowerCase() === state.platform
        )
      ).find((r) => r.key === state.selectedKey);
      if (fromAll) renderDetail(fromAll);
    }
  }

  // —— Events ——
  document.getElementById('modeBrand').addEventListener('click', () => {
    if (state.mode === 'brand') return;
    state.mode = 'brand';
    state.selectedKey = null;
    document.getElementById('modeBrand').classList.add('active');
    document.getElementById('modeBrand').setAttribute('aria-pressed', 'true');
    document.getElementById('modeProgram').classList.remove('active');
    document.getElementById('modeProgram').setAttribute('aria-pressed', 'false');
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (_) {}
    refresh();
  });
  document.getElementById('modeProgram').addEventListener('click', () => {
    if (state.mode === 'program') return;
    state.mode = 'program';
    state.selectedKey = null;
    document.getElementById('modeProgram').classList.add('active');
    document.getElementById('modeProgram').setAttribute('aria-pressed', 'true');
    document.getElementById('modeBrand').classList.remove('active');
    document.getElementById('modeBrand').setAttribute('aria-pressed', 'false');
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (_) {}
    refresh();
  });

  document.getElementById('progSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    refresh(false);
  });
  document.getElementById('platformFilter').addEventListener('change', (e) => {
    state.platform = e.target.value;
    refresh(false);
  });
  document.getElementById('hideClosed').addEventListener('change', (e) => {
    state.hideClosed = !!e.target.checked;
    refresh();
  });
  document.getElementById('clearSelection').addEventListener('click', clearSelection);
  document.getElementById('detailClose').addEventListener('click', clearSelection);

  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-sort');
      if (state.sortKey === k) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = k;
        state.sortDir = k === 'name' || k === 'platforms' || k === 'dominantUnit' || k === 'sessionStatus'
          ? 'asc'
          : 'desc';
      }
      refresh(false);
    });
  });

  // Hash: #brand=Name or #program=Name
  function applyHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw.includes('=') ? raw : 'brand=' + raw);
    const brand = params.get('brand');
    const program = params.get('program');
    if (brand) {
      state.mode = 'brand';
      state.selectedKey = brand;
      document.getElementById('modeBrand').classList.add('active');
      document.getElementById('modeBrand').setAttribute('aria-pressed', 'true');
      document.getElementById('modeProgram').classList.remove('active');
      document.getElementById('modeProgram').setAttribute('aria-pressed', 'false');
    } else if (program) {
      state.mode = 'program';
      state.selectedKey = program;
      document.getElementById('modeProgram').classList.add('active');
      document.getElementById('modeProgram').setAttribute('aria-pressed', 'true');
      document.getElementById('modeBrand').classList.remove('active');
      document.getElementById('modeBrand').setAttribute('aria-pressed', 'false');
    }
  }

  window.addEventListener('hashchange', () => {
    applyHash();
    refresh(false);
  });

  applyHash();
  refresh();

  console.info(
    '[MarketIntel programs] sites',
    allSites.length,
    'visible',
    allSites.filter(isVisible).length,
    'mode',
    state.mode
  );
})();
