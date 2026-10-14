import { readFileSync } from 'node:fs';
import { canonicalJson, canonicalSha256, sha256Hex } from '../src/canonical.js';
import { CLAIM_PAIR_V1_ID, CLAIM_PAIR_V1_TEXT, promptSha256, renderPrompt } from '../src/prompts/index.js';
import { LIBRARY_VERSION } from '../src/version.js';

const fx = JSON.parse(readFileSync('tests/fixtures/python_canonical.json', 'utf8'));

describe('prompt claim-pair-v1', () => {
  it('embedded text is byte-identical to the shipped prompts/claim-pair-v1.md', () => {
    const md = readFileSync('prompts/claim-pair-v1.md', 'utf8').replace(/\r\n/g, '\n');
    expect(CLAIM_PAIR_V1_TEXT).toBe(md);
  });

  it('hash equals the hash Python computes over the same file', () => {
    expect(promptSha256(CLAIM_PAIR_V1_ID)).toBe(fx.prompt_sha256);
  });

  it('renders byte-identically to Python str.format (braces, non-ASCII, quotes)', () => {
    const expected = readFileSync('tests/fixtures/rendered_claim_pair_v1.txt', 'utf8').replace(/\r\n/g, '\n');
    const got = renderPrompt(CLAIM_PAIR_V1_ID, {
      title: 'Ünïcode {braces} title',
      year: 2019,
      abstract: 'We found that sleep loss "reduced" accuracy — strongly. Braces {x} stay.',
      sentences: ['Smith et al. (2019) found sleep loss improved accuracy.', 'Second {odd} sentence.'],
    });
    expect(got).toBe(expected);
    expect(sha256Hex(got)).toBe(fx.rendered_sha256);
  });

  it('missing title and year render as placeholders, never "null"', () => {
    const got = renderPrompt(CLAIM_PAIR_V1_ID, { title: null, year: null, abstract: 'A.', sentences: ['S.'] });
    expect(got).toContain('Title: (unknown)');
    expect(got).toContain('Year: n.d.');
    expect(got).not.toContain('null');
  });

  it('rejects an unknown prompt id', () => {
    expect(() => promptSha256('claim-pair-v0')).toThrow(/unknown prompt id/);
  });
});

describe('canonical JSON', () => {
  it('matches Python json.dumps(sort_keys, compact, ensure_ascii=False) byte for byte', () => {
    expect(canonicalJson(fx.config)).toBe(fx.canonical);
    expect(canonicalSha256(fx.config)).toBe(fx.sha256);
  });

  it('is independent of key insertion order', () => {
    expect(canonicalSha256({ a: 1, b: { d: 2, c: 3 } })).toBe(canonicalSha256({ b: { c: 3, d: 2 }, a: 1 }));
  });

  it('refuses a non-finite number rather than hashing "null"', () => {
    expect(() => canonicalJson({ t: NaN })).toThrow(/non-finite/);
  });
});

describe('version', () => {
  it('LIBRARY_VERSION equals package.json version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(LIBRARY_VERSION).toBe(pkg.version);
  });
});
