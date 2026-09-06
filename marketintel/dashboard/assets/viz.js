(function (global) {
  const CATEGORY_SLOT = {
    gymnastics: 1,
    martial_arts: 2,
    adventure: 3,
    adventure_park: 3,
    stem: 4,
    stem_makers: 4,
    ninja: 5,
    cheer_dance: 6,
  };

  /** Concrete hex for Leaflet (light palette; CSS vars are not usable in divIcon HTML reliably). */
  const CATEGORY_HEX = {
    gymnastics: '#2563EB',
    martial_arts: '#7C3AED',
    adventure: '#0D9488',
    adventure_park: '#0D9488',
    stem: '#CA8A04',
    stem_makers: '#CA8A04',
    ninja: '#DC2626',
    cheer_dance: '#DB2777',
    other: '#64748B',
  };

  function categoryColor(c) {
    const slot = CATEGORY_SLOT[c] || 'other';
    return 'var(--series-' + slot + ')';
  }

  function categoryColorHex(category) {
    const key = String(category || '')
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, '_');
    if (CATEGORY_HEX[key]) return CATEGORY_HEX[key];
    if (key === 'adventurepark') return CATEGORY_HEX.adventure_park;
    if (key === 'stemmakers' || key === 'stem_maker') return CATEGORY_HEX.stem_makers;
    return CATEGORY_HEX.other;
  }

  /** Surveyed / rooftop-level precision only. */
  function isPreciseGeo(precision) {
    return precision === 'location';
  }

  function shapeClass(precision) {
    return isPreciseGeo(precision) ? 'marker-precise' : 'marker-approx';
  }

  function brandSlots(rows, metric, topN) {
    topN = topN == null ? 5 : topN;
    const totals = new Map();
    rows.forEach((r) => {
      const b = r.brand || r.brand_name || 'Unknown';
      totals.set(b, (totals.get(b) || 0) + (metric(r) || 0));
    });
    const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([b]) => b);
    const map = new Map(top.map((b, i) => [b, 'var(--series-' + (i + 1) + ')']));
    return (brand) => map.get(brand) || 'var(--series-other)';
  }

  global.MarketIntelViz = {
    CATEGORY_SLOT,
    CATEGORY_HEX,
    categoryColor,
    categoryColorHex,
    isPreciseGeo,
    shapeClass,
    brandSlots,
  };
})(typeof window !== 'undefined' ? window : globalThis);
