/**
 * Prompt texts, versioned. The text of each version is frozen: a change is a new
 * version (new id), never an edit, because every verdict records the prompt id
 * and hash it was produced with. prompts/<id>.md ships the same text for
 * readers; tests/prompt.test.ts asserts the two are identical.
 *
 * Placeholders follow Python str.format: {title} {year} {abstract} {sentences};
 * a literal brace is doubled. The accompanying benchmark renders the same file
 * with str.format, so both sides send byte-identical prompts.
 */
import { sha256Hex } from '../canonical.js';

export const CLAIM_PAIR_V1_ID = 'claim-pair-v1';

export const CLAIM_PAIR_V1_TEXT = "You check whether sentences in a manuscript describe a cited source accurately. Your only evidence is the cited source's abstract, printed below. You do not have the full paper.\n\nCITED SOURCE\nTitle: {title}\nYear: {year}\nAbstract:\n\"\"\"\n{abstract}\n\"\"\"\n\nCITING SENTENCES (each one cites the source above)\n{sentences}\n\nFor EACH numbered sentence, judge only the claim it attributes to the cited source, and give one verdict:\n- \"consistent\": the abstract supports that claim as stated. A faithful paraphrase or summary is consistent.\n- \"contradicts\": the abstract conflicts with that claim. Examples: the opposite direction of an effect or finding; a different number; a different study design, method or measure; a different population; a claim stated more strongly, more generally or with more certainty than the abstract reports.\n- \"silent\": the abstract neither supports nor contradicts that claim, so the abstract alone cannot settle it. The claim may still be true in the full paper.\n\nRules:\n- Judge each sentence on its own. The sentences may describe the source differently; one verdict does not imply another.\n- \"evidence_quote\" must be copied exactly, word for word, from the abstract, and must be the shortest span that decides the verdict. For a \"silent\" verdict, set \"evidence_quote\" to \"\".\n- \"reason\" is one short sentence.\n\nReturn only this JSON object, with one item per sentence, in order:\n{{\"items\": [{{\"id\": 1, \"verdict\": \"consistent\" | \"contradicts\" | \"silent\", \"evidence_quote\": \"...\", \"reason\": \"...\"}}]}}\n";

export const PROMPTS: Readonly<Record<string, string>> = {
  [CLAIM_PAIR_V1_ID]: CLAIM_PAIR_V1_TEXT,
};

export const DEFAULT_PROMPT_ID = CLAIM_PAIR_V1_ID;

export function promptSha256(promptId: string): string {
  const text = PROMPTS[promptId];
  if (text === undefined) throw new Error(`unknown prompt id ${promptId}`);
  return sha256Hex(text);
}

export interface PromptFields {
  title: string | null | undefined;
  year: number | string | null | undefined;
  abstract: string;
  sentences: string[];
}

/** Render the numbered sentence block exactly as the benchmark does. */
export function renderSentences(sentences: string[]): string {
  return sentences.map((s, i) => `${i + 1}. "${s}"`).join(String.fromCharCode(10));
}

/** Python str.format semantics for the four named fields; any other field is an error. */
export function renderPrompt(promptId: string, fields: PromptFields): string {
  const template = PROMPTS[promptId];
  if (template === undefined) throw new Error(`unknown prompt id ${promptId}`);
  const values: Record<string, string> = {
    title: fields.title || '(unknown)',
    year: fields.year === null || fields.year === undefined || fields.year === '' ? 'n.d.' : String(fields.year),
    abstract: fields.abstract,
    sentences: renderSentences(fields.sentences),
  };
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c === '{') {
      if (template[i + 1] === '{') { out += '{'; i++; continue; }
      const close = template.indexOf('}', i);
      const name = template.slice(i + 1, close);
      if (!(name in values)) throw new Error(`prompt ${promptId}: unknown field {${name}}`);
      out += values[name];
      i = close;
    } else if (c === '}') {
      if (template[i + 1] === '}') { out += '}'; i++; continue; }
      throw new Error(`prompt ${promptId}: single '}' at ${i}`);
    } else {
      out += c;
    }
  }
  return out;
}
