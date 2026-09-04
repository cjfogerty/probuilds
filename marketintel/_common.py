#!/usr/bin/env python3
"""Shared HTTP helpers. Stdlib only.

The User-Agent matters more than anything else here: at least one platform
blocks the bare `Python-urllib/3.x` string specifically while letting an
obviously-scripted `curl/8.4.0 scraper-bot` through. Always send a browser UA.
"""
import gzip, json, ssl, time, urllib.error, urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36")

# Some corporate Python installs fail TLS verification against public CAs.
# Prefer the system bundle; fall back to the default context.
try:
    CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
except Exception:
    CTX = ssl.create_default_context()


def get(url, headers=None, timeout=30, tries=3, backoff=1.0):
    """Return (status, body_text). status is an int, or 'ERR' on a transport failure.

    Retries only on 5xx and transport errors -- a 400/403/404 is an answer, not a
    failure, and on some platforms it is the answer you care about.
    """
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"}
    h.update(headers or {})
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, context=CTX, timeout=timeout) as f:
                body = f.read()
                if f.headers.get("Content-Encoding") == "gzip":
                    try:
                        body = gzip.decompress(body)
                    except Exception:
                        pass
                return f.status, body.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", "replace")
            except Exception:
                body = ""
            if e.code < 500:
                return e.code, body
            last = e
        except Exception as e:
            last = e
        time.sleep(backoff * (attempt + 1))
    return "ERR", str(last)[:200]


def get_json(url, headers=None, timeout=30, tries=3):
    h = {"Accept": "application/json"}
    h.update(headers or {})
    status, body = get(url, h, timeout, tries)
    if status != 200:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def write_json(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=1)
    print(f"wrote {path}")


def write_csv(path, rows, cols=None):
    import csv
    if not rows:
        print(f"(no rows for {path})")
        return
    cols = cols or list(rows[0].keys())
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"wrote {path}  ({len(rows)} rows)")
