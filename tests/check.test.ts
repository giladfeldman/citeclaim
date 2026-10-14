import { canonicalSha256 } from '../src/canonical.js';
import { checkClaims } from '../src/check.js';
import { groupBySource } from '../src/group.js';
import type { CitationInput, LlmClient, LlmRequest, SourceAbstract } from '../src/types.js';

const ABS_A = 'Sleep deprivation reduced working-memory accuracy in 48 undergraduates. '.repeat(4);
const ABS_B = 'A randomized trial of 300 adults found that mindfulness training lowered anxiety scores. '.repeat(3);
const abstracts = new Map<string, SourceAbstract>([
  ['10.1/a', { doi: '10.1/a', title: 'A', year: 2019, abstract: ABS_A, source: 'openalex' }],
  ['10.1/b', { doi: '10.1/b', title: 'B', year: 2020, abstract: ABS_B, source: 'crossref' }],
  ['10.1/short', { doi: '10.1/short', title: 'S', year: 2020, abstract: 'Too short.', source: 'crossref' }],
]);

const cite = (id: string, over: Partial<CitationInput> = {}): CitationInput => ({
  id, referenceKey: 'ref-a', doi: '10.1/a', linkStatus: 'matched', sourceCount: 1,
  sentence: `Sentence ${id} about sleep.`, ...over,
});

const CONFIG = { provider: 'test', model_requested: 'fake-latest', temperature: 0, seed: 7 };

/** Answers every item "silent" and records each request. */
function fakeClient(answer?: (req: LlmRequest, n: number) => string): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req) {
      requests.push(req);
      const n = (req.prompt.match(/^\d+\. "/gm) || []).length;
      const text = answer ? answer(req, n)
        : JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ id: i + 1, verdict: 'silent', evidence_quote: '', reason: '' })) });
      return { text, servedModel: 'fake-1.2', finishReason: 'stop', usage: { prompt_tokens: 10 }, callConfig: CONFIG };
    },
  };
}

describe('eligibility', () => {
  it('only single-source matched citations with DOI, sentence and abstract reach the model', async () => {
    const cs = [
      cite('ok'),
      cite('sug', { linkStatus: 'suggested' }),
      cite('amb', { linkStatus: 'ambiguous' }),
      cite('multi', { sourceCount: 3 }),
      cite('nodoi', { doi: null }),
      cite('nosent', { sentence: '  ' }),
      cite('noabs', { doi: '10.1/missing' }),
      cite('short', { doi: '10.1/short' }),
      cite('nokey', { referenceKey: null }),
    ];
    const client = fakeClient();
    const r = await checkClaims(cs, abstracts, client);
    expect(client.requests).toHaveLength(1);
    expect(r.items.map((i) => [i.citationId, i.status, i.reason])).toEqual([
      ['ok', 'judged', null],
      ['sug', 'not_assessed', 'link_not_matched'],
      ['amb', 'not_assessed', 'link_not_matched'],
      ['multi', 'not_assessed', 'multi_source_citation'],
      ['nodoi', 'not_assessed', 'no_doi'],
      ['nosent', 'not_assessed', 'no_citing_sentence'],
      ['noabs', 'not_assessed', 'no_abstract'],
      ['short', 'not_assessed', 'no_abstract'],
      ['nokey', 'not_assessed', 'link_not_matched'],
    ]);
    expect(r.summary).toMatchObject({ citations: 9, eligible: 1, judged: 1, calls: 1 });
  });

  it('accepts a doi.org URL as the DOI', async () => {
    const r = await checkClaims([cite('u', { doi: 'https://doi.org/10.1/A' })], abstracts, fakeClient());
    expect(r.items[0].status).toBe('judged');
  });

  it('rejects duplicate citation ids', async () => {
    await expect(checkClaims([cite('x'), cite('x')], abstracts, fakeClient())).rejects.toThrow(/duplicate/);
  });
});

describe('grouping', () => {
  it('one call per source; every sentence gets its own verdict; input order kept', async () => {
    const cs = [cite('a1'), cite('b1', { referenceKey: 'ref-b', doi: '10.1/b' }), cite('a2'), cite('a3')];
    const client = fakeClient();
    const r = await checkClaims(cs, abstracts, client);
    expect(client.requests).toHaveLength(2);
    expect(r.calls.map((c) => c.citationIds)).toEqual([['a1', 'a2', 'a3'], ['b1']]);
    expect(r.items.map((i) => i.citationId)).toEqual(['a1', 'b1', 'a2', 'a3']);
    expect(r.items.map((i) => [i.positionInGroup, i.groupSize])).toEqual([[1, 3], [1, 1], [2, 3], [3, 3]]);
    // the abstract is sent once per call
    expect(client.requests[0].prompt.split('Sleep deprivation reduced').length - 1).toBe(4);
  });

  it('splits a source cited more than maxGroupSize times into chunks', () => {
    const cs = Array.from({ length: 7 }, (_, i) => cite(`a${i}`));
    const g = groupBySource(cs, () => '10.1/a', 3);
    expect(g.map((x) => x.citations.length)).toEqual([3, 3, 1]);
    expect(() => groupBySource(cs, () => '10.1/a', 0)).toThrow();
  });
});

describe('call records and failures', () => {
  it('records prompt id/hash, served model and the call_config hash', async () => {
    const r = await checkClaims([cite('a1')], abstracts, fakeClient());
    const c = r.calls[0];
    expect(c.promptId).toBe('claim-pair-v1');
    expect(c.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.renderedPromptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.servedModel).toBe('fake-1.2');
    expect(c.callConfigSha256).toBe(canonicalSha256(CONFIG));
  });

  it('a throwing client gives llm_unavailable with the error kept, never a verdict', async () => {
    const client: LlmClient = { async complete() { throw new Error('503 high demand'); } };
    const r = await checkClaims([cite('a1'), cite('a2')], abstracts, client);
    expect(r.items.map((i) => [i.status, i.reason, i.verdict])).toEqual([
      ['llm_failed', 'llm_unavailable', null], ['llm_failed', 'llm_unavailable', null],
    ]);
    expect(r.calls[0].error).toMatch(/503/);
  });

  it('a truncated answer is llm_truncated even if its JSON happens to parse', async () => {
    const client: LlmClient = {
      async complete() {
        return { text: '{"items":[{"id":1,"verdict":"silent","evidence_quote":"","reason":""}]}',
          finishReason: 'MAX_TOKENS', callConfig: CONFIG };
      },
    };
    const r = await checkClaims([cite('a1')], abstracts, client);
    expect(r.items[0].reason).toBe('llm_truncated');
  });

  it('an empty answer is llm_unavailable', async () => {
    const client: LlmClient = { async complete() { return { text: '', finishReason: 'stop', callConfig: CONFIG }; } };
    const r = await checkClaims([cite('a1')], abstracts, client);
    expect(r.items[0].reason).toBe('llm_unavailable');
  });

  it('summary counts verdicts and reasons', async () => {
    const client = fakeClient((_req, n) => JSON.stringify({ items: Array.from({ length: n }, (_, i) => (
      i === 0 ? { id: 1, verdict: 'contradicts', evidence_quote: 'Sleep deprivation reduced working-memory accuracy', reason: '' }
        : { id: i + 1, verdict: 'consistent', evidence_quote: 'invented words here', reason: '' })) }));
    const r = await checkClaims([cite('a1'), cite('a2'), cite('x', { doi: null })], abstracts, client);
    expect(r.summary.byVerdict).toEqual({ consistent: 0, contradicts: 1, silent: 0 });
    expect(r.summary.byReason).toEqual({ quote_not_in_abstract: 1, no_doi: 1 });
  });
});
