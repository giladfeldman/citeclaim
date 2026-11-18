/**
 * Field coverage (2026-11-18 sweep). Class: "a returned field that no test checks".
 * Every field of ItemResult, CallRecord and CheckSummary is asserted here for each
 * item status (judged, not_assessed, llm_failed), so a field that stops being
 * filled, or is filled for the wrong status, fails a test.
 */
import { canonicalSha256, sha256Hex } from '../src/canonical.js';
import { checkClaims } from '../src/check.js';
import { promptSha256, renderPrompt } from '../src/prompts/index.js';
import { LIBRARY_VERSION } from '../src/version.js';
import type { CitationInput, LlmClient, SourceAbstract } from '../src/types.js';

const ABS = 'In a preregistered study of 120 adults, sleep restriction reduced recall accuracy by 12 percent. '.repeat(3);
const abstracts = new Map<string, SourceAbstract>([
  ['10.1/a', { doi: '10.1/a', title: 'Sleep and recall', year: 2021, abstract: ABS, source: 'openalex' }],
  ['10.1/b', { doi: '10.1/b', title: 'Other', year: 2020, abstract: ABS.replace('120', '80'), source: 'crossref' }],
]);
const CONFIG = { provider: 'test', model_requested: 'm', temperature: 0 };
const cite = (id: string, over: Partial<CitationInput> = {}): CitationInput => ({
  id, referenceKey: 'ref-a', doi: '10.1/a', linkStatus: 'matched', sourceCount: 1, sentence: `Claim ${id}.`, ...over,
});

const client: LlmClient = {
  async complete(req) {
    if (req.prompt.includes('80 adults')) throw new Error('HTTP 503 from provider');
    return {
      text: JSON.stringify({ items: [
        { id: 1, verdict: 'consistent', evidence_quote: 'sleep restriction reduced recall accuracy', reason: 'states it' },
        { id: 2, verdict: 'silent', evidence_quote: '', reason: 'not covered' },
      ] }),
      servedModel: 'fake-2', finishReason: 'stop', usage: { prompt_tokens: 42 }, callConfig: CONFIG,
    };
  },
};

describe('every returned field, for every status', () => {
  it('fills each field exactly as documented', async () => {
    const cs = [cite('j1'), cite('j2'), cite('na', { doi: null }), cite('f1', { referenceKey: 'ref-b', doi: 'https://doi.org/10.1/B' })];
    const r = await checkClaims(cs, abstracts, client);

    expect(r.libraryVersion).toBe(LIBRARY_VERSION);
    expect(r.promptId).toBe('claim-pair-v1');
    expect(r.promptSha256).toBe(promptSha256('claim-pair-v1'));

    const span = r.items[0].evidenceSpan as { start: number; end: number };
    expect(ABS.normalize('NFKC').slice(span.start, span.end).toLowerCase()).toBe('sleep restriction reduced recall accuracy');
    expect(r.items).toEqual([
      { citationId: 'j1', referenceKey: 'ref-a', doi: '10.1/a', status: 'judged', verdict: 'consistent', reason: null,
        evidenceQuote: 'sleep restriction reduced recall accuracy', evidenceSpan: span, rationale: 'states it',
        callIndex: 0, positionInGroup: 1, groupSize: 2 },
      { citationId: 'j2', referenceKey: 'ref-a', doi: '10.1/a', status: 'judged', verdict: 'silent', reason: null,
        evidenceQuote: '', evidenceSpan: null, rationale: 'not covered', callIndex: 0, positionInGroup: 2, groupSize: 2 },
      { citationId: 'na', referenceKey: 'ref-a', doi: null, status: 'not_assessed', verdict: null, reason: 'no_doi',
        evidenceQuote: null, evidenceSpan: null, rationale: null, callIndex: null, positionInGroup: null, groupSize: null },
      { citationId: 'f1', referenceKey: 'ref-b', doi: '10.1/b', status: 'llm_failed', verdict: null, reason: 'llm_unavailable',
        evidenceQuote: null, evidenceSpan: null, rationale: null, callIndex: 1, positionInGroup: 1, groupSize: 1 },
    ]);

    const prompt0 = renderPrompt('claim-pair-v1', { title: 'Sleep and recall', year: 2021, abstract: ABS, sentences: ['Claim j1.', 'Claim j2.'] });
    expect(r.calls[0]).toEqual({
      callIndex: 0, referenceKey: 'ref-a', doi: '10.1/a', citationIds: ['j1', 'j2'],
      promptId: 'claim-pair-v1', promptSha256: promptSha256('claim-pair-v1'), renderedPromptSha256: sha256Hex(prompt0),
      callConfig: CONFIG, callConfigSha256: canonicalSha256(CONFIG), servedModel: 'fake-2', finishReason: 'stop',
      usage: { prompt_tokens: 42 }, rawText: expect.stringContaining('"consistent"'), error: null,
    });
    expect(r.calls[1]).toMatchObject({
      callIndex: 1, referenceKey: 'ref-b', doi: '10.1/b', citationIds: ['f1'],
      callConfig: null, callConfigSha256: null, servedModel: null, finishReason: null, usage: null, rawText: null,
      error: 'HTTP 503 from provider',
    });

    expect(r.summary).toEqual({
      citations: 4, eligible: 3, judged: 2,
      byVerdict: { consistent: 1, contradicts: 0, silent: 1 },
      byReason: { no_doi: 1, llm_unavailable: 1 },
      calls: 2,
      abstractKeys: { given: 2, unreadable: 0, conflicting: 0 },
    });
  });
});
