import { mergeTranslationGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { loadGlossary, saveGlossary } from "../storage/projectStore.js";
export class ProjectGlossaryUpdater {
    projectDir;
    current;
    pending = Promise.resolve();
    constructor(projectDir, initial) {
        this.projectDir = projectDir;
        this.current = initial;
    }
    snapshot() {
        return this.current;
    }
    async mergeCandidates(candidates, episodeId) {
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
