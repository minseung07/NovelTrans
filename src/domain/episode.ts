export type Episode = {
  id: string;
  episodeNo: number;
  title: string;
  sourceText: string;
  foreword?: string;
  body: string;
  afterword?: string;
  sourceHash: string;
  metadata: Record<string, unknown>;
};

export type SourceAnalysis = {
  titleGuess: string;
  languageGuess: "ja" | "ko" | "unknown";
  characterCount: number;
  episodeCount: number;
  hasEpisodeHeadings: boolean;
  longEpisodeIds: string[];
  afterwordCount: number;
  warnings: string[];
};
