#!/usr/bin/env python3
"""Collect public bibliographic/project metadata; never execute imported content.

Standard library only, Python >=3.9. No account credentials, full papers,
private repositories, or Proofweave research writes are used by this command.
"""

import argparse
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

ROOT = Path(__file__).resolve().parents[2]
MAX_BYTES = 2_000_000
ATOM = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
RELEVANT = re.compile(r"theorem[- ]prov|autoformaliz|autoformalis|formaliz(?:ed|ing|ation).*math|formalis(?:ed|ing|ation).*math|\blean\s*[34]?\b.*(?:proof|math|theorem)|(?:proof|math|theorem).*\blean\s*[34]?\b|proof assistant", re.I)


def timestamp(value=None):
    return (value or dt.datetime.now(dt.timezone.utc)).isoformat(timespec="seconds").replace("+00:00", "Z")


def text(value, limit=8000):
    if not isinstance(value, str):
        return ""
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", value)).split())[:limit]


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def doi(value):
    value = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", text(value)).lower()
    return value if re.fullmatch(r"10\.\d{4,9}/\S+", value) else None


def topics_for(title, description=""):
    haystack = f"{title} {description}"
    topics = []
    if re.search(r"\blean(?:\s*[34])?\b", haystack, re.I):
        topics.append("Lean")
    if re.search(r"autoformali[sz]", haystack, re.I):
        topics.append("Autoformalization")
    if re.search(r"theorem[- ]prov", haystack, re.I):
        topics.append("Theorem proving")
    if re.search(r"(?:language model|\bLLM\b|machine learning)", haystack, re.I):
        topics.append("AI theorem proving")
    if re.search(r"benchmark|dataset", haystack, re.I):
        topics.append("Benchmarks")
    return topics or ["Formal mathematics"]


def record(*, identifier, kind, title, authors, summary, url, system, source_id, revision,
           published_at, updated_at, retrieved_at, topics, metadata_license, content_license=None, doi_id=None):
    value = {
        "id": identifier, "kind": kind, "title": text(title, 1000),
        "authors": [text(author, 240) for author in authors if text(author)],
        "summary": text(summary), "url": url, "topics": sorted(set(topics)),
        "publishedAt": published_at, "updatedAt": updated_at, "doi": doi_id,
        "provenance": {
            "sourceSystem": system, "sourceId": source_id, "revision": revision,
            "retrievedAt": retrieved_at, "metadataLicense": metadata_license,
            "contentLicense": content_license,
        },
        "status": "source_reported",
        "proofweaveAttested": False,
    }
    # Retrieval time is bookkeeping, not a new upstream revision.
    stable = {**value, "provenance": {k: v for k, v in value["provenance"].items() if k != "retrievedAt"}}
    value["contentHash"] = digest(stable)
    if not value["title"]:
        raise ValueError("A source record has no title")
    return value


def parse_arxiv(raw, retrieved_at):
    if re.search(br"<!DOCTYPE|<!ENTITY", raw, re.I):
        raise ValueError("XML declarations with entities are not accepted")
    root = ET.fromstring(raw)
    if root.tag != "{http://www.w3.org/2005/Atom}feed":
        raise ValueError("Expected an arXiv Atom feed")
    result = []
    for entry in root.findall("a:entry", ATOM):
        original = entry.findtext("a:id", "", ATOM).strip()
        match = re.fullmatch(r"https?://arxiv\.org/abs/((?:\d{4}\.\d{4,5}|[a-zA-Z.-]+/\d{7}))(v\d+)?", original)
        if not match:
            raise ValueError("Invalid arXiv identifier or API error entry")
        arxiv_id, version = match.groups()
        title = entry.findtext("a:title", "", ATOM)
        summary = entry.findtext("a:summary", "", ATOM)
        result.append(record(
            identifier=f"arxiv:{arxiv_id}", kind="preprint", title=title,
            authors=[a.findtext("a:name", "", ATOM) for a in entry.findall("a:author", ATOM)],
            summary=summary, url=f"https://arxiv.org/abs/{arxiv_id}{version or ''}",
            system="arXiv", source_id=arxiv_id, revision=version,
            published_at=entry.findtext("a:published", None, ATOM),
            updated_at=entry.findtext("a:updated", None, ATOM), retrieved_at=retrieved_at,
            topics=topics_for(title, summary), metadata_license="CC0-1.0",
            doi_id=doi(entry.findtext("x:doi", "", ATOM)),
        ))
    return result


def parse_crossref(raw, retrieved_at):
    payload = json.loads(raw)
    if payload.get("status") != "ok" or not isinstance(payload.get("message", {}).get("items"), list):
        raise ValueError("Expected a Crossref works response")
    result = []
    for item in payload["message"]["items"]:
        title = text(" ".join(item.get("title", [])))
        identifier = doi(item.get("DOI", ""))
        if not identifier or not RELEVANT.search(title):
            continue
        parts = item.get("published", {}).get("date-parts", [[]])[0]
        # Preserve source date precision: do not fabricate a January 1 date.
        published = "-".join(str(n) if index == 0 else f"{n:02d}" for index, n in enumerate(parts)) or None
        venue = text("; ".join(item.get("container-title", [])))
        result.append(record(
            identifier=f"doi:{identifier}", kind="paper", title=title,
            authors=[" ".join(filter(None, [a.get("given"), a.get("family")])) or a.get("name", "") for a in item.get("author", [])],
            summary=f"Publication venue: {venue}." if venue else "Bibliographic metadata supplied by Crossref.",
            url=f"https://doi.org/{urllib.parse.quote(identifier, safe='/():;._-')}", system="Crossref",
            source_id=identifier, revision=item.get("deposited", {}).get("date-time"),
            published_at=published, updated_at=item.get("deposited", {}).get("date-time"),
            retrieved_at=retrieved_at, topics=topics_for(title),
            metadata_license="Crossref public bibliographic metadata; abstracts excluded",
            doi_id=identifier,
        ))
    return result


def parse_github(raw, retrieved_at, expected_repo, topics, etag=None):
    item = json.loads(raw)
    if item.get("private") is not False or item.get("full_name", "").lower() != expected_repo.lower():
        raise ValueError("Repository is not the selected public repository")
    name = item["full_name"]
    return [record(
        identifier=f"github:{name.lower()}", kind="repository", title=name,
        authors=[item.get("owner", {}).get("login", name.split("/")[0])],
        summary=item.get("description") or "Public project repository.",
        url=f"https://github.com/{name}", system="GitHub", source_id=str(item["id"]),
        revision=etag or item.get("updated_at"), published_at=item.get("created_at"),
        updated_at=item.get("pushed_at"), retrieved_at=retrieved_at, topics=topics,
        metadata_license="GitHub public API metadata; repository contents not copied",
        content_license=(item.get("license") or {}).get("spdx_id"),
    )]


def merge_records(previous, incoming):
    merged = {item["id"]: item for item in previous}
    added = changed = 0
    for item in incoming:
        old = merged.get(item["id"])
        # An older response cannot downgrade an already observed arXiv version.
        if old and item["id"].startswith("arxiv:"):
            old_version = int((old["provenance"].get("revision") or "v0")[1:])
            new_version = int((item["provenance"].get("revision") or "v0")[1:])
            if old_version > new_version:
                continue
        added += old is None
        changed += old is not None and old["contentHash"] != item["contentHash"]
        item = {**item, "firstSeenAt": old.get("firstSeenAt", old["provenance"]["retrievedAt"]) if old else item["provenance"]["retrievedAt"]}
        item["previousContentHash"] = (old["contentHash"] if old["contentHash"] != item["contentHash"] else old.get("previousContentHash")) if old else None
        merged[item["id"]] = item
    # A preprint and a publication remain distinct, with explicit DOI links.
    by_doi = {}
    for item in merged.values():
        if item.get("doi"):
            by_doi.setdefault(item["doi"], []).append(item["id"])
    for item in merged.values():
        item["relatedRecordIds"] = sorted(i for i in by_doi.get(item.get("doi"), []) if i != item["id"])
    # A bibliographic deposit refresh is not a newly published paper.
    def display_date(item):
        return (item.get("updatedAt") if item["kind"] == "repository" else item.get("publishedAt")) or ""
    return sorted(merged.values(), key=lambda x: (display_date(x), x["id"]), reverse=True), added, changed


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # The importer uses exact, configured API hosts. Do not follow arbitrary
        # redirect destinations or fetch URLs extracted from remote content.
        return None


def fetch_public(url):
    if urllib.parse.urlparse(url).hostname not in {"api.github.com", "export.arxiv.org", "api.crossref.org"}:
        raise ValueError("API host is not allowlisted")
    request = urllib.request.Request(url, headers={
        "User-Agent": "ProofweaveResearchIndex/0.1 (+https://proofweave.org)",
        "Accept": "application/json, application/atom+xml",
    })
    with urllib.request.build_opener(NoRedirects()).open(request, timeout=25) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("Source response exceeds the metadata size limit")
        return raw, response.headers.get("ETag")


def retry_at(error, now):
    earliest = now + dt.timedelta(hours=24)
    retry = error.headers.get("Retry-After") if isinstance(error, urllib.error.HTTPError) else None
    if retry:
        try:
            indicated = now + dt.timedelta(seconds=int(retry)) if retry.isdigit() else parsedate_to_datetime(retry)
            earliest = max(earliest, indicated)
        except (ValueError, TypeError, OverflowError):
            pass
    return timestamp(earliest)


def collect(config, previous, fetch=fetch_public, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    checked = timestamp(now)
    existing_status = {s["id"]: s for s in previous.get("sources", [])}
    sources, incoming = [], []
    arxiv = config["arxiv"]
    crossref = config["crossref"]
    requests = [
        (arxiv["id"], "https://export.arxiv.org/api/query?" + urllib.parse.urlencode({"search_query": arxiv["query"], "sortBy": "lastUpdatedDate", "sortOrder": "descending", "max_results": min(arxiv["limit"], 100)}), parse_arxiv),
        (crossref["id"], "https://api.crossref.org/works?" + urllib.parse.urlencode({"query.title": crossref["query"], "filter": f"from-pub-date:{now.year - 2}-01-01,until-pub-date:{now.date().isoformat()}", "rows": min(crossref["limit"], 100), "sort": "relevance", "select": "DOI,title,author,published,indexed,deposited,container-title"}), parse_crossref),
    ]
    for repo in config["repositories"]:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo["name"]):
            raise ValueError("Invalid configured repository name")
        requests.append((f"github:{repo['name'].lower()}", f"https://api.github.com/repos/{repo['name']}", repo))
    for source_id, url, parser in requests:
        old = existing_status.get(source_id, {})
        if old.get("nextAttemptAt", "") > checked:
            sources.append({**old, "skippedThisRun": True})
            continue
        status = {"id": source_id, "url": url, "lastAttemptAt": checked, "lastSuccessAt": old.get("lastSuccessAt"), "skippedThisRun": False}
        try:
            raw, etag = fetch(url)
            rows = parse_github(raw, checked, parser["name"], parser["topics"], etag) if isinstance(parser, dict) else parser(raw, checked)
            incoming.extend(rows)
            status.update({"state": "ready", "lastSuccessAt": checked, "receivedRecords": len(rows), "error": None,
                           "nextAttemptAt": timestamp(now + dt.timedelta(hours=max(24, config["refreshHours"]))), "responseHash": hashlib.sha256(raw).hexdigest()})
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError, ET.ParseError) as error:
            code = error.code if isinstance(error, urllib.error.HTTPError) else None
            status.update({"state": "rate_limited" if code == 429 else "unavailable", "httpStatus": code,
                           "error": f"HTTP {code}" if code else type(error).__name__, "nextAttemptAt": retry_at(error, now), "receivedRecords": 0})
        sources.append(status)
    items, added, changed = merge_records(previous.get("items", []), incoming)
    return {"schemaVersion": "pw-public-research-index-v1", "collectedAt": checked,
            "scope": "Formal mathematics, Lean, and AI theorem proving",
            "configHash": digest(config), "items": items, "sources": sources,
            "lastRun": {"added": added, "changed": changed, "total": len(items)},
            "notice": "Automatically indexed external metadata. Source claims are not Proofweave verification or contributions."}


def write_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "config/public-research-sources.json")
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/public-research/index.json")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    previous = json.loads(args.output.read_text()) if args.output.exists() else {}
    result = collect(config, previous)
    write_atomic(args.output, result)
    print(json.dumps({**result["lastRun"], "output": str(args.output), "sources": [{"id": x["id"], "state": x["state"], "skipped": x["skippedThisRun"]} for x in result["sources"]]}, ensure_ascii=False))
    return 0 if all(s["state"] == "ready" for s in result["sources"]) else 2


if __name__ == "__main__":
    raise SystemExit(main())
