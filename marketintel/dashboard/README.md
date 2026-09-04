# Market Intel Dashboard (encrypted)

Password-gated operator command-center for kids activity brand footprint
(Urban Air / Snapology / The Little Gym / Premier Martial Arts).

## Live

GitHub Pages (when enabled for this repo):

`https://cjfogerty.github.io/probuilds/marketintel/dashboard/`

## Unlock

Open `index.html` (or the Pages URL). Enter the operator passphrase.
The encrypted payload is split across `dashboard.enc.part1` … `partN` and
decrypted in-browser with AES-GCM (PBKDF2 / SHA-256 / 200000 iterations).

Passphrase is **not** stored in this repository.

## Contents

| File | Role |
|------|------|
| `index.html` | Public password gate only |
| `dashboard.enc.partN` | Encrypted interactive dashboard payload |
| `README.md` | This file |

## Notes

- Snapshot week and methodology live inside the encrypted payload.
- Do not commit plaintext source, preview screenshots, or the passphrase.
- Research markdown / Python under `marketintel/` is separate from this folder.
