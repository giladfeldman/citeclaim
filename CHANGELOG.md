# Changelog

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
