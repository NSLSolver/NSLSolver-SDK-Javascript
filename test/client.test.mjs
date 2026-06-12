// Mock-fetch test suite — guards per-target request bodies, response parsing,
// and error mapping. Runs against the compiled dist via Node's built-in runner:
//   npm test   (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NSLSolver,
  AuthenticationError,
  InsufficientBalanceError,
  RateLimitError,
  SolveError,
} from "../dist/index.js";

/** Install a fake global fetch that records the request and returns `body`. */
function mockFetch(body, { status = 200, headers = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, json: init.body ? JSON.parse(init.body) : undefined });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    };
  };
  return calls;
}

const client = () => new NSLSolver("nsl_test", { maxRetries: 0 });

test("solveTurnstile sends the turnstile discriminator and parses token", async () => {
  const calls = mockFetch({ success: true, token: "tok", type: "turnstile", cost: 0 });
  const res = await client().solveTurnstile({ siteKey: "sk", url: "https://e.com" });
  assert.equal(calls[0].json.type, "turnstile");
  assert.equal(calls[0].json.site_key, "sk");
  assert.equal(res.token, "tok");
});

test("solveAkamai sends akamai body and returns cookies", async () => {
  const calls = mockFetch({ success: true, cookies: { _abck: "abck" }, type: "akamai" });
  const res = await client().solveAkamai({
    url: "https://e.com",
    userAgent: "UA",
    proxy: "http://p",
  });
  assert.equal(calls[0].json.type, "akamai");
  assert.equal(calls[0].json.user_agent, "UA");
  assert.equal(res.cookies._abck, "abck");
});

test("solveRecaptchaV3 sends required fields and omits optionals when unset", async () => {
  const calls = mockFetch({ success: true, token: "rtok", type: "recaptchav3" });
  await client().solveRecaptchaV3({ siteKey: "sk", url: "https://e.com", proxy: "http://p" });
  const sent = calls[0].json;
  assert.equal(sent.type, "recaptchav3");
  assert.equal(sent.site_key, "sk");
  assert.equal(sent.proxy, "http://p");
  assert.ok(!("action" in sent), "action omitted when unset");
  assert.ok(!("enterprise" in sent), "enterprise omitted when false/unset");
  assert.ok(!("user_agent" in sent), "user_agent omitted when unset");
});

test("solveRecaptchaV3 includes action/enterprise/userAgent when provided", async () => {
  const calls = mockFetch({ success: true, token: "rtok", type: "recaptchav3" });
  await client().solveRecaptchaV3({
    siteKey: "sk",
    url: "https://e.com",
    proxy: "http://p",
    action: "login",
    enterprise: true,
    userAgent: "UA",
  });
  const sent = calls[0].json;
  assert.equal(sent.action, "login");
  assert.strictEqual(sent.enterprise, true); // real JSON boolean
  assert.equal(sent.user_agent, "UA");
});

test("solveRecaptchaV3 accepts the hyphenated recaptcha-v3 response type", async () => {
  mockFetch({ success: true, token: "rtok", type: "recaptcha-v3", cost: 0.002 });
  const res = await client().solveRecaptchaV3({
    siteKey: "sk",
    url: "https://e.com",
    proxy: "http://p",
  });
  assert.equal(res.token, "rtok");
  assert.equal(res.type, "recaptcha-v3");
  assert.equal(res.cost, 0.002);
});

test("error status codes map to the typed exceptions", async () => {
  const cases = [
    [401, AuthenticationError],
    [402, InsufficientBalanceError],
    [400, SolveError],
  ];
  for (const [status, Type] of cases) {
    mockFetch({ success: false, error: "boom" }, { status });
    await assert.rejects(
      () => client().solveTurnstile({ siteKey: "sk", url: "https://e.com" }),
      Type,
    );
  }
});

test("429 is retried then throws RateLimitError when retries exhausted", async () => {
  mockFetch({ success: false, error: "rate limited" }, { status: 429 });
  await assert.rejects(
    () => client().solveTurnstile({ siteKey: "sk", url: "https://e.com" }),
    RateLimitError,
  );
});
