#!/usr/bin/env python3
"""Import audited public metadata. Requires a commit-pinned cache and hash manifest.

Does not fetch the proof library, execute upstream code, or attest any result.
"""
import argparse
from collections import Counter
from datetime import datetime
import hashlib
from html import unescape
import json
from pathlib import Path
import posixpath
import re
from urllib.parse import quote, urlparse


def import_catalog(snapshot):
    manifest = json.loads((snapshot / "source-manifest.json").read_text())
    revision = manifest["revision"]
    if manifest["repository"] != "https://github.com/openai/math" or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Expected the audited OpenAI repository and an exact commit")
    if manifest.get("metadataErrors"):
        raise ValueError("Resolve metadata download errors before importing")
    recorded = {entry["path"]:entry for entry in manifest["files"]}

    def read(path):
        if path not in recorded or ".." in Path(path).parts or path.startswith("/"):
            raise ValueError(f"Unrecorded metadata: {path}")
        raw = (snapshot / "upstream" / path).read_bytes()
        if hashlib.sha256(raw).hexdigest() != recorded[path]["sha256"]:
            raise ValueError(f"Metadata hash mismatch: {path}")
        return raw.decode("utf-8")

    def url(path):
        return f"https://github.com/openai/math/blob/{revision}/{quote(path, safe='/')}"

    def resolve_link(path, href):
        if href.startswith("https://"):
            if urlparse(href).hostname != "github.com":
                return href
            return href.replace("https://github.com/openai/math/blob/main/", f"https://github.com/openai/math/blob/{revision}/")
        if urlparse(href).scheme or href.startswith("//"):
            raise ValueError("Unsupported metadata link")
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), href))
        if resolved.startswith("../"):
            raise ValueError("Metadata link escapes repository")
        return url(resolved)

    def links(text, path):
        return [{"label":unescape(label), "url":resolve_link(path, href)}
                for label,href in re.findall(r"\[([^\n]+?)\]\(([^\s)]+)\)", text)]

    contents = read("CONTENTS.md")
    expected = re.search(r"\*\*(\d+) manuscripts covering (\d+) result families\.\*\*", contents)
    if not expected:
        raise ValueError("Upstream manuscript-map format changed")
    expected_papers, expected_families = map(int, expected.groups())
    subjects = {}
    subject = None
    for line in read("overview.tex").splitlines():
        section = re.match(r"\\cataloguesection\{([^}]+)\}\{\d+\}", line)
        if section:
            subject = section[1]
        entry = re.match(r"\\resultentry\{(\d{3})\}", line)
        if entry:
            if not subject or entry[1] in subjects:
                raise ValueError("Invalid family classification")
            subjects[entry[1]] = subject
    yaml = read("lean/formalization.yaml")
    sources_section = yaml.split("\nsources:\n",1)[1].split("\nrelated_formalizations:",1)[0]
    formal_sources = set(re.findall(r"^    id: \.\./(preprints/[^\n]+)$",sources_section,re.M))
    if len(formal_sources) != len(re.findall(r"^  - title:",sources_section,re.M)):
        raise ValueError("Upstream formalization-index format changed")
    markers = list(re.finditer(r"^\*\*(\d{3})\. (.*?)\*\*([^\n]*)",contents,re.M))
    family_list = []
    seen_pdfs = set()
    for index, marker in enumerate(markers):
        number,title,claim = marker.groups()
        section = contents[marker.end():markers[index+1].start() if index+1<len(markers) else len(contents)]
        scope_link = re.search(r"\[Lean\]\((lean/docs/\d+\.md)\)",claim)
        claim = re.sub(r"\s*\(\[Lean\]\([^)]+\)\)","",claim).strip()
        scope = None
        if scope_link:
            scope_path = scope_link[1]
            scope_doc = read(scope_path)
            scope_sections = re.split(r"^## (.+)$",scope_doc,flags=re.M)
            scopes = {scope_sections[i]:scope_sections[i+1].strip() for i in range(1,len(scope_sections),2)}
            scope = {"url":url(scope_path), "sha256":recorded[scope_path]["sha256"],
                     "text":scopes.get("Scope", "Scope details are available in the source document."),
                     "paperLinks":links(scope_sections[0],scope_path),
                     "comparatorLinks":links(scopes.get("Comparator links",""),scope_path)}
        manuscripts = []
        for paper_title,pdf_path,abstract in re.findall(r"&emsp;\[(.*?)\]\((preprints/[^\n]+?\.pdf)\)\s*(.*?)</td>",section,re.S):
            if pdf_path in seen_pdfs:
                raise ValueError("Duplicate manuscript PDF")
            seen_pdfs.add(pdf_path)
            readme_path = str(Path(pdf_path).parent / "README.md")
            readme = read(readme_path)
            citation = re.search(r"(?:```|~~~)bibtex\s*\n(.*?)\n(?:```|~~~)",readme,re.S)
            if not citation or not re.search(r"author\s*=\s*\{\{OpenAI\}\}",citation[1]):
                raise ValueError(f"Review citation and author format: {readme_path}")
            month = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
            date_match = re.search(month+r" \d{1,2}, \d{4}",readme)
            date_format = "%B %d, %Y"
            if not date_match:
                date_match = re.search(r"\d{1,2} "+month+r" \d{4}",readme)
                date_format = "%d %B %Y"
            if not date_match:
                raise ValueError(f"Missing manuscript date: {readme_path}")
            date = datetime.strptime(date_match[0],date_format).date().isoformat()
            version = re.search(r"^## Version note\s*\n(.*?)(?=^## |\Z)",readme,re.M|re.S)
            version_text = version[1].strip() if version else ""
            scope_cites_paper = bool(scope and any(link["url"] == url(pdf_path) for link in scope["paperLinks"]))
            manuscripts.append({
                "id":pdf_path.removeprefix("preprints/").rsplit("/",1)[0],
                "title":unescape(paper_title.strip()), "authors":["OpenAI"], "date":date,
                "abstract":unescape(abstract.strip()), "pdfUrl":url(pdf_path),
                "downloadUrl":f"https://raw.githubusercontent.com/openai/math/{revision}/{quote(pdf_path,safe='/')}",
                "readmeUrl":url(readme_path), "readmeSha256":recorded[readme_path]["sha256"],
                "citation":citation[1].strip(),
                "versionNote":re.sub(r"\[([^\n]+?)\]\(([^\s)]+)\)",r"\1",version_text),
                "versionLinks":links(version_text,readme_path),
                "listedInFormalizationIndex":pdf_path in formal_sources,
                "citedByScopeDocument":scope_cites_paper,
                "proofweaveReplay":"not_run", "statementReview":"not_started", "receipt":None,
            })
        if not manuscripts:
            raise ValueError(f"No manuscripts for family {number}")
        family_list.append({"number":number,"title":unescape(title.rstrip(".")),"subject":subjects[number],
                            "claim":unescape(claim),"manuscripts":manuscripts,"scope":scope})
    if len(seen_pdfs)!=expected_papers or len(family_list)!=expected_families or len(subjects)!=expected_families:
        raise ValueError("Imported counts do not match upstream declared counts")
    history = read("history.md")
    formal_count = re.search(r"(\d+) / (\d+) = ~42%",history)
    if not formal_count or int(formal_count[2]) != expected_papers:
        raise ValueError("Recheck upstream aggregate formalization count")
    withdrawals = []
    withdrawn_titles = re.findall(r"^- (.+)$",history.split("**Withdrawals**",1)[1].split("**Fixes**",1)[0],re.M)
    for title in withdrawn_titles:
        prefix = re.sub(r"[^a-z0-9]+","-",title.lower()).strip("-")
        candidates = [path for path in recorded if path.startswith("preprints/") and path.endswith("/README.md") and
                      re.sub(r"[^a-z0-9]+","-",path.split("/")[1].lower()).startswith(prefix+"-")]
        if len(candidates)!=1:
            raise ValueError(f"Check withdrawal source: {title}")
        path = candidates[0]
        notice = read(path)
        if "Withdrawn" not in notice:
            raise ValueError("Withdrawal notice missing")
        withdrawn_date = re.search(r"Withdrawn on (.+?)\.",notice)
        withdrawals.append({"title":title,"noticeUrl":url(path),"noticeSha256":recorded[path]["sha256"],
                            "date":datetime.strptime(withdrawn_date[1],"%B %d, %Y").date().isoformat()})
    lake = json.loads(read("lean/lake-manifest.json"))
    mathlib = next(package for package in lake["packages"] if package["name"]=="mathlib")
    papers = [paper for family in family_list for paper in family["manuscripts"]]
    subject_counts = Counter(family["subject"] for family in family_list)
    collection = {"schemaVersion":1,"id":"openai-math","title":"OpenAI mathematics release",
        "releaseDate":"2026-10-06", "indexedAt":manifest["retrievedAt"],
        "source":{"repository":manifest["repository"],"revision":revision,"license":"Apache-2.0",
                  "licenseUrl":url("LICENSE"),"historyUrl":url("history.md"),"contentsUrl":url("CONTENTS.md"),
                  "announcementUrl":"https://openai.com/index/sharing-ai-progress-in-mathematics/"},
        "environment":{"lean":read("lean/lean-toolchain").strip(),"mathlib":mathlib["rev"],
                       "instructionsUrl":url("lean/ComparatorChallenges/README.md")},
        "statistics":{"manuscripts":len(papers),"families":len(family_list),"subjects":len(subject_counts),
                      "scopeDocuments":sum(family["scope"] is not None for family in family_list),
                      "upstreamReportedFormalizedResults":int(formal_count[1]),"proofweaveReplays":0,
                      "yamlIndexedManuscripts":sum(paper["listedInFormalizationIndex"] for paper in papers)},
        "subjects":[{"name":name,"families":count} for name,count in sorted(subject_counts.items())],
        "families":family_list,"withdrawals":withdrawals}
    return collection,manifest


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    catalog,manifest=import_catalog(args.snapshot)
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/"openai-math.json").write_text(json.dumps(catalog,ensure_ascii=False,separators=(",",":"))+"\n")
    (args.output/"openai-math-summary.json").write_text(json.dumps({"statistics":catalog["statistics"],"revision":catalog["source"]["revision"],"indexedAt":catalog["indexedAt"]},indent=2)+"\n")
    (args.output/"openai-math-provenance.json").write_text(json.dumps(manifest,indent=2)+"\n")
    (args.output/"OPENAI-LICENSE.txt").write_bytes((args.snapshot/"upstream/LICENSE").read_bytes())
    print(json.dumps(catalog["statistics"],indent=2))
