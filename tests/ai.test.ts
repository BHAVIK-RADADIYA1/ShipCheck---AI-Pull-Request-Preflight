import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { test } from "node:test";

import {
  buildPromptDiff,
  readAiConfig,
  reviewWithAi,
  AI_ENV_VARS,
  MAX_AI_RISKS,
} from "../src/ai.js";
import type { AiConfig } from "../src/types.js";
import { FAKE_AWS_KEY } from "./fixtures/fake-credentials.js";
import { makeDiff } from "./helpers.js";

const KEY = "test-key-not-real";
const AWS_KEY = FAKE_AWS_KEY;

function configFor(baseUrl: string): AiConfig {
  return { baseUrl, apiKey: KEY, model: "test-model", maxDiffChars: 4000 };
}

interface Captured {
  path?: string;
  authorization?: string;
  body: unknown;
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, captured: Captured) => void,
): Promise<{ url: string; captured: Captured; close: () => Promise<void> }> {
  const captured: Captured = { body: null };
  const server = createServer((req, res) => {
    captured.path = req.url;
    captured.authorization = req.headers.authorization;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        captured.body = JSON.parse(text);
      } catch {
        captured.body = text;
      }
      handler(req, res, captured);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("test server did not bind");
  }

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    captured,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("readAiConfig disables AI when nothing is configured", () => {
  const result = readAiConfig({});
  assert.equal(result.config, null);
  assert.match(result.reason, new RegExp(AI_ENV_VARS.baseUrl));
});

test("readAiConfig names missing variables without exposing values", () => {
  const result = readAiConfig({
    [AI_ENV_VARS.baseUrl]: "https://example.invalid/v1",
    [AI_ENV_VARS.apiKey]: KEY,
  });

  assert.equal(result.config, null);
  assert.match(result.reason, new RegExp(AI_ENV_VARS.model));
  assert.doesNotMatch(result.reason, new RegExp(KEY));
});

test("readAiConfig rejects an invalid base URL", () => {
  const result = readAiConfig({
    [AI_ENV_VARS.baseUrl]: "not a url",
    [AI_ENV_VARS.model]: "m",
    [AI_ENV_VARS.apiKey]: KEY,
  });

  assert.equal(result.config, null);
  assert.match(result.reason, /not a valid URL/);
  assert.doesNotMatch(result.reason, new RegExp(KEY));
});

test("readAiConfig accepts a valid configuration", () => {
  const result = readAiConfig({
    [AI_ENV_VARS.baseUrl]: "https://example.invalid/v1/",
    [AI_ENV_VARS.model]: "test-model",
    [AI_ENV_VARS.apiKey]: KEY,
  });

  assert.ok(result.config);
  assert.equal(result.config.baseUrl, "https://example.invalid/v1");
  assert.equal(result.config.model, "test-model");
});

test("buildPromptDiff redacts credential-shaped lines", () => {
  const diff = makeDiff([
    { path: "src/config.ts", added: [`const key = "${AWS_KEY}";`, "const safe = 1;"] },
  ]);

  const prompt = buildPromptDiff(diff, 4000);
  assert.doesNotMatch(prompt, new RegExp(AWS_KEY));
  assert.match(prompt, /line redacted/);
  assert.match(prompt, /const safe = 1;/);
});

test("buildPromptDiff truncates large diffs", () => {
  const added = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index};`);
  const prompt = buildPromptDiff(makeDiff([{ path: "src/big.ts", added }]), 200);

  assert.ok(prompt.length < 400);
  assert.match(prompt, /diff truncated/);
});

test("reviewWithAi talks to a configured OpenAI-compatible server", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"summary":"Adds configuration.","risks":["Hard-coded value"]}',
            },
          },
        ],
      }),
    );
  });

  try {
    const diff = makeDiff([
      { path: "src/config.ts", added: [`const key = "${AWS_KEY}";`, "const safe = 1;"] },
    ]);
    const review = await reviewWithAi(diff, configFor(server.url));

    assert.equal(review.status, "completed");
    assert.equal(review.model, "test-model");
    assert.equal(review.summary, "Adds configuration.");
    assert.deepEqual(review.risks, ["Hard-coded value"]);
    assert.equal(server.captured.path, "/v1/chat/completions");
    assert.equal(server.captured.authorization, `Bearer ${KEY}`);
    assert.match(JSON.stringify(server.captured.body), /test-model/);
    assert.doesNotMatch(JSON.stringify(server.captured.body), new RegExp(AWS_KEY));
  } finally {
    await server.close();
  }
});

test("reviewWithAi reports an HTTP error without the key", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end('{"error":"boom"}');
  });

  try {
    const review = await reviewWithAi(
      makeDiff([{ path: "src/app.ts", added: ["const x = 1;"] }]),
      configFor(server.url),
    );

    assert.equal(review.status, "failed");
    assert.match(review.reason ?? "", /HTTP 500/);
    assert.doesNotMatch(JSON.stringify(review), new RegExp(KEY));
  } finally {
    await server.close();
  }
});

test("reviewWithAi reports invalid JSON responses", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("not json");
  });

  try {
    const review = await reviewWithAi(
      makeDiff([{ path: "src/app.ts", added: ["const x = 1;"] }]),
      configFor(server.url),
    );

    assert.equal(review.status, "failed");
    assert.match(review.reason ?? "", /not valid JSON/);
  } finally {
    await server.close();
  }
});

test("reviewWithAi caps accepted risks at the documented limit", async () => {
  const review = await reviewWithContent(
    JSON.stringify({
      summary: "Adds configuration.",
      risks: ["one", "two", "three", "four", "five"],
    }),
  );

  assert.equal(review.status, "completed");
  assert.equal(review.risks?.length, MAX_AI_RISKS);
  assert.deepEqual(review.risks, ["one", "two", "three"]);
});

test("reviewWithAi truncates an overlong summary", async () => {
  const review = await reviewWithContent(
    JSON.stringify({ summary: "a".repeat(2500), risks: [] }),
  );

  assert.equal(review.status, "completed");
  assert.equal(review.summary?.length, 2000);
});

test("reviewWithAi rejects malformed model output safely", async () => {
  const cases: Array<{ label: string; content: string; reason: RegExp; leaked?: string }> = [
    {
      label: "plain text",
      content: "Looks fine, ship it.",
      reason: /not valid JSON/,
      leaked: "Looks fine, ship it.",
    },
    { label: "array", content: "[]", reason: /not a JSON object/ },
    { label: "missing summary", content: '{"risks":["one"]}', reason: /missing a summary/ },
    { label: "numeric summary", content: '{"summary":1,"risks":[]}', reason: /missing a summary/ },
    {
      label: "invalid risks field",
      content: '{"summary":"ok","risks":"one"}',
      reason: /invalid risks field/,
    },
    {
      label: "non-string risk",
      content: '{"summary":"ok","risks":[1]}',
      reason: /non-string risk/,
    },
  ];

  for (const testCase of cases) {
    const review = await reviewWithContent(testCase.content);
    assert.equal(review.status, "failed", testCase.label);
    assert.match(review.reason ?? "", testCase.reason, testCase.label);
    if (testCase.leaked) {
      assert.equal(JSON.stringify(review).includes(testCase.leaked), false, testCase.label);
    }
  }
});

test("reviewWithAi reports a connection failure", async () => {
  const review = await reviewWithAi(
    makeDiff([{ path: "src/app.ts", added: ["const x = 1;"] }]),
    configFor("http://127.0.0.1:1"),
  );

  assert.equal(review.status, "failed");
  assert.doesNotMatch(JSON.stringify(review), new RegExp(KEY));
});
async function reviewWithContent(content: string) {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });

  try {
    return await reviewWithAi(
      makeDiff([{ path: "src/app.ts", added: ["const x = 1;"] }]),
      configFor(server.url),
    );
  } finally {
    await server.close();
  }
}
