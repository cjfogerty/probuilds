#!/usr/bin/env python3
"""Unleashed Brands shared backend — enrollment AND capacity, published outright.

Powers every Unleashed brand's public site: Urban Air, Snapology, The Little Gym,
Premier Martial Arts (brand 4, 308 US locations), Class 101, Sylvan, Water Wings.

No auth, no key. Works server-side. See PLATFORMS.md.

    python3 unleashed.py brands
    python3 unleashed.py parks 4
    python3 unleashed.py pull 4 --weeks 1 --out pma.json
"""
import argparse, datetime, json, os, statistics as st, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import get_json, write_json, write_csv

BASE = "https://unleashedapi.urbanairparks.com"
HDR = {"Origin": "https://store.unleashedbrands.com",
       "Referer": "https://store.unleashedbrands.com/"}


def brands():
    return (get_json(f"{BASE}/brands", HDR) or {}).get("data") or []


def parks(brand_id):
    return (get_json(f"{BASE}/brands/{brand_id}/parks", HDR) or {}).get("data") or []


def calendar(brand_id, park_id, frm, to):
    """One week is the right window. A wider range repeats each series once per
    occurrence -- a 90-day pull inflates enrollment ~12x."""
    url = (f"{BASE}/brands/{brand_id}/parks/{park_id}/events/calendars"
           f"?fromDate={frm}&toDate={to}")
    return (get_json(url, HDR, timeout=60) or {}).get("data") or []


def products(brand_id, park_id):
    """The productTypeIds params are REQUIRED -- without them this returns []."""
    url = (f"{BASE}/brands/{brand_id}/parks/{park_id}/products"
           f"?productTypeIds=1&productTypeIds=7")
    return (get_json(url, HDR) or {}).get("data") or []


def summarise(classes):
    """enrolled / capacity / open trial seats for one park-week."""
    enr = cap = intro = n = 0
    for c in classes:
        for d in c.get("details", []):
            if "reservationCount" not in d:
                continue
            r = d["reservationCount"]
            a = d.get("availableSlots", 0)
            enr += r
            cap += r + a
            intro += d.get("availableIntroSlots", 0)
            n += 1
    return {"n_classes": n, "enrolled": enr, "capacity": cap,
            "fill_pct": round(100 * enr / cap, 1) if cap else None,
            "intro_slots_open": intro}


def price_of(prods):
    """Cheapest ACTIVE recurring product = the comparable entry rate.

    A location showing a single ~$1000 product is on an annual/paid-in-full plan,
    not a monthly one -- check billingInterval before comparing across sites.
    """
    live = [p for p in prods if p.get("price") and p.get("isActive")]
    if not live:
        return {}
    cheapest = min(live, key=lambda p: p["price"])
    return {"price_low": cheapest["price"],
            "price_low_name": cheapest.get("parkProductName"),
            "billing_interval": cheapest.get("billingInterval"),
            "n_products": len(live)}


def week_window(weeks_ahead=0):
    today = datetime.date.today()
    monday = today + datetime.timedelta(days=(7 - today.weekday()) % 7 or 7)
    monday += datetime.timedelta(weeks=weeks_ahead)
    return monday.isoformat(), (monday + datetime.timedelta(days=6)).isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["brands", "parks", "pull"])
    ap.add_argument("brand_id", nargs="?", type=int)
    ap.add_argument("--weeks", type=int, default=0, help="weeks ahead for the window")
    ap.add_argument("--limit", type=int, default=0, help="stop after N parks (sampling)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    if a.cmd == "brands":
        for b in brands():
            print(f"  id={b['id']:<3} {b['name']:<26} classes={str(b.get('hasClasses')):5} "
                  f"memberships={str(b.get('hasMemberships')):5} slug={b.get('urlSlug')}")
        return

    if not a.brand_id:
        ap.error("brand_id required")

    pk = parks(a.brand_id)
    if a.cmd == "parks":
        print(f"{len(pk)} parks")
        for p in pk:
            print(f"  {p['name'][:34]:34} {p['id']}  slug={p.get('urlSlug')} "
                  f"zip={(p.get('address') or {}).get('zipCode')}")
        return

    frm, to = week_window(a.weeks)
    if a.limit:
        pk = pk[:a.limit]
    print(f"brand {a.brand_id}: {len(pk)} parks, week {frm} to {to}", flush=True)
    out = []
    for i, p in enumerate(pk, 1):
        # A "Z " name prefix marks a dead location on this platform. It still
        # carries products, so it will look like a zero-enrollment live site.
        dead = p["name"].startswith("Z ")
        s = summarise(calendar(a.brand_id, p["id"], frm, to))
        row = {"name": p["name"], "park_id": p["id"], "slug": p.get("urlSlug"),
               "zip": (p.get("address") or {}).get("zipCode"),
               "phone": p.get("phoneNumber"), "likely_closed": dead, **s}
        row.update(price_of(products(a.brand_id, p["id"])))
        out.append(row)
        if i % 25 == 0:
            print(f"  {i}/{len(pk)}", flush=True)
        time.sleep(0.15)

    live = [r for r in out if r["n_classes"] and not r["likely_closed"]]
    priced = [r for r in out if r.get("price_low")]
    print(f"\n{len(live)} with live classes, {len(priced)} with pricing, "
          f"{sum(1 for r in out if r['likely_closed'])} flagged closed")
    if live:
        e = sum(r["enrolled"] for r in live); c = sum(r["capacity"] for r in live)
        print(f"enrolled {e:,} / capacity {c:,} = {100*e/c:.1f}%")
    if priced:
        v = [r["price_low"] for r in priced]
        print(f"entry price: median ${st.median(v):.0f}  range ${min(v):.0f}-${max(v):.0f}")
    path = a.out or f"unleashed_brand{a.brand_id}.json"
    write_json(path, out)
    write_csv(path.replace(".json", ".csv"), out)


if __name__ == "__main__":
    main()
