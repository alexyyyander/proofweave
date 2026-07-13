# Proofweave information-source map

Last reviewed: 2026-07-13

This document lists sources that can seed Proofweave's conjecture catalog,
Lean declaration index, research context, identities, and provenance records.
Every imported record should retain its upstream URL, source revision, retrieval
time, and license.

## Tier 1: sources for the first product release

### Formal Conjectures

- Repository: https://github.com/google-deepmind/formal-conjectures
- Browseable documentation: https://google-deepmind.github.io/formal-conjectures/
- Paper: https://arxiv.org/abs/2605.13171
- Best use: seed the public conjecture catalog with versioned Lean statements,
  categories, source URLs, and open/solved status.
- Integration: consume immutable benchmark tags or pinned Git commits. Do not
  silently replace an existing Proofweave problem when upstream corrects a
  misformalization; create a new problem revision.
- Licensing: repository code is Apache-2.0 and other repository materials are
  CC-BY 4.0, with source-specific exceptions documented upstream.

### Mathlib

- Repository: https://github.com/leanprover-community/mathlib4
- Generated declaration documentation:
  https://leanprover-community.github.io/mathlib4_docs/
- Search guide:
  https://leanprover-community.github.io/blog/posts/searching-for-theorems-in-mathlib/
- Best use: canonical definitions, existing lemmas, declaration metadata,
  imports, and the environment against which artifacts are checked.
- Integration: index a pinned Mathlib commit locally. Store declaration names,
  types, documentation, source locations, and extracted dependency edges.

### Lean search services

- LeanSearch (natural-language and premise retrieval): https://leansearch.net/
- LeanSearch v2 paper: https://arxiv.org/abs/2605.13137
- Loogle (structural theorem search): https://loogle.lean-lang.org/
- Loogle source: https://github.com/nomeata/loogle
- LeanExplore (declaration search and Python API): https://www.leanexplore.com/
- LeanExplore source/API: https://github.com/justincasher/lean-explore
- Best use: novelty-assistance and premise discovery in the workbench.
- Integration: treat search results as advisory. A “not found” result is not a
  novelty certificate. Check service terms and rate limits before proxying a
  hosted service; self-host or index pinned data where practical.

### Lean projects and blueprints

- Public project index: https://leanprover-community.github.io/lean_projects.html
- Lean package registry: https://reservoir.lean-lang.org/
- Blueprint project template:
  https://github.com/leanprover-community/LeanProject
- Blueprint tooling: https://github.com/PatrickMassot/leanblueprint
- Best use: import project-level goals, declaration DAGs, formalization status,
  and examples of large collaborative projects.

### Papers With Lean

- Catalog: https://paperswithlean.com/
- Best use: connect Lean projects and declarations to research papers, topics,
  authors, and released code. Use as discovery metadata rather than a source of
  kernel truth.

## Tier 2: research and identity context

### Scholarly metadata

- OpenAlex API: https://developers.openalex.org/api-reference/introduction
- Crossref REST API:
  https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- arXiv API manual: https://info.arxiv.org/help/api/index.html
- Best use: paper metadata, citations, topics, institutions, and links from a
  conjecture to its informal source.
- Rule: preserve upstream identifiers (`doi`, `arxiv_id`, `openalex_id`) and do
  not merge people solely by name.

### Person identity

- ORCID API overview: https://info.orcid.org/hands-on-with-the-orcid-api/
- ORCID registry search API:
  https://info.orcid.org/documentation/api-tutorials/api-tutorial-searching-the-orcid-registry/
- Best use: optional account linking and researcher identity claims.
- Rule: ORCID is an identity link, not proof that one human controls no other
  Proofweave account.

### Delegation and provenance standards

- W3C Verifiable Credentials 2.0: https://www.w3.org/TR/vc-data-model/
- W3C PROV namespace and model: https://www.w3.org/ns/prov
- Contributor Role Taxonomy: https://credit.niso.org/
- Best use: model delegation certificates, signed claims, provenance bundles,
  and a vocabulary for contribution roles. Proofweave should extend these
  standards with formal-mathematics-specific roles instead of inventing an
  unrelated identity format.

## Benchmark and onboarding sources

- miniF2F: https://github.com/facebookresearch/miniF2F
- ProofNet: https://github.com/zhangir-azerbayev/ProofNet
- PutnamBench: https://github.com/trishullab/PutnamBench
- Mathematics in Lean:
  https://leanprover-community.github.io/mathematics_in_lean/
- Theorem Proving in Lean 4:
  https://docs.lean-lang.org/theorem_proving_in_lean4/

These are useful for smoke tests, tutorials, and verifier load testing. They
should be visibly separated from frontier research problems in the product.

## Recommended ingestion order

1. Pin one Formal Conjectures benchmark tag and import its metadata.
2. Pin the matching Lean and Mathlib revisions and build a local declaration
   index.
3. Import blueprint DAGs for two or three collaborative projects.
4. Enrich source papers through DOI/arXiv/OpenAlex identifiers.
5. Add ORCID linking only after local passkey-based accounts work.
6. Add external theorem-search adapters after the local corpus search is stable.

## Minimum provenance fields for every imported object

```text
source_system
source_url
source_object_id
source_revision
retrieved_at
content_hash
license
supersedes
```

