#!/usr/bin/env python3
"""Geocoding and ring classification. Free sources only, no API keys.

    python3 geo.py geocode sites.csv --out sites_geo.csv
    python3 geo.py rings sites_geo.csv mine.csv --miles 10 --out classified.csv

sites.csv needs: name[,street][,city][,state][,zip]
mine.csv needs:  name,lat,lng
"""
import argparse, csv, json, math, os, sys, time, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import get_json, write_csv


def census(street, city, state, zipc=""):
    """Street-level, free, no key, no rate limit worth worrying about."""
    addr = ", ".join([p for p in (street, city, state) if p])
    if zipc:
        addr += f" {zipc}"
    q = urllib.parse.urlencode({"address": addr, "benchmark": "Public_AR_Current",
                                "format": "json"})
    j = get_json("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + q)
    m = ((j or {}).get("result") or {}).get("addressMatches") or []
    if m:
        return m[0]["coordinates"]["y"], m[0]["coordinates"]["x"], "street"
    return None, None, None


def photon(query):
    """City-level fallback. Use this, NOT Nominatim -- Nominatim 429s hard and
    will silently return nothing for a whole run."""
    q = urllib.parse.urlencode({"q": query, "limit": 1})
    j = get_json("https://photon.komoot.io/api/?" + q)
    ft = (j or {}).get("features") or []
    if ft:
        c = ft[0]["geometry"]["coordinates"]
        return c[1], c[0], "city_centroid"
    return None, None, None


def zip_centroid(zipc):
    j = get_json(f"https://api.zippopotam.us/us/{str(zipc)[:5]}")
    p = ((j or {}).get("places") or [None])[0]
    if p:
        return float(p["latitude"]), float(p["longitude"]), "zip_centroid"
    return None, None, None


def geocode_row(r, cache):
    """Street -> Census, then city -> Photon, then ZIP centroid."""
    if r.get("lat") and r.get("lng"):
        return float(r["lat"]), float(r["lng"]), r.get("geo_precision") or "given"
    if r.get("street") and r.get("city"):
        la, lo, p = census(r.get("street"), r.get("city"), r.get("state"), r.get("zip"))
        if la:
            return la, lo, p
    key = f"{r.get('city','')}, {r.get('state','')}"
    if key.strip(" ,"):
        if key not in cache:
            cache[key] = photon(key + ", United States")
            time.sleep(0.35)          # be polite; Photon is a free service
        la, lo, p = cache[key]
        if la:
            return la, lo, p
    if r.get("zip"):
        return zip_centroid(r["zip"])
    return None, None, None


def haversine(a_lat, a_lng, b_lat, b_lng):
    R = 3958.7613
    p = math.pi / 180
    dla = (b_lat - a_lat) * p
    dlo = (b_lng - a_lng) * p
    h = (math.sin(dla / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin(dlo / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(h))


def classify(sites, mine, miles):
    """in_ring vs prospective, plus every one of yours the site sits inside.

    'prospective' = no site of yours within the radius. Carry these with
    enrollment and price but NEVER with a share figure -- there is no local
    denominator, and a pool-relative metric renders as "$0" / "0 of 0".
    """
    for s in sites:
        if not s.get("lat"):
            s["ring_status"] = "ungeocoded"
            continue
        d = sorted((haversine(float(s["lat"]), float(s["lng"]),
                              float(m["lat"]), float(m["lng"])), m["name"]) for m in mine)
        within = [(dist, nm) for dist, nm in d if dist <= miles]
        s["nearest"] = d[0][1]
        s["nearest_mi"] = round(d[0][0], 2)
        s["n_mine_in_ring"] = len(within)
        s["mine_in_ring"] = ";".join(nm for _, nm in within)
        s["ring_status"] = "in_ring" if within else "prospective"
    return sites


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["geocode", "rings"])
    ap.add_argument("sites")
    ap.add_argument("mine", nargs="?")
    ap.add_argument("--miles", type=float, default=10.0)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    rows = list(csv.DictReader(open(a.sites)))
    if a.cmd == "geocode":
        cache = {}
        done = 0
        for i, r in enumerate(rows, 1):
            la, lo, p = geocode_row(r, cache)
            r["lat"], r["lng"], r["geo_precision"] = la, lo, p
            done += 1 if la else 0
            if i % 40 == 0:
                print(f"  {i}/{len(rows)} ({done} located)", flush=True)
        miss = [r for r in rows if not r.get("lat")]
        print(f"geocoded {len(rows)-len(miss)} of {len(rows)}")
        import collections
        print("precision:", dict(collections.Counter(r.get("geo_precision") for r in rows)))
        if miss:
            print("missing:", [r.get("name") for r in miss][:8])
        write_csv(a.out or a.sites.replace(".csv", "_geo.csv"), rows)
    else:
        if not a.mine:
            ap.error("rings needs a second CSV of your own locations (name,lat,lng)")
        mine = list(csv.DictReader(open(a.mine)))
        rows = classify(rows, mine, a.miles)
        import collections
        print(dict(collections.Counter(r["ring_status"] for r in rows)))
        multi = [r for r in rows if r.get("n_mine_in_ring", 0) > 1]
        print(f"{len(multi)} sites sit inside MORE THAN ONE of your rings "
              f"(merge these to one row, do not hide the extras -- see METHOD.md)")
        write_csv(a.out or a.sites.replace(".csv", "_rings.csv"), rows)


if __name__ == "__main__":
    main()
