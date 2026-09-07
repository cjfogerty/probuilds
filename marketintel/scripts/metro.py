#!/usr/bin/env python3
"""Metro rollup + assignment for the market-intel site universe.

Why this exists: the `metro` field in data/sites.js is not a metro field. Of its
192 distinct values, many are individual suburbs ("Hoboken", "Chevy Chase",
"Fresh Meadows"), one is a state ("California"), and 454 visible sites carry no
value at all. Any sites-per-million ranking built on it understates every large
metro, because that metro's suburbs are counted as separate "metros".

This module assigns every site with coordinates to a CBSA by nearest-centroid
within a population-scaled radius. Offline, stdlib only, no geocoding calls --
the coordinates are already in the data pack.

    python3 metro.py audit  dashboard/data/sites.js
    python3 metro.py assign dashboard/data/sites.js --out sites_metro_v3.json
    python3 metro.py gaps   dashboard/data/sites.js
"""
import argparse, json, math, sys
from collections import Counter, defaultdict

# (name, lat, lng, population_millions). Approximate 2023 CBSA centroids and
# populations -- good enough to rank density, NOT a substitute for a Census join.
# Replace with a real CBSA shapefile join when accuracy matters.
CBSA = [
    ("New York", 40.71, -74.01, 19.5), ("Los Angeles", 34.05, -118.24, 12.8),
    ("Chicago", 41.88, -87.63, 9.3), ("Dallas-Fort Worth", 32.78, -96.80, 8.1),
    ("Houston", 29.76, -95.37, 7.5), ("Atlanta", 33.75, -84.39, 6.3),
    ("Washington DC", 38.90, -77.04, 6.3), ("Philadelphia", 39.95, -75.17, 6.25),
    ("Miami", 25.77, -80.19, 6.2), ("Phoenix", 33.45, -112.07, 5.1),
    ("Boston", 42.36, -71.06, 4.9), ("Riverside-San Bernardino", 33.95, -117.40, 4.7),
    ("San Francisco Bay", 37.77, -122.42, 4.6), ("Detroit", 42.33, -83.05, 4.3),
    ("Seattle", 47.61, -122.33, 4.1), ("Minneapolis", 44.98, -93.27, 3.7),
    ("Tampa", 27.95, -82.46, 3.3), ("San Diego", 32.72, -117.16, 3.3),
    ("Denver", 39.74, -104.99, 3.0), ("Baltimore", 39.29, -76.61, 2.8),
    ("Orlando", 28.54, -81.38, 2.8), ("Charlotte", 35.23, -80.84, 2.8),
    ("St. Louis", 38.63, -90.20, 2.8), ("San Antonio", 29.42, -98.49, 2.6),
    ("Portland", 45.52, -122.68, 2.5), ("Austin", 30.27, -97.74, 2.5),
    ("Sacramento", 38.58, -121.49, 2.4), ("Pittsburgh", 40.44, -79.996, 2.4),
    ("Las Vegas", 36.17, -115.14, 2.3), ("Cincinnati", 39.10, -84.51, 2.3),
    ("Kansas City", 39.10, -94.58, 2.2), ("Columbus", 39.96, -83.00, 2.2),
    ("Indianapolis", 39.77, -86.16, 2.1), ("Cleveland", 41.50, -81.69, 2.1),
    ("Nashville", 36.16, -86.78, 2.1), ("San Jose", 37.34, -121.89, 2.0),
    ("Virginia Beach", 36.85, -76.29, 1.8), ("Jacksonville", 30.33, -81.66, 1.7),
    ("Providence", 41.82, -71.41, 1.68), ("Milwaukee", 43.04, -87.91, 1.57),
    ("Raleigh", 35.78, -78.64, 1.5), ("Oklahoma City", 35.47, -97.52, 1.5),
    ("Louisville", 38.25, -85.76, 1.4), ("Richmond", 37.54, -77.44, 1.4),
    ("Memphis", 35.15, -90.05, 1.34), ("Salt Lake City", 40.76, -111.89, 1.3),
    ("Hartford", 41.76, -72.67, 1.21), ("Birmingham", 33.52, -86.80, 1.18),
    ("Fresno", 36.74, -119.79, 1.18), ("Grand Rapids", 42.96, -85.67, 1.16),
    ("Buffalo", 42.89, -78.88, 1.16), ("Rochester", 43.16, -77.61, 1.09),
    ("Tucson", 32.22, -110.97, 1.06), ("Tulsa", 36.15, -95.99, 1.04),
    ("Honolulu", 21.31, -157.86, 1.0), ("Omaha", 41.26, -95.93, 0.98),
    ("Worcester", 42.26, -71.80, 0.98), ("Greenville", 34.85, -82.39, 0.98),
    ("New Orleans", 29.95, -90.07, 0.96), ("Bridgeport-Stamford", 41.18, -73.19, 0.96),
    ("Albuquerque", 35.08, -106.65, 0.92), ("Bakersfield", 35.37, -119.02, 0.92),
    ("Knoxville", 35.96, -83.92, 0.93), ("McAllen", 26.20, -98.23, 0.89),
    ("El Paso", 31.76, -106.49, 0.87), ("Allentown", 40.60, -75.47, 0.87),
    ("Baton Rouge", 30.45, -91.19, 0.87), ("North Port-Sarasota", 27.34, -82.54, 0.86),
    ("Columbia SC", 34.00, -81.03, 0.85), ("Charleston SC", 32.78, -79.93, 0.85),
    ("Oxnard-Ventura", 34.20, -119.18, 0.84), ("Cape Coral-Fort Myers", 26.56, -81.87, 0.83),
    ("Boise", 43.62, -116.20, 0.83), ("Stockton", 37.96, -121.29, 0.79),
    ("Lakeland", 28.04, -81.95, 0.79), ("Greensboro", 36.07, -79.79, 0.79),
    ("Colorado Springs", 38.83, -104.82, 0.77), ("Little Rock", 34.75, -92.29, 0.75),
    ("Des Moines", 41.59, -93.62, 0.75), ("Provo-Orem", 40.23, -111.66, 0.73),
    ("Ogden", 41.22, -111.97, 0.72), ("Akron", 41.08, -81.52, 0.70),
    ("Winston-Salem", 36.10, -80.24, 0.70), ("Springfield MA", 42.10, -72.59, 0.70),
    ("Deltona-Daytona", 29.02, -81.30, 0.70), ("Madison", 43.07, -89.40, 0.69),
    ("Durham-Chapel Hill", 35.99, -78.90, 0.65), ("Syracuse", 43.05, -76.15, 0.65),
    ("Wichita", 37.69, -97.34, 0.65), ("Toledo", 41.65, -83.54, 0.64),
    ("Palm Bay-Melbourne", 28.08, -80.61, 0.63), ("Augusta", 33.47, -81.97, 0.62),
    ("Harrisburg", 40.27, -76.88, 0.60), ("Spokane", 47.66, -117.43, 0.60),
    ("Fayetteville AR", 36.06, -94.16, 0.59), ("Chattanooga", 35.05, -85.31, 0.58),
    ("Scranton", 41.41, -75.66, 0.57), ("Portland ME", 43.66, -70.26, 0.56),
    ("Lancaster PA", 40.04, -76.31, 0.56), ("Reno", 39.53, -119.81, 0.51),
    ("Pensacola", 30.42, -87.22, 0.51), ("Huntsville", 34.73, -86.59, 0.51),
    ("Corpus Christi", 27.80, -97.40, 0.44), ("Fort Wayne", 41.08, -85.14, 0.43),
    ("Asheville", 35.60, -82.55, 0.47), ("Visalia", 36.33, -119.29, 0.47),
    ("Killeen", 31.12, -97.73, 0.47), ("Ann Arbor", 42.28, -83.74, 0.37),
    ("Waco", 31.55, -97.15, 0.29), ("Tyler", 32.35, -95.30, 0.24),
]

R_EARTH_KM = 6371.0


def haversine(a_lat, a_lng, b_lat, b_lng):
    p = math.pi / 180
    dlat = (b_lat - a_lat) * p
    dlng = (b_lng - a_lng) * p
    h = (math.sin(dlat / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin(dlng / 2) ** 2)
    return 2 * R_EARTH_KM * math.asin(math.sqrt(h))


def radius_km(pop_m):
    """Big metros sprawl further. 40km floor, 90km ceiling."""
    return max(40.0, min(90.0, 35.0 + 18.0 * math.sqrt(pop_m)))


def assign(lat, lng):
    """Return (metro_name, distance_km) or (None, None) when nothing is in range."""
    if lat is None or lng is None:
        return None, None
    best, best_d = None, None
    for name, mlat, mlng, pop in CBSA:
        d = haversine(lat, lng, mlat, mlng)
        if d <= radius_km(pop) and (best_d is None or d < best_d):
            best, best_d = name, d
    return best, (round(best_d, 1) if best_d is not None else None)


def load_sites(path):
    raw = open(path).read()
    if path.endswith(".js"):
        raw = raw.split("=", 1)[1].strip().rstrip(";")
    doc = json.loads(raw)
    if "snapshots" in doc:
        return doc, doc["snapshots"][0]["sites"]
    return doc, doc.get("sites", doc)


def visible(sites):
    return [s for s in sites if not s.get("is_junk") and not s.get("likely_closed")]


def cmd_audit(args):
    _, sites = load_sites(args.path)
    vis = visible(sites)
    cur = Counter(s.get("metro") or "(none)" for s in vis)
    print(f"{len(vis)} visible sites · {len(cur)} distinct current metro values\n")

    moved, gained, unchanged, unplaceable = [], 0, 0, 0
    for s in vis:
        new, d = assign(s.get("lat"), s.get("lng"))
        old = s.get("metro")
        if new is None:
            unplaceable += 1
        elif not old:
            gained += 1
        elif new != old:
            moved.append((old, new, s.get("name")))
        else:
            unchanged += 1

    print(f"  unchanged            {unchanged:5}")
    print(f"  gained a metro       {gained:5}  (had none)")
    print(f"  rolled up / moved    {len(moved):5}")
    print(f"  outside every CBSA   {unplaceable:5}  (genuinely non-metro, or no coords)\n")

    roll = Counter((o, n) for o, n, _ in moved)
    print("Largest rollups (current label -> CBSA):")
    for (o, n), c in roll.most_common(25):
        print(f"  {o[:26]:26} -> {n[:24]:24} {c:3}")


def cmd_assign(args):
    doc, sites = load_sites(args.path)
    for s in sites:
        new, d = assign(s.get("lat"), s.get("lng"))
        s["metro_cbsa"] = new
        s["metro_distance_km"] = d
        s["metro_source"] = ("cbsa_centroid" if new else
                             ("none_in_range" if s.get("lat") else "no_coordinates"))
        # Keep the original so nothing is lost and the change is auditable.
        s.setdefault("metro_original", s.get("metro"))
        if new:
            s["metro"] = new
    json.dump(doc, open(args.out, "w"), separators=(",", ":"))
    n = sum(1 for s in sites if s.get("metro_cbsa"))
    print(f"wrote {args.out} — {n}/{len(sites)} sites carry a CBSA metro")


def cmd_gaps(args):
    _, sites = load_sites(args.path)
    vis = visible(sites)
    INDIE = {"jackrabbit", "iclasspro", "pike13"}
    by = defaultdict(lambda: Counter())
    for s in vis:
        m, _ = assign(s.get("lat"), s.get("lng"))
        if m:
            by[m]["total"] += 1
            by[m][s.get("platform") or "?"] += 1
    pop = {n: p for n, _, _, p in CBSA}

    rows = []
    for m, c in by.items():
        indie = sum(c[p] for p in INDIE)
        rows.append({
            "metro": m, "pop_m": pop[m], "sites": c["total"],
            "indie": indie,
            "per_m": c["total"] / pop[m],
            "indie_per_m": indie / pop[m],
        })
    # Benchmark: the best-covered metro sets the standard we could reach elsewhere.
    bench = max(r["per_m"] for r in rows if r["pop_m"] >= 1.0)
    for r in rows:
        r["expected"] = r["pop_m"] * bench
        r["gap"] = max(0, round(r["expected"] - r["sites"]))
    rows.sort(key=lambda r: -r["gap"])

    print(f"benchmark density = {bench:.2f} sites per million "
          f"(best-covered metro ≥1M people)\n")
    print(f"{'metro':24} {'pop M':>6} {'sites':>6} {'indie':>6} "
          f"{'per M':>6} {'expect':>7} {'gap':>6}")
    for r in rows[:30]:
        print(f"{r['metro'][:24]:24} {r['pop_m']:6.1f} {r['sites']:6} {r['indie']:6} "
              f"{r['per_m']:6.2f} {r['expected']:7.0f} {r['gap']:6}")
    print(f"\ntotal modelled gap across all metros: {sum(r['gap'] for r in rows):,} sites")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("audit", cmd_audit), ("assign", cmd_assign), ("gaps", cmd_gaps)):
        p = sub.add_parser(name)
        p.add_argument("path")
        if name == "assign":
            p.add_argument("--out", default="sites_metro_v3.json")
        p.set_defaults(fn=fn)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
