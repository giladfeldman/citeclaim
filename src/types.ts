/**
 * Evidence-scoped verdicts. The evidence is the cited source's ABSTRACT only, so
 * a verdict says what the abstract shows, never whether the paper supports the
 * claim. "silent" (the abstract does not settle it) is never a clean result.
 */
export type Verdict = 'consistent' | 'contradicts' | 'silent';

export const VERDICTS: readonly Verdict[] = ['consistent', 'contradicts', 'silent'];

/**
 * Why an item has no verdict. Every non-judged item carries exactly one.
 *
 * Not assessed (never sent to a model):
 *  - link_not_matched: the citation is not linked to a reference with status "matched"
 *  - multi_source_citation: the marker names more than one source ("[3-5]", "Smith 2019; Lee 2020")
 *  - no_doi: the reference has no DOI, so no abstract can be fetched by DOI
 *  - no_abstract: no abstract was found for the DOI
 *  - no_citing_sentence: the citing sentence is missing or empty
 * Model failures (sent, but no usable verdict):
 *  - llm_unavailable: the client threw or returned nothing
 *  - llm_truncated: the provider stopped at the output-token limit
 *  - llm_malformed: unparseable JSON, a missing item, or a verdict outside the scheme
 *  - quote_not_in_abstract: a consistent/contradicts verdict whose evidence quote is not in the abstract
 */
export type AbstentionReason =
  | 'link_not_matched'
  | 'multi_source_citation'
  | 'no_doi'
  | 'no_abstract'
  | 'no_citing_sentence'
  | 'llm_unavailable'
  | 'llm_truncated'
  | 'llm_malformed'
  | 'quote_not_in_abstract';

export const NOT_ASSESSED_REASONS: readonly AbstentionReason[] = [
  'link_not_matched', 'multi_source_citation', 'no_doi', 'no_abstract', 'no_citing_sentence',
];
export const LLM_FAILURE_REASONS: readonly AbstentionReason[] = [
  'llm_unavailable', 'llm_truncated', 'llm_malformed', 'quote_not_in_abstract',
];

export type LinkStatus = 'matched' | 'suggested' | 'ambiguous' | 'unmatched';

/** One in-text citation, as the host knows it. */
export interface CitationInput {
  /** Host identifier for the citation (stable within a document). */
  id: string;
  /** Identifier of the reference-list entry the citation is linked to. Citations of one source share it. */
  referenceKey: string | null;
  /** DOI of that reference, if known. */
  doi?: string | null;
  linkStatus: LinkStatus;
  /** How many sources the citation marker names (1 for "[4]" or "(Smith, 2019)"; 3 for "[3-5]"). */
  sourceCount: number;
  /** The citing sentence(s): the claim this citation is attached to. */
  sentence: string | null;
}

/** The cited source's abstract, fetched by the host (e.g. from Crossref, OpenAlex or Europe PMC). */
export interface SourceAbstract {
  doi: string;
  title?: string | null;
  year?: number | null;
  abstract: string | null;
  /** Where the abstract came from (crossref, openalex, ...), recorded for provenance. */
  source?: string | null;
}

/**
 * Everything that can change a model's answer, recorded once per call setup and
 * hashed. A knob the provider does not expose is the string "n/a", never omitted,
 * so "not applicable" and "not recorded" stay distinguishable.
 */
export type CallConfig = Record<string, unknown>;

export interface LlmRequest {
  prompt: string;
  promptId: string;
  promptSha256: string;
}

export interface LlmResponse {
  /** Raw text answer, expected to be the JSON object the prompt asks for. */
  text: string;
  /** Model the provider says it served (may differ from the alias requested). */
  servedModel?: string | null;
  /** Provider stop reason, e.g. "stop", "STOP", "length", "MAX_TOKENS". */
  finishReason?: string | null;
  usage?: Record<string, number | string | null> | null;
  /** The settings this call was made with. Hashed by the library. */
  callConfig: CallConfig;
}

/** Injected model client. The library ships no provider, key or network code. */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type ItemStatus = 'judged' | 'not_assessed' | 'llm_failed';

export interface ItemResult {
  citationId: string;
  referenceKey: string | null;
  doi: string | null;
  status: ItemStatus;
  verdict: Verdict | null;
  /** Set exactly when status is not "judged". */
  reason: AbstentionReason | null;
  /** Verbatim span of the abstract that decided the verdict ("" for silent). */
  evidenceQuote: string | null;
  /**
   * UTF-16 offsets of evidenceQuote in the NFKC form of the abstract
   * (`abstract.normalize('NFKC')`), when found. They equal offsets in the original
   * abstract only when NFKC leaves it unchanged (a ligature such as U+FB01 expands
   * and shifts everything after it); slice the normalised string to highlight.
   */
  evidenceSpan: { start: number; end: number } | null;
  rationale: string | null;
  /** Which grouped call judged this item. */
  callIndex: number | null;
  /** Position of this item inside its grouped call (1-based). */
  positionInGroup: number | null;
  groupSize: number | null;
}

export interface CallRecord {
  callIndex: number;
  referenceKey: string;
  doi: string;
  citationIds: string[];
  promptId: string;
  promptSha256: string;
  renderedPromptSha256: string;
  callConfig: CallConfig | null;
  callConfigSha256: string | null;
  servedModel: string | null;
  finishReason: string | null;
  usage: Record<string, number | string | null> | null;
  rawText: string | null;
  error: string | null;
}

export interface CheckSummary {
  citations: number;
  eligible: number;
  judged: number;
  byVerdict: Record<Verdict, number>;
  byReason: Partial<Record<AbstentionReason, number>>;
  calls: number;
}

export interface CheckResult {
  libraryVersion: string;
  promptId: string;
  promptSha256: string;
  items: ItemResult[];
  calls: CallRecord[];
  summary: CheckSummary;
}

export interface CheckOptions {
  /** Most citing sentences sent in one call. Larger groups of one source are split. Default 6. */
  maxGroupSize?: number;
  /** Calls in flight at once. Default 1 (free tiers are rate-limited). */
  concurrency?: number;
}
