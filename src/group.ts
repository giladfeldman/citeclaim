import type { CitationInput } from './types.js';

export interface SourceGroup {
  referenceKey: string;
  doi: string;
  citations: CitationInput[];
}

/**
 * One group per (source, chunk): every eligible citation of the same reference
 * is judged in one call, so the abstract and instructions are sent once.
 * A source cited more than maxGroupSize times is split into consecutive chunks
 * of at most maxGroupSize, in document order. Groups come out in order of each
 * source's first citation, so the call sequence is deterministic.
 */
export function groupBySource(
  eligible: CitationInput[],
  doiOf: (c: CitationInput) => string,
  maxGroupSize: number,
): SourceGroup[] {
  if (!Number.isInteger(maxGroupSize) || maxGroupSize < 1) {
    throw new Error(`maxGroupSize must be a positive integer, got ${maxGroupSize}`);
  }
  const bySource = new Map<string, CitationInput[]>();
  for (const c of eligible) {
    // Keyed by reference AND DOI: two citations sharing a reference key but
    // carrying different DOIs must never be judged against one abstract.
    const key = JSON.stringify([c.referenceKey, doiOf(c)]);
    const list = bySource.get(key);
    if (list) list.push(c);
    else bySource.set(key, [c]);
  }
  const groups: SourceGroup[] = [];
  for (const cites of bySource.values()) {
    for (let i = 0; i < cites.length; i += maxGroupSize) {
      const chunk = cites.slice(i, i + maxGroupSize);
      groups.push({ referenceKey: chunk[0].referenceKey as string, doi: doiOf(chunk[0]), citations: chunk });
    }
  }
  return groups;
}
