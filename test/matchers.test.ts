import { describe, expect, it } from "vitest";
import {
  extractHost,
  matchArg,
  matchHost,
  matchName,
  matchPath,
} from "../src/policy/matchers.js";

describe("matchName", () => {
  it("matches exact names", () => {
    expect(matchName("bash", "bash")).toBe(true);
    expect(matchName("bash", "fs.read")).toBe(false);
  });

  it("matches globs", () => {
    expect(matchName("fs.read", "fs.*")).toBe(true);
    expect(matchName("fs.read", "*")).toBe(true);
    expect(matchName("http.fetch", "fs.*")).toBe(false);
  });

  it("matches regexps and arrays", () => {
    expect(matchName("fs.read", /^fs\./)).toBe(true);
    expect(matchName("net.connect", ["fs.*", "net.*"])).toBe(true);
    expect(matchName("bash", ["fs.*", "net.*"])).toBe(false);
  });
});

describe("matchPath", () => {
  it("matches globs with normalization", () => {
    expect(matchPath("./src/index.ts", "src/**")).toBe(true);
    expect(matchPath("src/index.ts", "src/**")).toBe(true);
    expect(matchPath("/etc/passwd", "src/**")).toBe(false);
    expect(matchPath("src/a/b/c.ts", "src/**")).toBe(true);
  });

  it("handles dotfiles", () => {
    expect(matchPath(".env", "**")).toBe(true);
    expect(matchPath("./.env", ".env")).toBe(true);
  });

  it("strips trailing slashes", () => {
    expect(matchPath("src/", "src")).toBe(true);
  });
});

describe("extractHost / matchHost", () => {
  it("extracts hosts from full and bare URLs", () => {
    expect(extractHost("https://api.github.com/repos")).toBe("api.github.com");
    expect(extractHost("api.github.com/repos")).toBe("api.github.com");
    expect(extractHost("not a url at all")).toBeUndefined();
  });

  it("matches exact hosts and wildcards", () => {
    expect(matchHost("api.github.com", "api.github.com")).toBe(true);
    expect(matchHost("api.github.com", "*.github.com")).toBe(true);
    expect(matchHost("github.com", "*.github.com")).toBe(false); // apex not matched by *.
    expect(matchHost("evil.com", "*.github.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchHost("API.GitHub.com", "api.github.com")).toBe(true);
  });
});

describe("matchArg", () => {
  it("equals and oneOf", () => {
    expect(matchArg("x", { equals: "x" })).toBe(true);
    expect(matchArg({ a: 1 }, { equals: { a: 1 } })).toBe(true);
    expect(matchArg("b", { oneOf: ["a", "b"] })).toBe(true);
    expect(matchArg("c", { oneOf: ["a", "b"] })).toBe(false);
  });

  it("glob and host", () => {
    expect(matchArg("./src/x.ts", { glob: "src/**" })).toBe(true);
    expect(matchArg("https://evil.com", { host: "*.github.com" })).toBe(false);
    expect(matchArg("https://api.github.com", { host: "*.github.com" })).toBe(true);
  });

  it("regex, contains, exists", () => {
    expect(matchArg("abc123", { regex: /\d+/ })).toBe(true);
    expect(matchArg("hello world", { contains: "world" })).toBe(true);
    expect(matchArg(undefined, { exists: false })).toBe(true);
    expect(matchArg("x", { exists: true })).toBe(true);
  });

  it("custom predicate", () => {
    expect(matchArg(5, (v) => typeof v === "number" && v > 3)).toBe(true);
  });
});
