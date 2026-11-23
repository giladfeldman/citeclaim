/**
 * A copy of referencecheck v0.3.0's DOI reader (src/util/normalize.ts there: DOI_SHAPE,
 * DOI_START, SHORT_DOI_START, cleanDoiInput and its helpers), unchanged but for this header.
 * Same author and licence (AGPL-3.0-only). It is a copy, not a dependency, because citeclaim
 * has no runtime dependencies; tests/doiVectors.test.ts holds referencecheck v0.3.0's own
 * answers on 74 inputs and fails if the two readers drift (citeclaim v0.2.0 review 2).
 * Comments below are referencecheck's and refer to its review history.
 */

export const DOI_SHAPE = /^10\.\d{3,9}\/\S+$/;
/** The start of a DOI: `10.<registrant>/`. */
export const DOI_START = /^10\.\d{3,9}\//;
/** The start of a shortDOI: `10/` and the token's first character (a shortdoi.org alias). */
export const SHORT_DOI_START = /^10\/[A-Za-z0-9]/;

/** Wrappers a DOI arrives in: resolver URLs (any scheme, dx./www.), bare host, `doi:` labels. */
const DOI_WRAPPER = /^(?:(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\/|doi:\s*)/i;
/** A resolver link (not a `doi:` label): what follows the DOI is URL syntax. */
const DOI_LINK = /^(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\//i;

/**
 * Reduce any written form of a DOI to the DOI itself: surrounding whitespace removed,
 * resolver URL or `doi:` label removed, percent-encoding decoded. Case is PRESERVED (DOIs
 * are case-insensitive, but callers report the DOI back and some compare case-folded
 * themselves). Anything that is not a DOI is returned trimmed and otherwise unchanged, so
 * shape checks downstream still see it and reject it.
 */
export function cleanDoiInput(doi: string | null | undefined): string {
  if (typeof doi !== 'string') return '';
  let d = doi.trim();
  // Twice: "https://doi.org/doi:10.x/y" and "doi: https://doi.org/10.x/y" occur in
  // hand-built links. A link inside a label is still a link (v0.3.0 review 9).
  let isLink = false;
  for (let i = 0; i < 2; i++) {
    if (DOI_LINK.test(d)) isLink = true;
    d = d.replace(DOI_WRAPPER, '').trim();
  }
  // In a resolver link a raw "?" starts the query and a raw "#" the fragment: neither is part
  // of the DOI (a DOI's own "#" or "?" is written %23 / %3F in a link, and is decoded below).
  // Cut before decoding. A final "#" stays, with or without a query after it: Wiley SICI DOIs
  // end in "CO;2-#".
  if (isLink) {
    const cut = d.search(/[?#]/);
    if (cut >= 0) d = /^#(?:\?.*)?$/.test(d.slice(cut)) ? d.slice(0, cut + 1) : d.slice(0, cut);
  }
  // Only a "?" written as such starts a query; one decoded from %3F is part of the DOI.
  const rawQuery = d.includes('?');
  if (/%[0-9a-f]{2}/i.test(d)) {
    try {
      const decoded = decodeURIComponent(d);
      // An escape that decodes to whitespace ("10.1000/a%20b") is kept encoded, written bare
      // or inside a resolver URL alike: decoding it would turn a well-formed DOI into one
      // with a space in it, which the shape check then reports as malformed (0.2.x kept
      // the encoded form and called it well-formed).
      if (countWhitespace(decoded) <= countWhitespace(d)) d = decoded;
    } catch {
      // A malformed escape is left as written; the shape check will reject it.
    }
  }
  d = d.trim();
  // A shortDOI ("10/gt3vmw") arrives in the same links and citations as a full DOI. Its
  // token is letters and digits only, so a "#..." after it is never part of it.
  const isShort = SHORT_DOI_START.test(d);
  if (isShort) d = d.replace(/#.*$/, '');
  if (DOI_START.test(d) || isShort) {
    for (let prev = ''; prev !== d; ) {
      prev = d;
      d = stripLinkTail(stripCitationTail(d), rawQuery);
    }
  }
  return d;
}

/**
 * What a copied link leaves after a DOI written without its resolver (v0.3.0 reviews 7 and
 * 8): a query of `key=value` pairs ("?utm_source=x"), a lone final "?", and trailing
 * slashes. Before, only deduplication dropped them, so the preprint, retraction and Crossref
 * lookups asked for "10.x/y?utm_source=x", got no record, and a preprint read as clean.
 * Measured 2026-11-22 (doi.org handle API, DataCite search): "10.5334/irsp.571/" is not a
 * DOI and "10.5334/irsp.571" is; one DataCite DOI holds "?" (10.4125/pd00??th), none a
 * `key=value` query. NOT cut from a DOI written bare: a "#..." fragment (28,387 DataCite DOIs
 * hold one, e.g. 10.15475/dhz/kfn/1918/12/28#page-1, a different DOI from .../28) and a
 * page ending ("/full", "/pdf": 10.58079/pdf and 10.82364/144/ssu/ref/meta/full are DOIs).
 */
function stripLinkTail(doi: string, rawQuery: boolean): string {
  return (rawQuery ? doi.replace(/\?(?:\S*=\S*)?$/, '') : doi).replace(/\/+$/, '');
}

function countWhitespace(s: string): number {
  return s.match(/\s/g)?.length ?? 0;
}

const CLOSE_TO_OPEN: Record<string, string> = { ')': '(', ']': '[', '>': '<', '}': '{' };

/**
 * What a citation writes after a DOI ("[preprint]", "(PMID 123)", "Accessed 2020") follows
 * a space; it starts with a bracket or one of these words.
 */
const CITATION_TAIL = /^(?:[\[(]|(?:doi|pmid|pmcid|available|accessed|retrieved|epub|published|pdf|url)\b|https?:)/i;

/**
 * What a citation puts after a DOI is not part of it (review 2026-11-19). A space is cut at
 * only when a citation tail follows it: "10.1371/journal.pone. 0123456" is a DOI broken by a
 * space, and stays whole so the shape check reports it, as 0.2.x did, instead of becoming the
 * different DOI "10.1371/journal.pone". Trailing . , ; : and quotes are sentence
 * punctuation; a closing bracket is dropped only when it closes nothing inside the DOI, so
 * "10.1016/S0140-6736(20)30183-5" and SICI forms ending in ">" stay whole while
 * "10.1101/x)." loses ")." Applied to input that starts with a DOI only.
 */
function stripCitationTail(doi: string): string {
  const m = doi.match(/^(\S+)\s+([\s\S]*)$/);
  let d = m && CITATION_TAIL.test(m[2]) ? m[1] : doi;
  const count = (ch: string) => d.split(ch).length - 1;
  for (;;) {
    const last = d.slice(-1);
    if (/[.,;:'"‘’“”]/.test(last)) d = d.slice(0, -1);
    else if (CLOSE_TO_OPEN[last] && count(last) > count(CLOSE_TO_OPEN[last])) d = d.slice(0, -1);
    else return d;
  }
}

