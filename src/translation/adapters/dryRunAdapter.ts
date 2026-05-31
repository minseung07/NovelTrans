import type { AdapterStatus, TranslationInput, TranslationResult, TranslatorAdapter } from "../../domain/translation.js";
import { nowIso } from "../../utils/time.js";
import { extractNumbers, paragraphs } from "../../utils/text.js";

type DryRunAdapterOptions = {
  failEpisodeIds?: string[];
};

export class DryRunAdapter implements TranslatorAdapter {
  readonly id = "dry-run";
  readonly label = "Dry-run translator";
  private readonly failEpisodeIds: Set<string>;

  constructor(options: DryRunAdapterOptions = {}) {
    this.failEpisodeIds = new Set(options.failEpisodeIds ?? []);
  }

  async checkAvailability(): Promise<AdapterStatus> {
    return {
      available: true,
      message: "dry-run 백엔드는 항상 사용할 수 있습니다."
    };
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    input.signal?.throwIfAborted();
    if (this.failEpisodeIds.has(input.episode.id)) {
      throw new Error(`dry-run에서 ${input.episode.id} 화의 실패를 요청했습니다.`);
    }

    const sourceParagraphs = paragraphs(input.episode.body);
    const bodyKo = (sourceParagraphs.length > 0 ? sourceParagraphs : [input.episode.body]).map((paragraph, index) => {
      const numbers = extractNumbers(paragraph);
      const preservedNumbers = numbers.length > 0 ? ` ${numbers.join(" ")}` : "";
      const glossaryTargets = input.glossaryEntries
        .filter((entry) => entry.target && paragraph.includes(entry.source))
        .map((entry) => entry.target)
        .filter((target): target is string => Boolean(target));
      const glossaryText = glossaryTargets.length > 0 ? ` 용어: ${glossaryTargets.join(", ")}` : "";
      return `번역문 ${input.episode.episodeNo}-${index + 1}:${preservedNumbers} 한국어 초벌 문단입니다.${glossaryText}`;
    });

    return {
      episodeId: input.episode.id,
      titleKo: `제${input.episode.episodeNo}화`,
      bodyKo: bodyKo.join("\n\n"),
      summary: `Dry-run summary for ${input.episode.id}.`,
      usedGlossaryEntries: input.glossaryEntries.filter((entry) => entry.target && input.episode.sourceText.includes(entry.source)).map((entry) => entry.id),
      newGlossaryCandidates: [],
      qaIssueIds: [],
      model: input.model ?? "dry-run",
      backend: this.id,
      createdAt: nowIso()
    };
  }
}
