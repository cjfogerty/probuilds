#!/usr/bin/env python3
"""Add Greenville Gymnastics and Gymnastics Academy of Charleston to the
live dashboard packs (sites.js + SPA JSON), then rebuild markets.

Both gyms are public Jackrabbit orgs that were not in the 1547-site pack.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DASH = os.path.join(ROOT, "dashboard", "data")
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)

from jackrabbit import fetch, parse_feed, summarise  # noqa: E402
from metro import assign as assign_metro  # noqa: E402
import build_markets  # noqa: E402

WEEK_START, WEEK_END = "2026-09-07", "2026-09-13"
AS_OF = "2026-09-06"

GYMS = [
    dict(
        org="494652",
        brand="Greenville Gymnastics",
        name="Greenville Gymnastics — Greenville, SC",
        slug="greenville-gymnastics",
        city="Greenville",
        state="SC",
        zip="29607",
        phone="864-297-5589",
        lat=34.830992338243,
        lng=-82.305957993149,
        color="#6366F1",
        program_id="greenville_gymnastics_classes",
        program_name="Greenville Gymnastics Classes",
        billing_notes="JR observed-max seat model from public OpeningsJS; semester tuition",
    ),
    dict(
        org="509080",
        brand="Gymnastics Academy of Charleston",
        name="Gymnastics Academy of Charleston — Charleston, SC",
        slug="gymnastics-academy-of-charleston",
        city="Charleston",
        state="SC",
        zip="29492",
        phone="843-856-2200",
        lat=32.902896334823,
        lng=-79.912265795359,
        color="#F97316",
        program_id="gac_charleston_classes",
        program_name="Gymnastics Academy of Charleston Classes",
        billing_notes="JR observed-max seat model from public OpeningsJS; session tuition",
    ),
]


def load_js(path):
    raw = open(path, encoding="utf-8").read()
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def save_js(path, varname, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write("window.%s = " % varname)
        json.dump(obj, f, separators=(",", ":"), allow_nan=False)
        f.write(";\n")


def pull_org(org):
    rows = parse_feed(fetch(org))
    if not rows:
        raise SystemExit(f"empty OpeningsJS feed for org {org}")
    s = summarise(rows, org_rows=rows)
    print(f"  org {org}: {s['classes']} classes, enrolled {s['est_enrolled']}/{s['derived_capacity']}")
    return s


def site_row(g, stats):
    enrolled = int(stats["est_enrolled"])
    capacity = int(stats["derived_capacity"])
    price = float(stats["monthly_median"]) if stats.get("monthly_median") else None
    fill = round(100 * enrolled / capacity, 1) if capacity else None
    monthly = round(enrolled * price, 2) if price else None
    annual = round(monthly * 12, 2) if monthly is not None else None
    weekly = round(monthly * 12 / 52, 2) if monthly is not None else None
    metro, dist = assign_metro(g["lat"], g["lng"])
    return {
        "id": g["org"],
        "brand_id": f"jr_{g['org']}",
        "brand": g["brand"],
        "name": g["name"],
        "slug": g["slug"],
        "zip": g["zip"],
        "phone": g["phone"],
        "metro": metro,
        "metro_original": metro,
        "metro_cbsa": metro,
        "metro_distance_km": dist,
        "metro_source": "cbsa_centroid",
        "city": g["city"],
        "state": g["state"],
        "lat": g["lat"],
        "lng": g["lng"],
        "geo_precision": "location",
        "n_classes": int(stats["classes"]),
        "enrolled": enrolled,
        "capacity": capacity,
        "fill_pct": fill,
        "intro_slots_open": 0,
        "price_low": price,
        "price_low_name": f"JR group median tuition (${price})" if price else None,
        "billing_interval": "monthly",
        "n_products": 0,
        "likely_closed": False,
        "is_junk": False,
        "evidence_tier": "observed_max",
        "platform": "jackrabbit",
        "est_monthly_rev": monthly,
        "est_annual_rev": annual,
        "est_weekly_rev": weekly,
        "revenue_eligible": bool(price and enrolled),
        "revenue_note": "rollable_term_session_per_enrollee_month" if price else None,
        "color": g["color"],
        "category": "gymnastics",
        "program_id": g["program_id"],
        "program_name": g["program_name"],
        "session_model": "term_session",
        "session_name": None,
        "session_start": None,
        "session_end": None,
        "session_dates_status": "current",
        "price_unit": "per_month",
        "billing_model": "term_session",
        "revenue_unit": "per_enrollee_month",
        "revenue_rollable": bool(price and enrolled),
        "term_months": None,
        "term_days": None,
        "price_monthly_equiv": price,
        "billing_notes": g["billing_notes"],
        "lessons_per_month_assumed": 4.0,
        "observation_week_start": WEEK_START,
        "observation_week_end": WEEK_END,
        "week_start": WEEK_START,
        "week_end": WEEK_END,
    }


def slim_site(s):
    keys = [
        "id", "brand", "brand_id", "name", "category", "platform", "city", "state",
        "zip", "metro", "lat", "lng", "geo_precision", "enrolled", "capacity",
        "fill_pct", "price_low", "price_monthly_equiv", "est_monthly_rev",
        "est_annual_rev", "n_classes", "n_products", "evidence_tier",
        "billing_model", "program_name", "phone", "color", "likely_closed",
        "is_junk", "revenue_eligible",
    ]
    return {k: s[k] for k in keys if k in s}


def brand_meta(s):
    return {
        "id": s["brand_id"],
        "name": s["brand"],
        "color": s["color"],
        "revenue": True,
        "note": "Tuition estimate when priced",
        "sites": 1,
        "enrolled": s["enrolled"],
        "platform": "jackrabbit",
    }


def brand_json(s):
    return {
        "id": s["brand_id"],
        "name": s["brand"],
        "color": s["color"],
        "revenue": True,
        "note": "Tuition estimate when priced",
        "platform": "jackrabbit",
        "sites": 1,
        "enrolled": s["enrolled"],
        "capacity": s["capacity"],
        "est_annual_rev": s["est_annual_rev"],
        "category": "gymnastics",
        "states": [s["state"]],
        "n_states": 1,
        "price_median": s["price_low"],
    }


def rebuild_metros(sites):
    vis = [s for s in sites if not s.get("is_junk") and not s.get("likely_closed")]
    by = {}
    for s in vis:
        m = (s.get("metro") or "").strip()
        if not m:
            continue
        row = by.setdefault(m, {"metro": m, "sites": 0, "enrolled": 0,
                                "est_annual_rev": 0.0, "brands": set(),
                                "lats": [], "lngs": [], "states": set()})
        row["sites"] += 1
        row["enrolled"] += int(s.get("enrolled") or 0)
        if s.get("revenue_eligible") and s.get("est_annual_rev"):
            row["est_annual_rev"] += float(s["est_annual_rev"])
        if s.get("brand"):
            row["brands"].add(s["brand"])
        if s.get("lat") and s.get("lng"):
            row["lats"].append(s["lat"]); row["lngs"].append(s["lng"])
        if s.get("state"):
            row["states"].add(s["state"])
    out = []
    for m, r in by.items():
        out.append({
            "metro": m,
            "sites": r["sites"],
            "enrolled": r["enrolled"],
            "est_annual_rev": round(r["est_annual_rev"], 2),
            "brands": sorted(r["brands"]),
            "lat": round(sum(r["lats"]) / len(r["lats"]), 4) if r["lats"] else None,
            "lng": round(sum(r["lngs"]) / len(r["lngs"]), 4) if r["lngs"] else None,
            "states": sorted(r["states"]),
        })
    out.sort(key=lambda x: (-x["sites"], x["metro"]))
    return out


def main():
    sites_doc = load_js(os.path.join(DASH, "sites.js"))
    rows = sites_doc["snapshots"][0]["sites"]
    existing = {str(s.get("id")) for s in rows}

    added = []
    print("pulling Jackrabbit openings…")
    for g in GYMS:
        if g["org"] in existing:
            print(f"  skip {g['brand']} — already in pack")
            continue
        stats = pull_org(g["org"])
        rec = site_row(g, stats)
        rows.append(rec)
        added.append(rec)
        print(f"  + {rec['name']}  enrolled={rec['enrolled']} cap={rec['capacity']} "
              f"util={rec['fill_pct']}% metro={rec['metro']}")

    if not added:
        print("nothing to add")
        return

    brands = sites_doc["meta"].setdefault("brands", [])
    have = {b.get("name") for b in brands}
    for rec in added:
        if rec["brand"] not in have:
            brands.append(brand_meta(rec))
            have.add(rec["brand"])
    brands.sort(key=lambda b: (b.get("name") or "").lower())
    sites_doc["meta"]["brands"] = brands
    sites_doc["meta"]["n_sites"] = len(rows)
    sites_doc["snapshots"][0]["sites"] = rows
    save_js(os.path.join(DASH, "sites.js"), "MARKETINTEL", sites_doc)
    print(f"wrote sites.js ({len(rows)} sites)")

    slim_path = os.path.join(DASH, "sites.json")
    slim = json.load(open(slim_path))
    slim_ids = {str(s.get("id")) for s in slim}
    for rec in added:
        if rec["id"] not in slim_ids:
            slim.append(slim_site(rec))
    json.dump(slim, open(slim_path, "w"), separators=(",", ":"))
    open(slim_path, "a").write("\n")
    print(f"wrote sites.json ({len(slim)} sites)")

    bpath = os.path.join(DASH, "brands.json")
    brands_j = json.load(open(bpath))
    have_j = {b.get("name") for b in brands_j}
    for rec in added:
        if rec["brand"] not in have_j:
            brands_j.append(brand_json(rec))
            have_j.add(rec["brand"])
    brands_j.sort(key=lambda b: (b.get("name") or "").lower())
    json.dump(brands_j, open(bpath, "w"), separators=(",", ":"))
    open(bpath, "a").write("\n")
    print(f"wrote brands.json ({len(brands_j)} brands)")

    metros = rebuild_metros(rows)
    mpath = os.path.join(DASH, "metros.json")
    json.dump(metros, open(mpath, "w"), separators=(",", ":"))
    open(mpath, "a").write("\n")
    print(f"wrote metros.json ({len(metros)} metros)")

    print("rebuilding markets…")
    out, rep = build_markets.build(ROOT)
    markets_list = list(out["markets"].values()) if isinstance(out["markets"], dict) else out["markets"]
    markets_json = {
        "meta": {k: v for k, v in out["meta"].items()
                 if k not in ("plausibility", "enrollment_model_by_category")},
        "national": out["national"],
        "markets": markets_list,
    }
    # keep SPA meta fields the previous file used
    prev_meta = json.load(open(os.path.join(DASH, "markets.json"))).get("meta", {})
    for k in ("as_of", "week", "source", "generated", "revenue_methodology",
              "legend_notes", "presets", "geo_stats", "data_quality",
              "n_sites_raw", "n_sites_visible", "n_brands", "n_markets",
              "n_trade_areas", "unassigned_sites"):
        if k in prev_meta and k not in markets_json["meta"]:
            markets_json["meta"][k] = prev_meta[k]
    vis = [s for s in rows if not s.get("is_junk") and not s.get("likely_closed")]
    markets_json["meta"]["n_sites_raw"] = len(rows)
    markets_json["meta"]["n_sites_visible"] = len(vis)
    markets_json["meta"]["n_brands"] = len({s.get("brand") for s in vis if s.get("brand")})
    markets_json["meta"]["n_markets"] = len(markets_list)
    mj = os.path.join(DASH, "markets.json")
    json.dump(markets_json, open(mj, "w"), separators=(",", ":"))
    open(mj, "a").write("\n")
    print(f"wrote markets.json ({len(markets_list)} markets)")

    meta = json.load(open(os.path.join(DASH, "meta.json")))
    meta["n_sites_raw"] = len(rows)
    meta["n_sites_visible"] = len(vis)
    meta["n_brands"] = markets_json["meta"]["n_brands"]
    meta["n_markets"] = len(markets_list)
    json.dump(meta, open(os.path.join(DASH, "meta.json"), "w"), indent=2)
    open(os.path.join(DASH, "meta.json"), "a").write("\n")
    print("wrote meta.json")
    print("qa_sites_visible", rep.get("qa_sites_visible"),
          "unassigned", rep.get("unassigned_sites"))


if __name__ == "__main__":
    main()
