import { box, renderScreen, table } from "../layout.js";
export function renderExportRoomScreen(model, width) {
    const metadata = model.overview.metadata;
    const preview = model.exportPreview;
    const body = [
        ...box("결과물 형식", [
            checked(metadata.outputOptions.formats.includes("txt"), "TXT"),
            checked(metadata.outputOptions.formats.includes("epub"), "EPUB")
        ], width),
        "",
        ...box("EPUB 옵션", [
            checked(true, "목차"),
            checked(metadata.outputOptions.includeGlossaryAppendix, "용어집 부록"),
            checked(metadata.outputOptions.includeAfterword, "후기 포함"),
            checked(Boolean(metadata.outputOptions.verticalWriting), "세로쓰기"),
            checked(Boolean(metadata.outputOptions.coverImagePath), "표지 이미지")
        ], width),
        "",
        ...box("미리보기", [
            ...table([
                ["제목", preview.title],
                ["전체 화", preview.episodeCount],
                ["번역 완료", preview.translatedEpisodeCount],
                ["용어 부록", preview.glossaryAppendixCount],
                ["표지", metadata.outputOptions.coverImagePath ?? "(없음)"],
                ["TXT", preview.txtExists ? "생성됨" : preview.expectedTxtPath],
                ["EPUB", preview.epubExists ? "생성됨" : preview.expectedEpubPath]
            ], 11)
        ], width)
    ];
    return renderScreen("결과물 제작실", model.overview.metadata.name, body, "[1/2] 형식   [A/W/V/C] 옵션   [P] 확인   [Enter] 생성   [B] 뒤로", { width });
}
function checked(value, label) {
    return `[${value ? "x" : " "}] ${label}`;
}
