#!/usr/bin/env python3
"""Jackrabbit Class — public OpeningsJS feed. No parent account, no login.

Built for gymnastics, dance, cheer, swim and martial arts, so expect it often.

`GetClassesForEnroll` DOES require a parent session -- but it is not the only way
in, and assuming it was cost months on the swim build.

    python3 jackrabbit.py feed 499027
    python3 jackrabbit.py find-locs 499027 --cities cities.txt
    python3 jackrabbit.py pull 499027 --loc BMD
    python3 jackrabbit.py pull 499027 --name-code SK
"""
import argparse, concurrent.futures as cf, html, os, re, statistics as st, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import get, write_csv

FEED = "https://app.jackrabbitclass.com/jr3.0/Openings/OpeningsJS?OrgID={org}"
# One-off items that are not recurring lesson inventory.
SKIP = re.compile(r"camp|clinic|party|meet|open (swim|gym)|event|workshop|seminar|test", re.I)
PRIVATE = re.compile(r"\bprivate\b", re.I)
SEMI = re.compile(r"\bsemi[- ]?private\b", re.I)


def fetch(org, loc=None):
    url = FEED.format(org=org) + (f"&loc={loc}" if loc else "")
    status, body = get(url, timeout=60)
    return body if status == 200 else ""


def parse_feed(text):
    """The feed is JS that document.write()s an HTML table. Parse the table."""
    text = re.sub(r"\\'", "'", text)
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S | re.I):
        cells = [html.unescape(re.sub(r"<[^>]+>", " ", td)).strip()
                 for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
        cells = [re.sub(r"\s+", " ", c) for c in cells]
        if len(cells) >= 6 and any(c for c in cells):
            rows.append(cells)
    if not rows:
        return []
    header = [c.lower() for c in rows[0]]
    def idx(*names):
        for n in names:
            for i, h in enumerate(header):
                if n in h:
                    return i
        return None
    ix = {"class": idx("class", "description"), "days": idx("day"),
          "times": idx("time"), "openings": idx("opening"),
          "tuition": idx("tuition", "price"), "register": idx("register", "action"),
          "session": idx("session"), "ages": idx("age")}
    out = []
    for r in rows[1:]:
        rec = {}
        for k, i in ix.items():
            rec[k] = r[i] if (i is not None and i < len(r)) else ""
        if rec.get("class"):
            out.append(rec)
    return out


def num(s, default=0.0):
    try:
        return float(re.sub(r"[^0-9.\-]", "", str(s)) or default)
    except Exception:
        return default


def kind_of(r):
    n = r.get("class", "")
    if SEMI.search(n):
        return "semi"
    if PRIVATE.search(n):
        return "private"
    return "group"


def level_of(name):
    """Strip day/time/location noise to leave the level token."""
    n = re.sub(r"\b\d{1,2}:\d{2}\s*[ap]?m?\b", " ", name, flags=re.I)
    n = re.sub(r"\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b\.?", " ", n, flags=re.I)
    n = re.sub(r"[\[\]()*]", " ", n)
    return re.sub(r"\s+", " ", n).strip().lower()[:40]


def lessons_only(rows):
    return [r for r in rows if not SKIP.search(r.get("class", "") + " " + r.get("session", ""))]


def find_locs(org, candidates, workers=6):
    """A valid loc= returns a subset; an invalid one returns 0 rows. That makes
    brute-forcing candidates cheap and unambiguous."""
    def probe(code):
        return code, len(parse_feed(fetch(org, code)))
    good = {}
    with cf.ThreadPoolExecutor(workers) as ex:
        for code, n in ex.map(probe, candidates):
            if n > 0:
                good[code] = n
    return good


def city_codes(city):
    """Plausible 3-5 letter codes for a city name."""
    c = re.sub(r"[^a-z ]", "", city.lower()).strip()
    words = c.split()
    letters = c.replace(" ", "")
    cons = re.sub(r"[aeiou]", "", letters)
    out = [letters[:3], cons[:3], letters[:4], cons[:4]]
    if len(words) > 1:
        out.append("".join(w[0] for w in words))
    return [x.upper() for x in dict.fromkeys(out) if 2 <= len(x) <= 5]


def summarise(rows, brand_ratio=None, org_rows=None):
    """enrolled = derived_capacity - openings.

    Capacity per class, in priority order: private=1, semi=2, published ratio,
    else the max openings ever seen for that level ACROSS THE WHOLE ORG. That
    last part matters -- computed per location, a small site never sees an empty
    class and its capacity collapses to its own current openings.
    """
    maxopen = {}
    for r in lessons_only(org_rows if org_rows is not None else rows):
        if kind_of(r) == "group":
            lvl = level_of(r["class"])
            maxopen[lvl] = max(maxopen.get(lvl, 0), int(num(r.get("openings"))))
    cap = op = wl = 0
    tui = []
    rows = lessons_only(rows)
    for r in rows:
        k = kind_of(r)
        if k == "private":
            c = 1
        elif k == "semi":
            c = 2
        else:
            lvl = level_of(r["class"])
            c = max((brand_ratio or {}).get(lvl, (brand_ratio or {}).get("_default", 0)),
                    maxopen.get(lvl, 0), 1)
        o = int(num(r.get("openings")))
        cap += max(c, o)
        op += o
        if "wait" in (r.get("register") or "").lower():
            wl += 1
        t = num(r.get("tuition"))
        if k == "group" and t > 0:
            tui.append(t)
    enr = cap - op
    mo = st.median(tui) if tui else None
    return {"classes": len(rows), "waitlisted": wl, "openings": op,
            "derived_capacity": cap, "est_enrolled": enr,
            "est_utilization_pct": round(100 * enr / cap, 1) if cap else None,
            "capacity_basis": "published_ratio+observed_max" if brand_ratio else "observed_max_only",
            "monthly_median": round(mo, 2) if mo else None,
            "per_lesson_median": round((mo if mo and mo >= 70 else (mo or 0) * 4.33) / 4.33, 2) if mo else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["feed", "find-locs", "pull"])
    ap.add_argument("org")
    ap.add_argument("--loc", default=None)
    ap.add_argument("--name-code", default=None,
                    help="token inside the class name; some orgs split only this way")
    ap.add_argument("--cities", default=None)
    ap.add_argument("--codes", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    if a.cmd == "feed":
        rows = parse_feed(fetch(a.org))
        print(f"{len(rows)} rows ({len(lessons_only(rows))} lesson rows)")
        for r in rows[:5]:
            print("  ", {k: v for k, v in r.items() if v})
        return

    if a.cmd == "find-locs":
        cands = []
        if a.codes:
            cands = [l.strip().upper() for l in open(a.codes) if l.strip()]
        elif a.cities:
            for c in open(a.cities):
                if c.strip():
                    cands += city_codes(c.strip())
        else:
            ap.error("--cities or --codes required")
        cands = list(dict.fromkeys(cands))
        print(f"probing {len(cands)} candidate codes...")
        good = find_locs(a.org, cands)
        total = len(parse_feed(fetch(a.org)))
        print(f"\n{len(good)} valid codes, {sum(good.values())} of {total} org rows covered")
        for c, n in sorted(good.items(), key=lambda x: -x[1]):
            print(f"   {c:6} rows={n}")
        return

    org_rows = parse_feed(fetch(a.org))
    if a.loc:
        rows = parse_feed(fetch(a.org, a.loc))
    elif a.name_code:
        pat = re.compile(rf"\b{re.escape(a.name_code)}\b")
        rows = [r for r in org_rows if pat.search(r.get("class", ""))]
    else:
        rows = org_rows
    s = summarise(rows, org_rows=org_rows)
    s.update({"org": a.org, "loc": a.loc or a.name_code or "(whole org)"})
    for k, v in s.items():
        print(f"  {k:22} {v}")
    if a.out:
        write_csv(a.out, [s])


if __name__ == "__main__":
    main()
