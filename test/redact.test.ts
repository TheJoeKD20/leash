import { describe, expect, it } from "vitest";
import { preview, sanitize, sanitizeArgs } from "../src/trace/redact.js";

describe("sanitize", () => {
  it("redacts sensitive keys at any depth", () => {
    const out = sanitizeArgs({
      url: "https://x.com",
      apiKey: "sk-123",
      nested: { password: "hunter2", note: "fine" },
      token: "t",
      access_key: "ak",
    });
    expect(out.url).toBe("https://x.com");
    expect(out.apiKey).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).note).toBe("fine");
    expect(out.token).toBe("[redacted]");
    expect(out.access_key).toBe("[redacted]");
  });

  it("truncates long strings", () => {
    const out = sanitize("x".repeat(1000), { maxStringLength: 10 }) as string;
    expect(out.startsWith("xxxxxxxxxx")).toBe(true);
    expect(out).toMatch(/\+990 chars/);
  });

  it("handles circular references", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const out = sanitize(a) as Record<string, unknown>;
    expect(out.self).toBe("[circular]");
  });

  it("redacts common agent credential keys", () => {
    const out = sanitizeArgs({
      bearer: "abc",
      jwt: "ey.x.y",
      passphrase: "p",
      pwd: "p2",
      "x-api-key": "k",
      Authorization: "Bearer z",
      refresh_token: "r",
      client_secret: "c",
      keep: "ok",
    });
    for (const k of [
      "bearer",
      "jwt",
      "passphrase",
      "pwd",
      "x-api-key",
      "Authorization",
      "refresh_token",
      "client_secret",
    ]) {
      expect(out[k]).toBe("[redacted]");
    }
    expect(out.keep).toBe("ok");
  });

  it("treats maxStringLength <= 0 as no truncation", () => {
    expect(sanitize("hello", { maxStringLength: 0 })).toBe("hello");
  });

  it("supports a custom predicate", () => {
    const out = sanitizeArgs(
      { keepThis: "x", dropThis: "y" },
      { redact: (key) => key === "dropThis" },
    );
    expect(out.keepThis).toBe("x");
    expect(out.dropThis).toBe("[redacted]");
  });

  it("does not mutate the input", () => {
    const input = { apiKey: "secret" };
    sanitizeArgs(input);
    expect(input.apiKey).toBe("secret");
  });
});

describe("preview", () => {
  it("collapses whitespace and truncates", () => {
    expect(preview({ a: 1 })).toBe('{"a":1}');
    expect(preview("a\n  b")).toBe("a b");
    expect(preview("y".repeat(50), 5)).toMatch(/^yyyyy…/);
  });
});
