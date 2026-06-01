import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveOpenAICompatibleApiKey, loadOpenAICompatibleApiKey, clearOpenAICompatibleApiKey, getCredentialPath } from "../config/credentialStore.js";
import { getConfigPath, loadConfig } from "../config/configStore.js";
import { defaultConfig } from "../config/defaultConfig.js";
import { cycleActiveBackendModel } from "../ui/actions/settingsActions.js";
import { createProjectAdapter } from "../ui/actions/translationJobActions.js";
import { createProjectFromText } from "../engine/projectWorkflow.js";
import { loadProjectMetadata } from "../storage/projectStore.js";
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

test("credential loading treats corrupted local stores as unavailable", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "noveltrans-bad-credentials-"));
  await writeFile(getCredentialPath(configDir), "{not-json", "utf8");
  assert.equal(loadOpenAICompatibleApiKey(configDir), undefined);

  await saveOpenAICompatibleApiKey("sk-recovered", configDir);
  assert.equal(loadOpenAICompatibleApiKey(configDir), "sk-recovered");
});

test("config loading falls back safely for malformed nested values", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "noveltrans-bad-config-"));
  await writeFile(
    getConfigPath(configDir),
    JSON.stringify({
      defaultBackend: "not-a-backend",
      outputFormats: "epub",
      concurrency: "bad",
      qa: null,
      epub: "bad",
      openAICompatible: null,
      codexCli: null,
      logLevel: "verbose"
    }),
    "utf8"
  );

  const config = await loadConfig(configDir);
  assert.equal(config.defaultBackend, defaultConfig.defaultBackend);
  assert.deepEqual(config.outputFormats, defaultConfig.outputFormats);
  assert.equal(config.concurrency, defaultConfig.concurrency);
  assert.deepEqual(config.qa, defaultConfig.qa);
  assert.deepEqual(config.epub, defaultConfig.epub);
  assert.equal(config.openAICompatible.baseUrl, defaultConfig.openAICompatible.baseUrl);
  assert.equal(config.codexCli.command, defaultConfig.codexCli.command);
  assert.equal(config.logLevel, defaultConfig.logLevel);
});

test("active backend model cycling updates Codex model for Codex backend", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "noveltrans-codex-model-config-"));
  const next = await cycleActiveBackendModel(
    {
      ...defaultConfig,
      defaultBackend: "codex-cli",
      defaultModel: "old-default-model",
      codexCli: { ...defaultConfig.codexCli, model: "old-codex-model" }
    },
    configDir
  );

  assert.equal(next.defaultModel, next.codexCli.model);
  assert.notEqual(next.codexCli.model, "old-codex-model");
  const persisted = await loadConfig(configDir);
  assert.equal(persisted.codexCli.model, next.codexCli.model);
  assert.equal(persisted.defaultModel, next.codexCli.model);
});

test("v2 job adapter clears legacy OpenAI default model pins from Codex projects", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-codex-legacy-model-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 旧設定", "黒架は歩いた。"].join("\n"),
    sourceLabel: "inline://legacy-model-test",
    projectRoot: join(root, "projects"),
    name: "Legacy Codex Pin",
    backend: "codex-cli",
    model: "openai-default-model",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  await createProjectAdapter(created.metadata.projectDir, {
    config: {
      ...defaultConfig,
      defaultBackend: "codex-cli",
      defaultModel: "openai-default-model",
      openAICompatible: { ...defaultConfig.openAICompatible, model: "openai-default-model" },
      codexCli: { ...defaultConfig.codexCli, model: "codex-runtime-model" }
    }
  });

  const metadata = await loadProjectMetadata(created.metadata.projectDir);
  assert.equal(metadata.options.backend, "codex-cli");
  assert.equal(metadata.options.model, undefined);
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
      "writeFileSync(args[outputIndex + 1], JSON.stringify({ titleKo: '제1화', bodyKo: '테스트 번역문입니다. 12', newGlossaryCandidates: [] }), 'utf8');"
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

test("Codex CLI adapter isolates translation exec from workspace-write config and ambient env", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-codex-isolation-"));
  const fakeCodex = join(root, "fake-codex.mjs");
  const workspaceSecret = join(root, "workspace-secret.txt");
  const workspaceMarker = join(root, "workspace-marker.txt");
  const originalSecretPath = process.env.NOVELTRANS_SECRET_PATH;
  const originalMarkerPath = process.env.NOVELTRANS_MARKER_PATH;
  context.after(() => {
    if (originalSecretPath === undefined) {
      delete process.env.NOVELTRANS_SECRET_PATH;
    } else {
      process.env.NOVELTRANS_SECRET_PATH = originalSecretPath;
    }
    if (originalMarkerPath === undefined) {
      delete process.env.NOVELTRANS_MARKER_PATH;
    } else {
      process.env.NOVELTRANS_MARKER_PATH = originalMarkerPath;
    }
  });
  process.env.NOVELTRANS_SECRET_PATH = workspaceSecret;
  process.env.NOVELTRANS_MARKER_PATH = workspaceMarker;
  await writeFile(workspaceSecret, "workspace secret", "utf8");
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('codex 0.0.0-test'); process.exit(0); }",
      "if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using test'); process.exit(0); }",
      "const sandboxIndex = args.indexOf('--sandbox');",
      "const outputIndex = args.indexOf('--output-last-message');",
      "if (args.indexOf('exec') < 0 || sandboxIndex < 0 || outputIndex < 0) process.exit(2);",
      "const report = {",
      "  sandboxValue: args[sandboxIndex + 1],",
      "  cwd: process.cwd(),",
      "  envKeys: Object.keys(process.env).sort(),",
      "  secretPathVisible: Boolean(process.env.NOVELTRANS_SECRET_PATH),",
      "  markerPathVisible: Boolean(process.env.NOVELTRANS_MARKER_PATH),",
      "  secretRead: false,",
      "  markerWritten: false",
      "};",
      "try { if (process.env.NOVELTRANS_SECRET_PATH) { readFileSync(process.env.NOVELTRANS_SECRET_PATH, 'utf8'); report.secretRead = true; } } catch {}",
      "try { if (process.env.NOVELTRANS_MARKER_PATH) { writeFileSync(process.env.NOVELTRANS_MARKER_PATH, 'written by fake codex', 'utf8'); report.markerWritten = true; } } catch {}",
      "writeFileSync(args[outputIndex + 1], JSON.stringify({ titleKo: '격리', bodyKo: JSON.stringify(report), newGlossaryCandidates: [] }), 'utf8');"
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeCodex, 0o755);

  const adapter = new CodexCliAdapter({
    command: fakeCodex,
    timeoutMs: 5000,
    sandbox: "workspace-write"
  });
  const result = await adapter.translateEpisode({
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話",
      sourceText: "黒架は指示を読んだ。",
      body: "黒架は指示を読んだ。",
      sourceHash: "hash",
      metadata: {}
    },
    glossaryEntries: [],
    glossaryContext: ""
  });
  const report = JSON.parse(result.bodyKo) as {
    sandboxValue: string;
    cwd: string;
    envKeys: string[];
    secretPathVisible: boolean;
    markerPathVisible: boolean;
    secretRead: boolean;
    markerWritten: boolean;
  };

  assert.equal(report.sandboxValue, "read-only");
  assert.match(report.cwd, /noveltrans-codex-/);
  assert.equal(report.secretPathVisible, false);
  assert.equal(report.markerPathVisible, false);
  assert.equal(report.envKeys.includes("NOVELTRANS_SECRET_PATH"), false);
  assert.equal(report.envKeys.includes("NOVELTRANS_MARKER_PATH"), false);
  assert.equal(report.secretRead, false);
  assert.equal(report.markerWritten, false);
  await assert.rejects(() => access(workspaceMarker));
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
      "writeFileSync(args[outputIndex + 1], JSON.stringify({ titleKo: '제1화', bodyKo: '팩토리 번역문입니다.', newGlossaryCandidates: [] }), 'utf8');"
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
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ titleKo: "제1화", bodyKo: "재시도 성공 번역문", newGlossaryCandidates: [] }) } }] }), {
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

test("OpenAI-compatible adapter rejects cleartext base URLs before sending tokens", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("should not be called", { status: 500 });
  };

  const adapter = new OpenAICompatibleAdapter({
    apiKey: "sk-test",
    baseUrl: "http://example.test/v1",
    model: "test-model",
    temperature: 0.2,
    timeoutMs: 5000
  });

  const status = await adapter.checkAvailability();
  assert.equal(status.available, false);
  assert.match(status.message, /https/);
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
        model: "test-model"
      }),
    /https/
  );
  assert.equal(calls, 0);
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

test("OpenAI-compatible adapter rejects malformed non-JSON translation content", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "번역은 다음과 같습니다: 흑가는 걸었다." } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  const adapter = new OpenAICompatibleAdapter({
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    temperature: 0.2,
    timeoutMs: 5000
  });

  await assert.rejects(
    () =>
      adapter.translateEpisode({
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
      }),
    /strict JSON/
  );
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

test("OpenAI-compatible adapter reports internal request timeouts distinctly", async (context) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
        const error = new Error("fetch aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };

  const adapter = new OpenAICompatibleAdapter({
    apiKey: "sk-test",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    temperature: 0.2,
    timeoutMs: 5,
    maxRetries: 0,
    retryDelayMs: 0
  });

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
        model: "test-model"
      }),
    (error: unknown) => error instanceof Error && error.name === "TimeoutError"
  );
  assert.equal(calls, 1);
});
