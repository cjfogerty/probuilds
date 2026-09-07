#!/usr/bin/env python3
"""
build_markets.py — turn the site-grain snapshot into market-grain intelligence.

Reads  : dashboard/data/sites.js          (site snapshot, window.MARKETINTEL)
         reference/*.json                 (geography crosswalks + ACS demand)
Writes : dashboard/data/markets.js        (window.MARKETINTEL_MARKETS)
         dashboard/data/sites_geo.js      (window.MARKETINTEL_SITEGEO — site->market join)
         build_report.json                (QA / coverage report)

Every metric here is defined in METRICS.md. Stdlib only.

    python3 scripts/build_markets.py [--root .]
"""

import argparse
import json
import math
import os
import statistics as stats
from collections import defaultdict

# ---------------------------------------------------------------- constants

NATIONAL_MEDIAN_HH_INCOME = 78538   # ACS 2023 5-yr, US
THIN_DEMAND_KIDS = 500              # ZCTA floor for ranked screens
CONF_A_COVERAGE, CONF_B_COVERAGE = 0.70, 0.40
CONF_A_MIN_SITES = 5
MIN_BRANDS_FOR_HHI = 3
MIN_SITES_FOR_FILL = 3
EARTH_MI = 3958.7613

# --- plausibility guards -------------------------------------------------
# Upstream `observed_max` capacity derivation produces occasional absurd values
# (one site reads 166 billion seats), and some monthly prices are actually term
# or annual figures. Unguarded, 11 sites move national capacity by 5 orders of
# magnitude and 2 sites carry 10% of national enrollment. Rows that trip a guard
# are FLAGGED, never deleted, and excluded from headline roll-ups.
MAX_SITE_CAPACITY = 5000      # observed p90 is 1,293; median 650
MAX_SITE_ENROLLED = 3000      # observed p99 is 1,923; median 270
MAX_CAP_TO_ENR_RATIO = 40     # an empty-ish gym, generously
MAX_MONTHLY_PRICE = 600       # above this it is a term/annual figure mislabeled
MIN_MONTHLY_PRICE = 15        # below this it is a drop-in or an add-on
MAX_SITE_ANNUAL_REV = 6e6     # single-location youth gym ceiling, generously

CATEGORY_DENOMINATOR = {          # which age band each category is measured against
    "gymnastics": "kids_0_14",
    "adventure": "kids_0_14",
    "martial_arts": "kids_5_14",
    "stem": "kids_5_14",
    "ninja": "kids_5_14",
    "cheer_dance": "kids_5_14",
}
QUOTABLE_TIERS = {"published", "class_line_published"}


# ---------------------------------------------------------------- helpers

def load_js_global(path):
    """Read a `window.X = {...};` data file and return the object."""
    raw = open(path, encoding="utf-8").read()
    return json.loads(raw[raw.index("{"):].rstrip().rstrip(";"))


def write_js_global(path, varname, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write("window.%s = " % varname)
        json.dump(obj, f, separators=(",", ":"), allow_nan=False)
        f.write(";\n")


def haversine(a_lat, a_lng, b_lat, b_lng):
    p = math.pi / 180
    dla, dlo = (b_lat - a_lat) * p, (b_lng - a_lng) * p
    h = (math.sin(dla / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin(dlo / 2) ** 2)
    return 2 * EARTH_MI * math.asin(math.sqrt(h))


def safe_div(a, b):
    if a is None or b in (None, 0):
        return None
    return a / b


def median(xs):
    xs = [x for x in xs if x is not None]
    return stats.median(xs) if xs else None


def pct(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    i = (len(xs) - 1) * q
    lo, hi = math.floor(i), math.ceil(i)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def percentile_rank(value, sorted_vals):
    """Fraction of the population at or below `value`. 0..1."""
    if value is None or not sorted_vals:
        return None
    lo, hi = 0, len(sorted_vals)
    while lo < hi:
        mid = (lo + hi) // 2
        if sorted_vals[mid] <= value:
            lo = mid + 1
        else:
            hi = mid
    return lo / len(sorted_vals)


def rnd(x, n=4):
    return None if x is None else round(x, n)


# ---------------------------------------------------------------- geo join

class Geo:
    def __init__(self, root):
        ref = os.path.join(root, "reference")
        dc = json.load(open(os.path.join(ref, "demand_cbsa_county.json")))
        self.demand_cbsa = dc["cbsa"]
        self.demand_county = dc["county"]
        self.demand_zcta = json.load(open(os.path.join(ref, "demand_zcta.json")))
        self.county_cbsa = json.load(open(os.path.join(ref, "county_cbsa.json")))
        self.zcta_county = json.load(open(os.path.join(ref, "zcta_county.json")))
        self.latlng_county = json.load(open(os.path.join(ref, "latlng_county.json")))
        self.zcta_centroid = json.load(open(os.path.join(ref, "zcta_centroid.json")))

    def resolve(self, site):
        """-> dict(zcta, county_fips, cbsa, market_id, market_name, market_type, geo_method)"""
        out = {"zcta": None, "county_fips": None, "cbsa": None, "cbsa_name": None,
               "market_id": None, "market_name": None, "market_type": None,
               "geo_method": "unresolved", "state_name": None, "csa": None,
               "csa_name": None}
        z = str(site.get("zip") or "").strip()
        county = None
        if z in self.demand_zcta:
            out["zcta"] = z
            county = self.zcta_county.get(z)
            out["geo_method"] = "zip_xwalk"
        if county is None:
            lat, lng = site.get("lat"), site.get("lng")
            if lat is not None and lng is not None:
                key = "%s,%s" % (round(lat, 4), round(lng, 4))
                county = self.latlng_county.get(key)
                if county:
                    out["geo_method"] = "latlng_reverse"
        if not county:
            return out
        out["county_fips"] = county
        cb = self.county_cbsa.get(county)
        if cb:
            out.update(cbsa=cb["cbsa"], cbsa_name=cb["cbsa_name"],
                       market_id=cb["cbsa"], market_name=cb["cbsa_name"],
                       market_type=cb["type"], state_name=cb.get("state_name"),
                       csa=cb.get("csa"), csa_name=cb.get("csa_name"))
        else:
            cname = (self.demand_county.get(county) or {}) and None
            out.update(market_id="county:" + county,
                       market_name="Non-metro county %s" % county,
                       market_type="non_cbsa")
        return out

    def market_demand(self, market_id):
        if market_id is None:
            return None
        if market_id.startswith("county:"):
            return self.demand_county.get(market_id.split(":", 1)[1])
        return self.demand_cbsa.get(market_id)


# ---------------------------------------------------------------- build

def visible(s):
    return not s.get("likely_closed") and not s.get("is_junk")


def plausibility_flags(row):
    """Return a list of guard names this row trips. Empty list == clean."""
    f = []
    cap, enr = row["capacity"], row["enrolled"]
    px, rev = row["price"], row["est_annual_rev"]
    if cap and cap > MAX_SITE_CAPACITY:
        f.append("capacity_implausible")
    if enr and enr > MAX_SITE_ENROLLED:
        f.append("enrolled_implausible")
    # The ratio guard exists to catch DERIVED capacity blowing up. Published
    # capacity is authoritative: a near-empty studio is a fact worth keeping, and
    # dropping the emptiest sites would bias fill rate upward.
    if (cap and enr and cap > MAX_CAP_TO_ENR_RATIO * enr
            and row["evidence_tier"] not in QUOTABLE_TIERS):
        f.append("capacity_ratio_implausible")
    if px and px > MAX_MONTHLY_PRICE:
        f.append("price_implausible_high")
    if px and px < MIN_MONTHLY_PRICE and row["category"] != "adventure":
        f.append("price_implausible_low")
    if rev and rev > MAX_SITE_ANNUAL_REV:
        f.append("revenue_implausible")
    return f


def build(root):
    data = load_js_global(os.path.join(root, "dashboard", "data", "sites.js"))
    meta = data.get("meta", {})
    snap = data["snapshots"][-1]
    sites = snap["sites"]
    geo = Geo(root)

    report = {"as_of": snap.get("as_of"), "week_start": snap.get("week_start"),
              "week_end": snap.get("week_end"), "sites_in": len(sites)}

    # ---- 1. join every site to a market -------------------------------
    joined = []
    for s in sites:
        g = geo.resolve(s)
        row = {
            "id": s.get("id"), "brand": s.get("brand"), "brand_id": s.get("brand_id"),
            "name": s.get("name"), "category": s.get("category"),
            "platform": s.get("platform"), "state": s.get("state"),
            "city": s.get("city"), "zip": s.get("zip"),
            "lat": s.get("lat"), "lng": s.get("lng"),
            "geo_precision": s.get("geo_precision") or "ungeocoded",
            "enrolled": s.get("enrolled") or 0,
            "capacity": s.get("capacity") or 0,
            "fill_pct": s.get("fill_pct"),
            "price": s.get("price_monthly_equiv") if s.get("price_monthly_equiv")
                     else (s.get("price_low") if s.get("billing_interval") == "monthly" else None),
            "billing_model": s.get("billing_model"),
            "evidence_tier": s.get("evidence_tier"),
            "revenue_eligible": bool(s.get("revenue_eligible")),
            "est_annual_rev": s.get("est_annual_rev"),
            "visible": visible(s),
        }
        row.update(g)
        row["flags"] = plausibility_flags(row)
        row["plausible"] = not row["flags"]
        joined.append(row)

    report["geo_method"] = dict_count(joined, "geo_method")
    report["market_type"] = dict_count(joined, "market_type")
    report["unassigned_sites"] = sum(1 for r in joined if r["market_id"] is None)
    report["unassigned_examples"] = [
        "%s: %s (%s)" % (r["brand"], r["name"], r["state"])
        for r in joined if r["market_id"] is None][:20]

    all_vis = [r for r in joined if r["visible"] and r["market_id"]]
    vis = [r for r in all_vis if r["plausible"]]

    flagged = [r for r in all_vis if not r["plausible"]]
    fc = defaultdict(int)
    for r in flagged:
        for f in r["flags"]:
            fc[f] += 1
    report["plausibility"] = {
        "flagged_sites": len(flagged),
        "by_flag": dict(sorted(fc.items(), key=lambda kv: -kv[1])),
        "enrolled_excluded": sum(r["enrolled"] for r in flagged),
        "enrolled_excluded_pct": rnd(
            sum(r["enrolled"] for r in flagged)
            / max(sum(r["enrolled"] for r in all_vis), 1), 4),
        "capacity_excluded": sum(r["capacity"] for r in flagged),
        "revenue_excluded": round(sum(r["est_annual_rev"] or 0
                                      for r in flagged if r["revenue_eligible"])),
        "examples": [{"brand": r["brand"], "name": r["name"], "enrolled": r["enrolled"],
                      "capacity": r["capacity"], "price": r["price"],
                      "est_annual_rev": r["est_annual_rev"],
                      "platform": r["platform"], "evidence_tier": r["evidence_tier"],
                      "flags": r["flags"]}
                     for r in sorted(flagged, key=lambda r: -(r["capacity"] or 0))[:25]],
    }

    # ---- 2. national reference lines ----------------------------------
    nat_price = {}
    for cat in {r["category"] for r in vis}:
        nat_price[cat] = median([r["price"] for r in vis
                                 if r["category"] == cat and r["price"]])
    report["national_median_price_by_category"] = {k: rnd(v, 2) for k, v in nat_price.items()}

    # Which categories actually publish enrollment? A pass/membership model
    # (Urban Air) never reports enrolled, so its 0% coverage is a property of the
    # billing model, not a data gap — and must not drag a market's confidence down.
    enr_model = {}
    for cat in {r["category"] for r in vis}:
        rows = [r for r in vis if r["category"] == cat]
        share = sum(1 for r in rows if r["enrolled"] > 0) / len(rows)
        enr_model[cat] = "reported" if share >= 0.20 else "not_published"
    report["enrollment_model_by_category"] = enr_model

    # ---- 3. roll up: market x category and market total ----------------
    def cell(rows, market_id, category, dem):
        n = len(rows)
        # coverage is judged only over sites whose category publishes enrollment
        cov_rows = [r for r in rows if enr_model.get(r["category"]) == "reported"]
        enrolled = sum(r["enrolled"] for r in rows)
        capacity = sum(r["capacity"] for r in rows)
        rev = sum(r["est_annual_rev"] or 0 for r in rows if r["revenue_eligible"])
        with_enr = sum(1 for r in rows if r["enrolled"] > 0)
        with_price = sum(1 for r in rows if r["price"])
        with_rev = sum(1 for r in rows if r["revenue_eligible"])
        street = sum(1 for r in rows if r["geo_precision"] == "location")
        nc = len(cov_rows)
        cov_enr = (sum(1 for r in cov_rows if r["enrolled"] > 0) / nc) if nc else None
        if cov_enr is None:
            conf = "N"          # no enrollment-reporting supply here — counts only
        else:
            conf = ("A" if cov_enr >= CONF_A_COVERAGE and nc >= CONF_A_MIN_SITES
                    else "B" if cov_enr >= CONF_B_COVERAGE else "C")

        # brand structure
        by_brand = defaultdict(lambda: {"enrolled": 0, "sites": 0})
        for r in rows:
            b = by_brand[r["brand"]]
            b["enrolled"] += r["enrolled"]
            b["sites"] += 1
        brands = sorted(by_brand.items(), key=lambda kv: -kv[1]["enrolled"])
        n_brands_enr = sum(1 for _, v in brands if v["enrolled"] > 0)
        hhi = cr4 = top_share = None
        if enrolled > 0 and n_brands_enr >= MIN_BRANDS_FOR_HHI:
            shares = [v["enrolled"] / enrolled for _, v in brands if v["enrolled"] > 0]
            hhi = round(sum((sh * 100) ** 2 for sh in shares))
            cr4 = rnd(sum(shares[:4]))
            top_share = rnd(shares[0])

        # utilization
        pair = [r for r in rows if r["enrolled"] > 0 and r["capacity"] > 0]
        fill = (sum(r["enrolled"] for r in pair) / sum(r["capacity"] for r in pair)
                if len(pair) >= MIN_SITES_FOR_FILL else None)
        open_seats = (sum(r["capacity"] - r["enrolled"] for r in pair)
                      if len(pair) >= MIN_SITES_FOR_FILL else None)
        at_cap = sum(1 for r in rows if (r["fill_pct"] or 0) >= 0.90)

        prices = [r["price"] for r in rows if r["price"]]
        p_med, p25, p75 = median(prices), pct(prices, .25), pct(prices, .75)

        denom_field = CATEGORY_DENOMINATOR.get(category, "kids_0_14")
        kids = (dem or {}).get(denom_field)
        kids014 = (dem or {}).get("kids_0_14")

        quotable = sum(r["enrolled"] for r in rows
                       if r["evidence_tier"] in QUOTABLE_TIERS)

        out = {
            "market_id": market_id, "category": category,
            "sites": n, "brands": len(by_brand),
            "enrolled": enrolled, "capacity": capacity,
            "est_annual_rev": round(rev) if rev else 0,
            "cov_enrollment": rnd(cov_enr, 3),
            "cov_enrollment_basis_sites": nc,
            "enrollment_model": (enr_model.get(category) if category != "__all__"
                                 else ("mixed" if 0 < nc < n else
                                       "reported" if nc else "not_published")),
            "cov_price": rnd(with_price / n, 3) if n else None,
            "cov_revenue": rnd(with_rev / n, 3) if n else None,
            "cov_street_geo": rnd(street / n, 3) if n else None,
            "confidence": conf,
            "pct_enrolled_quotable": rnd(quotable / enrolled, 3) if enrolled else None,
            "denominator_field": denom_field,
            "kids_denom": kids, "kids_0_14": kids014,
            "hhi": hhi, "cr4": cr4,
            "top_brand": brands[0][0] if brands else None,
            "top_brand_share": top_share,
            "brand_mix": [{"brand": b, "sites": v["sites"], "enrolled": v["enrolled"],
                           "share": rnd(v["enrolled"] / enrolled) if enrolled else None}
                          for b, v in brands[:12]],
            "fill_rate": rnd(fill, 3), "open_seats": open_seats,
            "sites_at_capacity": at_cap,
            "price_median": rnd(p_med, 2), "price_p25": rnd(p25, 2), "price_p75": rnd(p75, 2),
            "price_headroom": rnd(p75 - p_med, 2) if (p75 is not None and p_med is not None) else None,
            "price_index": rnd(100 * p_med / nat_price[category], 1)
                           if (category in nat_price and nat_price.get(category) and p_med) else None,
        }
        # demand-gated metrics — blanked, never zeroed, when there is no denominator
        # Density needs only a demand denominator.
        if kids and n:
            out["sites_per_100k_kids"] = rnd(n / kids * 1e5, 2)
            out["kids_per_site"] = round(kids / n)
        else:
            out["sites_per_100k_kids"] = out["kids_per_site"] = None
        # Penetration and spend additionally need usable enrollment coverage.
        if kids and conf in ("A", "B"):
            out["penetration_observed"] = rnd(enrolled / kids, 5)
            out["penetration_adjusted"] = rnd((enrolled / kids) / cov_enr, 5) if cov_enr else None
            out["spend_per_kid"] = rnd(rev / kids, 2) if rev else None
            out["spend_per_enrolled"] = rnd(rev / enrolled, 2) if enrolled else None
        else:
            for k in ("penetration_observed", "penetration_adjusted",
                      "spend_per_kid", "spend_per_enrolled"):
                out[k] = None
        return out

    by_mk = defaultdict(list)
    by_m = defaultdict(list)
    for r in vis:
        by_mk[(r["market_id"], r["category"])].append(r)
        by_m[r["market_id"]].append(r)

    markets = {}
    for mid, rows in by_m.items():
        dem = geo.market_demand(mid) or {}
        sample = rows[0]
        tot = cell(rows, mid, "__all__", dem)
        tot.pop("price_index", None)
        markets[mid] = {
            "market_id": mid,
            "market_name": sample["market_name"],
            "market_type": sample["market_type"],
            "state": sample.get("state_name") or sample.get("state"),
            "csa_name": sample.get("csa_name"),
            "demand": {
                "pop": dem.get("pop"), "kids_0_4": dem.get("k0_4"),
                "kids_0_14": dem.get("kids_0_14"), "kids_5_14": dem.get("kids_5_14"),
                "kids_0_17": dem.get("kids_0_17"),
                "households": dem.get("households"),
                "hh_with_kids": dem.get("hh_with_kids"),
                "median_hh_income": dem.get("median_hh_income"),
                "income_index": rnd(100 * dem["median_hh_income"] / NATIONAL_MEDIAN_HH_INCOME, 1)
                                if dem.get("median_hh_income") else None,
            },
            "total": tot,
            "categories": {},
        }
    for (mid, cat), rows in by_mk.items():
        markets[mid]["categories"][cat] = cell(rows, mid, cat, geo.market_demand(mid) or {})

    # ---- 4. whitespace, percentile-ranked within category --------------
    for cat in {c for m in markets.values() for c in m["categories"]}:
        pool = [(mid, m["categories"][cat], m["demand"])
                for mid, m in markets.items()
                if cat in m["categories"] and m["categories"][cat]["confidence"] in ("A", "B")]
        axes = {
            "kids": sorted(d.get("kids_0_14") for _, c, d in pool if d.get("kids_0_14")),
            "spk": sorted(c["sites_per_100k_kids"] for _, c, _ in pool if c["sites_per_100k_kids"]),
            "fill": sorted(c["fill_rate"] for _, c, _ in pool if c["fill_rate"]),
            "inc": sorted(d.get("median_hh_income") for _, c, d in pool if d.get("median_hh_income")),
        }
        for mid, c, d in pool:
            comps, used = [], []
            v = percentile_rank(d.get("kids_0_14"), axes["kids"])
            if v is not None:
                comps.append(v); used.append("demand")
            v = percentile_rank(c["sites_per_100k_kids"], axes["spk"])
            if v is not None:
                comps.append(1 - v); used.append("underbuilt")
            v = percentile_rank(c["fill_rate"], axes["fill"])
            if v is not None:
                comps.append(v); used.append("tightness")
            v = percentile_rank(d.get("median_hh_income"), axes["inc"])
            if v is not None:
                comps.append(v); used.append("affluence")
            c["whitespace"] = round(100 * sum(comps) / len(comps), 1) if comps else None
            c["whitespace_components_used"] = used
            # A big metro where we can see only a handful of sites is more likely a
            # hole in the universe than a hole in the market. Rank it separately.
            c["low_observed_supply"] = bool(
                c["sites"] < 4 and (d.get("kids_0_14") or 0) > 200_000)

    # ---- 5. trade areas (ZCTA grain) ----------------------------------
    trade = build_trade_areas(vis, geo)

    # ---- 6. national roll-up ------------------------------------------
    nat = {}
    for cat in sorted({r["category"] for r in vis}):
        rows = [r for r in vis if r["category"] == cat]
        nat[cat] = cell(rows, "US", cat, None)
    nat["__all__"] = cell(vis, "US", "__all__", None)

    out = {
        "meta": {
            "as_of": snap.get("as_of"),
            "week": {"from": snap.get("week_start"), "to": snap.get("week_end")},
            "generated_from": "dashboard/data/sites.js",
            "demand_source": "ACS 2023 5-year (B01001, B19013, B11005) via Census table-based summary file",
            "geography": "OMB CBSA 2023 delineation; ZIP->ZCTA->county->CBSA",
            "national_median_hh_income": NATIONAL_MEDIAN_HH_INCOME,
            "national_median_price_by_category": report["national_median_price_by_category"],
            "definitions": "METRICS.md",
            "caveat": ("Share and penetration are measured against platform-visible supply only "
                       "(Unleashed, iClassPro, Jackrabbit, Pike13, My Gym). Off-platform "
                       "independents are not in the universe, so shares are upper bounds and "
                       "penetration figures are lower bounds."),
            "n_markets": len(markets),
            "n_trade_areas": len(trade),
            "unassigned_sites": report["unassigned_sites"],
            "plausibility": report["plausibility"],
            "enrollment_model_by_category": enr_model,
        },
        "national": nat,
        "markets": markets,
        "trade_areas": trade,
    }

    ddir = os.path.join(root, "dashboard", "data")
    write_js_global(os.path.join(ddir, "markets.js"), "MARKETINTEL_MARKETS", out)
    write_js_global(os.path.join(ddir, "sites_geo.js"), "MARKETINTEL_SITEGEO",
                    {"meta": {"as_of": snap.get("as_of")}, "sites": joined})

    report.update(qa(out, joined))
    json.dump(report, open(os.path.join(root, "build_report.json"), "w"), indent=1)
    return out, report


def build_trade_areas(vis, geo, radii=(5, 10)):
    """ZCTA-grain rings, restricted to ZCTAs in metros that contain supply."""
    live_cbsas = {r["cbsa"] for r in vis if r["cbsa"]}
    pts = [r for r in vis if r["lat"] is not None and r["lng"] is not None]

    # candidate ZCTAs: those whose county sits in a CBSA that has supply
    cands = []
    for z, dem in geo.demand_zcta.items():
        if (dem.get("kids_0_14") or 0) < THIN_DEMAND_KIDS:
            continue
        county = geo.zcta_county.get(z)
        cb = geo.county_cbsa.get(county) if county else None
        if not cb or cb["cbsa"] not in live_cbsas or cb["type"] != "metro":
            continue
        cands.append((z, dem, cb))

    zpt = geo.zcta_centroid          # 2024 Census Gazetteer internal points

    # grid index for speed
    grid = defaultdict(list)
    for r in pts:
        grid[(int(r["lat"] * 4), int(r["lng"] * 4))].append(r)

    def near(lat, lng, miles):
        span = int(miles / 15) + 1
        gy, gx = int(lat * 4), int(lng * 4)
        for dy in range(-span, span + 1):
            for dx in range(-span, span + 1):
                for r in grid.get((gy + dy, gx + dx), ()):
                    if haversine(lat, lng, r["lat"], r["lng"]) <= miles:
                        yield r

    out = []
    for z, dem, cb in cands:
        p = zpt.get(z)
        if not p:
            continue
        lat, lng = p
        row = {"zcta": z, "cbsa": cb["cbsa"], "cbsa_name": cb["cbsa_name"],
               "county_fips": geo.zcta_county.get(z),
               "lat": lat, "lng": lng,
               "kids_0_14": dem.get("kids_0_14"), "kids_5_14": dem.get("kids_5_14"),
               "kids_0_4": dem.get("k0_4"),
               "households": dem.get("households"), "hh_with_kids": dem.get("hh_with_kids"),
               "median_hh_income": dem.get("median_hh_income"),
               "distance_method": "haversine"}
        for mi in radii:
            ring = list(near(lat, lng, mi))
            row["sites_%dmi" % mi] = len(ring)
            row["brands_%dmi" % mi] = len({r["brand"] for r in ring})
            row["enrolled_%dmi" % mi] = sum(r["enrolled"] for r in ring)
            row["capacity_%dmi" % mi] = sum(r["capacity"] for r in ring)
            pair = [r for r in ring if r["enrolled"] > 0 and r["capacity"] > 0]
            row["fill_%dmi" % mi] = (rnd(sum(r["enrolled"] for r in pair)
                                         / sum(r["capacity"] for r in pair), 3)
                                     if len(pair) >= MIN_SITES_FOR_FILL else None)
            row["cat_mix_%dmi" % mi] = dict_count(ring, "category")
        row["kids_per_site_10mi"] = (round(row["kids_0_14"] / row["sites_10mi"])
                                     if row["sites_10mi"] else None)
        nearest = None
        for r in near(lat, lng, 60):
            d = haversine(lat, lng, r["lat"], r["lng"])
            if nearest is None or d < nearest:
                nearest = d
        row["nearest_competitor_mi"] = rnd(nearest, 2)
        out.append(row)

    # trade-area whitespace, within metro
    by_cbsa = defaultdict(list)
    for r in out:
        by_cbsa[r["cbsa"]].append(r)
    for cbsa, rows in by_cbsa.items():
        axes = {
            "kids": sorted(r["kids_0_14"] for r in rows if r["kids_0_14"]),
            "spk": sorted(r["sites_10mi"] / r["kids_0_14"] * 1e5 for r in rows if r["kids_0_14"]),
            "fill": sorted(r["fill_10mi"] for r in rows if r["fill_10mi"]),
            "inc": sorted(r["median_hh_income"] for r in rows if r["median_hh_income"]),
        }
        for r in rows:
            comps, used = [], []
            v = percentile_rank(r["kids_0_14"], axes["kids"])
            if v is not None:
                comps.append(v); used.append("demand")
            spk = r["sites_10mi"] / r["kids_0_14"] * 1e5 if r["kids_0_14"] else None
            v = percentile_rank(spk, axes["spk"])
            if v is not None:
                comps.append(1 - v); used.append("underbuilt")
            v = percentile_rank(r["fill_10mi"], axes["fill"])
            if v is not None:
                comps.append(v); used.append("tightness")
            v = percentile_rank(r["median_hh_income"], axes["inc"])
            if v is not None:
                comps.append(v); used.append("affluence")
            r["ta_whitespace"] = round(100 * sum(comps) / len(comps), 1) if comps else None
            r["ta_components_used"] = used
    return out


def dict_count(rows, field):
    c = defaultdict(int)
    for r in rows:
        c[r.get(field) or "null"] += 1
    return dict(sorted(c.items(), key=lambda kv: -kv[1]))


# ---------------------------------------------------------------- QA

def qa(out, joined):
    vis = [r for r in joined if r["visible"] and r["plausible"]]
    m = out["markets"]
    r = {
        "qa_sites_visible_plausible": len(vis),
        "qa_sites_visible": sum(1 for x in joined if x["visible"]),
        "qa_sites_in_markets": sum(c["total"]["sites"] for c in m.values()),
        "qa_enrolled_source": sum(x["enrolled"] for x in vis),
        "qa_enrolled_rolled": sum(c["total"]["enrolled"] for c in m.values()),
        "qa_rev_source": round(sum(x["est_annual_rev"] or 0 for x in vis if x["revenue_eligible"])),
        "qa_rev_rolled": sum(c["total"]["est_annual_rev"] for c in m.values()),
        "qa_confidence_mix": dict_count(
            [{"c": c["total"]["confidence"]} for c in m.values()], "c"),
        "qa_markets_without_demand": sum(
            1 for c in m.values() if not (c["demand"] or {}).get("kids_0_14")),
    }
    unassigned_plausible = sum(1 for x in joined
                               if x["visible"] and x["plausible"] and not x["market_id"])
    r["qa_site_reconcile_ok"] = (r["qa_sites_visible_plausible"] - r["qa_sites_in_markets"]
                                 == unassigned_plausible)
    r["qa_unassigned_plausible"] = unassigned_plausible
    r["qa_enrolled_reconcile_delta"] = r["qa_enrolled_source"] - r["qa_enrolled_rolled"]
    # repeated-value bug signal
    latlngs = defaultdict(int)
    for x in vis:
        if x["lat"] is not None:
            latlngs[(round(x["lat"], 4), round(x["lng"], 4))] += 1
    worst = sorted(latlngs.items(), key=lambda kv: -kv[1])[:5]
    r["qa_repeated_coords_top5"] = [{"at": "%s,%s" % k, "n": v} for k, v in worst]
    return r


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    a = ap.parse_args()
    _, rep = build(a.root)
    print(json.dumps(rep, indent=1)[:4000])
