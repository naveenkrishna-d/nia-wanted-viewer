#!/usr/bin/env python3
"""Fetch public NIA wanted pages and publish a validated JSON dataset.

Designed for scheduled execution (e.g. GitHub Actions). If the source is
unreachable or parsing produces a suspiciously small dataset, the existing
last-known-good records.json is left untouched and the command exits non-zero.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "records.json"
CHANGELOG_PATH = ROOT / "data" / "change_log.json"
STATUS_PATH = ROOT / "data" / "status.json"

SOURCES = [
    ("Most Wanted", "https://nia.gov.in/most-wanted"),
    ("Most Wanted Photos", "https://nia.gov.in/most-wanted-photos"),
]
MAX_PAGES = 50
STOP_AFTER_EMPTY_OR_DUPLICATE_PAGES = 2
HEADERS = {
    "User-Agent": "NIA-Public-Data-Viewer/1.0 (+public data refresh; respects source website)",
    "Accept-Language": "en-IN,en;q=0.9",
}
LABELS = [
    "Reward", "Name", "Aliases", "Parentage", "Address", "Wanted in",
    "Accused Status", "Age/DOB (Approx)", "Organization", "E-mail",
    "Phone No.", "Postal Address",
]
LABEL_RE = re.compile(r"^(%s)\s*:?$" % "|".join(re.escape(x) for x in LABELS), re.I)
CASE_RE = re.compile(r"RC-[A-Z0-9-]+/\d{4}/NIA/[A-Z0-9-]+", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def normalize_aliases(value: str) -> str:
    value = clean(value)
    value = re.sub(r"\s*@\s*", "; ", value).strip(" ;")
    value = re.sub(r"\s*,\s*", "; ", value)
    parts = [p.strip() for p in value.split(";") if p.strip()]
    return "; ".join(dict.fromkeys(parts))


def absolutize(src: str, base: str) -> str:
    return urljoin(base, src) if src else ""


def image_map(soup: BeautifulSoup, base_url: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for img in soup.find_all("img"):
        alt = clean(img.get("alt", ""))
        src = img.get("src") or img.get("data-src") or img.get("data-original") or ""
        if alt and src:
            out.setdefault(alt.casefold(), absolutize(src, base_url))
    return out


def parse_records(html: str, page_url: str, source_name: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    images = image_map(soup, page_url)
    lines = [clean(x) for x in soup.get_text("\n").splitlines()]
    lines = [x for x in lines if x]

    records: list[dict] = []
    i = 0
    while i < len(lines):
        m = LABEL_RE.match(lines[i])
        if not m or m.group(1).lower() != "name":
            i += 1
            continue

        fields: dict[str, str] = {}
        j = i
        while j < len(lines):
            lm = LABEL_RE.match(lines[j])
            if not lm:
                j += 1
                continue
            label = lm.group(1)
            if label.lower() == "name" and fields.get("Name"):
                break
            k = j + 1
            vals: list[str] = []
            while k < len(lines) and not LABEL_RE.match(lines[k]):
                # Boilerplate indicates the modal/profile block is over.
                if lines[k].startswith(("Identity of the informant", "PLEASE HELP US", "For any information")):
                    break
                vals.append(lines[k])
                k += 1
            fields[label] = clean(" ".join(vals))
            j = max(k, j + 1)
            if k < len(lines) and (lines[k].startswith("Identity of the informant") or lines[k].startswith("PLEASE HELP US")):
                break

        name = clean(fields.get("Name", ""))
        if name and len(name) <= 180 and name.lower() not in {"name", "search by name"}:
            wanted = clean(fields.get("Wanted in", ""))
            cases = list(dict.fromkeys(m.group(0).upper() for m in CASE_RE.finditer(wanted)))
            reward = clean(fields.get("Reward", ""))
            rec = {
                "name": name,
                "aliases": normalize_aliases(fields.get("Aliases", "")),
                "parentage": clean(fields.get("Parentage", "")),
                "address": clean(fields.get("Address", "")),
                "cases": cases,
                "wanted_in_raw": wanted,
                "status": clean(fields.get("Accused Status", "")),
                "age": clean(fields.get("Age/DOB (Approx)", "")),
                "organization": clean(fields.get("Organization", "")),
                "reward": reward,
                "image_url": images.get(name.casefold(), ""),
                "source_pages": [source_name],
                "source_url": page_url,
                "source_urls": [page_url],
            }
            records.append(rec)
        i = max(j, i + 1)

    return records


def merge_records(records: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for r in records:
        key = r["name"].casefold().strip() + "|" + (r.get("image_url") or "|".join(r.get("cases", [])))
        r["id"] = sha256_text(key)[:20]
        if key not in merged:
            merged[key] = r
            continue
        cur = merged[key]
        for field in ["aliases", "parentage", "address", "wanted_in_raw", "status", "age", "organization", "reward", "image_url"]:
            if not cur.get(field) and r.get(field):
                cur[field] = r[field]
        cur["source_urls"] = list(dict.fromkeys(cur.get("source_urls", []) + r.get("source_urls", [])))
        cur["cases"] = list(dict.fromkeys(cur.get("cases", []) + r.get("cases", [])))
        cur["source_pages"] = list(dict.fromkeys(cur.get("source_pages", []) + r.get("source_pages", [])))
    return sorted(merged.values(), key=lambda x: x["name"].casefold())


def fetch_all() -> tuple[list[dict], list[dict]]:
    session = requests.Session()
    session.headers.update(HEADERS)
    all_records: list[dict] = []
    checks: list[dict] = []

    session.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
    for source_name, base_url in SOURCES:
        pending = {base_url}
        visited = set()
        fingerprints = set()
        source_count = 0
        while pending:
            url = sorted(pending)[0]
            pending.remove(url)
            if url in visited:
                continue
            if len(visited) >= 500:
                raise RuntimeError("Pagination safety limit reached; refusing partial dataset")
            resp = session.get(url, timeout=45)
            resp.raise_for_status()
            page_records = parse_records(resp.text, url, source_name)
            if not page_records:
                raise RuntimeError(f"No records on advertised page {url}")
            fingerprint = sha256_text(json.dumps([r["name"] for r in page_records]))
            if fingerprint in fingerprints:
                raise RuntimeError(f"Repeated page content at {url}; pagination may be blocked")
            fingerprints.add(fingerprint)
            visited.add(url)
            all_records.extend(page_records)
            source_count += len(page_records)
            checks.append({"url": url, "status": resp.status_code, "records": len(page_records)})
            soup = BeautifulSoup(resp.text, "html.parser")
            for link in soup.select('a[href]'):
                target = urljoin(url, link['href'])
                parsed = urlparse(target)
                if parsed.netloc != urlparse(base_url).netloc or parsed.path != urlparse(base_url).path:
                    continue
                values = parse_qs(parsed.query).get('page', [])
                if values and values[0].isdigit():
                    last = int(values[0])
                    if last >= 500:
                        raise RuntimeError("Advertised page exceeds safety limit")
                    for page in range(1, last + 1):
                        candidate = f"{base_url}?page={page}"
                        if candidate not in visited:
                            pending.add(candidate)
        if not source_count:
            raise RuntimeError(f"Source empty: {source_name}")

    return merge_records(all_records), checks


def canonical_content(records: list[dict]) -> str:
    # Exclude volatile verification timestamps; use actual public record content.
    return json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_status(ok: bool, **extra) -> None:
    payload = {"ok": ok, "checked_at": now_iso(), **extra}
    STATUS_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    old = load_json(DATA_PATH, {})
    old_records = old.get("records", []) if isinstance(old, dict) else []

    try:
        records, checks = fetch_all()
        # Guardrail: do not publish an obviously broken/blocked scrape.
        min_expected = max(10, int(len(old_records) * 0.90)) if old_records else 10
        if len(records) < min_expected:
            raise RuntimeError(f"Validation failed: parsed {len(records)} records; expected at least {min_expected}")

        generated_at = now_iso()
        new_hash = sha256_text(canonical_content(records))
        old_hash = old.get("content_sha256") or (sha256_text(canonical_content(old_records)) if old_records else "")

        old_names = {r.get("name", "") for r in old_records}
        new_names = {r.get("name", "") for r in records}
        added = sorted(new_names - old_names)
        removed = sorted(old_names - new_names)

        payload = {
            "source": SOURCES[0][1],
            "source_secondary": SOURCES[1][1],
            "generated_at": generated_at,
            "verification": "Fetched directly from official NIA public pages; passed scraper validation.",
            "count": len(records),
            "content_sha256": new_hash,
            "records": records,
        }
        DATA_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        history = load_json(CHANGELOG_PATH, [])
        if not isinstance(history, list):
            history = []
        history.insert(0, {
            "checked_at": generated_at,
            "changed": new_hash != old_hash,
            "count": len(records),
            "added": added,
            "removed": removed,
        })
        CHANGELOG_PATH.write_text(json.dumps(history[:100], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        write_status(True, count=len(records), changed=new_hash != old_hash, checks=checks)
        print(f"OK: {len(records)} records; changed={new_hash != old_hash}; added={len(added)} removed={len(removed)}")
        return 0
    except Exception as exc:
        write_status(False, error=str(exc))
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
