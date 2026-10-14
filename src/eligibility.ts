import type { AbstentionReason, CitationInput, SourceAbstract } from './types.js';

/** Shortest abstract worth judging against; shorter "abstracts" are usually a title echo or a stub. */
export const MIN_ABSTRACT_CHARS = 200;

export function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const d = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  return d.startsWith('10.') ? d : null;
}

/**
 * Why a citation cannot be sent to a model, or null when it can. Checked in a
 * fixed order so the reason is deterministic: link, sources, DOI, sentence, abstract.
 */
export function ineligibilityReason(
  c: CitationInput,
  abstracts: ReadonlyMap<string, SourceAbstract>,
): AbstentionReason | null {
  if (c.linkStatus !== 'matched' || !c.referenceKey) return 'link_not_matched';
  if (!Number.isInteger(c.sourceCount) || c.sourceCount !== 1) return 'multi_source_citation';
  const doi = normalizeDoi(c.doi);
  if (!doi) return 'no_doi';
  if (!c.sentence || !c.sentence.trim()) return 'no_citing_sentence';
  const a = abstracts.get(doi);
  if (!a || !a.abstract || a.abstract.trim().length < MIN_ABSTRACT_CHARS) return 'no_abstract';
  // The map key is the host's claim about which source this abstract belongs to;
  // the record carries its own DOI. If they disagree the abstract may be someone
  // else's, so no verdict is attributed to this source.
  if (a.doi && normalizeDoi(a.doi) !== doi) return 'no_abstract';
  return null;
}
