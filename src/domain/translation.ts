import type { Episode } from "./episode.js";
import type { GlossaryEntry } from "./glossary.js";

export type AdapterStatus = {
  available: boolean;
  message: string;
};

export type TranslationInput = {
  episode: Episode;
  glossaryEntries: GlossaryEntry[];
  glossaryContext: string;
  styleGuide?: string;
  model?: string;
  signal?: AbortSignal;
};

export type TranslationResult = {
  episodeId: string;
  titleKo: string;
  forewordKo?: string;
  bodyKo: string;
  afterwordKo?: string;
  summary?: string;
  usedGlossaryEntries: string[];
  newGlossaryCandidates: string[];
  qaIssueIds: string[];
  model: string;
  backend: string;
  createdAt: string;
};

export interface TranslatorAdapter {
  id: string;
  label: string;
  checkAvailability(): Promise<AdapterStatus>;
  translateEpisode(input: TranslationInput): Promise<TranslationResult>;
}
