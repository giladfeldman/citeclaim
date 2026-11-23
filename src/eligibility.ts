import { cleanDoiInput, DOI_SHAPE } from './doiClean.js';
import type { AbstentionReason, CitationInput, SourceAbstract } from './types.js';

/** Shortest abstract worth judging against; shorter "abstracts" are usually a title echo or a stub. */
export const MIN_ABSTRACT_CHARS = 200;

/**
 * The one DOI reader in this library: the citation's DOI, the abstracts-map key
 * and the abstract record's own DOI all go through it, so one DOI written two
 * ways is one DOI. It reads a DOI exactly as referencecheck v0.3.0 does
 * (`cleanDoiInput`, copied into ./doiClean.ts): surrounding whitespace, a resolver
 * URL or `doi:` label, a link's `?query` / `#fragment`, a bare `?key=value`,
 * trailing slashes, sentence punctuation, an unmatched closing bracket and a
 * citation tail after a space ("[preprint]", "Accessed 2020") are removed, and
 * percent-encoding is decoded (unless it decodes to whitespace). The result is
 * lower-cased (DOIs are case-insensitive) and must have the DOI shape
 * (`10.` + 3-9 digits + `/` + a suffix without spaces), else null: a shortDOI
 * (`10/abc`) cannot be matched to an abstract without a lookup, so it is no DOI here.
 */
export function normalizeDoi(doi: string | null | undefined): string | null {
  const d = cleanDoiInput(doi).toLowerCase();
  return DOI_SHAPE.test(d) ? d : null;
}

/**
 * The host's abstracts map re-keyed by `normalizeDoi`, with what could not be
 * used counted rather than dropped. `conflicting` holds DOIs that two usable map
 * entries (abstract long enough, own DOI not naming another source) claim with
 * different abstract text (whitespace aside): neither can be attributed, so their
 * citations are `no_abstract`. An unusable entry beside a usable one is ignored.
 */
export interface AbstractIndex {
  byDoi: ReadonlyMap<string, SourceAbstract>;
  conflicting: ReadonlySet<string>;
  /** Map keys that are not readable as a DOI (their entries are never used). */
  unreadableKeys: string[];
  /** DOIs in byDoi whose record can be judged against (abstract long enough, own DOI agrees). */
  usable: number;
}

/** A record that can be judged against for `doi`: an abstract long enough, and no own DOI naming another source. */
function usableFor(rec: SourceAbstract | undefined, doi: string): boolean {
  if (!rec || typeof rec.abstract !== 'string' || rec.abstract.trim().length < MIN_ABSTRACT_CHARS) return false;
  return !rec.doi || normalizeDoi(rec.doi) === doi;
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

export function indexAbstracts(abstracts: ReadonlyMap<string, SourceAbstract>): AbstractIndex {
  const byDoi = new Map<string, SourceAbstract>();
  const conflicting = new Set<string>();
  const unreadableKeys: string[] = [];
  for (const [key, rec] of abstracts) {
    const doi = normalizeDoi(key);
    if (!doi) { unreadableKeys.push(key); continue; }
    const prev = byDoi.get(doi);
    if (!prev) { byDoi.set(doi, rec); continue; }  // kept even if unusable: its citations read no_abstract
    // Only records that could be judged against compete: a stub, a missing abstract or a
    // record naming another DOI beside the real one does not hide the real one (review 1).
    const prevOk = usableFor(prev, doi);
    const recOk = usableFor(rec, doi);
    if (!prevOk) { if (recOk) byDoi.set(doi, rec); continue; }
    if (recOk && prev !== rec && !sameText(prev.abstract as string, rec.abstract as string)) conflicting.add(doi);
  }
  for (const d of conflicting) byDoi.delete(d);
  let usable = 0;
  for (const [d, r] of byDoi) if (usableFor(r, d)) usable++;
  return { byDoi, conflicting, unreadableKeys, usable };
}

function isIndex(x: ReadonlyMap<string, SourceAbstract> | AbstractIndex): x is AbstractIndex {
  return typeof (x as AbstractIndex).byDoi === 'object' && (x as AbstractIndex).byDoi !== null
    && Array.isArray((x as AbstractIndex).unreadableKeys);
}

/**
 * Why a citation cannot be sent to a model, or null when it can. Checked in a
 * fixed order so the reason is deterministic: link, sources, DOI, sentence, abstract.
 * The abstract is looked up by `normalizeDoi`, so a map keyed `https://doi.org/10.X/Y`
 * serves a citation whose DOI is `10.x/y`. Pass an `indexAbstracts` result to
 * avoid re-indexing the map for every citation.
 */
export function ineligibilityReason(
  c: CitationInput,
  abstracts: ReadonlyMap<string, SourceAbstract> | AbstractIndex,
): AbstentionReason | null {
  const index = isIndex(abstracts) ? abstracts : indexAbstracts(abstracts);
  if (c.linkStatus !== 'matched' || !c.referenceKey) return 'link_not_matched';
  if (!Number.isInteger(c.sourceCount) || c.sourceCount !== 1) return 'multi_source_citation';
  const doi = normalizeDoi(c.doi);
  if (!doi) return 'no_doi';
  if (!c.sentence || !c.sentence.trim()) return 'no_citing_sentence';
  const a = index.byDoi.get(doi);
  // One rule for "can be judged against", shared with indexAbstracts (review 2: two copies).
  // It also refuses a record whose own DOI names another source: the map key is the host's
  // claim, the record carries its own DOI, and if they disagree the abstract may be someone else's.
  if (!usableFor(a, doi)) return 'no_abstract';
  return null;
}
