# SPA base-path note (2026-09-13)

## Bug
Live Hub/Markets stuck on Loading because `assets/intel-*.js` fetched
`https://cjfogerty.github.io/data/markets.json` (404). Sites/brands/metros
already used helper `Q('data/…')` → `/probuilds/marketintel/dashboard/data/…`.

## Live fix
Page Committer pushed `f32588e7` patching `intel-D8_bJyKR.js`.

## Source status
**Vite/TanStack SPA source is not in** `cjfogerty/probuilds` **or**
`cjfogerty/marketintel` (empty). Only built `dashboard/assets/*` hashes are
committed. Until the SPA app tree is checked into a repo, run:

```bash
python3 marketintel/scripts/patch_spa_data_base.py marketintel/dashboard/assets
```

after every SPA rebuild so `/data/markets.json` cannot regress.

## Hydration #418
CueWay also saw React #418. Likely SSR HTML vs client tree mismatch on the
Pages build (pathname rewrite script in `<head>` + streamed SSR). Needs the
SPA source to fix properly — do not chase in minified chunks.

## Repo layout
Guard lives at `marketintel/scripts/patch_spa_data_base.py` + this note.
Workspace twin: `/workspace/marketintel-dashboard/`.
