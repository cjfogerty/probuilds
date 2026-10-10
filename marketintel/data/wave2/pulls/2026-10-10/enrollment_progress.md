# Enrollment refresh progress — 2026-10-10 (America/Chicago)

- obs week: 2026-10-05 → 2026-10-11 (Mon–Sun CT; brief's 10-06 is a Tuesday)
- history snapshot (pre-pull, read-only): `data/wave2/history/2026-10-10_enrollment_refresh_pre_pull/`
- fold applied: **True** (no git commit; no pings)
- sites targeted: 763; touched (folded): **692**; enrolled_sum (touched): 129445

## Coverage cut — enrolled-known vs total sites (after fold)

known = enrolled non-null AND not a 0-enrolled/0-capacity placeholder; unknown (null) counts in the denominator, never as 0; fresh = folded from the 2026-10-10 pull

| platform | total | known | % known | fresh 10-10 | % fresh | prior-stamp known | 0/0 placeholder | unknown (null) | note |
|---|---|---|---|---|---|---|---|---|---|
| sportsengine | 6096 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 6096 | null enroll by design (no public seats) |
| unleashed | 1083 | 375 | 34.6% | 0 | 0.0% | 375 | 708 | 0 | not in this refresh's scope (prior stamp) |
| web_discovery | 561 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 561 | null enroll by design (no public seats) |
| activenet | 327 | 320 | 97.9% | 301 | 92.0% | 19 | 7 | 0 |  |
| mygym | 174 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 174 | null enroll by design (no public seats) |
| iclasspro | 173 | 173 | 100.0% | 172 | 99.4% | 1 | 0 | 0 |  |
| jackrabbit | 100 | 100 | 100.0% | 100 | 100.0% | 0 | 0 | 0 |  |
| daxko | 81 | 65 | 80.2% | 47 | 58.0% | 18 | 0 | 16 |  |
| teamunify | 65 | 38 | 58.5% | 35 | 53.8% | 3 | 22 | 5 |  |
| pike13 | 17 | 5 | 29.4% | 5 | 29.4% | 0 | 12 | 0 |  |
| leadconnector | 5 | 0 | 0.0% | 0 | 0.0% | 0 | 0 | 5 | null enroll by design (no public seats) |
| **all** | 8682 | 1076 | **12.4%** | 660 | **7.6%** | 416 | 749 | 6857 | |

## Per-platform pull status

- **iclasspro**: ok=172, ok_no_lesson_classes=1
- **jackrabbit**: ok=100
- **pike13**: ok=17
- **teamunify**: not_returned:kept=2, not_returned:not_found=3, ok=60
- **activenet**: no_activities_today=26, ok=301
- **daxko**: no_offerings_today=13, ok=68

## enrolled_sum by platform (before = history snapshot → after)

| platform | before | after |
|---|---|---|
| activenet | 18284 | 19604 |
| daxko | 1550 | 1626 |
| iclasspro | 81592 | 81310 |
| jackrabbit | 21852 | 21110 |
| leadconnector | 0 | 0 |
| mygym | 0 | 0 |
| pike13 | 192 | 271 |
| sportsengine | 0 | 0 |
| teamunify | 7591 | 6957 |
| unleashed | 102060 | 102060 |
| web_discovery | 0 | 0 |

## Top 10 movers (sites with both prior and today)

- iclasspro `umdgc:1` UMDGC - Upper Merion Dance & Gymnastics Center: 811 → 1398 (+587)
- iclasspro `houstongymnastics:1` Houston Gymnastics Academy: 893 → 371 (-522)
- activenet `activenet:chicagoparkdistrict:morgan_park_sports_ctr` Morgan Park Sports Ctr: 1096 → 1577 (+481)
- iclasspro `jumpgym:1` Jump Gym - Woodland Hills: 582 → 134 (-448)
- iclasspro `goldmedalhuntington:1` Gold Medal Gymnastics Huntington: 751 → 1193 (+442)
- iclasspro `tumblebustx:1` Alamo Heights Gymnastics Academy/Tumblebus LLC: 1232 → 832 (-400)
- teamunify `tu:njsac:boontonnj` Star Athletics Cheer & Tumbling — Boonton, NJ: 851 → 491 (-360)
- jackrabbit `507893` Viking Gymnastics Club: 2681 → 2363 (-318)
- iclasspro `goldmedalsmithtown:11` Gold Medal SMITHTOWN: 1161 → 860 (-301)
- iclasspro `carolinaflipz:1` Carolina Flipz: 2890 → 2595 (-295)

## Method notes

- ICP: OPENINGS_CAP=40, level key levelId|level|name[:40]; seat floor follows each site's original fold lineage (floor 8 where prior billing_notes say 'floor', else floor 1 = wave2_pull) so deltas are like-for-like (validated: median |Δ| 24/27 vs 178/59 mismatched). Current-session filter = next occurrence ≤ 2026-10-24 and not ended before obs start (ICP startDate is the rolling next occurrence, so a strict Mon–Sun filter on a Saturday drops most classes; future-season rows such as UMDGC still drop). Per site `alt_floor8_current_session` and `legacy_wave2` are kept in enroll_iclasspro.json.
- ICP floor-1 sites are volatile: capacity = max openings seen per level, so class counts can hold while capacity swings (e.g. jumpgym 600→145, houstongymnastics 1056→522). Treat single-pull ICP movers as model noise until a second pull confirms.
- JR: org-wide observed max, openings multi-day max / cap 80; swim rows dropped; NEW term filter keeps lowest-numbered term when a feed lists ≥2 (Fall 1/Fall 2) — hit 517374, 504897, 507153.
- Pike13: maximum_clients − capacity_remaining, window 2026-10-10..10-17.
- TeamUnify: slotRegister / maxLimit, ≥90000 = unlimited; multi-location teams stay null.
- Daxko: N out of M spots, sum per branch. ActiveNet: already_enrolled + total_open, date_after=2026-10-10.
- GHL/LeadConnector: skipped — widgets only expose trial appointment slots; Boyer cap stays null.
- Rows not refreshed (errors / no activities / zero classes) keep prior values AND prior obs-week stamp.
