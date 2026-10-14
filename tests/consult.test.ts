/**
 * Regressions from the tier-3 consult of 2026-10-14 (Sonnet + Sol). Each was
 * reproduced against the pre-fix code (v0.1.0 working tree) before the fix.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../src/canonical.js';
import { checkClaims } from '../src/check.js';
import { groupBySource } from '../src/group.js';
import { locateQuote, parseGroupAnswer } from '../src/parse.js';
import type { CitationInput, LlmClient, LlmRequest, SourceAbstract } from '../src/types.js';

const ABSTRACT = 'Students in the restricted-sleep condition recalled fewer words than controls.';
const ans = (items: unknown[]) => JSON.stringify({ items });
const silent = (id: unknown) => ({ id, verdict: 'silent', evidence_quote: '', reason: '' });

describe('item ids (Sol, Sonnet D1/D2)', () => {
  it('a non-integer id such as 1.9 is not item 1', () => {
    expect(parseGroupAnswer(ans([silent(1.9)]), 1, ABSTRACT)[0].verdict).toBeNull();
  });
  it('true, "1e0" and "01" are not item 1', () => {
    for (const id of [true, '1e0', '01', ' 1']) {
      expect(parseGroupAnswer(ans([silent(id)]), 1, ABSTRACT)[0].verdict).toBeNull();
    }
  });
  it('zero-based numbering fails the whole answer instead of shifting verdicts', () => {
    const r = parseGroupAnswer(ans([
      { id: 0, verdict: 'contradicts', evidence_quote: 'recalled fewer words', reason: '' },
      { id: 1, verdict: 'silent', evidence_quote: '', reason: '' },
    ]), 2, ABSTRACT);
    expect(r.map((x) => x.reason)).toEqual(['llm_malformed', 'llm_malformed']);
  });
  it('an id past the number of sentences fails the whole answer', () => {
    const r = parseGroupAnswer(ans([silent(1), silent(3)]), 2, ABSTRACT);
    expect(r.every((x) => x.verdict === null)).toBe(true);
  });
  it('plain integers and digit strings still work', () => {
    const r = parseGroupAnswer(ans([silent(1), silent('2')]), 2, ABSTRACT);
    expect(r.map((x) => x.verdict)).toEqual(['silent', 'silent']);
  });
});

describe('grouping keys on reference AND doi (Sol)', () => {
  it('two DOIs under one reference key are never judged against one abstract', () => {
    const cs: CitationInput[] = [
      { id: 'a', referenceKey: 'r1', doi: '10.1/a', linkStatus: 'matched', sourceCount: 1, sentence: 'S1' },
      { id: 'b', referenceKey: 'r1', doi: '10.1/b', linkStatus: 'matched', sourceCount: 1, sentence: 'S2' },
    ];
    const g = groupBySource(cs, (c) => c.doi as string, 6);
    expect(g.map((x) => [x.doi, x.citations.map((c) => c.id)])).toEqual([['10.1/a', ['a']], ['10.1/b', ['b']]]);
  });

  it('end to end, each sentence is sent with its own abstract', async () => {
    const long = (w: string) => `${w} `.repeat(60);
    const abstracts = new Map<string, SourceAbstract>([
      ['10.1/a', { doi: '10.1/a', abstract: long('alpha') }],
      ['10.1/b', { doi: '10.1/b', abstract: long('beta') }],
    ]);
    const seen: string[] = [];
    const client: LlmClient = {
      async complete(req: LlmRequest) {
        seen.push(req.prompt.includes('alpha') ? 'alpha' : 'beta');
        return { text: ans([silent(1)]), finishReason: 'stop', callConfig: {} };
      },
    };
    await checkClaims([
      { id: 'a', referenceKey: 'r1', doi: '10.1/a', linkStatus: 'matched', sourceCount: 1, sentence: 'S1' },
      { id: 'b', referenceKey: 'r1', doi: '10.1/b', linkStatus: 'matched', sourceCount: 1, sentence: 'S2' },
    ], abstracts, client);
    expect(seen.sort()).toEqual(['alpha', 'beta']);
  });
});

describe('quote guard parity with the Python scorer (Sol, Sonnet Q2)', () => {
  const raw = readFileSync('tests/fixtures/quote_parity.json');
  const fx = JSON.parse(raw.toString('utf8')) as { cases: { abstract: string; quote: string; expected: boolean }[] };

  it('fixture is the pinned byte-identical copy shared with the benchmark', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(QUOTE_PARITY_SHA256);
  });

  it.each(fx.cases.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    expect(locateQuote(c.abstract, c.quote) !== null).toBe(c.expected);
  });

  it('the span covers a non-BMP final character fully', () => {
    const a = 'see 𐐀𐐀𐐀 here';
    const s = locateQuote(a, '𐐨𐐨𐐨');
    expect(s).not.toBeNull();
    expect(a.slice(s!.start, s!.end)).toBe('𐐀𐐀𐐀');
  });
});

describe('canonical JSON refuses what Python would write differently (Sol, Sonnet Q5)', () => {
  it('an integer beyond 2^53 is refused, not rounded', () => {
    expect(() => canonicalJson({ seed: 9007199254740993 })).toThrow(/representable/);
  });
  it('keys sort by UTF-16 code unit (the Python side matches this order)', () => {
    expect(canonicalJson({ '': 1, '𐀀': 2 })).toBe('{"𐀀":2,"":1}');
  });
});

/** sha256 of tests/fixtures/quote_parity.json; the benchmark's copy pins the same value. */
const QUOTE_PARITY_SHA256 = 'd1e4d73d74cb52269f79c0ac17299bf41512ffa820199f67b8b5165ec393e28c';

describe('review-pass regressions (2026-10-14)', () => {
  const long = 'Sleep restriction reduced recall in undergraduates. '.repeat(8);
  const cite = (id: string): CitationInput => (
    { id, referenceKey: 'r', doi: '10.1/a', linkStatus: 'matched', sourceCount: 1, sentence: `S ${id}` });
  const client: LlmClient = {
    complete: async () => ({
      text: ans([{ id: 1, verdict: 'consistent', evidence_quote: 'reduced recall', reason: '' }]), callConfig: {},
    }),
  };

  it('a non-integer or non-positive concurrency is refused, not run with zero workers', async () => {
    const abstracts = new Map<string, SourceAbstract>([['10.1/a', { doi: '10.1/a', abstract: long }]]);
    for (const concurrency of [NaN, 0, -1, 1.5]) {
      await expect(checkClaims([cite('a')], abstracts, client, { concurrency })).rejects.toThrow(/concurrency/);
    }
  });

  it('an abstract record whose own DOI differs from its map key is not used', async () => {
    const abstracts = new Map<string, SourceAbstract>([['10.1/a', { doi: '10.9/other', abstract: long }]]);
    const r = await checkClaims([cite('a')], abstracts, client);
    expect(r.items[0].status).toBe('not_assessed');
    expect(r.items[0].reason).toBe('no_abstract');
    expect(r.calls).toHaveLength(0);
  });

  it('evidenceSpan indexes the NFKC form of the abstract (a ligature shifts it)', () => {
    const abstract = 'The \ufb01rst study found recall dropped.';
    const span = locateQuote(abstract, 'recall dropped') as { start: number; end: number };
    expect(abstract.normalize('NFKC').slice(span.start, span.end)).toBe('recall dropped');
  });
});
