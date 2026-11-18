import type { AbstentionReason, CitationInput, SourceAbstract } from './types.js';

/** Shortest abstract worth judging against; shorter "abstracts" are usually a title echo or a stub. */
export const MIN_ABSTRACT_CHARS = 200;

/** A resolver URL (`http(s)://`, `dx.` or `www.`, or bare `doi.org/`) or a `doi:` label. */
const DOI_WRAPPER = /^(?:(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\/|doi:\s*)/i;

/**
 * The one DOI reader in this library: the citation's DOI, the abstracts-map key
 * and the abstract record's own DOI all go through it, so one DOI written two
 * ways is one DOI. Whitespace, a resolver URL or a `doi:` label (also both, as in
 * `doi: https://doi.org/...`) are removed, percent-encoding is decoded, and the
 * result is lower-cased (DOIs are case-insensitive). Returns null unless the
 * result starts with `10.` and holds a `/`.
 */
export function normalizeDoi(doi: string | null | undefined): string | null {
  if (typeof doi !== 'string') return null;
  let d = doi.trim();
  for (let i = 0; i < 2; i++) d = d.replace(DOI_WRAPPER, '').trim();
  if (/%[0-9a-f]{2}/i.test(d)) {
    try {
      d = decodeURIComponent(d).trim();
    } catch {
      return null; // a broken percent-encoding cannot be read as a DOI
    }
  }
  d = d.toLowerCase();
  return d.startsWith('10.') && d.includes('/') ? d : null;
}

/**
 * The host's abstracts map re-keyed by `normalizeDoi`, with what could not be
 * used counted rather than dropped. `conflicting` holds DOIs that two map
 * entries claim with different abstract text: neither can be attributed, so
 * their citations are `no_abstract`.
 */
export interface AbstractIndex {
  byDoi: ReadonlyMap<string, SourceAbstract>;
  conflicting: ReadonlySet<string>;
  /** Map keys that are not readable as a DOI (their entries are never used). */
  unreadableKeys: string[];
}

export function indexAbstracts(abstracts: ReadonlyMap<string, SourceAbstract>): AbstractIndex {
  const byDoi = new Map<string, SourceAbstract>();
  const conflicting = new Set<string>();
  const unreadableKeys: string[] = [];
  for (const [key, rec] of abstracts) {
    const doi = normalizeDoi(key);
    if (!doi) { unreadableKeys.push(key); continue; }
    const prev = byDoi.get(doi);
    if (!prev) { byDoi.set(doi, rec); continue; }
    if (prev !== rec && (prev?.abstract ?? '') !== (rec?.abstract ?? '')) conflicting.add(doi);
  }
  for (const d of conflicting) byDoi.delete(d);
  return { byDoi, conflicting, unreadableKeys };
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
  if (!a || !a.abstract || a.abstract.trim().length < MIN_ABSTRACT_CHARS) return 'no_abstract';
  // The map key is the host's claim about which source this abstract belongs to;
  // the record carries its own DOI. If they disagree the abstract may be someone
  // else's, so no verdict is attributed to this source.
  if (a.doi && normalizeDoi(a.doi) !== doi) return 'no_abstract';
  return null;
}
