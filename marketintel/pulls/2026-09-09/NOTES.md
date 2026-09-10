# Queue run — night of 2026-09-09

Unauthenticated public feeds only. Full class arrays live in the project artifacts (`queue_extracts/iclasspro.json`), not in this commit.

Collector output is fold-shaped for `fold.py plan --pull` but **not applied** to `sites.js` / `products.js`.

## Priority 1 — pulled

| Account | City | Classes | Openings | $ / mo median | Status |
|---|---|---|---|---|---|
| wogaplano | Plano TX | 150 | 660 | 114 | NEW — fold |
| wogafrisco | Frisco TX | 199 | 461 | 114 | NEW — fold |
| eaglegymnasticsfrisco | Frisco TX | 128 | 227 | 120 | NEW — fold |
| all4frisco | Frisco TX | 219 | 819 | 119 | NEW — fold (multi-program) |
| woodlandsgymnastics | Spring TX | 55 | 297 | 110 | NEW — fold |
| dragongym (GAGE) | Blue Springs MO | 143 | filter 47 invite/team | 158 | NEW — fold after filter |
| jr_540088 Texas Dreams | Coppell TX | 113 already in census | do not resit | 125 | GEO-FIX ONLY. Metro is Austin in sites.js. 117 Wrangler Dr #175, Coppell 75019. Enrolled on file: 276. |

Do not quote GAGE openings sum 2,081. Do not quote Texas Dreams openings — one OpeningsJS cell was `Mon: 7 Tue: 9…` and inflated the sum to ~80k.

## Priority 2

- Metroplex: `metroplexcamp` classes disabled. Leave location-only.
- USAG / ATA / GB / TSK metro pins scheduled 2026-09-10 06:00 America/Chicago.

## Fold (Intel Snatcher only)

```
python3 marketintel/scripts/fold.py plan --pull marketintel/pulls/2026-09-09/
```

Run geo.py first. Do not apply --write from a laptop that does not own the pack. Do not import fold.py.
