import type { Episode } from "../domain/episode.js";
import type { GlossaryData } from "../domain/glossary.js";
import type { TranslationStyle } from "../domain/config.js";
import type { TranslationResult, TranslatorAdapter } from "../domain/translation.js";
import { buildGlossaryContext } from "../glossary/glossaryEngine.js";
import { styleGuideFor } from "../translation/styleGuide.js";
import { hashText } from "../utils/hash.js";
import { normalizeNewlines } from "../utils/text.js";

const maxChunkCharacters = 30000;

export type TranslateEpisodePartsOptions = {
  adapter: TranslatorAdapter;
  episode: Episode;
  glossary: GlossaryData;
  glossaryStrictness: "low" | "medium" | "high" | "strict";
  translationStyle?: TranslationStyle;
  model?: string;
  signal?: AbortSignal;
};

export async function translateEpisodeParts(options: TranslateEpisodePartsOptions): Promise<TranslationResult> {
  const glossaryContext = buildGlossaryContext(options.glossary.entries, options.glossaryStrictness);
  const styleGuide = styleGuideFor(options.translationStyle ?? "balanced-webnovel");
  const baseInput = {
    glossaryEntries: options.glossary.entries,
    glossaryContext,
    styleGuide,
    model: options.model,
    signal: options.signal
  };

  const foreword = options.episode.foreword?.trim();
  const forewordResult = foreword
    ? await options.adapter.translateEpisode({
        ...baseInput,
        episode: buildSegmentEpisode(options.episode, "foreword", foreword)
      })
    : null;

  const bodyChunks = splitBodyChunks(options.episode.body);
  const bodyResults: TranslationResult[] = [];
  for (const [index, chunk] of bodyChunks.entries()) {
    options.signal?.throwIfAborted();
    const episode = bodyChunks.length === 1 ? options.episode : buildChunkEpisode(options.episode, chunk, index + 1, bodyChunks.length);
    bodyResults.push(
      await options.adapter.translateEpisode({
        ...baseInput,
        episode
      })
    );
  }

  const result = mergeBodyResults(options.episode, bodyResults);

  const afterword = options.episode.afterword?.trim();
  const afterwordResult = afterword
    ? await options.adapter.translateEpisode({
        ...baseInput,
        episode: buildSegmentEpisode(options.episode, "afterword", afterword)
      })
    : null;

  if (!forewordResult && !afterwordResult) {
    return result;
  }
  return {
    ...result,
    ...(forewordResult ? { forewordKo: forewordResult.bodyKo } : {}),
    ...(afterwordResult ? { afterwordKo: afterwordResult.bodyKo } : {}),
    usedGlossaryEntries: unique([
      ...result.usedGlossaryEntries,
      ...(forewordResult?.usedGlossaryEntries ?? []),
      ...(afterwordResult?.usedGlossaryEntries ?? [])
    ]),
    newGlossaryCandidates: unique([
      ...result.newGlossaryCandidates,
      ...(forewordResult?.newGlossaryCandidates ?? []),
      ...(afterwordResult?.newGlossaryCandidates ?? [])
    ])
  };
}

function splitBodyChunks(body: string): string[] {
  const normalized = normalizeNewlines(body).trim();
  if (normalized.length <= maxChunkCharacters) {
    return [normalized];
  }
  const blocks = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.length > maxChunkCharacters) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongBlock(trimmed));
      continue;
    }
    const next = current ? `${current}\n\n${trimmed}` : trimmed;
    if (next.length > maxChunkCharacters && current) {
      chunks.push(current);
      current = trimmed;
    } else {
      current = next;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.length > 0 ? chunks : [normalized];
}

function splitLongBlock(block: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < block.length; index += maxChunkCharacters) {
    chunks.push(block.slice(index, index + maxChunkCharacters));
  }
  return chunks;
}

function mergeBodyResults(episode: Episode, results: TranslationResult[]): TranslationResult {
  const [first, ...rest] = results;
  if (!first) {
    throw new Error(`No translation result was produced for ${episode.id}.`);
  }
  if (rest.length === 0) {
    return first;
  }
  return {
    ...first,
    episodeId: episode.id,
    bodyKo: results.map((result) => result.bodyKo.trim()).filter(Boolean).join("\n\n"),
    summary: results.map((result) => result.summary).filter((summary): summary is string => Boolean(summary)).join("\n") || first.summary,
    usedGlossaryEntries: unique(results.flatMap((result) => result.usedGlossaryEntries)),
    newGlossaryCandidates: unique(results.flatMap((result) => result.newGlossaryCandidates))
  };
}

function buildChunkEpisode(episode: Episode, body: string, chunkNo: number, chunkCount: number): Episode {
  const { foreword: _foreword, afterword: _afterword, ...baseEpisode } = episode;
  return {
    ...baseEpisode,
    id: `${episode.id}_chunk_${chunkNo}`,
    title: episode.title,
    sourceText: body,
    body,
    sourceHash: hashText(body),
    metadata: {
      ...episode.metadata,
      parentEpisodeId: episode.id,
      segment: "body-chunk",
      chunkNo,
      chunkCount
    }
  };
}

function buildSegmentEpisode(episode: Episode, segment: "foreword" | "afterword", text: string): Episode {
  const { foreword: _foreword, afterword: _afterword, ...baseEpisode } = episode;
  return {
    ...baseEpisode,
    id: `${episode.id}_${segment}`,
    title: `${episode.title} ${segment === "foreword" ? "Foreword" : "Afterword"}`,
    sourceText: text,
    body: text,
    sourceHash: hashText(text),
    metadata: {
      ...episode.metadata,
      parentEpisodeId: episode.id,
      segment
    }
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
