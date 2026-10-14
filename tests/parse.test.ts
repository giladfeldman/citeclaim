import { extractJsonObject, locateQuote, parseGroupAnswer } from '../src/parse.js';

const ABSTRACT =
  'Sleep deprivation reduced working-memory accuracy in 48 undergraduates. ' +
  'The effect was larger under time pressure — a pattern consistent with resource accounts. ' +
  'We found no effect on reaction time.';

const ans = (items: unknown[]) => JSON.stringify({ items });

describe('locateQuote', () => {
  it('finds an exact span and reports offsets into the abstract', () => {
    const q = 'reduced working-memory accuracy';
    const s = locateQuote(ABSTRACT, q);
    expect(s).not.toBeNull();
    expect(ABSTRACT.slice(s!.start, s!.end)).toBe(q);
  });

  it('forgives case, whitespace, curly quotes and dash variants', () => {
    expect(locateQuote(ABSTRACT, 'SLEEP  deprivation   reduced')).not.toBeNull();
    expect(locateQuote(ABSTRACT, 'time pressure - a pattern')).not.toBeNull();
  });

  it('accepts elided pieces in order, rejects them out of order', () => {
    expect(locateQuote(ABSTRACT, 'Sleep deprivation reduced ... no effect on reaction time')).not.toBeNull();
    expect(locateQuote(ABSTRACT, 'no effect on reaction time ... Sleep deprivation reduced')).toBeNull();
  });

  it('rejects a changed word, an empty quote and a too-short piece', () => {
    expect(locateQuote(ABSTRACT, 'Sleep deprivation improved working-memory accuracy')).toBeNull();
    expect(locateQuote(ABSTRACT, '')).toBeNull();
    expect(locateQuote(ABSTRACT, 'a')).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('reads fenced and prose-wrapped answers', () => {
    expect(extractJsonObject('```json\n{"items":[]}\n```')).toEqual({ items: [] });
    expect(extractJsonObject('Here you go: {"items":[]} thanks')).toEqual({ items: [] });
  });
  it('throws on no object', () => {
    expect(() => extractJsonObject('no json')).toThrow();
  });
});

describe('parseGroupAnswer', () => {
  it('parses a valid grouped answer item by item', () => {
    const r = parseGroupAnswer(ans([
      { id: 1, verdict: 'consistent', evidence_quote: 'Sleep deprivation reduced working-memory accuracy', reason: 'r1' },
      { id: 2, verdict: 'contradicts', evidence_quote: 'We found no effect on reaction time', reason: 'r2' },
      { id: 3, verdict: 'silent', evidence_quote: '', reason: 'r3' },
    ]), 3, ABSTRACT);
    expect(r.map((x) => x.verdict)).toEqual(['consistent', 'contradicts', 'silent']);
    expect(r.every((x) => x.reason === null)).toBe(true);
    expect(r[0].evidenceSpan).not.toBeNull();
  });

  it('unparseable answer: every item llm_malformed, none consistent', () => {
    const r = parseGroupAnswer('I think it is fine', 2, ABSTRACT);
    expect(r.map((x) => x.reason)).toEqual(['llm_malformed', 'llm_malformed']);
    expect(r.some((x) => x.verdict !== null)).toBe(false);
  });

  it('a missing item fails alone; its neighbours still count', () => {
    const r = parseGroupAnswer(ans([
      { id: 1, verdict: 'silent', evidence_quote: '', reason: '' },
      { id: 3, verdict: 'silent', evidence_quote: '', reason: '' },
    ]), 3, ABSTRACT);
    expect(r.map((x) => x.verdict)).toEqual(['silent', null, 'silent']);
    expect(r[1].reason).toBe('llm_malformed');
  });

  it('a verdict outside the scheme is malformed (not coerced)', () => {
    const r = parseGroupAnswer(ans([{ id: 1, verdict: 'supported', evidence_quote: 'x', reason: '' }]), 1, ABSTRACT);
    expect(r[0]).toMatchObject({ verdict: null, reason: 'llm_malformed' });
  });

  it('a duplicated id is malformed, not last-one-wins', () => {
    const r = parseGroupAnswer(ans([
      { id: 1, verdict: 'contradicts', evidence_quote: 'We found no effect on reaction time', reason: '' },
      { id: 1, verdict: 'consistent', evidence_quote: 'Sleep deprivation reduced', reason: '' },
    ]), 1, ABSTRACT);
    expect(r[0].reason).toBe('llm_malformed');
  });

  it('consistent with an invented quote becomes quote_not_in_abstract, never consistent', () => {
    const r = parseGroupAnswer(ans([
      { id: 1, verdict: 'consistent', evidence_quote: 'Sleep deprivation improved accuracy', reason: '' },
    ]), 1, ABSTRACT);
    expect(r[0]).toMatchObject({ verdict: null, reason: 'quote_not_in_abstract' });
  });

  it('contradicts with an empty quote becomes quote_not_in_abstract', () => {
    const r = parseGroupAnswer(ans([{ id: 1, verdict: 'contradicts', evidence_quote: '', reason: '' }]), 1, ABSTRACT);
    expect(r[0].reason).toBe('quote_not_in_abstract');
  });

  it('accepts verdict case variants and string ids', () => {
    const r = parseGroupAnswer(ans([{ id: '1', verdict: 'Silent', evidence_quote: '', reason: '' }]), 1, ABSTRACT);
    expect(r[0].verdict).toBe('silent');
  });
});
