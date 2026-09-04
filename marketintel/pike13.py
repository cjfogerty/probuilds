#!/usr/bin/env python3
"""Pike13 front API — published capacity AND integer openings.

Fitness-first platform: gyms, CrossFit, yoga, martial arts. Expect it often in
the martial arts / gym vertical.

Each operator's marketing page embeds a public client_id for its own schedule
widget. With that, the front API is unauthenticated.

    python3 pike13.py discover https://www.example.com/some-location/
    python3 pike13.py pull <subdomain> <client_id>
"""
import argparse, datetime, json, os, re, statistics as st, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import get, get_json, write_json

CID_RE = re.compile(
    r"https?://([a-z0-9-]+)\.pike13\.com/api/v2/front/[^\"']*client_id=([A-Za-z0-9]+)")
# One-off inventory that is not a recurring class seat.
DROP = re.compile(r"private|camp|party|clinic|assessment|make ?-?up|trial|intro|open gym", re.I)


def discover(page_url):
    """Pull the (subdomain, client_id) pair out of an operator's own page."""
    status, body = get(page_url)
    if status != 200:
        return None
    m = CID_RE.search(body)
    return {"subdomain": m.group(1), "client_id": m.group(2)} if m else None


def services(sub, cid):
    j = get_json(f"https://{sub}.pike13.com/api/v2/front/services.json?client_id={cid}")
    return (j or {}).get("services") or []


def occurrences(sub, cid, frm, to):
    j = get_json(f"https://{sub}.pike13.com/api/v2/front/event_occurrences.json"
                 f"?client_id={cid}&from={frm}&to={to}", timeout=60)
    return (j or {}).get("event_occurrences") or []


def pull(sub, cid, frm=None, to=None):
    """enrolled = maximum_clients - capacity_remaining.

    Observed openings against a PUBLISHED capacity, which is stronger evidence
    than any seat model.
    """
    if not frm:
        today = datetime.date.today()
        mon = today + datetime.timedelta(days=(7 - today.weekday()) % 7 or 7)
        frm, to = mon.isoformat(), (mon + datetime.timedelta(days=7)).isoformat()
    svc = {s["id"]: s for s in services(sub, cid)}
    enrolled = cap = n = wl = 0
    for e in occurrences(sub, cid, frm, to):
        s = svc.get(e.get("service_id")) or {}
        mx = s.get("maximum_clients")
        name = e.get("name") or ""
        if not mx or DROP.search(name) or e.get("state") != "active":
            continue
        rem = e.get("capacity_remaining")
        if not isinstance(rem, int) or rem < 0 or rem > mx:
            continue
        n += 1
        cap += mx
        enrolled += (mx - rem)
        if (e.get("waitlist") or {}).get("full"):
            wl += 1
    # Pricing rides the SAME client_id.
    # NOTE: base_price is an OBJECT carrying price_cents, not a number.
    prices = []
    for s in svc.values():
        if DROP.search(s.get("name") or ""):
            continue
        bp = ((s.get("pricing") or {}).get("single_visit") or {}).get("base_price") or {}
        cents = bp.get("price_cents")
        if cents:
            prices.append(cents / 100.0)
    return {"subdomain": sub, "window": f"{frm}..{to}", "n_classes": n,
            "capacity": cap, "enrolled": enrolled,
            "fill_pct": round(100 * enrolled / cap, 1) if cap else None,
            "waitlisted_classes": wl,
            "seats_per_class": round(cap / n, 2) if n else None,
            "per_lesson_median": round(st.median(prices), 2) if prices else None,
            "n_levels_priced": len(prices)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["discover", "pull"])
    ap.add_argument("a")
    ap.add_argument("b", nargs="?")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    if args.cmd == "discover":
        r = discover(args.a)
        print(json.dumps(r, indent=1) if r else "no pike13 client_id found on that page")
    else:
        if not args.b:
            ap.error("pull needs <subdomain> <client_id>")
        r = pull(args.a, args.b)
        for k, v in r.items():
            print(f"  {k:20} {v}")
        if args.out:
            write_json(args.out, r)


if __name__ == "__main__":
    main()
