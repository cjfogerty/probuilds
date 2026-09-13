#!/usr/bin/env python3
"""Guard against SPA regressions: absolute /data/*.json fetches on GitHub Pages.

The Market Intel SPA ships only as built assets under marketintel/dashboard/assets/
(no Vite source in cjfogerty/probuilds or the empty cjfogerty/marketintel repo).
One chunk historically fetched `/data/markets.json` (site root → 404) while other
loads correctly used base `/probuilds/marketintel/dashboard/` via helper Q().

Usage:
  python3 scripts/patch_spa_data_base.py path/to/dashboard/assets
  python3 scripts/patch_spa_data_base.py path/to/intel-XXXX.js

Exits 0 if already clean or patched; 1 if a bad absolute fetch remains unknown.
"""
from __future__ import annotations
import re, sys
from pathlib import Path

BAD = re.compile(r"\$\(`/data/([^`]+)`\)")
# Also catch double-quoted / fetch forms
BAD2 = re.compile(r"""(?:fetch\(|\$\()(["'`])/data/([^"'`]+)(["'`])\)""")

def patch_text(t: str) -> tuple[str, int]:
    n = 0
    def repl(m):
        nonlocal n
        n += 1
        return f"$(Q(`data/{m.group(1)}`))"
    t2 = BAD.sub(repl, t)
    return t2, n

def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    root = Path(argv[1])
    files = [root] if root.is_file() else sorted(root.glob("intel-*.js")) + sorted(root.glob("**/intel-*.js"))
    if not files:
        print(f"no intel-*.js under {root}")
        return 1
    total = 0
    for f in files:
        t = f.read_text()
        if "/data/" not in t and "data/markets" not in t:
            continue
        t2, n = patch_text(t)
        # leftover absolute /data/ json?
        leftovers = re.findall(r"[\"'`]/data/[a-zA-Z0-9_.-]+\.json", t2)
        if n:
            f.write_text(t2)
            print(f"patched {f} ({n} absolute /data/ → Q(data/…))")
            total += n
        elif leftovers:
            print(f"WARN {f} still has absolute /data/ refs: {leftovers}")
            return 1
        else:
            print(f"clean {f}")
    print(f"done — {total} replacements")
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
