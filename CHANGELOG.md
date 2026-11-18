# Changelog

## v0.2.0 (2026-11-18)

A sweep for one defect class: **one DOI read differently in different code paths**. The
citation's DOI, the keys of the host's abstracts map and each abstract record's own DOI are
three readers of one value; they now share one rule, bound by a variant matrix
(`tests/doiParity.test.ts`) that was watched failing on v0.1.1. No prompt change: the prompt
`claim-pair-v1` and its hash are unchanged.

### Fixed
- **A supplied abstract was reported missing.** The abstracts map was looked up by the
  lower-cased citation DOI only, so a map keyed in any other form (`10.1234/ABC`,
  `https://doi.org/10.1234/abc`, `doi:10.1234/abc`) gave `no_abstract` for a source whose
  abstract was there: "could not check" for a source that could be checked. The map is now
  re-keyed by `normalizeDoi` before lookup.
- **`normalizeDoi` missed written forms** that other tools produce: `https://www.doi.org/`, a
  bare `doi.org/`, a percent-encoded DOI (`10.1234%2Fabc`), and a `doi:` label in front of a
  resolver URL. Each gave `no_doi` (citation) or `no_abstract` (map key or record DOI). It also
  accepted strings with no `/` (`10.1234`) as a DOI; those are now `no_doi`.

### Added
- `summary.abstractKeys: { given, unreadable, conflicting }`: map entries whose key is not a
  DOI, and DOIs claimed by two entries with different abstract text, were dropped without a
  count; a conflicting DOI is now not used at all (its citations are `no_abstract`) rather than
  using whichever entry came first.
- `indexAbstracts(abstracts)`, and `ineligibilityReason` accepts its result.
- Every field of `ItemResult`, `CallRecord` and `CheckSummary` is now asserted for each item
  status (`tests/fieldCoverage.test.ts`).

### What a consumer does differently
- Nothing is required. Citations that were `no_abstract` only because of the key form are now
  judged. A consumer that reads `summary` sees the new `abstractKeys` field.

## v0.1.1 (2026-10-23)

Documentation only: no behaviour, prompt or API change. Apart from this changelog and the README,
the only differences from v0.1.0 are the version number (`package.json`, `LIBRARY_VERSION` in
`src/version.ts`, `CITATION.cff`) and a test that keeps `CITATION.cff` in step with `package.json`.

- README: the recommended free model for `checkClaims` (measured October 2026 on a held-out
  benchmark of 589 tasks), and how unreliable its free endpoint was (HTTP 429/503/404), with the
  advice to retry with backoff and show `llm_unavailable` as "could not run", never as a verdict.
- README: the install line pins `#v0.1.1`.
- Why a release for a README change: consumers pin a tag, and an untagged commit after v0.1.0
  read as unreleased work to tools that compare a package with its tags. Consumers need not repin; v0.1.0
  and v0.1.1 behave the same.

## v0.1.0 (2026-10-14)

First release.

- `checkClaims(citations, abstracts, client, options)`: evidence-scoped verdicts
  (`consistent` / `contradicts` / `silent`) per citing sentence, one model call
  per cited source (split above `maxGroupSize`, default 6).
- Typed abstention reasons for citations that are not assessed and for model
  failures; a failure is never a verdict.
- Verbatim-quote guard with the located span returned for highlighting.
- Injected `LlmClient`; call records carry prompt id/hash, rendered-prompt hash
  and `callConfigSha256` (canonical JSON, cross-language).
- Prompt `claim-pair-v1`.
- Checked before release by two other models (tier-3 cross-model consult): item ids must be the
  sentence numbers (anything else fails the whole answer instead of shifting verdicts); citations
  are grouped by reference AND DOI; one quote-matching specification is shared byte-for-byte with
  the benchmark's Python port (fixture `tests/fixtures/quote_parity.json`); canonical hashing
  refuses integers beyond 2^53.
- Review pass: `concurrency` must be a positive integer (it was silently run with zero workers for NaN);
  an abstract record whose own DOI differs from its map key is not used; `evidenceSpan` is documented
  as offsets into the NFKC form of the abstract.
