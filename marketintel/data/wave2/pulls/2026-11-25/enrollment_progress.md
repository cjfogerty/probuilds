# Enrollment refresh progress — 2026-11-25 (America/Chicago)

- obs week: 2026-11-23 → 2026-11-29 (Mon–Sun CT)
- history snapshot (pre-pull, read-only): `data/wave2/history/2026-11-25_enrollment_refresh_pre_pull/`
- fold applied: **True** (no git commit; no pings)
- sites targeted: 763; touched (folded): **661**; enrolled_sum (touched): 124963

## Coverage cut — enrolled-known vs total sites (after fold)

known = enrolled non-null AND not a 0-enrolled/0-capacity placeholder; unknown (null) counts in the denominator, never as 0; fresh = folded from the 2026-11-25 pull

| platform | total | known | % known | fresh 11-25 | % fresh | prior-stamp known | 0/0 placeholder | unknown (null) | note |
|---|---|---|---|---|---|---|---|---|---|
| sportsengine | 6096 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 6096 | null enroll by design (no public seats) |
| unleashed | 1083 | 375 | 34.6% | 0 | 0.0% | 375 | 708 | 0 | not in this refresh's scope (prior stamp) |
| web_discovery | 561 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 561 | null enroll by design (no public seats) |
| activenet | 327 | 318 | 97.2% | 282 | 86.2% | 36 | 9 | 0 |  |
| mygym | 174 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 174 | null enroll by design (no public seats) |
| iclasspro | 173 | 173 | 100.0% | 168 | 97.1% | 5 | 0 | 0 |  |
| jackrabbit | 100 | 100 | 100.0% | 100 | 100.0% | 0 | 0 | 0 |  |
| daxko | 81 | 68 | 84.0% | 37 | 45.7% | 31 | 0 | 13 |  |
| teamunify | 65 | 38 | 58.5% | 35 | 53.8% | 3 | 22 | 5 |  |
| pike13 | 17 | 5 | 29.4% | 5 | 29.4% | 0 | 12 | 0 |  |
| leadconnector | 5 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 5 | null enroll by design (no public seats) |
| **all** | 8682 | 1077 | **12.4%** | 627 | **7.2%** | 450 | 751 | 6854 | |

## Per-platform pull status

- **iclasspro**: ok=168, ok_no_lesson_classes=4, probe_frozen=1
- **jackrabbit**: ok=100
- **pike13**: ok=17
- **teamunify**: not_returned:kept=3, not_returned:not_found=3, ok=59
- **activenet**: no_activities_today=43, ok=284
- **daxko**: no_offerings_today=27, ok=54

## enrolled_sum by platform (before = history snapshot → after)

| platform | before | after |
|---|---|---|
| activenet | 19604 | 19952 |
| daxko | 1626 | 1675 |
| iclasspro | 81310 | 78534 |
| jackrabbit | 21110 | 20478 |
| leadconnector | 0 | 0 |
| mygym | 0 | 0 |
| pike13 | 271 | 152 |
| sportsengine | 0 | 0 |
| teamunify | 6957 | 7043 |
| unleashed | 102060 | 102060 |
| web_discovery | 0 | 0 |

## Top 10 movers (sites with both prior and today)

- iclasspro `carolinaflipz:1` Carolina Flipz: 2595 → 457 (-2138)
- iclasspro `crenshaws:1` Crenshaw Athletic Club: 341 → 1249 (+908)
- iclasspro `carolinaninjaacademy:1` Carolina Ninja Academy: 800 → 168 (-632)
- activenet `activenet:chicagoparkdistrict:morgan_park_sports_ctr` Morgan Park Sports Ctr: 1577 → 967 (-610)
- activenet `activenet:mecklenburgparks:david_b_waymer_rec_ctr` David B. Waymer Rec Ctr: 319 → 774 (+455)
- activenet `activenet:gepark:ackerman_sfc` Ackerman SFC: 668 → 1118 (+450)
- iclasspro `warriortechocr:1` Warrior Tech OCR: 484 → 158 (-326)
- iclasspro `wrightsgymnasticsacademy:1` Wright's Gymnastics Academy: 486 → 770 (+284)
- iclasspro `tumblebustx:1` Alamo Heights Gymnastics Academy/Tumblebus LLC: 832 → 570 (-262)
- iclasspro `scottsdalegymnastics:1` Scottsdale Gymnastics & Trampoline / Parkour: 507 → 258 (-249)

## Method notes

- ICP: OPENINGS_CAP=40, level key levelId|level|name[:40]; seat floor follows each site's original fold lineage (floor 8 where prior billing_notes say 'floor', else floor 1 = wave2_pull) so deltas are like-for-like (validated: median |Δ| 24/27 vs 178/59 mismatched). Current-session filter = next occurrence ≤ 2026-12-09 and not ended before obs start (ICP startDate is the rolling next occurrence, so a strict Mon–Sun filter on a Saturday drops most classes; future-season rows such as UMDGC still drop). Per site `alt_floor8_current_session` and `legacy_wave2` are kept in enroll_iclasspro.json.
- ICP floor-1 sites are volatile: capacity = max openings seen per level, so class counts can hold while capacity swings (e.g. jumpgym 600→145, houstongymnastics 1056→522). Treat single-pull ICP movers as model noise until a second pull confirms.
- JR: org-wide observed max, openings multi-day max / cap 80; swim rows dropped; NEW term filter keeps lowest-numbered term when a feed lists ≥2 (Fall 1/Fall 2) — hit 517374, 504897, 507153.
- Pike13: maximum_clients − capacity_remaining, window 2026-11-25..12-02.
- TeamUnify: slotRegister / maxLimit, ≥90000 = unlimited; multi-location teams stay null.
- Daxko: N out of M spots, sum per branch. ActiveNet: already_enrolled + total_open, date_after=2026-11-25.
- GHL/LeadConnector: skipped — widgets only expose trial appointment slots; Boyer cap stays null.
- Rows not refreshed (errors / no activities / zero classes) keep prior values AND prior obs-week stamp.

## 2026-11-25 run notes (collector: scripts/enrollment_refresh_2026_11_25.py; fold: scripts/fold_enrollment_refresh_2026_11_25.py; summary: scripts/write_enrollment_summary.py)

- Jackrabbit OpeningsJS changed format (table now a JSON-escaped string: `var content = "\u003C..."`). The old parser read every feed as empty (first attempt: 47/47 `empty_feed`, discarded to logs/). Collector now decodes the string first.
- Jackrabbit feeds now list next season beside the current one (e.g. 517374: "Fall 2 2026" + "Winter 2027"); the ordinal term rule missed it (1485 → 4581). Added a date window from the new Class Starts/Ends columns (starts ≤ 2026-12-09, ends ≥ 2026-11-23), then the ordinal rule. 35/100 orgs trimmed. Pre-fix run kept in logs/enroll_jackrabbit.v2_no_date_window.json.
- iClassPro seat-floor lineage: the 10-10 fold tag in billing_notes contains "floor" on every row, so the old test flipped all sites to floor 8. Now taken from the 10-10 pull's seat_floor (91 floor-1, 81 floor-8 — same as 10-10).
- Fetch modules (daxko/activenet/teamunify) had OUT_DIR pinned to pulls/2026-09-13; redirected to pulls/2026-11-25/module_state so the old pull dir is untouched.
- Thanksgiving week: more Daxko orgs (27 vs 13) and ActiveNet sites (43 vs 26) had nothing scheduled; those rows keep prior values + prior stamp.
- pulled_at stamps in enroll_*.json read "CT" but are UTC-5 (1 h ahead of CST); script fixed for future runs.
- brand_id: 174 mygym rows → `mygym`; 5 null JR rows → `jr_{org}` (matches the other 95 JR rows; brief asked `jackrabbit_{org}` — one constant, JR_BRAND_PREFIX, to switch).
