export type GlossaryTermType =
  | "person"
  | "place"
  | "organization"
  | "skill"
  | "item"
  | "title"
  | "concept"
  | "term"
  | "unknown";

export type GlossaryStatus = "candidate" | "confirmed" | "locked" | "forbidden" | "deprecated";

export type GlossaryTargetCandidate = {
  target: string;
  count: number;
  episodeIds: string[];
};

export type GlossaryEntry = {
  id: string;
  source: string;
  target: string | null;
  reading?: string;
  type: GlossaryTermType;
  status: GlossaryStatus;
  aliases: string[];
  forbiddenTargets: string[];
  notes: string;
  confidence: number;
  sourceScore: number;
  targetScore: number;
  occurrenceCount: number;
  firstSeenEpisode: number | null;
  lastSeenEpisode: number | null;
  locked: boolean;
  targetCandidates: GlossaryTargetCandidate[];
  createdAt: string;
  updatedAt: string;
};

export type GlossaryConflict = {
  id: string;
  source: string;
  targets: string[];
  entryIds: string[];
  status: "open" | "resolved";
  message: string;
  updatedAt: string;
};

export type GlossaryData = {
  version: 1;
  entries: GlossaryEntry[];
  conflicts: GlossaryConflict[];
  updatedAt: string;
};
