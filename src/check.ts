import { canonicalSha256, sha256Hex } from './canonical.js';
import { ineligibilityReason, normalizeDoi } from './eligibility.js';
import { groupBySource } from './group.js';
import { isTruncated, parseGroupAnswer } from './parse.js';
import { DEFAULT_PROMPT_ID, promptSha256, renderPrompt } from './prompts/index.js';
import {
  VERDICTS,
  type AbstentionReason,
  type CallRecord,
  type CheckOptions,
  type CheckResult,
  type CitationInput,
  type ItemResult,
  type LlmClient,
  type LlmResponse,
  type SourceAbstract,
  type Verdict,
} from './types.js';
import { LIBRARY_VERSION } from './version.js';

function emptyItem(c: CitationInput, reason: AbstentionReason | null): ItemResult {
  return {
    citationId: c.id,
    referenceKey: c.referenceKey,
    doi: normalizeDoi(c.doi),
    status: reason ? 'not_assessed' : 'judged',
    verdict: null,
    reason,
    evidenceQuote: null,
    evidenceSpan: null,
    rationale: null,
    callIndex: null,
    positionInGroup: null,
    groupSize: null,
  };
}

async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Check every citation of a document against its cited source's abstract.
 *
 * Citations that cannot be judged are returned as `not_assessed` with a reason
 * and never reach the model. The rest are grouped per source (one call per
 * source and chunk) and each sentence gets its own verdict. A failed call or a
 * malformed item becomes `llm_failed` with a reason, never a verdict. Items come
 * back in the input order.
 */
export async function checkClaims(
  citations: CitationInput[],
  abstracts: ReadonlyMap<string, SourceAbstract>,
  client: LlmClient,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const promptId = DEFAULT_PROMPT_ID;
  const pSha = promptSha256(promptId);
  const maxGroupSize = options.maxGroupSize ?? 6;
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`concurrency must be a positive integer, got ${concurrency}`);
  }
  const items = new Map<string, ItemResult>();
  const eligible: CitationInput[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    if (seen.has(c.id)) throw new Error(`duplicate citation id ${c.id}`);
    seen.add(c.id);
    const reason = ineligibilityReason(c, abstracts);
    if (reason) items.set(c.id, emptyItem(c, reason));
    else eligible.push(c);
  }

  const groups = groupBySource(eligible, (c) => normalizeDoi(c.doi) as string, maxGroupSize);
  const calls: CallRecord[] = [];
  const tasks = groups.map((g, callIndex) => async () => {
    const src = abstracts.get(g.doi) as SourceAbstract;
    const abstract = src.abstract as string;
    const prompt = renderPrompt(promptId, {
      title: src.title, year: src.year, abstract, sentences: g.citations.map((c) => c.sentence as string),
    });
    const rec: CallRecord = {
      callIndex, referenceKey: g.referenceKey, doi: g.doi, citationIds: g.citations.map((c) => c.id),
      promptId, promptSha256: pSha, renderedPromptSha256: sha256Hex(prompt),
      callConfig: null, callConfigSha256: null, servedModel: null, finishReason: null,
      usage: null, rawText: null, error: null,
    };
    let resp: LlmResponse | null = null;
    try {
      resp = await client.complete({ prompt, promptId, promptSha256: pSha });
    } catch (err) {
      rec.error = err instanceof Error ? err.message : String(err);
    }
    if (resp) {
      rec.callConfig = resp.callConfig ?? null;
      rec.callConfigSha256 = resp.callConfig ? canonicalSha256(resp.callConfig) : null;
      rec.servedModel = resp.servedModel ?? null;
      rec.finishReason = resp.finishReason ?? null;
      rec.usage = resp.usage ?? null;
      rec.rawText = resp.text ?? null;
    }
    const n = g.citations.length;
    let parsed;
    if (!resp || !resp.text) {
      parsed = Array.from({ length: n }, () => ({ verdict: null, reason: 'llm_unavailable' as AbstentionReason,
        evidenceQuote: null, evidenceSpan: null, rationale: null }));
    } else if (isTruncated(resp.finishReason)) {
      parsed = Array.from({ length: n }, () => ({ verdict: null, reason: 'llm_truncated' as AbstentionReason,
        evidenceQuote: null, evidenceSpan: null, rationale: null }));
    } else {
      parsed = parseGroupAnswer(resp.text, n, abstract);
    }
    g.citations.forEach((c, k) => {
      const p = parsed[k];
      items.set(c.id, {
        citationId: c.id, referenceKey: c.referenceKey, doi: g.doi,
        status: p.verdict ? 'judged' : 'llm_failed',
        verdict: p.verdict, reason: p.verdict ? null : p.reason,
        evidenceQuote: p.evidenceQuote, evidenceSpan: p.evidenceSpan, rationale: p.rationale,
        callIndex, positionInGroup: k + 1, groupSize: n,
      });
    });
    return rec;
  });
  calls.push(...(await runPool(tasks, concurrency)));

  const ordered = citations.map((c) => items.get(c.id) as ItemResult);
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  const byReason: Partial<Record<AbstentionReason, number>> = {};
  for (const it of ordered) {
    if (it.verdict) byVerdict[it.verdict]++;
    if (it.reason) byReason[it.reason] = (byReason[it.reason] ?? 0) + 1;
  }
  return {
    libraryVersion: LIBRARY_VERSION,
    promptId,
    promptSha256: pSha,
    items: ordered,
    calls,
    summary: {
      citations: citations.length,
      eligible: eligible.length,
      judged: ordered.filter((i) => i.status === 'judged').length,
      byVerdict,
      byReason,
      calls: calls.length,
    },
  };
}
