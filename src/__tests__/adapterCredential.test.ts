import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveOpenAICompatibleApiKey, loadOpenAICompatibleApiKey, clearOpenAICompatibleApiKey, getCredentialPath } from "../config/credentialStore.js";
import { defaultConfig } from "../config/defaultConfig.js";
import { createTranslatorAdapter } from "../translation/adapters/adapterFactory.js";
import { CodexCliAdapter } from "../translation/adapters/codexCliAdapter.js";
import { OpenAICompatibleAdapter } from "../translation/adapters/openAICompatibleAdapter.js";
import type { TranslationInput } from "../domain/translation.js";

test("stores OpenAI-compatible API key outside plain config text", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "noveltrans-credentials-"));
  await saveOpenAICompatibleApiKey("sk-test-secret", configDir);

  assert.equal(loadOpenAICompatibleApiKey(configDir), "sk-test-secret");
  const rawStore = await readFile(getCredentialPath(configDir), "utf8");
  assert.equal(rawStore.includes("sk-test-secret"), false);

  await clearOpenAICompatibleApiKey(configDir);
  assert.equal(loadOpenAICompatibleApiKey(configDir), undefined);
});

test("Codex CLI adapter invokes codex exec and reads the last message file", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-codex-adapter-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('codex 0.0.0-test'); process.exit(0); }",
      "if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using test'); process.exit(0); }",
      "const execIndex = args.indexOf('exec');",
      "const approvalIndex = args.indexOf('--ask-for-approval');",
      "const outputIndex = args.indexOf('--output-last-message');",
      "if (execIndex < 0 || outputIndex < 0) process.exit(2);",
      "if (approvalIndex < 0 || approvalIndex > execIndex) process.exit(3);",
      "writeFileSync(args[outputIndex + 1], '테스트 번역문입니다. 12', 'utf8');"
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeCodex, 0o755);

  const adapter = new CodexCliAdapter({
    command: fakeCodex,
    timeoutMs: 5000,
    sandbox: "read-only"
  });
  const status = await adapter.checkAvailability();
  assert.equal(status.available, true);

  const input: TranslationInput = {
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話",
      sourceText: "黒架は12人を見た。",
      body: "黒架は12人を見た。",
      sourceHash: "hash",
      metadata: {}
    },
    glossaryEntries: [],
    glossaryContext: "",
    model: "codex-test"
  };
  const result = await adapter.translateEpisode(input);
  assert.equal(result.backend, "codex-cli");
  assert.equal(result.bodyKo, "테스트 번역문입니다. 12");
  assert.equal(result.model, "codex-test");
});

test("Codex CLI factory does not force the generic default model", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-codex-factory-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('codex 0.0.0-test'); process.exit(0); }",
      "if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using test'); process.exit(0); }",
      "if (args.includes('--model')) { console.error('generic model was forced'); process.exit(4); }",
      "const outputIndex = args.indexOf('--output-last-message');",
      "if (args.indexOf('exec') < 0 || outputIndex < 0) process.exit(2);",
      "writeFileSync(args[outputIndex + 1], '팩토리 번역문입니다.', 'utf8');"
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeCodex, 0o755);

  const adapter = createTranslatorAdapter("codex-cli", {
    ...defaultConfig,
    defaultBackend: "codex-cli",
    defaultModel: "gpt-4.1-mini",
    codexCli: {
      command: fakeCodex,
      timeoutMs: 5000,
      sandbox: "read-only"
    }
  });

  const result = await adapter.translateEpisode({
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話",
      sourceText: "黒架は歩いた。",
      body: "黒架は歩いた。",
      sourceHash: "hash",
      metadata: {}
    },
    glossaryEntries: [],
    glossaryContext: ""
  });

  assert.equal(result.backend, "codex-cli");
  assert.equal(result.bodyKo, "팩토리 번역문입니다.");
  assert.equal(result.model, "codex-cli-default");
});

test("Codex CLI adapter reports unavailable when codex is not logged in", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-codex-login-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('codex 0.0.0-test'); process.exit(0); }",
      "if (args[0] === 'login' && args[1] === 'status') { console.error('Not logged in'); process.exit(1); }",
      "process.exit(2);"
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeCodex, 0o755);

  const adapter = new CodexCliAdapter({
    command: fakeCodex,
    timeoutMs: 5000,
    sandbox: "read-only"
  });
  const status = await adapter.checkAvailability();
  assert.equal(status.available, false);
  assert.match(status.message, /not logged in/i);
});

test("OpenAI-compatible adapter retries transient chat completion failures", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let requestText = "";
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    requestText = String(init?.body ?? "");
    if (calls === 1) {
      return new Response("rate limited", { status: 429 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "재시도 성공 번역문" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const adapter = new OpenAICompatibleAdapter({
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    temperature: 0.2,
    timeoutMs: 5000,
    maxRetries: 1,
    retryDelayMs: 0
  });
  const result = await adapter.translateEpisode({
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話",
      sourceText: "黒架は歩いた。",
      body: "黒架は歩いた。",
      sourceHash: "hash",
      metadata: {}
    },
    glossaryEntries: [],
    glossaryContext: "",
    styleGuide: "Use a balanced Korean web novel style.",
    model: "test-model"
  });

  assert.equal(calls, 2);
  assert.match(requestText, /Translation style/);
  assert.match(requestText, /balanced Korean web novel style/);
  assert.equal(result.bodyKo, "재시도 성공 번역문");
});

test("OpenAI-compatible adapter parses translated title and glossary candidates from JSON", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                titleKo: "제1화 흑가",
                bodyKo: "흑가는 걸었다.",
                newGlossaryCandidates: ["黒架 => 흑가"]
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const adapter = new OpenAICompatibleAdapter({
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    temperature: 0.2,
    timeoutMs: 5000
  });
  const result = await adapter.translateEpisode({
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話 黒架",
      sourceText: "黒架は歩いた。",
      body: "黒架は歩いた。",
      sourceHash: "hash",
      metadata: {}
    },
    glossaryEntries: [],
    glossaryContext: "",
    model: "test-model"
  });

  assert.equal(result.titleKo, "제1화 흑가");
  assert.equal(result.bodyKo, "흑가는 걸었다.");
  assert.deepEqual(result.newGlossaryCandidates, ["黒架 => 흑가"]);
});

test("Codex CLI adapter parses translated title from JSON output", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-codex-json-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('codex 0.0.0-test'); process.exit(0); }",
      "if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using test'); process.exit(0); }",
      "const outputIndex = args.indexOf('--output-last-message');",
      "writeFileSync(args[outputIndex + 1], JSON.stringify({ titleKo: '제1화 흑가', bodyKo: '흑가는 걸었다.', newGlossaryCandidates: ['黒架 => 흑가'] }), 'utf8');"
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeCodex, 0o755);

  const adapter = new CodexCliAdapter({
    command: fakeCodex,
    timeoutMs: 5000,
    sandbox: "read-only"
  });
  const result = await adapter.translateEpisode({
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話 黒架",
      sourceText: "黒架は歩いた。",
      body: "黒架は歩いた。",
      sourceHash: "hash",
      metadata: {}
    },
    glossaryEntries: [],
    glossaryContext: ""
  });

  assert.equal(result.titleKo, "제1화 흑가");
  assert.equal(result.bodyKo, "흑가는 걸었다.");
  assert.deepEqual(result.newGlossaryCandidates, ["黒架 => 흑가"]);
});

test("OpenAI-compatible adapter does not retry user cancellation", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.equal((init?.signal as AbortSignal | undefined)?.aborted, true);
    const error = new Error("aborted by test");
    error.name = "AbortError";
    throw error;
  };

  const adapter = new OpenAICompatibleAdapter({
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    temperature: 0.2,
    timeoutMs: 5000,
    maxRetries: 2,
    retryDelayMs: 0
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      adapter.translateEpisode({
        episode: {
          id: "episode_001",
          episodeNo: 1,
          title: "第1話",
          sourceText: "黒架は歩いた。",
          body: "黒架は歩いた。",
          sourceHash: "hash",
          metadata: {}
        },
        glossaryEntries: [],
        glossaryContext: "",
        model: "test-model",
        signal: controller.signal
      }),
    /aborted by test/
  );
  assert.equal(calls, 1);
});
