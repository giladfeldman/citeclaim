/**
 * DOI parity (2026-11-18 sweep). Class: "one DOI read differently in different
 * code paths". The citation's DOI, the abstracts-map key and the abstract record's
 * own DOI are three readers of one value. Before 0.2.0 the reader missed `www.`,
 * a bare `doi.org/`, percent-encoding and `doi: https://...`, and the map was
 * looked up by the lower-cased DOI only, so a host map keyed in any other form
 * gave `no_abstract`: "could not check" for a source whose abstract was supplied.
 */
import { checkClaims } from '../src/check.js';
import { indexAbstracts, ineligibilityReason, normalizeDoi } from '../src/eligibility.js';
import type { CitationInput, LlmClient, SourceAbstract } from '../src/types.js';

const BARE = '10.31234/OSF.io/AbCdE';
const WRAPPERS = [
  '', 'doi:', 'doi: ', 'DOI:', 'DOI: ', 'https://doi.org/', 'http://doi.org/', 'https://dx.doi.org/',
  'http://dx.doi.org/', 'https://www.doi.org/', 'doi.org/', 'doi: https://doi.org/',
];
const SPACING = (s: string) => [s, ` ${s}`, `${s} `, `\t${s}\n`];
const CASES = (s: string) => [s, s.toLowerCase(), s.toUpperCase()];
const FORMS: string[] = [
  ...WRAPPERS.flatMap((w) => SPACING(w + BARE)),
  ...CASES(BARE),
  'https://doi.org/10.31234%2FOSF.io%2FAbCdE',
];
const ABS = 'Participants who slept less than six hours recalled fewer words than rested participants. '.repeat(3);

const silentClient = (): LlmClient => ({
  async complete(req) {
    const n = (req.prompt.match(/^\d+\. "/gm) || []).length;
    return {
      text: JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ id: i + 1, verdict: 'silent', evidence_quote: '', reason: '' })) }),
      callConfig: { provider: 'test', model_requested: 'm', temperature: 0 },
    };
  },
});
const cite = (doi: string | null): CitationInput => ({
  id: 'c1', referenceKey: 'r1', doi, linkStatus: 'matched', sourceCount: 1, sentence: 'Sleep loss impairs recall.',
});

describe('normalizeDoi: one DOI, every written form', () => {
  it('reads all forms as the same key', () => {
    const bad = FORMS.filter((f) => normalizeDoi(f) !== BARE.toLowerCase());
    expect(bad).toEqual([]);
  });
  it('rejects what is not a DOI (control)', () => {
    for (const s of ['', '   ', 'doi:', 'https://doi.org/', '10.1234', 'pmid:123', 'https://example.org/10.1000/x', null, undefined]) {
      expect(normalizeDoi(s as string)).toBeNull();
    }
  });
});

describe('abstract lookup parity: citation DOI form x map-key form x record DOI form', () => {
  it('every combination reaches the model with the supplied abstract', async () => {
    const bad: string[] = [];
    // Full cross for the citation and key; the record's own DOI form varies with the key.
    for (const citeForm of FORMS) for (const keyForm of FORMS) {
      const abstracts = new Map<string, SourceAbstract>([[keyForm, { doi: keyForm, abstract: ABS }]]);
      if (ineligibilityReason(cite(citeForm), abstracts) !== null) bad.push(`${JSON.stringify(citeForm)} / ${JSON.stringify(keyForm)}`);
    }
    expect(bad).toEqual([]);
  });
  it('checkClaims judges a citation whose map key is a resolver URL', async () => {
    const abstracts = new Map<string, SourceAbstract>([[`https://doi.org/${BARE}`, { doi: `doi:${BARE}`, abstract: ABS }]]);
    const r = await checkClaims([cite(BARE.toLowerCase())], abstracts, silentClient());
    expect(r.items[0]).toMatchObject({ status: 'judged', verdict: 'silent', reason: null, doi: BARE.toLowerCase() });
    expect(r.calls[0].doi).toBe(BARE.toLowerCase());
    expect(r.summary.abstractKeys).toEqual({ given: 1, unreadable: 0, conflicting: 0, usable: 1 });
  });
  it('a different DOI is still no abstract (control)', () => {
    const abstracts = new Map<string, SourceAbstract>([['10.31234/osf.io/zzzzz', { doi: '10.31234/osf.io/zzzzz', abstract: ABS }]]);
    expect(ineligibilityReason(cite(BARE), abstracts)).toBe('no_abstract');
  });
  it('a record whose own DOI names another source is not attributed (control)', () => {
    const abstracts = new Map<string, SourceAbstract>([[BARE, { doi: 'https://doi.org/10.1000/other', abstract: ABS }]]);
    expect(ineligibilityReason(cite(BARE), abstracts)).toBe('no_abstract');
  });
});

describe('abstracts map: entries that cannot be used are counted, not dropped silently', () => {
  it('counts unreadable keys', async () => {
    const abstracts = new Map<string, SourceAbstract>([
      ['not a doi', { doi: 'not a doi', abstract: ABS }],
      [BARE, { doi: BARE, abstract: ABS }],
    ]);
    const r = await checkClaims([cite(BARE)], abstracts, silentClient());
    expect(r.summary.abstractKeys).toEqual({ given: 2, unreadable: 1, conflicting: 0, usable: 1 });
    expect(indexAbstracts(abstracts).unreadableKeys).toEqual(['not a doi']);
  });
  it('two keys for one DOI with different abstracts: neither is used, and it is counted', async () => {
    const abstracts = new Map<string, SourceAbstract>([
      [BARE, { doi: BARE, abstract: ABS }],
      [`https://doi.org/${BARE}`, { doi: BARE, abstract: `${ABS} Different text.` }],
    ]);
    const r = await checkClaims([cite(BARE)], abstracts, silentClient());
    expect(r.items[0]).toMatchObject({ status: 'not_assessed', reason: 'no_abstract' });
    expect(r.summary.abstractKeys).toEqual({ given: 2, unreadable: 0, conflicting: 1, usable: 0 });
  });
  it('two keys for one DOI with the same abstract are one source (control)', async () => {
    const abstracts = new Map<string, SourceAbstract>([
      [BARE, { doi: BARE, abstract: ABS }],
      [BARE.toLowerCase(), { doi: BARE, abstract: ABS }],
    ]);
    const r = await checkClaims([cite(BARE)], abstracts, silentClient());
    expect(r.items[0].status).toBe('judged');
    expect(r.summary.abstractKeys.conflicting).toBe(0);
  });
});

/**
 * Review 1 of v0.2.0 (2026-11-24, consult seat Sonnet + own reproduction). Class: "one
 * fact read differently by different readers": the DOI as referencecheck v0.3.0 reads it
 * (link tails cut, sentence punctuation dropped, DOI shape required), and an abstracts map
 * whose second entry for one DOI is a stub, an empty abstract or another source's record.
 */
describe('review 1: a usable abstract is not hidden by an unusable entry for the same DOI', () => {
  const STUBS: Array<[string, SourceAbstract]> = [
    ['null abstract', { doi: BARE, abstract: null as unknown as string }],
    ['short stub', { doi: BARE, abstract: 'Too short.' }],
    ['record of another DOI', { doi: '10.9999/other', abstract: `${ABS} Other paper.` }],
  ];
  for (const [name, stub] of STUBS) for (const stubFirst of [true, false]) {
    it(`${name}, ${stubFirst ? 'before' : 'after'} the real one: judged, not conflicting`, async () => {
      const real: [string, SourceAbstract] = [`doi:${BARE}`, { doi: BARE, abstract: ABS }];
      const s: [string, SourceAbstract] = [BARE, stub];
      const abstracts = new Map<string, SourceAbstract>(stubFirst ? [s, real] : [real, s]);
      const r = await checkClaims([cite(BARE)], abstracts, silentClient());
      expect(r.items[0].status).toBe('judged');
      expect(r.summary.abstractKeys).toEqual({ given: 2, unreadable: 0, conflicting: 0, usable: 1 });
    });
  }
  it('the same text with other whitespace is one abstract', () => {
    const abstracts = new Map<string, SourceAbstract>([
      [BARE, { doi: BARE, abstract: ABS }],
      [`https://doi.org/${BARE}`, { doi: BARE, abstract: `  ${ABS.replace(/ /g, '\n  ')} ` }],
    ]);
    expect(indexAbstracts(abstracts).conflicting.size).toBe(0);
    expect(ineligibilityReason(cite(BARE), abstracts)).toBeNull();
  });
});

describe('review 1: normalizeDoi reads a DOI as referencecheck v0.3.0 does', () => {
  const D = '10.1000/xyz.123';
  it.each([
    [`https://doi.org/${D}?utm_source=x`, D], [`https://doi.org/${D}#sec1`, D], [`https://doi.org/${D}?a=1#b`, D],
    [`${D}.`, D], [`${D},`, D], [`${D};`, D], [`https://doi.org/${D}/`, D], [`(${D})`.slice(1), D],
    ['10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-#', '10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-#'],
    ['https://doi.org/10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-#?utm=1', '10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-#'],
    ['https://doi.org/10.1000/a%3Fb', '10.1000/a?b'], ['10.1000/a(b)', '10.1000/a(b)'],
  ])('%s -> %s', (input, want) => {
    expect(normalizeDoi(input)).toBe(want);
  });
  it.each(['10.1/x', '10.abc/x', '10.5/', '10/abc', '10.1000/ab cd', '10.1000/'])('%s is not a DOI', (input) => {
    expect(normalizeDoi(input)).toBeNull();
  });
});

describe('review 2: abstractKeys.usable counts only records that can be judged against', () => {
  it.each([
    ['a stub', { doi: BARE, abstract: 'short' }],
    ['no abstract', { doi: BARE, abstract: null as unknown as string }],
    ['a record of another DOI', { doi: '10.1000/other', abstract: ABS }],
    ['an unreadable own DOI', { doi: 'garbage', abstract: ABS }],
  ])('%s: usable 0 and the item is no_abstract', async (_n, rec) => {
    const r = await checkClaims([cite(BARE)], new Map<string, SourceAbstract>([[BARE, rec as SourceAbstract]]), silentClient());
    expect(r.items[0]).toMatchObject({ status: 'not_assessed', reason: 'no_abstract' });
    expect(r.summary.abstractKeys).toEqual({ given: 1, unreadable: 0, conflicting: 0, usable: 0 });
  });
  it('a usable record is counted (control)', async () => {
    const r = await checkClaims([cite(BARE)], new Map<string, SourceAbstract>([[BARE, { doi: BARE, abstract: ABS }]]), silentClient());
    expect(r.summary.abstractKeys.usable).toBe(1);
  });
});
