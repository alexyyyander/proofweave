import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("public_research", ROOT / "scripts/ingest/collect-public-research.py")
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)
NOW = dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
STAMP = ingest.timestamp(NOW)
CONFIG = {"refreshHours": 24, "arxiv": {"id": "arxiv:test", "query": "ti:Lean", "limit": 50}, "crossref": {"id": "crossref:test", "query": "theorem proving", "limit": 50}, "repositories": []}


def atom(version="v1", doi="10.1234/Paper"):
    return f'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/2601.12345{version}</id><title>Autoformalization with Lean 4</title><summary>A &amp; B.</summary><author><name>Alice</name></author><published>2026-01-01T00:00:00Z</published><updated>2026-02-01T00:00:00Z</updated><arxiv:doi>{doi}</arxiv:doi></entry></feed>'''.encode()


def crossref():
    return json.dumps({"status": "ok", "message": {"items": [
        {"DOI": "10.1234/paper", "title": ["Autoformalization with Lean"], "author": [{"given": "A", "family": "B"}], "published": {"date-parts": [[2026, 3]]}, "container-title": ["Example proceedings"], "abstract": "DO NOT COPY THIS ABSTRACT"},
        {"DOI": "10.1234/unrelated", "title": ["Lean manufacturing processes"]},
    ]}}).encode()


class IngestionTests(unittest.TestCase):
    def test_arxiv_identifier_version_provenance(self):
        item = ingest.parse_arxiv(atom("v2"), STAMP)[0]
        self.assertEqual(item["id"], "arxiv:2601.12345")
        self.assertEqual(item["provenance"]["revision"], "v2")
        self.assertEqual(item["doi"], "10.1234/paper")
        self.assertEqual(item["summary"], "A & B.")
        self.assertFalse(item["proofweaveAttested"])
        self.assertEqual(item["status"], "source_reported")

    def test_arxiv_bad_or_error_xml_rejected(self):
        for source in [b"<html>Rate limited</html>", b"<!DOCTYPE x><feed/>", b"<feed xmlns='http://www.w3.org/2005/Atom'><entry><id>http://arxiv.org/api/errors#bad-query</id></entry></feed>"]:
            with self.assertRaises(ValueError):
                ingest.parse_arxiv(source, STAMP)

    def test_crossref_relevance_date_precision_no_abstract_copy(self):
        records = ingest.parse_crossref(crossref(), STAMP)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["publishedAt"], "2026-03")
        self.assertNotIn("DO NOT COPY", json.dumps(records))

    def test_repeat_deduplicates_without_counting_retrieval_as_change(self):
        first, added, changed = ingest.merge_records([], ingest.parse_arxiv(atom(), STAMP))
        self.assertEqual((added, changed), (1, 0))
        second, added, changed = ingest.merge_records(first, ingest.parse_arxiv(atom(), "2026-10-13T00:00:00Z"))
        self.assertEqual((len(second), added, changed), (1, 0, 0))
        self.assertEqual(second[0]["firstSeenAt"], STAMP)

    def test_revision_update_and_old_response_never_downgrades(self):
        first, _, _ = ingest.merge_records([], ingest.parse_arxiv(atom("v1"), STAMP))
        second, added, changed = ingest.merge_records(first, ingest.parse_arxiv(atom("v2"), STAMP))
        self.assertEqual((added, changed), (0, 1))
        self.assertEqual(second[0]["previousContentHash"], first[0]["contentHash"])
        third, _, changed = ingest.merge_records(second, ingest.parse_arxiv(atom("v1"), STAMP))
        self.assertEqual(third[0]["provenance"]["revision"], "v2")
        self.assertEqual(changed, 0)

    def test_paper_and_preprint_link_via_doi_without_conflating_claims(self):
        records, _, _ = ingest.merge_records([], ingest.parse_arxiv(atom(), STAMP) + ingest.parse_crossref(crossref(), STAMP))
        self.assertEqual(len(records), 2)
        for item in records:
            self.assertEqual(len(item["relatedRecordIds"]), 1)
            self.assertFalse(item["proofweaveAttested"])

    def test_public_repository_identity_enforced(self):
        payload = {"id": 10, "private": False, "full_name": "example/lean", "owner": {"login": "example"}, "description": "An example", "license": {"spdx_id": "Apache-2.0"}}
        parsed = ingest.parse_github(json.dumps(payload), STAMP, "example/lean", ["Lean"])[0]
        self.assertEqual(parsed["id"], "github:example/lean")
        for changed in [{**payload, "private": True}, {**payload, "full_name": "other/lean"}]:
            with self.assertRaises(ValueError):
                ingest.parse_github(json.dumps(changed), STAMP, "example/lean", [])

    def test_partial_outage_preserves_old_records_and_records_backoff(self):
        old, _, _ = ingest.merge_records([], ingest.parse_arxiv(atom(), STAMP))
        def fetch(url):
            if "arxiv" in url:
                raise urllib.error.HTTPError(url, 429, "Rate limited", {"Retry-After": "172800"}, None)
            return crossref(), None
        result = ingest.collect(CONFIG, {"items": old}, fetch=fetch, now=NOW)
        self.assertEqual(len(result["items"]), 2)
        status = result["sources"][0]
        self.assertEqual(status["state"], "rate_limited")
        self.assertEqual(status["nextAttemptAt"], "2026-10-14T00:00:00Z")
        self.assertIsNone(status["lastSuccessAt"])

    def test_cached_run_does_not_fetch_and_keeps_unavailability_visible(self):
        previous = {"items": [], "sources": [
            {"id": "arxiv:test", "state": "rate_limited", "nextAttemptAt": "2026-10-13T00:00:00Z"},
            {"id": "crossref:test", "state": "ready", "nextAttemptAt": "2026-10-13T00:00:00Z"},
        ]}
        def forbidden(_):
            self.fail("Fetched during cooldown")
        result = ingest.collect(CONFIG, previous, fetch=forbidden, now=NOW)
        self.assertEqual(result["sources"][0]["state"], "rate_limited")
        self.assertTrue(all(s["skippedThisRun"] for s in result["sources"]))

    def test_unexpected_api_host_not_fetched(self):
        with self.assertRaises(ValueError):
            ingest.fetch_public("https://localhost/private")

    def test_recent_metadata_deposit_does_not_promote_an_old_paper(self):
        old = ingest.parse_crossref(crossref(), STAMP)[0]
        old.update({"id": "doi:10.1234/old", "publishedAt": "2024", "updatedAt": "2026-10-12T00:00:00Z"})
        newer = {**old, "id": "doi:10.1234/new", "publishedAt": "2026-10", "updatedAt": "2026-09-30T00:00:00Z"}
        items, _, _ = ingest.merge_records([], [old, newer])
        self.assertEqual(items[0]["id"], newer["id"])


if __name__ == "__main__":
    unittest.main()
