// Export stage: output option toggles + a live preview.
import { box } from "../../components/box.js";
import { stack } from "../../components/geometry.js";
const onOff = (value) => (value ? "켜짐" : "꺼짐");
export function renderExport(project, width) {
    const output = project.overview.metadata.outputOptions;
    const preview = project.exportPreview;
    const options = box("출력 옵션", [
        `TXT ${onOff(output.formats.includes("txt"))}   EPUB ${onOff(output.formats.includes("epub"))}`,
        `용어집 부록 ${onOff(output.includeGlossaryAppendix)}   세로쓰기 ${onOff(output.verticalWriting)}   후기 ${onOff(output.includeAfterword)}`,
        "[t]TXT [e]EPUB [p]부록 [v]세로쓰기 [a]후기 [g]생성"
    ], width);
    const previewBox = box("미리보기", [
        `${preview.translatedEpisodeCount}/${preview.episodeCount}화 번역됨`,
        `TXT ${preview.txtExists ? "생성됨" : "미생성"}   EPUB ${preview.epubExists ? "생성됨" : "미생성"}`,
        `경로: ${preview.expectedTxtPath}`
    ], width);
    return stack(options, previewBox);
}
