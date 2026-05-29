import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../config/defaultConfig.js";
import { listEpisodes } from "../storage/projectStore.js";
import { parseEpisodeRange } from "../webImport/episodeRange.js";
import { WebImportService } from "../webImport/webImportService.js";
import type { WebFetch } from "../webImport/httpClient.js";
import { detectWebImportUrl } from "../webImport/urlDetector.js";

test("web import detects supported sites and parses episode ranges", () => {
  assert.equal(detectWebImportUrl("https://kakuyomu.jp/works/123")?.site, "kakuyomu");
  assert.equal(detectWebImportUrl("https://ncode.syosetu.com/n1234ab/")?.site, "syosetu");
  assert.equal(detectWebImportUrl("https://ncode.syosetu.com/n1234ab")?.site, "syosetu");
  assert.equal(detectWebImportUrl("https://example.com/novel"), null);
  assert.deepEqual(parseEpisodeRange("1-3", 10), { start: 1, end: 3, label: "1-3화" });
  assert.deepEqual(parseEpisodeRange("latest-2", 10), { start: 9, end: 10, label: "최신 2화" });
  assert.deepEqual(parseEpisodeRange("4-", 6), { start: 4, end: 6, label: "4화부터 끝까지" });
});

test("web import service creates a project from Kakuyomu fixtures", async () => {
  const fetchFn = fixtureFetch({
    "https://kakuyomu.jp/works/123": `
      <html><head><meta property="og:title" content="星の庭 - カクヨム"></head>
      <body>
        <a href="/users/alice">アリス</a>
        <a href="/works/123/episodes/1001">庭の始まり</a>
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"__APOLLO_STATE__":{
            "Work:123":{"id":"123","tableOfContentsV2":[{"__ref":"TableOfContentsChapter:"}]},
            "TableOfContentsChapter:":{"episodeUnions":[
              {"__ref":"Episode:1001"},
              {"__ref":"Episode:1002"},
              {"__ref":"Episode:1003"}
            ]},
            "Episode:1001":{"id":"1001","title":"第1話 庭の始まり"},
            "Episode:1002":{"id":"1002","title":"第2話 星の声"},
            "Episode:1003":{"id":"1003","title":"第3話 聖印"}
          }}}}
        </script>
      </body></html>
    `,
    "https://kakuyomu.jp/works/123/episodes/1001": `
      <html><head><meta property="og:title" content="庭の始まり - カクヨム"></head>
      <body><div class="widget-episodeBody"><p>黒架は庭に立った。</p><p>星が揺れた。</p></div></body></html>
    `,
    "https://kakuyomu.jp/works/123/episodes/1002": `
      <html><head><meta property="og:title" content="星の声 - カクヨム"></head>
      <body><div class="widget-episodeBody"><p>聖印が光った。</p></div></body></html>
    `,
    "https://kakuyomu.jp/works/123/episodes/1003": `
      <html><head><meta property="og:title" content="聖印 - カクヨム"></head>
      <body><div class="widget-episodeBody"><p>黒架は聖印を拾った。</p></div></body></html>
    `
  });
  const service = new WebImportService({ fetchFn, delayMs: 0 });
  const work = await service.loadWork("https://kakuyomu.jp/works/123");
  assert.equal(work.title, "星の庭");
  assert.equal(work.episodes.length, 3);
  assert.equal(work.episodes[2]?.remoteId, "1003");
  const preview = service.buildPreview(work, "2-3");
  const root = await mkdtemp(join(tmpdir(), "noveltrans-web-kakuyomu-"));
  const progress: string[] = [];
  const result = await service.importProject(
    preview,
    {
      projectRoot: join(root, "projects"),
      backend: "dry-run",
      model: "dry-run",
      translationStyle: defaultConfig.translationStyle,
      concurrency: 1,
      glossaryStrictness: defaultConfig.glossaryStrictness,
      userConfirmedRights: true
    },
    (event) => progress.push(`${event.phase}:${event.completed}/${event.total}`)
  );
  assert.deepEqual(progress, [
    "start:0/2",
    "episode-start:0/2",
    "episode-complete:1/2",
    "episode-start:1/2",
    "episode-complete:2/2",
    "compose:2/2",
    "create-project:2/2",
    "metadata:2/2"
  ]);
  assert.equal(result.created.analysis.episodeCount, 2);
  const episodes = await listEpisodes(result.created.metadata.projectDir);
  assert.equal(episodes[0]?.metadata.sourceSite, "kakuyomu");
  assert.equal(episodes[0]?.metadata.sourceUrl, "https://kakuyomu.jp/works/123/episodes/1002");
  assert.match(episodes[1]?.body ?? "", /聖印/);
});

test("Kakuyomu import rejects partial anchor-only tables when the page exposes a larger count", async () => {
  const anchors = Array.from({ length: 7 }, (_, index) => `<a href="/works/999/episodes/${1000 + index}">第${index + 1}話</a>`).join("");
  const fetchFn = fixtureFetch({
    "https://kakuyomu.jp/works/999": `
      <html><head><meta property="og:title" content="長い庭 - カクヨム"></head>
      <body>
        ${anchors}
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"__APOLLO_STATE__":{
            "Work:999":{"id":"999","publicEpisodeCount":295,"tableOfContentsV2":[]}
          }}}}
        </script>
      </body></html>
    `
  });
  const service = new WebImportService({ fetchFn, delayMs: 0 });
  await assert.rejects(() => service.loadWork("https://kakuyomu.jp/works/999"), /295화.*7화/);
});

test("web import service reads Syosetu fixtures", async () => {
  const fetchFn = fixtureFetch({
    "https://ncode.syosetu.com/n1234ab/": `
      <html><head><title>月の炉 - 小説家になろう</title></head>
      <body>
        <p class="novel_title">月の炉</p>
        <div class="novel_writername">作者：山田</div>
        <a href="/n1234ab/1/">第一話</a>
        <a href="/n1234ab/2/">第二話</a>
      </body></html>
    `,
    "https://api.syosetu.com/novelapi/api/?out=json&of=t-w-ga&ncode=n1234ab": `
      [{"allcount":1},{"title":"API月の炉","writer":"API山田","general_all_no":2}]
    `,
    "https://ncode.syosetu.com/n1234ab/1/": `
      <html><body>
        <p class="novel_subtitle">第一話</p>
        <div id="novel_p"><p>前書きです。</p></div>
        <div id="novel_honbun"><p>黒架は炉を見た。</p></div>
        <div id="novel_a"><p>あとがきです。</p></div>
      </body></html>
    `,
    "https://ncode.syosetu.com/n1234ab/2/": `
      <html><body>
        <p class="novel_subtitle">第二話</p>
        <div id="novel_honbun"><p>聖印が鳴った。</p></div>
      </body></html>
    `
  });
  const service = new WebImportService({ fetchFn, delayMs: 0 });
  const work = await service.loadWork("https://ncode.syosetu.com/n1234ab");
  assert.equal(work.site, "syosetu");
  assert.equal(work.title, "API月の炉");
  assert.equal(work.author, "API山田");
  const preview = service.buildPreview(work, "1");
  const root = await mkdtemp(join(tmpdir(), "noveltrans-web-syosetu-"));
  const result = await service.importProject(preview, {
    projectRoot: join(root, "projects"),
    backend: "dry-run",
    model: "dry-run",
    translationStyle: defaultConfig.translationStyle,
    concurrency: 1,
    glossaryStrictness: defaultConfig.glossaryStrictness,
    userConfirmedRights: true
  });
  const episodes = await listEpisodes(result.created.metadata.projectDir);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]?.metadata.sourceSite, "syosetu");
  assert.match(episodes[0]?.foreword ?? "", /前書き/);
  assert.match(episodes[0]?.body ?? "", /黒架/);
  assert.doesNotMatch(episodes[0]?.body ?? "", /前書き/);
  assert.match(episodes[0]?.afterword ?? "", /あとがき/);
});

function fixtureFetch(fixtures: Record<string, string>): WebFetch {
  return async (url) => {
    const html = fixtures[url];
    if (!html) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
}
