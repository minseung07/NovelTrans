import type { GlossaryData } from "../domain/glossary.js";
import { mergeTranslationGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { loadGlossary, saveGlossary } from "../storage/projectStore.js";

export class ProjectGlossaryUpdater {
  private current: GlossaryData;
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly projectDir: string,
    initial: GlossaryData
  ) {
    this.current = initial;
  }

  snapshot(): GlossaryData {
    return this.current;
  }

  async mergeCandidates(candidates: string[], episodeId: string): Promise<GlossaryData> {
    const update = this.pending.then(async () => {
      if (candidates.length === 0) {
        return;
      }
      const latest = await loadGlossary(this.projectDir);
      const next = mergeTranslationGlossaryCandidates(latest, candidates, episodeId);
      this.current = next;
      if (next !== latest) {
        await saveGlossary(this.projectDir, next);
      }
    });
    this.pending = update.catch(() => undefined);
    await update;
    return this.current;
  }
}
