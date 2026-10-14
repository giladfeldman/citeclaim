import { VERDICTS, type AbstentionReason, type Verdict } from './types.js';

export interface ParsedItem {
  verdict: Verdict | null;
  reason: AbstentionReason | null;
  evidenceQuote: string | null;
  evidenceSpan: { start: number; end: number } | null;
  rationale: string | null;
}

/** Pull the first JSON object out of a model answer (tolerates ``` fences and leading prose). */
export function extractJsonObject(text: string): unknown {
  let s = (text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in answer');
  return JSON.parse(s.slice(start, end + 1));
}

/**
 * Normalisation shared by the quote and the abstract before matching: Unicode
 * NFKC, curly quotes to straight, every dash to "-", whitespace collapsed,
 * lower case. It forgives typography a model cannot reproduce exactly; it does
 * not forgive a different word.
 */
/**
 * The exact matching spec, shared with the Python port in the benchmark
 * (scorer.quote_in_abstract) and pinned by tests/fixtures/quote_parity.json:
 *   NFKC, then per CODE POINT: an explicit whitespace list -> " ", curly
 *   single quotes and prime -> "'", curly double quotes and double prime -> '"',
 *   U+2010..U+2015 and U+2212 -> "-", otherwise lower-cased on its own (no
 *   context rules, so the result does not depend on the neighbours); then runs
 *   of spaces collapse and the ends are trimmed. The whitespace list is explicit
 *   because JavaScript's \s and Python's \s disagree (U+FEFF, U+001C..U+001F).
 */
const WHITESPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);
const SINGLE_QUOTES = new Set([0x2018, 0x2019, 0x201a, 0x201b, 0x2032]);
const DOUBLE_QUOTES = new Set([0x201c, 0x201d, 0x201e, 0x201f, 0x2033]);

function mapCodePoint(ch: string): string {
  const cp = ch.codePointAt(0) as number;
  if (WHITESPACE.has(cp)) return ' ';
  if (SINGLE_QUOTES.has(cp)) return "'";
  if (DOUBLE_QUOTES.has(cp)) return '"';
  if ((cp >= 0x2010 && cp <= 0x2015) || cp === 0x2212) return '-';
  return ch.toLowerCase();
}

/** Normalised text plus, for each UTF-16 unit of it, the code-point index in the NFKC source. */
function normalizeWithMap(s: string): { norm: string; map: number[]; src: string } {
  const src = s.normalize('NFKC');
  let norm = '';
  const map: number[] = [];
  let prevSpace = true; // drops leading spaces
  let offset = 0;
  for (const ch of src) {
    const m = mapCodePoint(ch);
    if (m === ' ') {
      if (!prevSpace) {
        norm += ' ';
        map.push(offset);
        prevSpace = true;
      }
    } else {
      prevSpace = false;
      for (let k = 0; k < m.length; k++) map.push(offset);
      norm += m;
    }
    offset += ch.length;
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map, src };
}

export function normalizeForMatch(s: string): string {
  return normalizeWithMap(s).norm;
}

const TRIM = new Set([' ', '"', "'", '.', ',', ';', ':']);

function trimPiece(p: string): string {
  let a = 0;
  let b = p.length;
  while (a < b && TRIM.has(p[a])) a++;
  while (b > a && TRIM.has(p[b - 1])) b--;
  return p.slice(a, b);
}

/** Pieces of a quote: split on "..." or U+2026, normalised, trimmed, empties dropped. */
export function quotePieces(quote: string): string[] {
  return quote
    .split(/\.\.\.|…/)
    .map((p) => trimPiece(normalizeForMatch(p)))
    .filter((p) => p.length > 0);
}

/**
 * Locate a quote in the abstract. Returns the span (UTF-16 offsets into the
 * NFKC form of the abstract, for highlighting), or null when the quote is not
 * there. Each piece must appear, in order, and hold at least 3 code points, so
 * an empty or tiny quote cannot pass by accident.
 */
export function locateQuote(abstract: string, quote: string): { start: number; end: number } | null {
  const pieces = quotePieces(quote);
  if (pieces.length === 0 || pieces.some((p) => [...p].length < 3)) return null;
  const { norm, map, src } = normalizeWithMap(abstract);

  let from = 0;
  let first = -1;
  let lastEnd = -1;
  for (const p of pieces) {
    const at = norm.indexOf(p, from);
    if (at < 0) return null;
    if (first < 0) first = at;
    lastEnd = at + p.length;
    from = lastEnd;
  }
  const endCp = src.codePointAt(map[lastEnd - 1]) as number;
  return { start: map[first], end: map[lastEnd - 1] + (endCp > 0xffff ? 2 : 1) };
}

/** A sentence number: a JSON integer, or a string of decimal digits without a leading zero. */
export function parseItemId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null;
  if (typeof v === 'string' && /^[1-9][0-9]{0,5}$/.test(v)) return Number(v);
  return null;
}

const STOP_TRUNCATED = new Set(['length', 'max_tokens', 'MAX_TOKENS']);

export function isTruncated(finishReason: string | null | undefined): boolean {
  return !!finishReason && STOP_TRUNCATED.has(finishReason);
}

/**
 * Validate a grouped answer item by item. A malformed item is llm_malformed and
 * the others still count; a consistent/contradicts verdict without a quote that
 * is verbatim in the abstract is quote_not_in_abstract. Nothing here ever turns
 * a failure into "consistent".
 */
export function parseGroupAnswer(text: string, nItems: number, abstract: string): ParsedItem[] {
  const fail = (reason: AbstentionReason): ParsedItem => ({
    verdict: null, reason, evidenceQuote: null, evidenceSpan: null, rationale: null,
  });
  let obj: unknown;
  try {
    obj = extractJsonObject(text);
  } catch {
    return Array.from({ length: nItems }, () => fail('llm_malformed'));
  }
  const items = (obj as { items?: unknown })?.items;
  if (!Array.isArray(items)) return Array.from({ length: nItems }, () => fail('llm_malformed'));

  // Ids must be exactly the sentence numbers. Anything else (0-based numbering,
  // 1.9, true, "1e0", "01", a number past nItems) means the answer's items cannot
  // be attributed to sentences with certainty, so the WHOLE answer is malformed:
  // a shifted attribution would score verdicts against the wrong sentences.
  const byId = new Map<number, Record<string, unknown>>();
  const duplicate = new Set<number>();
  for (const it of items) {
    if (!it || typeof it !== 'object') return Array.from({ length: nItems }, () => fail('llm_malformed'));
    const id = parseItemId((it as Record<string, unknown>).id);
    if (id === null || id < 1 || id > nItems) {
      return Array.from({ length: nItems }, () => fail('llm_malformed'));
    }
    if (byId.has(id)) duplicate.add(id);
    byId.set(id, it as Record<string, unknown>);
  }

  const out: ParsedItem[] = [];
  for (let k = 1; k <= nItems; k++) {
    const it = byId.get(k);
    if (!it || duplicate.has(k)) { out.push(fail('llm_malformed')); continue; }
    const v = typeof it.verdict === 'string' ? it.verdict.trim().toLowerCase() : '';
    if (!(VERDICTS as readonly string[]).includes(v)) { out.push(fail('llm_malformed')); continue; }
    const verdict = v as Verdict;
    const quote = typeof it.evidence_quote === 'string' ? it.evidence_quote : '';
    const rationale = typeof it.reason === 'string' ? it.reason : null;
    if (verdict === 'silent') {
      out.push({ verdict, reason: null, evidenceQuote: '', evidenceSpan: null, rationale });
      continue;
    }
    const span = quote.trim() ? locateQuote(abstract, quote) : null;
    if (!span) {
      out.push({ ...fail('quote_not_in_abstract'), evidenceQuote: quote, rationale });
      continue;
    }
    out.push({ verdict, reason: null, evidenceQuote: quote, evidenceSpan: span, rationale });
  }
  return out;
}
