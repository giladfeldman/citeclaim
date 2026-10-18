# citeclaim

Citation-claim fidelity checks: does a manuscript's citing sentence agree with
the **abstract** of the source it cites?

For every in-text citation, citeclaim sends the cited source's abstract and the
citing sentence(s) to a language model you supply, and returns one
**evidence-scoped** verdict per sentence:

| Verdict | Meaning |
|---|---|
| `consistent` | the abstract supports the claim the sentence attributes to the source |
| `contradicts` | the abstract conflicts with that claim (opposite direction, a different number, design, measure or population, or a stronger/more general claim than the abstract reports) |
| `silent` | the abstract neither supports nor contradicts it; the claim may still be true in the full paper |

An abstract can show a mismatch; it cannot show that a paper does **not**
support a claim. So `silent` is never a clean result, and every output is meant
as a **suggestion for the author to check**, not an error finding. A free or
small model judging an abstract will miss things and will sometimes be wrong;
re-run important checks with a stronger model and read the source.

## What the library does, and what it leaves to you

- **Eligibility.** Only a citation linked to exactly one reference with status
  `matched`, with a DOI, a citing sentence and an abstract of at least 200
  characters is sent to a model. Everything else comes back `not_assessed` with
  a typed reason (`link_not_matched`, `multi_source_citation`, `no_doi`,
  `no_citing_sentence`, `no_abstract`).
- **Per-source grouping.** All eligible citations of one source are judged in
  one call (the abstract is sent once; each sentence still gets its own
  verdict). Sources cited more than `maxGroupSize` times (default 6) are split.
- **Per-item validation.** A malformed answer, a missing item, a duplicated id
  or a verdict outside the scheme is `llm_failed` for that item only
  (`llm_malformed`); a truncated answer is `llm_truncated`; a failed call is
  `llm_unavailable`. A failure is never turned into `consistent`.
- **Verbatim-quote guard.** A `consistent` or `contradicts` verdict must quote
  the abstract. The quote is located in the abstract (forgiving case,
  whitespace, curly quotes and dash variants, and `...` elisions in order); if
  it is not there the item becomes `llm_failed` (`quote_not_in_abstract`). The
  located span is returned for highlighting (offsets index the NFKC form of the abstract). The
  guard proves the quoted words are in the abstract, in order; it does not prove the quote
  decides the verdict, so the quote is shown for the author to judge.
- **Untrusted text.** Sentences and abstracts are inserted into the prompt as text. A sentence
  that imitates the numbering cannot shift verdicts (ids must match the sentence numbers and every
  non-silent verdict needs a quote found in the abstract), but treat the model's reason as advice.
- **Injected model client.** The library ships no provider, key or network
  code. You pass an `LlmClient` whose `complete()` returns the text, the model
  the provider served, the stop reason, usage, and the `callConfig` it used.
- **Provenance.** Every call record carries the prompt id and hash, the hash of
  the rendered prompt, and `callConfigSha256` (canonical JSON: sorted keys,
  compact, UTF-8; whole-number floats must be passed as integers), so a verdict
  traces to the exact settings that produced it.

Fetching abstracts is not part of this library; use any source (for example
Crossref, OpenAlex, Europe PMC) and pass them in as `SourceAbstract` objects.

## Install

```bash
npm install github:giladfeldman/citeclaim#v0.1.0
```

## Use

```ts
import { checkClaims, type LlmClient } from 'citeclaim';

const client: LlmClient = {
  async complete({ prompt }) {
    const r = await myModel(prompt);               // your provider call
    return { text: r.text, servedModel: r.model, finishReason: r.stop,
             usage: r.usage, callConfig: { provider: 'x', model_requested: 'y', temperature: 0 } };
  },
};

const citations = [
  { id: 'c1', referenceKey: 'ref-12', doi: '10.1234/abc', linkStatus: 'matched', sourceCount: 1,
    sentence: 'Sleep restriction reduced recall in undergraduates (Okafor & Lind, 2031).' },
];
const abstracts = new Map([['10.1234/abc', { doi: '10.1234/abc', title: '...', year: 2031, abstract: '...' }]]);

const result = await checkClaims(citations, abstracts, client, { maxGroupSize: 6 });
// result.items[i]: { status, verdict, reason, evidenceQuote, evidenceSpan, rationale, ... }
// result.calls[j]: { promptId, promptSha256, renderedPromptSha256, callConfigSha256, servedModel, ... }
// result.summary:  { citations, eligible, judged, byVerdict, byReason, calls }
```

## Prompt

The prompt is versioned and frozen: `prompts/claim-pair-v1.md` (id
`claim-pair-v1`). A change is a new version, never an edit. Placeholders follow
Python `str.format` (`{title}`, `{year}`, `{abstract}`, `{sentences}`), so a
Python caller can render byte-identical prompts.

## Accuracy

Accuracy is measured on a benchmark of real citing sentences and abstracts with
minimal-edit perturbations; synthetic results are an upper bound for real
manuscripts. Results and the model each figure applies to are published with
the benchmark, not here, because they change when the model changes.

### Recommended free model (measured October 2026)

`nvidia/nemotron-3-ultra-550b-a55b` on NVIDIA's free hosted API (thinking off). It met every
pre-registered pass bar on a held-out benchmark of 589 citation-check tasks, on two
independent repeats; every other free model measured either missed a bar or had too small a
free daily allowance to finish. Results: accuracy 0.84 on both, and
a contradiction raised on 4-5% of correct citations. Judging all of a source's citing sentences
in one call was as accurate as one call per sentence. The figures hold for that model at that
time only; re-measure after any model change.

The free endpoint is not reliable. In the same week it rate-limited per model (HTTP 429), was
sometimes overloaded (HTTP 503), gave no answer for hours at a time, and for about a day
returned HTTP 404 for the model. Your `LlmClient` should retry with backoff and send one
request stream per model; a call that still fails comes back as `llm_failed` with reason
`llm_unavailable`, never as a verdict, so tell the user the check could not run.

## License

MIT. See `LICENSE`.
