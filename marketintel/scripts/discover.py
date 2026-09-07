#!/usr/bin/env python3
"""Metro-driven discovery runner for the three independent-operator platforms.

The gap analysis (metro.py gaps) says WHERE to look. This says WHAT to run there
and writes the results in the shape fold.py expects, so a wave is:

    python3 discover.py orders --top 8 > orders.json     # offline, no network
    python3 discover.py run orders.json --out pulls/2026-09-13/
    python3 fold.py plan  --pull pulls/2026-09-13/
    python3 fold.py apply --pull pulls/2026-09-13/ --write

Only `run` touches the network. Run it from your own machine — these are your
collectors hitting public feeds at your own rate, from your own IP.

Rate limiting is deliberate and not optional: iClassPro slug-guessing fires one
request per candidate and a metro can produce 400 candidates. --workers stays
low and --sleep stays non-zero. GOTCHAS.md documents what a 429 costs you.
"""
import argparse, concurrent.futures as cf, json, os, sys, time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Principal cities + the suburbs that actually hold kids' activity businesses.
# These are the "suburb query variants" that turn a metro from 4 sites into 40 —
# a slug guess on "chicago" finds the Loop and nothing else.
SUBURBS = {
    "New York": ["manhattan", "brooklyn", "queens", "bronx", "staten island", "hoboken",
                 "jersey city", "newark", "montclair", "westfield", "scarsdale", "white plains",
                 "new rochelle", "yonkers", "great neck", "garden city", "huntington",
                 "commack", "syosset", "port washington", "rye", "greenwich", "stamford",
                 "paramus", "ridgewood", "summit", "princeton", "edison", "morristown"],
    "Los Angeles": ["santa monica", "pasadena", "burbank", "glendale", "sherman oaks",
                    "encino", "woodland hills", "calabasas", "torrance", "manhattan beach",
                    "redondo beach", "long beach", "irvine", "newport beach", "huntington beach",
                    "anaheim", "fullerton", "cerritos", "valencia", "thousand oaks",
                    "agoura hills", "west hollywood", "culver city", "el segundo"],
    "Chicago": ["naperville", "aurora", "schaumburg", "evanston", "oak park", "arlington heights",
                "palatine", "des plaines", "skokie", "wilmette", "glenview", "northbrook",
                "highland park", "lake forest", "elmhurst", "hinsdale", "downers grove",
                "wheaton", "st charles", "geneva", "orland park", "tinley park", "plainfield",
                "oak brook", "libertyville", "buffalo grove", "vernon hills"],
    "San Francisco Bay": ["san francisco", "oakland", "berkeley", "alameda", "san mateo",
                          "palo alto", "mountain view", "sunnyvale", "santa clara", "san jose",
                          "cupertino", "fremont", "pleasanton", "dublin", "walnut creek",
                          "danville", "san ramon", "livermore", "marin", "san rafael",
                          "redwood city", "burlingame", "los gatos", "campbell", "milpitas"],
    "Miami": ["miami", "coral gables", "kendall", "doral", "aventura", "hialeah",
              "fort lauderdale", "plantation", "weston", "pembroke pines", "coral springs",
              "boca raton", "delray beach", "boynton beach", "west palm beach", "jupiter",
              "wellington", "davie", "sunrise", "miramar", "homestead", "coconut creek"],
    "Detroit": ["detroit", "royal oak", "birmingham", "troy", "novi", "northville",
                "plymouth", "canton", "livonia", "farmington hills", "west bloomfield",
                "bloomfield hills", "rochester hills", "sterling heights", "ann arbor",
                "dearborn", "grosse pointe", "clarkston", "commerce", "brighton"],
    "Phoenix": ["phoenix", "scottsdale", "chandler", "gilbert", "mesa", "tempe", "glendale",
                "peoria", "surprise", "goodyear", "queen creek", "ahwatukee", "cave creek",
                "fountain hills", "avondale", "buckeye", "anthem", "litchfield park"],
    "Minneapolis": ["minneapolis", "st paul", "edina", "eden prairie", "minnetonka", "plymouth",
                    "maple grove", "woodbury", "eagan", "bloomington", "burnsville",
                    "lakeville", "chanhassen", "chaska", "apple valley", "roseville",
                    "blaine", "shoreview", "wayzata", "stillwater"],
    "Philadelphia": ["philadelphia", "king of prussia", "wayne", "malvern", "west chester",
                     "media", "newtown square", "doylestown", "newtown", "langhorne",
                     "cherry hill", "marlton", "moorestown", "haddonfield", "wilmington",
                     "newark de", "downingtown", "exton", "phoenixville", "ardmore"],
    "Las Vegas": ["las vegas", "henderson", "summerlin", "north las vegas", "green valley",
                  "spring valley", "enterprise", "anthem nv", "boulder city"],
    "Columbus": ["columbus", "dublin oh", "westerville", "powell", "hilliard", "gahanna",
                 "worthington", "new albany", "grove city", "pickerington", "lewis center"],
    "Riverside-San Bernardino": ["riverside", "corona", "temecula", "murrieta", "menifee",
                                 "rancho cucamonga", "ontario", "chino hills", "eastvale",
                                 "redlands", "san bernardino", "moreno valley", "hemet"],
}

# Brand prefixes that iClassPro accounts commonly use. guess_slugs tries
# {base, prefix+base, base+suffix} so a short list here multiplies coverage.
ICP_PREFIXES = ["", "gss", "the", "elite", "premier", "american", "us", "all", "star"]


def cmd_orders(args):
    """Emit work orders. Offline — reads the gap ranking, writes a plan."""
    from metro import assign, CBSA, load_sites, visible
    from collections import Counter
    _, sites = load_sites(args.path)
    vis = visible(sites)
    pop = {n: p for n, _, _, p in CBSA}
    have = Counter()
    for s in vis:
        m, _ = assign(s.get("lat"), s.get("lng"))
        if m:
            have[m] += 1
    rows = [{"metro": m, "pop_m": pop[m], "have": have.get(m, 0),
             "gap": max(0, round(pop[m] * args.benchmark - have.get(m, 0)))}
            for m in pop]
    rows = [r for r in rows if r["metro"] in SUBURBS]
    rows.sort(key=lambda r: -r["gap"])

    orders = []
    for r in rows[: args.top]:
        cities = SUBURBS[r["metro"]]
        orders.append({
            "metro": r["metro"], "pop_m": r["pop_m"],
            "have": r["have"], "modelled_gap": r["gap"],
            "iclasspro": {"cities": cities, "prefixes": ICP_PREFIXES,
                          "candidates": len(cities) * len(ICP_PREFIXES)},
            "jackrabbit": {"loc_codes_from": cities,
                           "note": "needs an OrgID per brand — jackrabbit.py find-locs "
                                   "brute-forces loc= codes once you have one"},
            "pike13": {"note": "discovery is per-operator: pike13.py discover <their page URL>. "
                               "No directory endpoint exists — seed from local search results."},
        })
    out = {"generated": time.strftime("%Y-%m-%d"), "benchmark_per_m": args.benchmark,
           "orders": orders,
           "total_icp_candidates": sum(o["iclasspro"]["candidates"] for o in orders)}
    json.dump(out, sys.stdout, indent=1)
    print(file=sys.stderr)
    print(f"{len(orders)} metros · {out['total_icp_candidates']} iClassPro candidates "
          f"· modelled gap {sum(o['modelled_gap'] for o in orders)} sites", file=sys.stderr)


def cmd_run(args):
    """The only networked command. Your machine, your IP, your rate limit."""
    import iclasspro
    plan = json.load(open(args.orders))
    os.makedirs(args.out, exist_ok=True)
    seen, accounts = set(), []

    for order in plan["orders"]:
        cities = order["iclasspro"]["cities"]
        print(f"\n== {order['metro']}  (have {order['have']}, gap {order['modelled_gap']})")
        for prefix in order["iclasspro"]["prefixes"]:
            hits = iclasspro.guess_slugs(cities, prefix=prefix, workers=args.workers)
            for h in hits:
                if h["account"] in seen:
                    continue
                seen.add(h["account"])
                h["metro_hint"] = order["metro"]
                accounts.append(h)
                print(f"   + {h['account']:26} {h['state']:12} "
                      f"{h.get('n_locations', 0)} loc")
            time.sleep(args.sleep)

    # Second pass: only the live accounts are worth a classes+tuition pull.
    live = [a for a in accounts if a["state"] == "exists"]
    print(f"\n{len(accounts)} accounts resolved, {len(live)} live — pulling classes")
    def detail(a):
        try:
            a["classes"] = iclasspro.classes(a["account"])
            a["tuition"] = iclasspro.tuition(a["account"])
        except Exception as e:
            a["error"] = str(e)[:200]
        return a
    with cf.ThreadPoolExecutor(args.workers) as ex:
        live = list(ex.map(detail, live))

    path = os.path.join(args.out, "iclasspro.json")
    json.dump({"accounts": accounts}, open(path, "w"), indent=1)
    print(f"wrote {path}  ({len(accounts)} accounts, {len(live)} with classes)")
    print("\nnext:  python3 geo.py <that file>   # coordinates, or the fold lands unplaced")
    print("       python3 fold.py plan --pull " + args.out)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("orders")
    o.add_argument("path", nargs="?", default="dashboard/data/sites.js")
    o.add_argument("--top", type=int, default=8)
    o.add_argument("--benchmark", type=float, default=8.6,
                   help="sites per million a thoroughly-worked metro reaches (St. Louis)")
    o.set_defaults(fn=cmd_orders)
    r = sub.add_parser("run")
    r.add_argument("orders")
    r.add_argument("--out", required=True)
    r.add_argument("--workers", type=int, default=4)
    r.add_argument("--sleep", type=float, default=1.5)
    r.set_defaults(fn=cmd_run)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
