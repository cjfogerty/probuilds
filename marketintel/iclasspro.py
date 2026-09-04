#!/usr/bin/env python3
"""iClassPro public "open" API.

Publishes `openings` but never capacity or enrolled, so enrollment needs a seat
model (see METHOD.md). Publishes tuition on the class DETAIL endpoint only.

    python3 iclasspro.py probe gssnaperville
    python3 iclasspro.py guess-slugs cities.txt --prefix gss
    python3 iclasspro.py classes gssnaperville --out gssnaperville.json
    python3 iclasspro.py tuition gssnaperville
"""
import argparse, concurrent.futures as cf, json, os, re, statistics as st, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import get_json, get, write_json, write_csv

BASE = "https://app.iclasspro.com/api/open/v1"
HDR = {"Origin": "https://portal.iclasspro.com", "Referer": "https://portal.iclasspro.com/"}
MONTHLY_FLOOR = 70.0   # >= this is a monthly rate; below is per-lesson
WEEKS = 4.33


def probe(account):
    """Distinguish the three meaningful states. See GOTCHAS.md.

      exists   -> open feed, locations returned
      frozen   -> real account that CHURNED OFF the platform (403)
      login    -> real, active, but the owner switched the public feed off
      missing  -> no such account (400)
    """
    status, body = get(f"{BASE}/{account}/locations", HDR)
    if status == 200:
        try:
            d = json.loads(body).get("data") or []
        except Exception:
            d = []
        if d:
            # The public feed can be switched off per account, and the wall is on
            # /classes, not /locations -- an account whose locations come back
            # fine can still refuse to list a single class.
            cstat, cbody = get(f"{BASE}/{account}/classes?limit=1&page=1", HDR)
            walled = cstat == 200 and "sign in" in (cbody or "").lower()
            return {"account": account,
                    "state": "login_walled" if walled else "exists",
                    "n_locations": len(d),
                    "locations": [{"id": x["id"], "name": x.get("name"),
                                   "street": x.get("address"), "city": x.get("city"),
                                   "state": x.get("state"), "zip": x.get("zip"),
                                   "phone": x.get("phone")} for x in d]}
        if "sign in" in body.lower():
            return {"account": account, "state": "login_walled"}
        return {"account": account, "state": "empty"}
    if status == 403 and "frozen" in (body or "").lower():
        return {"account": account, "state": "frozen"}
    if status == 400:
        return {"account": account, "state": "missing"}
    return {"account": account, "state": f"http_{status}"}


def classes(account, location_id=None, max_pages=40):
    out, page = [], 1
    while page <= max_pages:
        url = f"{BASE}/{account}/classes?limit=50&page={page}"
        if location_id:
            url += f"&locationId={location_id}"
        j = get_json(url, HDR)
        if not j:
            break
        d = j.get("data") or []
        out += d
        total = j.get("totalRecords")
        if not d or (total is not None and len(out) >= total):
            break
        page += 1
    return out


def tuition(account, location_id=None, per_level=2):
    """Tuition lives on the DETAIL endpoint only. It is set per level per account,
    so sample a couple of classes per level and take the median."""
    cls = classes(account, location_id)
    by_level = {}
    for c in cls:
        by_level.setdefault(c.get("levelId"), []).append(c["id"])
    prices = []
    targets = [cid for ids in by_level.values() for cid in ids[:per_level]]
    def one(cid):
        d = (get_json(f"{BASE}/{account}/classes/{cid}", HDR) or {}).get("data") or {}
        try:
            t = float(d.get("tuition"))
        except (TypeError, ValueError):
            return None
        return t if t > 0 else None
    with cf.ThreadPoolExecutor(8) as ex:
        for v in ex.map(one, targets):
            if v:
                prices.append(v)
    if not prices:
        return {}
    # tuitionTerm is unreliable -- magnitude decides.
    monthly = [p if p >= MONTHLY_FLOOR else p * WEEKS for p in prices]
    mo = st.median(monthly)
    return {"account": account, "n_priced": len(prices),
            "monthly_median": round(mo, 2),
            "per_lesson_median": round(mo / WEEKS, 2)}


def guess_slugs(names, prefix="", suffix="", workers=8):
    """Derive candidate accounts from city/marketing slugs and validate live.

    This is the fastest way to map a brand: it confirms the account AND returns
    the street address in one small call. Far better than fetching heavyweight
    marketing pages, which get rate-limited.
    """
    cands = []
    for n in names:
        base = re.sub(r"[^a-z0-9]", "", n.lower())
        for c in {base, prefix + base, base + suffix, prefix + base + suffix}:
            if c and c not in cands:
                cands.append(c)
    hits = []
    with cf.ThreadPoolExecutor(workers) as ex:
        for r in ex.map(probe, cands):
            if r["state"] in ("exists", "login_walled", "frozen"):
                hits.append(r)
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["probe", "classes", "tuition", "guess-slugs"])
    ap.add_argument("target")
    ap.add_argument("--location", type=int, default=None)
    ap.add_argument("--prefix", default="")
    ap.add_argument("--suffix", default="")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    if a.cmd == "probe":
        print(json.dumps(probe(a.target), indent=1))
    elif a.cmd == "classes":
        c = classes(a.target, a.location)
        print(f"{len(c)} classes")
        opens = [x.get("openings") for x in c if isinstance(x.get("openings"), int)]
        if opens:
            print(f"openings: total {sum(opens)}, max on one class {max(opens)}")
        write_json(a.out or f"{a.target}_classes.json",
                   {"account": a.target, "location_id": a.location or 1, "classes": c})
    elif a.cmd == "tuition":
        print(json.dumps(tuition(a.target, a.location), indent=1))
    else:
        names = [l.strip() for l in open(a.target) if l.strip()]
        hits = guess_slugs(names, a.prefix, a.suffix)
        for h in hits:
            print(f"  {h['account']:28} {h['state']:12} "
                  + (f"{h['n_locations']} loc" if h.get("n_locations") else ""))
        print(f"\n{len(hits)} of {len(names)} names resolved")
        rows = [{**{k: v for k, v in h.items() if k != "locations"},
                 **(h.get("locations", [{}])[0])} for h in hits]
        write_csv(a.out or "iclasspro_accounts.csv", rows)


if __name__ == "__main__":
    main()
