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

  const PAGE_SIZE = 200;
  const CATEGORY_ORDER = [
    'gymnastics',
    'ninja',
    'martial_arts',
    'cheer_dance',
    'adventure_park',
    'stem_makers',
    'other',
  ];

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

  function isVisible(s) {
    if (s.likely_closed) return false;
    if (s.is_junk) return false;
    return true;
  }

  const BILLING_MODEL_ORDER = [
    'perpetual_monthly',
    'membership_pass_monthly',
    'prepaid_term_membership',
    'term_session',
    'one_off_per_lesson',
    'one_off_package',
    'unknown',
  ];

  function billingModelOf(s) {
    const v = String(s.billing_model || '').trim();
    if (v) return v;
    if (s.brand_id === 1 || s.brand_id === '1' || /^urban air$/i.test(s.brand || '')) {
      return 'membership_pass_monthly';
    }
    return 'unknown';
  }

  function revenueUnitOf(s) {
    return String(s.revenue_unit || '').trim() || 'unknown';
  }

  function isRollable(s) {
    if (s.revenue_rollable === true || s.revenue_rollable === 'true') return true;
    if (s.revenue_rollable === false || s.revenue_rollable === 'false') return false;
    // legacy fallback: monthly tuition non-UA
    return s.revenue_eligible === true && !isUrbanAir(s);
  }

  function isTuitionUnit(s) {
    const u = revenueUnitOf(s);
    return u === 'per_enrollee_month' || u === 'per_enrollee_term';
  }

  function isPassUnit(s) {
    const u = revenueUnitOf(s);
    return u === 'per_member_month' || u === 'per_member_term' || billingModelOf(s) === 'membership_pass_monthly';
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

  function programOf(s) {
    const raw = (s.program_name || s.program || '').trim();
    if (raw) return { name: raw, fallback: false };
    return { name: brandNameOf(s), fallback: true };
  }

  function normalizeCategory(raw) {
    const v = String(raw || '')
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, '_');
    if (!v) return '';
    if (v === 'adventure' || v === 'adventurepark') return 'adventure_park';
    if (v === 'stem' || v === 'stem_maker' || v === 'stemmakers') return 'stem_makers';
    if (v === 'cheer' || v === 'dance' || v === 'cheer/dance') return 'cheer_dance';
    if (v === 'martial' || v === 'martialarts') return 'martial_arts';
    if (CATEGORY_ORDER.includes(v)) return v;
    return v;
  }

  /** Prefer site.category; else derive from brand/program/name/session keywords (spec order). */
  function categoryOf(s) {
    const fromSite = normalizeCategory(s.category);
    if (fromSite && CATEGORY_ORDER.includes(fromSite)) return fromSite;

    const hay = [s.brand, s.program_name, s.program, s.name, s.session_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (/ninja|parkour|warrior/.test(hay)) return 'ninja';
    if (/martial|bjj|tkd|mma|combat|karate/.test(hay)) return 'martial_arts';
    if (/cheer|dance|tumbl/.test(hay)) return 'cheer_dance';
    if (/urban air|trampoline park/.test(hay)) return 'adventure_park';
    if (/snapology/.test(hay)) return 'stem_makers';
    if (
      /gymnast|little gym|gold medal|dawes|gyminny|tumbles|head over heels|flip|apex/.test(hay)
    ) {
      return 'gymnastics';
    }
    return 'other';
  }

  function unitBucket(intervalOrSite) {
    let v = intervalOrSite;
    if (v && typeof v === 'object') {
      v = v.price_unit || v.billing_interval || '';
    }
    v = String(v || '')
      .toLowerCase()
      .trim();
    if (v === 'monthly' || v === 'per_month') return 'monthly';
    if (v === 'per_lesson' || v === 'per_class' || v === 'each' || v === 'per_visit') return 'lesson';
    if (v === 'per_session' || v === 'per_package') return 'lesson';
    return 'unknown';
  }

  function unitLabel(bucket) {
    if (bucket === 'monthly') return 'monthly';
    if (bucket === 'lesson') return 'per_lesson / each';
    return 'unknown';
  }

  function siteRev(s) {
    const enrolled = s.enrolled;
    const price =
      s.price_monthly_equiv != null && !isNaN(+s.price_monthly_equiv)
        ? +s.price_monthly_equiv
        : s.price_low;
    const bucket = unitBucket(s);
    const model = billingModelOf(s);
    const unit = revenueUnitOf(s);
    const rollable = isRollable(s);

    if (!rollable) {
      return {
        monthly: null,
        annual: null,
        passMonthly: null,
        strength: 'non_rollable',
        note: model + ' · not revenue_rollable',
        rollable: false,
        tuition: false,
        pass: isPassUnit(s),
      };
    }

    let monthly = null;
    let annual = null;
    if (s.est_monthly_rev != null && !isNaN(+s.est_monthly_rev)) {
      monthly = +s.est_monthly_rev;
      annual =
        s.est_annual_rev != null && !isNaN(+s.est_annual_rev)
          ? +s.est_annual_rev
          : monthly * 12;
    } else if (
      enrolled != null &&
      price != null &&
      !isNaN(+enrolled) &&
      !isNaN(+price) &&
      +enrolled > 0
    ) {
      monthly = +enrolled * +price;
      annual = monthly * 12;
    }

    const tuition = isTuitionUnit(s);
    const pass = isPassUnit(s);

    // Gate Est monthly/annual dollars: tuition units go to tuition KPIs; pass units stay separate
    if (tuition && monthly != null) {
      return {
        monthly,
        annual,
        passMonthly: null,
        tuitionSticker: null,
        passSticker: null,
        strength: 'solid',
        note: 'rollable tuition · ' + model,
        rollable: true,
        tuition: true,
        pass: false,
      };
    }
    if (tuition) {
      const sticker =
        s.price_monthly_equiv != null && !isNaN(+s.price_monthly_equiv)
          ? +s.price_monthly_equiv
          : s.price_low != null && !isNaN(+s.price_low)
            ? +s.price_low
            : null;
      return {
        monthly: null,
        annual: null,
        passMonthly: null,
        tuitionSticker: sticker,
        passSticker: null,
        strength: sticker != null ? 'tuition_sticker' : 'tuition_empty',
        note:
          sticker != null
            ? 'tuition sticker · ' + (s.evidence_tier || 'price_only') + ' (no enroll — not revenue)'
            : 'tuition · missing price',
        rollable: !!rollable,
        tuition: true,
        pass: false,
      };
    }
    if (pass && monthly != null) {
      return {
        monthly: null,
        annual: null,
        passMonthly: monthly,
        passSticker: null,
        strength: 'pass',
        note: 'rollable pass · enroll×price',
        rollable: true,
        tuition: false,
        pass: true,
      };
    }
    if (pass) {
      const sticker =
        s.price_monthly_equiv != null && !isNaN(+s.price_monthly_equiv)
          ? +s.price_monthly_equiv
          : s.price_low != null && !isNaN(+s.price_low)
            ? +s.price_low
            : null;
      return {
        monthly: null,
        annual: null,
        passMonthly: null,
        passSticker: sticker,
        strength: sticker != null ? 'pass_sticker' : 'pass_empty',
        note: sticker != null ? 'pass sticker (no enroll — not revenue)' : 'pass · missing price',
        rollable: true,
        tuition: false,
        pass: true,
      };
    }
    // Rollable but unknown/other unit — show price_monthly_equiv as display only, do not roll into tuition
    return {
      monthly: null,
      annual: null,
      passMonthly: null,
      strength: 'display_only',
      note: 'rollable but unit ' + unit + ' not in tuition KPI',
      rollable: true,
      tuition: false,
      pass: false,
      listPartial: monthly,
    };
  }

  function sessionStatusForSite(s) {
    const st = s.session_dates_status;
    if (st === 'captured' || (s.session_start && s.session_end)) return 'CAPTURED';
    if (st === 'not_applicable') return 'N/A';
    if (st === 'missing') return 'MISSING';
    if (s.session_start || s.session_end) return 'PARTIAL';
    return 'MISSING';
  }

  function sessionHintForSite(s) {
    const st = sessionStatusForSite(s);
    if (st === 'CAPTURED') {
      const jr = String(s.platform || '').toLowerCase() === 'jackrabbit';
      return jr ? 'inferred from session labels' : 'session window captured';
    }
    if (st === 'N/A') {
      if (isUrbanAir(s)) return 'membership_pass (not class sessions)';
      if (s.session_model === 'ongoing_tuition') return 'ongoing — session dates N/A';
      return 'not applicable';
    }
    if (String(s.platform || '').toLowerCase() === 'pike13') return 'course dates not pulled';
    return '';
  }

  function sessionCoverageCounts(list) {
    let cap = 0,
      miss = 0,
      na = 0;
    list.forEach((s) => {
      const st = s.session_dates_status;
      if (st === 'captured' || (s.session_start && s.session_end)) cap++;
      else if (st === 'not_applicable') na++;
      else miss++;
    });
    return { captured: cap, missing: miss, notApplicable: na };
  }

  function fillPctOf(s) {
    if (s.fill_pct != null && !isNaN(+s.fill_pct)) return +s.fill_pct;
    if (s.enrolled != null && s.capacity != null && +s.capacity > 0 && !isNaN(+s.enrolled)) {
      return (100 * +s.enrolled) / +s.capacity;
    }
    return null;
  }

  function siteId(s) {
    return String(s.id || s.program_id || s.slug || brandNameOf(s) + '|' + (s.name || '') + '|' + (s.zip || ''));
  }

  function mapHrefForSite(s) {
    const q = new URLSearchParams();
    if (s.lat != null && s.lng != null && !isNaN(+s.lat) && !isNaN(+s.lng)) {
      q.set('lat', String(s.lat));
      q.set('lng', String(s.lng));
    } else if (brandNameOf(s) !== 'Unknown') {
      q.set('brand', brandNameOf(s));
    } else if ((s.metro || '').trim()) {
      q.set('metro', (s.metro || '').trim());
    }
    const hash = q.toString();
    return 'map.html' + (hash ? '#' + hash : '');
  }

  // —— State ——
  const state = {
    category: '',
    brands: new Set(),
    program: '',
    metro: '',
    billingModel: '',
    platform: '',
    hideClosed: true,
    search: '',
    summaryBy: 'brand', // brand | category | program
    sortKey: 'name',
    sortDir: 'asc',
    selectedId: null,
    shown: PAGE_SIZE,
    suppressHash: false,
  };

  // —— Chips / pull week ——
  const weekFrom = snapshot.week_start || meta.week?.from || '—';
  const weekTo = snapshot.week_end || meta.week?.to || '—';
  const pullWeekLabel = weekFrom + ' → ' + weekTo;

  document.getElementById('asOfChip').innerHTML =
    'As of <strong>' + esc(snapshot.as_of || meta.as_of || '—') + '</strong>';
  document.getElementById('weekChip').innerHTML =
    'Schedule week <strong>' +
    esc(weekFrom) +
    '</strong> → <strong>' +
    esc(weekTo) +
    '</strong> <span class="chip-sub">(pulled ' +
    esc(snapshot.as_of || meta.as_of || meta.generated || '—') +
    ')</span>';
  document.getElementById('pullWeekRange').textContent = pullWeekLabel;
  document.getElementById('pullWeekInline').textContent = pullWeekLabel;

  function baseSites() {
    return state.hideClosed ? allSites.filter(isVisible) : allSites.slice();
  }

  /** Sites after all intersecting filters (before table pagination). */
  function filteredSites() {
    let list = baseSites();

    if (state.category) {
      const cat = normalizeCategory(state.category);
      list = list.filter((s) => categoryOf(s) === cat);
    }
    if (state.brands.size) {
      list = list.filter((s) => state.brands.has(brandNameOf(s)));
    }
    if (state.program) {
      list = list.filter((s) => programOf(s).name === state.program);
    }
    if (state.metro) {
      list = list.filter((s) => (s.metro || '').trim() === state.metro);
    }
    if (state.billingModel) {
      list = list.filter((s) => billingModelOf(s) === state.billingModel);
    }
    if (state.platform) {
      const p = state.platform.toLowerCase();
      list = list.filter((s) => String(s.platform || '').toLowerCase() === p);
    }
    const needle = state.search.trim().toLowerCase();
    if (needle) {
      list = list.filter((s) => {
        const hay = [
          s.name,
          s.city,
          s.zip,
          s.state,
          s.metro,
          brandNameOf(s),
          programOf(s).name,
          categoryOf(s),
          billingModelOf(s),
          revenueUnitOf(s),
          s.platform,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(needle);
      });
    }
    return list;
  }

  function aggregate(list) {
    const sites = list.length;
    const metros = new Set(list.map((s) => (s.metro || '').trim()).filter(Boolean));
    let enrolledSum = 0;
    let enrollPositiveSum = 0;
    let enrollSites = 0;
    let enrollZeroSites = 0;
    let priceSites = 0;
    let priceSumTuition = 0;
    let priceCountTuition = 0;
    let monthly = 0;
    let annual = 0;
    let monthlySites = 0;
    let annualSites = 0;
    let passMonthly = 0;
    let passSites = 0;
    let passStickerSum = 0;
    let passStickerSites = 0;
    let tuitionStickerSum = 0;
    let tuitionStickerSites = 0;
    let partialList = 0;
    let partialSites = 0;
    let rollableSites = 0;
    let nonRollableSites = 0;
    const units = { monthly: 0, lesson: 0, unknown: 0 };
    const billingCounts = {};
    BILLING_MODEL_ORDER.forEach((k) => { billingCounts[k] = 0; });
    let uaSites = 0;

    list.forEach((s) => {
      if (isUrbanAir(s) || billingModelOf(s) === 'membership_pass_monthly') uaSites++;
      const bucket = unitBucket(s);
      units[bucket] = (units[bucket] || 0) + 1;
      const bm = billingModelOf(s);
      billingCounts[bm] = (billingCounts[bm] || 0) + 1;

      if (isRollable(s)) rollableSites++;
      else nonRollableSites++;

      if (s.enrolled != null && !isNaN(+s.enrolled)) {
        enrolledSum += +s.enrolled;
        if (+s.enrolled > 0) {
          enrollSites++;
          enrollPositiveSum += +s.enrolled;
        } else {
          enrollZeroSites++;
        }
      }
      if (s.price_low != null && !isNaN(+s.price_low)) {
        priceSites++;
        if (isTuitionUnit(s)) {
          // include price_only stickers (e.g. My Gym) in avg price — not in Est. monthly
          priceCountTuition++;
          priceSumTuition += +s.price_low;
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
      if (rev.passMonthly != null) {
        passMonthly += rev.passMonthly;
        passSites++;
      }
      if (rev.passSticker != null) {
        passStickerSum += rev.passSticker;
        passStickerSites++;
      }
      if (rev.tuitionSticker != null) {
        tuitionStickerSum += rev.tuitionSticker;
        tuitionStickerSites++;
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

    const avgEnroll = enrollSites > 0 ? enrollPositiveSum / enrollSites : null;
    const avgPrice = priceCountTuition > 0 ? priceSumTuition / priceCountTuition : null;
    const cov = sessionCoverageCounts(list);

    return {
      sites,
      metros: metros.size,
      enrolled: enrolledSum,
      enrollSites,
      enrollCov: sites ? enrollSites / sites : null,
      priceSites,
      priceCov: sites ? priceSites / sites : null,
      avgEnroll,
      enrollZeroSites,
      avgPrice,
      units,
      dominantUnit,
      billingCounts,
      rollableSites,
      nonRollableSites,
      estMonthly: monthlySites ? monthly : null,
      estAnnual: annualSites ? annual : null,
      monthlySites,
      annualSites,
      passMonthly: passSites ? passMonthly : null,
      passSites,
      passStickerAvg: passStickerSites ? passStickerSum / passStickerSites : null,
      passStickerSites,
      tuitionStickerAvg: tuitionStickerSites ? tuitionStickerSum / tuitionStickerSites : null,
      tuitionStickerSites,
      partialList: partialSites ? partialList : null,
      partialSites,
      uaSites,
      sessStartCap: cov.captured,
      sessStartMiss: cov.missing,
      sessEndCap: cov.captured,
      sessEndMiss: cov.missing,
      sessNA: cov.notApplicable,
    };
  }

  function groupForSummary(list, by) {
    const map = new Map();
    list.forEach((s) => {
      let key;
      if (by === 'category') key = categoryOf(s);
      else if (by === 'program') key = programOf(s).name;
      else key = brandNameOf(s);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    const rows = [];
    map.forEach((sites, name) => {
      let enrolled = 0;
      sites.forEach((s) => {
        if (s.enrolled != null && !isNaN(+s.enrolled)) enrolled += +s.enrolled;
      });
      rows.push({
        key: name,
        name,
        sites: sites.length,
        enrolled,
        brands: [...new Set(sites.map(brandNameOf))],
      });
    });
    return rows;
  }

  function sortSiteRows(list) {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const numKeys = new Set(['enrolled', 'capacity', 'fillPct', 'price', 'estMonthly']);

    return list.slice().sort((a, b) => {
      const ra = siteRev(a);
      const rb = siteRev(b);
      let av;
      let bv;
      switch (key) {
        case 'brand':
          av = brandNameOf(a);
          bv = brandNameOf(b);
          break;
        case 'program':
          av = programOf(a).name;
          bv = programOf(b).name;
          break;
        case 'category':
          av = categoryOf(a);
          bv = categoryOf(b);
          break;
        case 'billing':
          av = billingModelOf(a);
          bv = billingModelOf(b);
          break;
        case 'name':
          av = a.name || '';
          bv = b.name || '';
          break;
        case 'metro':
          av = a.metro || '';
          bv = b.metro || '';
          break;
        case 'state':
          av = a.state || '';
          bv = b.state || '';
          break;
        case 'platform':
          av = String(a.platform || '').toLowerCase();
          bv = String(b.platform || '').toLowerCase();
          break;
        case 'enrolled':
          av = a.enrolled;
          bv = b.enrolled;
          break;
        case 'capacity':
          av = a.capacity;
          bv = b.capacity;
          break;
        case 'fillPct':
          av = fillPctOf(a);
          bv = fillPctOf(b);
          break;
        case 'price':
          av = a.price_low;
          bv = b.price_low;
          break;
        case 'unit':
          av = unitLabel(unitBucket(a));
          bv = unitLabel(unitBucket(b));
          break;
        case 'session':
          av = sessionStatusForSite(a) + (sessionHintForSite(a) || '');
          bv = sessionStatusForSite(b) + (sessionHintForSite(b) || '');
          break;
        case 'estMonthly':
          av = ra.monthly != null ? ra.monthly : ra.listPartial;
          bv = rb.monthly != null ? rb.monthly : rb.listPartial;
          break;
        default:
          av = a.name || '';
          bv = b.name || '';
      }

      if (numKeys.has(key)) {
        av = av == null || isNaN(av) ? -Infinity : +av;
        bv = bv == null || isNaN(bv) ? -Infinity : +bv;
        if (av === bv) return brandNameOf(a).localeCompare(brandNameOf(b)) || String(a.name || '').localeCompare(String(b.name || ''));
        return (av - bv) * dir;
      }
      av = String(av ?? '');
      bv = String(bv ?? '');
      const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' });
      if (cmp === 0) return String(a.name || '').localeCompare(String(b.name || ''));
      return cmp * dir;
    });
  }

  function hasActiveFilters() {
    return !!(
      state.category ||
      state.brands.size ||
      state.program ||
      state.metro ||
      state.billingModel ||
      state.platform ||
      state.search.trim()
    );
  }

  function scopeLabel() {
    const parts = [];
    if (state.category) parts.push('Category: ' + state.category);
    if (state.brands.size === 1) parts.push('Brand: ' + [...state.brands][0]);
    else if (state.brands.size > 1) parts.push(state.brands.size + ' brands');
    if (state.program) parts.push('Program: ' + state.program);
    if (state.metro) parts.push('Metro: ' + state.metro);
    if (state.billingModel) parts.push('Billing: ' + state.billingModel);
    if (state.platform) parts.push('Platform: ' + state.platform);
    if (state.search.trim()) parts.push('Search: “' + state.search.trim() + '”');
    return parts.length ? parts.join(' · ') : 'National (all visible)';
  }

  function writeHash() {
    if (state.suppressHash) return;
    const q = new URLSearchParams();
    if (state.category) q.set('category', state.category);
    if (state.brands.size === 1) q.set('brand', [...state.brands][0]);
    else if (state.brands.size > 1) q.set('brand', [...state.brands].join('|'));
    if (state.program) q.set('program', state.program);
    if (state.metro) q.set('metro', state.metro);
    if (state.billingModel) q.set('billing', state.billingModel);
    if (state.platform) q.set('platform', state.platform);
    const hash = q.toString();
    try {
      history.replaceState(null, '', location.pathname + location.search + (hash ? '#' + hash : ''));
    } catch (_) {}
  }

  function applyHash() {
    const raw = (location.hash || '').replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw.includes('=') ? raw : 'brand=' + raw);
    const brand = params.get('brand');
    const category = params.get('category');
    const metro = params.get('metro');
    const program = params.get('program');
    const billing = params.get('billing');
    const platform = params.get('platform');

    if (category) state.category = normalizeCategory(category);
    if (program) state.program = program;
    if (metro) state.metro = metro;
    if (billing) state.billingModel = billing;
    if (platform) state.platform = platform.toLowerCase();
    if (brand) {
      state.brands = new Set(
        brand
          .split('|')
          .map((b) => b.trim())
          .filter(Boolean)
      );
    }
  }

  // —— Cascading option population ——
  function sitesForBrandOptions() {
    let list = baseSites();
    if (state.category) {
      const cat = normalizeCategory(state.category);
      list = list.filter((s) => categoryOf(s) === cat);
    }
    return list;
  }

  function sitesForProgramOptions() {
    let list = sitesForBrandOptions();
    if (state.brands.size) list = list.filter((s) => state.brands.has(brandNameOf(s)));
    return list;
  }

  function sitesForMetroOptions() {
    let list = sitesForProgramOptions();
    if (state.program) list = list.filter((s) => programOf(s).name === state.program);
    return list;
  }

  function populateCategoryFilter() {
    const sel = document.getElementById('categoryFilter');
    if (!sel) return;
    const present = new Set(baseSites().map(categoryOf));
    const current = state.category;
    // Keep static options from HTML; ensure known categories exist
    const existing = new Set([...sel.options].map((o) => o.value).filter(Boolean));
    CATEGORY_ORDER.forEach((c) => {
      if (!existing.has(c) && present.has(c)) {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      }
    });
    // Disable empty categories? Keep all selectable for hash deep-links.
    sel.value = current && [...sel.options].some((o) => o.value === current) ? current : '';
    if (sel.value !== state.category) state.category = sel.value;
  }

  function renderBrandMs() {
    const listEl = document.getElementById('brandMsList');
    const labelEl = document.getElementById('brandMsLabel');
    const searchEl = document.getElementById('brandMsSearch');
    if (!listEl || !labelEl) return;

    const brands = [...new Set(sitesForBrandOptions().map(brandNameOf))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    // Drop selected brands that vanished after category cascade
    const next = new Set([...state.brands].filter((b) => brands.includes(b)));
    if (next.size !== state.brands.size) state.brands = next;

    const needle = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
    const shown = needle ? brands.filter((b) => b.toLowerCase().includes(needle)) : brands;

    listEl.innerHTML = shown
      .map((b) => {
        const checked = state.brands.has(b);
        return (
          '<label class="ms-option">' +
          '<input type="checkbox" value="' +
          esc(b) +
          '"' +
          (checked ? ' checked' : '') +
          ' />' +
          '<span>' +
          esc(b) +
          '</span></label>'
        );
      })
      .join('');

    listEl.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
      inp.addEventListener('change', () => {
        if (inp.checked) state.brands.add(inp.value);
        else state.brands.delete(inp.value);
        updateBrandLabel();
        state.shown = PAGE_SIZE;
        // Cascading: refresh program/metro options + results
        populateProgramFilter();
        populateMetroFilter();
        writeHash();
        refresh(false);
      });
    });

    updateBrandLabel();
  }

  function updateBrandLabel() {
    const labelEl = document.getElementById('brandMsLabel');
    if (!labelEl) return;
    if (!state.brands.size) labelEl.textContent = 'All brands';
    else if (state.brands.size === 1) labelEl.textContent = [...state.brands][0];
    else labelEl.textContent = state.brands.size + ' brands';
  }

  function populateProgramFilter() {
    const sel = document.getElementById('programFilter');
    if (!sel) return;
    const programs = [...new Set(sitesForProgramOptions().map((s) => programOf(s).name))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    const current = state.program;
    sel.innerHTML =
      '<option value="">All programs</option>' +
      programs.map((p) => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('');
    if (current && programs.includes(current)) sel.value = current;
    else {
      sel.value = '';
      state.program = '';
    }
  }

  function populateMetroFilter() {
    const sel = document.getElementById('metroFilter');
    if (!sel) return;
    const metros = [...new Set(sitesForMetroOptions().map((s) => (s.metro || '').trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    const current = state.metro;
    sel.innerHTML =
      '<option value="">All metros</option>' +
      metros.map((m) => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
    if (current && metros.includes(current)) sel.value = current;
    else {
      sel.value = '';
      state.metro = '';
    }
  }


  function populateBillingFilter() {
    const sel = document.getElementById('billingFilter');
    if (!sel) return;
    const counts = {};
    baseSites().forEach((s) => {
      const m = billingModelOf(s);
      counts[m] = (counts[m] || 0) + 1;
    });
    const models = BILLING_MODEL_ORDER.filter((m) => counts[m]).concat(
      Object.keys(counts).filter((m) => !BILLING_MODEL_ORDER.includes(m)).sort()
    );
    const current = state.billingModel;
    sel.innerHTML =
      '<option value="">All billing models</option>' +
      models
        .map(
          (m) =>
            '<option value="' +
            esc(m) +
            '">' +
            esc(m) +
            ' (' +
            fmtNum(counts[m] || 0) +
            ')</option>'
        )
        .join('');
    if (current && models.includes(current)) sel.value = current;
    else {
      sel.value = '';
      state.billingModel = '';
    }
  }

  function populatePlatformFilter() {
    const sel = document.getElementById('platformFilter');
    if (!sel) return;
    const current = state.platform;
    const plats = [
      ...new Set(baseSites().map((s) => String(s.platform || '').toLowerCase()).filter(Boolean)),
    ].sort();
    sel.innerHTML =
      '<option value="">All platforms</option>' +
      plats.map((p) => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('');
    sel.value = current && plats.includes(current) ? current : '';
    if (sel.value !== state.platform) state.platform = sel.value;
  }

  function populateFilters() {
    populateCategoryFilter();
    renderBrandMs();
    populateProgramFilter();
    populateMetroFilter();
    populateBillingFilter();
    populatePlatformFilter();

    // Sync select values from state (after options built)
    const cat = document.getElementById('categoryFilter');
    if (cat) cat.value = state.category || '';
    const prog = document.getElementById('programFilter');
    if (prog) prog.value = state.program || '';
    const metro = document.getElementById('metroFilter');
    if (metro) metro.value = state.metro || '';
    const bill = document.getElementById('billingFilter');
    if (bill) bill.value = state.billingModel || '';
    const plat = document.getElementById('platformFilter');
    if (plat) plat.value = state.platform || '';
  }

  // —— Render ——
  function renderFilterChips() {
    const chips = document.getElementById('filterChips');
    const clearBtn = document.getElementById('clearFilters');
    if (!chips) return;

    const items = [];
    if (state.category) items.push({ k: 'category', label: 'category: ' + state.category });
    [...state.brands].sort().forEach((b) => items.push({ k: 'brand', v: b, label: 'brand: ' + b }));
    if (state.program) items.push({ k: 'program', label: 'program: ' + state.program });
    if (state.metro) items.push({ k: 'metro', label: 'metro: ' + state.metro });
    if (state.billingModel) items.push({ k: 'billing', label: 'billing: ' + state.billingModel });
    if (state.platform) items.push({ k: 'platform', label: 'platform: ' + state.platform });
    if (state.search.trim()) items.push({ k: 'search', label: 'search: ' + state.search.trim() });

    if (!items.length) {
      chips.hidden = true;
      chips.innerHTML = '';
      if (clearBtn) clearBtn.hidden = true;
      return;
    }

    chips.hidden = false;
    if (clearBtn) clearBtn.hidden = false;
    chips.innerHTML = items
      .map((it) => {
        const data =
          it.k === 'brand' ? ' data-k="brand" data-v="' + esc(it.v) + '"' : ' data-k="' + esc(it.k) + '"';
        return (
          '<button type="button" class="filter-chip"' +
          data +
          '>' +
          esc(it.label) +
          ' <span aria-hidden="true">×</span></button>'
        );
      })
      .join('');

    chips.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-k');
        if (k === 'category') state.category = '';
        else if (k === 'brand') state.brands.delete(btn.getAttribute('data-v'));
        else if (k === 'program') state.program = '';
        else if (k === 'metro') state.metro = '';
        else if (k === 'billing') state.billingModel = '';
        else if (k === 'platform') state.platform = '';
        else if (k === 'search') {
          state.search = '';
          const inp = document.getElementById('progSearch');
          if (inp) inp.value = '';
        }
        state.shown = PAGE_SIZE;
        populateFilters();
        writeHash();
        refresh(false);
      });
    });
  }


  function renderBillingGrid(agg) {
    const grid = document.getElementById('billingGrid');
    const legend = document.getElementById('billingLegend');
    if (!grid) return;
    const counts = agg.billingCounts || {};
    const keys = BILLING_MODEL_ORDER.filter((k) => counts[k]).concat(
      Object.keys(counts).filter((k) => !BILLING_MODEL_ORDER.includes(k) && counts[k]).sort()
    );
    if (!keys.length) {
      grid.innerHTML = '<div class="billing-card"><div class="bm-name">No sites</div></div>';
      if (legend) legend.textContent = '';
      return;
    }
    const rollableModels = new Set([
      'perpetual_monthly',
      'membership_pass_monthly',
      'term_session',
    ]);
    grid.innerHTML = keys
      .map((k) => {
        const n = counts[k] || 0;
        const cls = rollableModels.has(k) ? 'rollable' : 'non-rollable';
        const hint =
          k === 'membership_pass_monthly'
            ? 'pass $ separate'
            : rollableModels.has(k)
              ? 'may roll if stamped'
              : 'not annualized';
        return (
          '<button type="button" class="billing-card ' +
          cls +
          '" data-billing="' +
          esc(k) +
          '"><div class="bm-name">' +
          esc(k) +
          '</div><div class="bm-count">' +
          fmtNum(n) +
          '</div><div class="bm-sub">' +
          hint +
          '</div></button>'
        );
      })
      .join('');
    grid.querySelectorAll('[data-billing]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.billingModel = btn.getAttribute('data-billing') || '';
        state.shown = PAGE_SIZE;
        populateFilters();
        writeHash();
        refresh(false);
      });
    });
    if (legend) {
      legend.textContent =
        'Tuition Est. KPIs use revenue_rollable + per_enrollee_month only. Green cards ≈ typically rollable models; amber = one-off / unknown.';
    }
  }

  function renderKpis(agg) {
    document.getElementById('scopeName').textContent = scopeLabel();
    document.getElementById('kSites').textContent = fmtNum(agg.sites);
    document.getElementById('kSitesSub').textContent =
      (agg.uaSites ? agg.uaSites + ' UA pass sites · ' : '') +
      (state.hideClosed ? 'open / non-junk' : 'incl. closed/junk');
    document.getElementById('kMetros').textContent = fmtNum(agg.metros);
    document.getElementById('kEnrolled').textContent = fmtNum(agg.enrolled);
    document.getElementById('kEnrollSub').textContent =
      fmtNum(agg.enrollSites) +
      ' with enroll > 0 · ' +
      fmtNum(agg.enrollZeroSites || 0) +
      ' reported 0';
    document.getElementById('kAvgEnroll').textContent =
      agg.avgEnroll != null ? fmtDec(agg.avgEnroll, 1) : '—';
    document.getElementById('kEnrollCov').textContent = fmtPct(agg.enrollSites, agg.sites);
    document.getElementById('kPriceCov').textContent = fmtPct(agg.priceSites, agg.sites);
    document.getElementById('kAvgPrice').textContent =
      agg.avgPrice != null ? '$' + fmtDec(agg.avgPrice, 0) : '—';
    document.getElementById('kAvgPriceUnit').textContent =
      agg.tuitionStickerSites
        ? '$/mo tuition stickers · ' +
          fmtNum(agg.tuitionStickerSites) +
          ' price-only (not in Est.) · never mixed with UA'
        : '$/mo tuition (per_enrollee_month) · never mixed with UA passes';

    document.getElementById('kMonthly').textContent = fmtMoney(agg.estMonthly);
    document.getElementById('kAnnual').textContent = fmtMoney(agg.estAnnual);

    let monthlySub =
      fmtNum(agg.monthlySites) +
      ' rollable tuition sites · ' +
      fmtNum(agg.rollableSites) +
      ' rollable / ' +
      fmtNum(agg.nonRollableSites) +
      ' not';
    let annualSub = '×12 on rollable per_enrollee_month only';
    if (agg.partialSites) {
      monthlySub += ' · ' + agg.partialSites + ' other rollable (not in tuition $)';
    }
    document.getElementById('kMonthlySub').textContent = monthlySub;
    document.getElementById('kAnnualSub').textContent = annualSub;

    const kPass = document.getElementById('kPassMonthly');
    const kPassSub = document.getElementById('kPassSub');
    if (kPass) {
      if (agg.passMonthly != null) kPass.textContent = fmtMoney(agg.passMonthly);
      else if (agg.passStickerAvg != null)
        kPass.textContent = '$' + fmtDec(agg.passStickerAvg, 2) + ' avg';
      else kPass.textContent = '—';
    }
    if (kPassSub) {
      if (agg.passSites) {
        kPassSub.textContent = fmtNum(agg.passSites) + ' pass sites · enroll×price (revenue)';
      } else if (agg.passStickerSites) {
        kPassSub.textContent =
          'avg price_monthly_equiv · ' +
          fmtNum(agg.passStickerSites) +
          ' sites · no enroll (sticker, not revenue)';
      } else {
        kPassSub.textContent = 'UA / membership_pass — no price yet';
      }
    }

    renderBillingGrid(agg);

        const sessionChip = document.getElementById('sessionChip');
    if (sessionChip) {
      const cap = agg.sessStartCap || 0;
      const miss = agg.sessStartMiss || 0;
      const na = agg.sessNA || 0;
      sessionChip.textContent =
        'Session: ' + fmtNum(cap) + ' captured · ' + fmtNum(miss) + ' missing · ' + fmtNum(na) + ' n/a';
      sessionChip.title =
        'Session calendars — N/A is typical for ongoing tuition / pass sites. Pull week ≠ session dates.';
    }
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

    document.getElementById('entityCountChip').innerHTML =
      '<strong>' + fmtNum(agg.sites) + '</strong> sites';
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

  function renderBarChart(list) {
    const el = document.getElementById('enrollBars');
    const by = state.summaryBy;
    document.getElementById('chartModeLabel').textContent =
      by === 'category' ? '(categories)' : by === 'program' ? '(programs)' : '(brands)';

    const rows = groupForSummary(list, by)
      .slice()
      .sort((a, b) => (b.enrolled || 0) - (a.enrolled || 0) || b.sites - a.sites)
      .slice(0, 12);

    if (!rows.length) {
      el.innerHTML =
        '<div class="empty-row" style="padding:20px;color:var(--soft)">No groups to chart.</div>';
      return;
    }

    const max = Math.max(...rows.map((r) => r.enrolled || 0), 1);
    el.innerHTML = rows
      .map((r) => {
        const pct = Math.max(2, Math.round((100 * (r.enrolled || 0)) / max));
        const color =
          brandsMeta.find((b) => b.name === r.name || (r.brands && r.brands[0] === b.name))?.color ||
          'var(--accent)';
        return (
          '<div class="bar-row" data-summary-key="' +
          esc(r.key) +
          '" data-summary-by="' +
          esc(by) +
          '" title="' +
          esc(r.name) +
          ' — ' +
          fmtNum(r.sites) +
          ' sites">' +
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
      row.addEventListener('click', () => {
        const key = row.getAttribute('data-summary-key');
        const mode = row.getAttribute('data-summary-by');
        if (mode === 'brand') {
          state.brands = new Set([key]);
        } else if (mode === 'category') {
          state.category = key;
        } else if (mode === 'program') {
          state.program = key;
        }
        state.shown = PAGE_SIZE;
        populateFilters();
        writeHash();
        refresh(false);
      });
    });
  }

  function sessionCell(s) {
    const st = sessionStatusForSite(s);
    const hint = sessionHintForSite(s);
    const cls =
      st === 'CAPTURED' ? 'ok' : st === 'PARTIAL' ? 'partial' : st === 'N/A' ? 'na' : 'miss';
    let title = 'session_dates_status';
    if (hint && hint.indexOf('inferred') >= 0) title = 'Inferred from JR session names — not published calendars';
    let html = '<span class="sess-status ' + cls + '" title="' + esc(title) + '">' + esc(st) + '</span>';
    if (hint) {
      html +=
        '<div class="sess-cell-hint">' +
        esc(hint) +
        '</div>';
    }
    return html;
  }

  function updateTablePager(shownCount, total) {
    const truncated = total > 0 && shownCount < total;
    const banner = document.getElementById('tableTruncationBanner');
    const bannerText = document.getElementById('tableTruncationText');
    const footer = document.getElementById('tableFooter');
    const showing = document.getElementById('tableShowing');
    const moreBtn = document.getElementById('loadMoreBtn');
    const showAllBtn = document.getElementById('showAllBtn');

    if (banner) {
      banner.hidden = !truncated;
      banner.classList.toggle('is-truncated', truncated);
      if (bannerText) {
        bannerText.textContent =
          'Showing ' +
          fmtNum(shownCount) +
          ' of ' +
          fmtNum(total) +
          ' sites — use Load more or Show all';
      }
    }

    if (footer) {
      const showFooter = total > 0;
      footer.hidden = !showFooter;
      footer.classList.toggle('is-active', truncated);
      footer.classList.toggle('is-truncated', truncated);
      if (showing) {
        showing.textContent = 'Showing ' + fmtNum(shownCount) + ' of ' + fmtNum(total);
      }
    }

    if (moreBtn) moreBtn.hidden = !truncated;
    if (showAllBtn) showAllBtn.hidden = !truncated;
  }

  function renderTable(sorted) {
    const body = document.getElementById('factsBody');
    const total = sorted.length;
    const limit = Number.isFinite(state.shown) ? state.shown : total;
    const slice = sorted.slice(0, Math.min(limit, total));

    document.getElementById('tableCount').textContent = '(' + fmtNum(total) + ')';

    document.querySelectorAll('.sort-btn').forEach((btn) => {
      const k = btn.getAttribute('data-sort');
      if (k === state.sortKey) {
        btn.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      } else {
        btn.setAttribute('aria-sort', 'none');
      }
    });

    updateTablePager(slice.length, total);

    if (!slice.length) {
      body.innerHTML =
        '<tr class="empty-row"><td colspan="16">No sites match the current filters.</td></tr>';
      return;
    }

    body.innerHTML = slice
      .map((s) => {
        const id = siteId(s);
        const selected = state.selectedId === id ? ' selected' : '';
        const prog = programOf(s);
        const cat = categoryOf(s);
        const bm = billingModelOf(s);
        const bucket = unitBucket(s);
        const rev = siteRev(s);
        const fill = fillPctOf(s);
        const fb = prog.fallback
          ? '<span class="fallback-badge" title="No program field — using brand">brand</span>'
          : '';
        const billCls = rev.rollable ? 'rollable' : 'non-rollable';
        const monthlyCell =
          rev.monthly != null
            ? fmtMoney(rev.monthly)
            : rev.passMonthly != null
              ? '<span title="pass/member — not in tuition KPI">' +
                fmtMoney(rev.passMonthly) +
                '<span class="partial-tag">pass</span></span>'
              : rev.passSticker != null
                ? '<span title="pass sticker — no enroll, not revenue">$' +
                  fmtDec(rev.passSticker, 2) +
                  '<span class="partial-tag">sticker</span></span>'
                : rev.tuitionSticker != null
                  ? '<span title="tuition sticker — no enroll, not revenue">$' +
                    fmtDec(rev.tuitionSticker, rev.tuitionSticker < 20 ? 2 : 0) +
                    '<span class="partial-tag">sticker</span></span>'
                  : rev.listPartial != null
                    ? '<span title="not rolled into tuition">' +
                      fmtMoney(rev.listPartial) +
                      '<span class="partial-tag">n/a</span></span>'
                    : '—';

        return (
          '<tr tabindex="0" data-id="' +
          esc(id) +
          '" class="' +
          selected.trim() +
          '">' +
          '<td class="brand-cell" data-label="Brand">' +
          esc(brandNameOf(s)) +
          '</td>' +
          '<td class="program-cell" data-label="Program">' +
          esc(prog.name) +
          fb +
          '</td>' +
          '<td data-label="Category"><span class="cat-pill cat-' +
          esc(cat) +
          '">' +
          esc(cat) +
          '</span></td>' +
          '<td data-label="Billing"><span class="bill-pill ' +
          billCls +
          '" title="' +
          esc(revenueUnitOf(s) + (rev.rollable ? ' · rollable' : ' · not rollable')) +
          '">' +
          esc(bm) +
          '</span></td>' +
          '<td class="name-cell" data-label="Site">' +
          esc(s.name || '—') +
          '</td>' +
          '<td data-label="Metro">' +
          esc(s.metro || '—') +
          '</td>' +
          '<td class="st-cell" data-label="ST">' +
          esc(s.state || '—') +
          '</td>' +
          '<td data-label="Platform"><span class="plat-pill">' +
          esc(String(s.platform || '—').toLowerCase()) +
          '</span></td>' +
          '<td class="num" data-label="Enrolled">' +
          fmtNum(s.enrolled) +
          '</td>' +
          '<td class="num" data-label="Capacity">' +
          fmtNum(s.capacity) +
          '</td>' +
          '<td class="num" data-label="Fill%">' +
          (fill != null ? fmtDec(fill, 0) + '%' : '—') +
          '</td>' +
          '<td class="num" data-label="Price">' +
          (s.price_low != null ? '$' + fmtDec(s.price_low, s.price_low < 20 ? 2 : 0) : '—') +
          '</td>' +
          '<td data-label="Unit"><span class="ubadge ' +
          bucket +
          '">' +
          esc(unitLabel(bucket)) +
          '</span></td>' +
          '<td data-label="Session">' +
          sessionCell(s) +
          '</td>' +
          '<td class="num rev-cell" data-label="Est monthly">' +
          monthlyCell +
          '</td>' +
          '<td data-label="Map"><a class="map-link" href="' +
          esc(mapHrefForSite(s)) +
          '" title="Open on map">Map</a></td>' +
          '</tr>'
        );
      })
      .join('');

    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const activate = () => {
        state.selectedId = tr.getAttribute('data-id');
        refresh(false);
      };
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        activate();
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  function renderDetail(s) {
    const panel = document.getElementById('detailPanel');
    if (!panel) return;
    if (!s) {
      panel.hidden = true;
      document.getElementById('detailMapLink').href = 'map.html';
      return;
    }
    panel.hidden = false;
    const prog = programOf(s);
    const cat = categoryOf(s);
    const rev = siteRev(s);
    const fill = fillPctOf(s);

    document.getElementById('detailKicker').textContent = 'Site · ' + cat;
    document.getElementById('detailName').textContent = s.name || '—';
    document.getElementById('detailMeta').innerHTML =
      '<span class="plat-pill">' +
      esc(brandNameOf(s)) +
      '</span>' +
      '<span class="plat-pill">' +
      esc(prog.name) +
      '</span>' +
      '<span class="cat-pill cat-' +
      esc(cat) +
      '">' +
      esc(cat) +
      '</span>' +
      '<span class="plat-pill">' +
      esc(String(s.platform || '—').toLowerCase()) +
      '</span>' +
      (s.metro ? '<span class="plat-pill">' + esc(s.metro) + '</span>' : '');

    document.getElementById('detailMapLink').href = mapHrefForSite(s);

    const stats = [
      { l: 'Brand', v: brandNameOf(s) },
      { l: 'Program', v: prog.name, s: prog.fallback ? 'brand fallback' : '' },
      { l: 'Category', v: cat },
      { l: 'Metro / ST', v: (s.metro || '—') + ' · ' + (s.state || '—') },
      { l: 'Enrolled', v: fmtNum(s.enrolled), s: 'capacity ' + fmtNum(s.capacity) },
      {
        l: 'Fill %',
        v: fill != null ? fmtDec(fill, 1) + '%' : '—',
      },
      {
        l: 'Price',
        v: s.price_low != null ? '$' + fmtDec(s.price_low, s.price_low < 20 ? 2 : 0) : '—',
        s: unitLabel(unitBucket(s)),
      },
      {
        l: 'Est. monthly',
        v: fmtMoney(rev.monthly != null ? rev.monthly : rev.listPartial),
        s: rev.note,
        rev: true,
      },
      {
        l: 'Est. annualized',
        v: fmtMoney(rev.annual),
        s: rev.annual == null ? 'weak / — when non-monthly' : 'monthly × 12 when solid',
        rev: true,
      },
      {
        l: 'Session dates',
        v: sessionStatusForSite(s),
        s: sessionHintForSite(s) || (s.session_start || '') + (s.session_end ? ' → ' + s.session_end : ''),
      },
    ];

    document.getElementById('detailBody').innerHTML = stats
      .map(
        (st) =>
          '<div class="detail-stat"><div class="ds-l">' +
          esc(st.l) +
          '</div><div class="ds-v' +
          (st.rev ? ' rev' : '') +
          '">' +
          esc(String(st.v)) +
          '</div>' +
          (st.s ? '<div class="ds-s">' + esc(st.s) + '</div>' : '') +
          '</div>'
      )
      .join('');
  }

  function setSummaryMode(mode) {
    state.summaryBy = mode;
    ['summaryBrand', 'summaryCategory', 'summaryProgram'].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const on = btn.getAttribute('data-summary') === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function clearAllFilters() {
    state.category = '';
    state.brands = new Set();
    state.program = '';
    state.metro = '';
    state.billingModel = '';
    state.platform = '';
    state.search = '';
    state.selectedId = null;
    state.shown = PAGE_SIZE;
    const inp = document.getElementById('progSearch');
    if (inp) inp.value = '';
    const hide = document.getElementById('hideClosed');
    // leave hideClosed as-is
    populateFilters();
    writeHash();
    refresh(false);
  }

  let cachedSorted = [];

  function refresh(rebuildOptions) {
    if (rebuildOptions !== false) populateFilters();
    else {
      // Keep brand MS list in sync when not full rebuild
      updateBrandLabel();
    }

    const list = filteredSites();
    const sorted = sortSiteRows(list);
    cachedSorted = sorted;
    const agg = aggregate(list);

    renderFilterChips();
    renderKpis(agg);
    renderUnitPanel(agg);
    renderUnitMixChart(agg);
    renderBarChart(list);
    renderTable(sorted);

    const selected = state.selectedId
      ? list.find((s) => siteId(s) === state.selectedId) ||
        allSites.find((s) => siteId(s) === state.selectedId)
      : null;
    renderDetail(selected || null);

    const clearBtn = document.getElementById('clearFilters');
    if (clearBtn) clearBtn.hidden = !hasActiveFilters();
  }

  // —— Brand multi-select chrome ——
  (function wireBrandMs() {
    const wrap = document.getElementById('brandMsWrap');
    const trigger = document.getElementById('brandMsTrigger');
    const panel = document.getElementById('brandMsPanel');
    const search = document.getElementById('brandMsSearch');
    const clear = document.getElementById('brandMsClear');
    const done = document.getElementById('brandMsDone');
    if (!wrap || !trigger || !panel) return;

    function openPanel(open) {
      panel.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && search) {
        search.value = '';
        renderBrandMs();
        setTimeout(() => search.focus(), 0);
      }
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel(panel.hidden);
    });
    if (done) done.addEventListener('click', () => openPanel(false));
    if (clear) {
      clear.addEventListener('click', () => {
        state.brands = new Set();
        state.shown = PAGE_SIZE;
        renderBrandMs();
        populateProgramFilter();
        populateMetroFilter();
        writeHash();
        refresh(false);
      });
    }
    if (search) {
      search.addEventListener('input', () => renderBrandMs());
    }
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !wrap.contains(e.target)) openPanel(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) openPanel(false);
    });
  })();

  // —— Events ——
  document.getElementById('categoryFilter').addEventListener('change', (e) => {
    state.category = e.target.value;
    // Cascade: prune brands / program / metro
    state.shown = PAGE_SIZE;
    populateFilters();
    writeHash();
    refresh(false);
  });
  document.getElementById('programFilter').addEventListener('change', (e) => {
    state.program = e.target.value;
    state.shown = PAGE_SIZE;
    populateMetroFilter();
    writeHash();
    refresh(false);
  });
  document.getElementById('metroFilter').addEventListener('change', (e) => {
    state.metro = e.target.value;
    state.shown = PAGE_SIZE;
    writeHash();
    refresh(false);
  });
  const billingFilter = document.getElementById('billingFilter');
  if (billingFilter) {
    billingFilter.addEventListener('change', (e) => {
      state.billingModel = e.target.value;
      state.shown = PAGE_SIZE;
      writeHash();
      refresh(false);
    });
  }
  document.getElementById('platformFilter').addEventListener('change', (e) => {
    state.platform = e.target.value;
    state.shown = PAGE_SIZE;
    writeHash();
    refresh(false);
  });
  document.getElementById('progSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    state.shown = PAGE_SIZE;
    refresh(false);
  });
  document.getElementById('hideClosed').addEventListener('change', (e) => {
    state.hideClosed = !!e.target.checked;
    state.shown = PAGE_SIZE;
    refresh(true);
  });

  const clearFiltersBtn = document.getElementById('clearFilters');
  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearAllFilters);

  document.getElementById('detailClose').addEventListener('click', () => {
    state.selectedId = null;
    refresh(false);
  });

  ['summaryBrand', 'summaryCategory', 'summaryProgram'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      setSummaryMode(btn.getAttribute('data-summary') || 'brand');
      refresh(false);
    });
  });

  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      const cur = Number.isFinite(state.shown) ? state.shown : cachedSorted.length;
      state.shown = cur + PAGE_SIZE;
      renderTable(cachedSorted);
    });
  }

  const showAllBtn = document.getElementById('showAllBtn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      state.shown = Infinity;
      renderTable(cachedSorted);
    });
  }

  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-sort');
      if (state.sortKey === k) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = k;
        const ascDefault = new Set(['brand', 'program', 'category', 'billing', 'name', 'metro', 'state', 'platform', 'unit', 'session']);
        state.sortDir = ascDefault.has(k) ? 'asc' : 'desc';
      }
      refresh(false);
    });
  });

  window.addEventListener('hashchange', () => {
    state.suppressHash = true;
    state.category = '';
    state.brands = new Set();
    state.program = '';
    state.metro = '';
    state.billingModel = '';
    state.platform = '';
    applyHash();
    state.shown = PAGE_SIZE;
    populateFilters();
    state.suppressHash = false;
    refresh(false);
  });

  applyHash();
  setSummaryMode(state.summaryBy);
  refresh(true);

  // Expose for smoke / verification
  window.__PROGRAMS_DEBUG = {
    filteredSites,
    categoryOf,
    brandNameOf,
    state,
    PAGE_SIZE,
  };

  console.info(
    '[MarketIntel programs] sites',
    allSites.length,
    'visible',
    allSites.filter(isVisible).length,
    'summaryBy',
    state.summaryBy
  );
})();
