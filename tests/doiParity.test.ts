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
    for (const s of ['', '   ', 'doi:', 'https://doi.org/', '10.1234', 'pmid:123', 'https://example.org/10.1/x', '10.1/%E0%A4%A', null, undefined]) {
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
    expect(r.summary.abstractKeys).toEqual({ given: 1, unreadable: 0, conflicting: 0 });
  });
  it('a different DOI is still no abstract (control)', () => {
    const abstracts = new Map<string, SourceAbstract>([['10.31234/osf.io/zzzzz', { doi: '10.31234/osf.io/zzzzz', abstract: ABS }]]);
    expect(ineligibilityReason(cite(BARE), abstracts)).toBe('no_abstract');
  });
  it('a record whose own DOI names another source is not attributed (control)', () => {
    const abstracts = new Map<string, SourceAbstract>([[BARE, { doi: 'https://doi.org/10.1/other', abstract: ABS }]]);
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
    expect(r.summary.abstractKeys).toEqual({ given: 2, unreadable: 1, conflicting: 0 });
    expect(indexAbstracts(abstracts).unreadableKeys).toEqual(['not a doi']);
  });
  it('two keys for one DOI with different abstracts: neither is used, and it is counted', async () => {
    const abstracts = new Map<string, SourceAbstract>([
      [BARE, { doi: BARE, abstract: ABS }],
      [`https://doi.org/${BARE}`, { doi: BARE, abstract: `${ABS} Different text.` }],
    ]);
    const r = await checkClaims([cite(BARE)], abstracts, silentClient());
    expect(r.items[0]).toMatchObject({ status: 'not_assessed', reason: 'no_abstract' });
    expect(r.summary.abstractKeys).toEqual({ given: 2, unreadable: 0, conflicting: 1 });
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
