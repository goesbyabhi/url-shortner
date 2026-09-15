import { describe, expect, it } from "vitest";
import { validateAlias, validateExpiresInSeconds, validateUrl } from "./validate.js";

describe("validateUrl", () => {
  it("accepts http and https urls", () => {
    const r = validateUrl("https://example.com/some/path?q=1");
    expect(r).toMatchObject({ ok: true, url: "https://example.com/some/path?q=1" });
    expect(validateUrl("http://example.com")).toMatchObject({ ok: true });
  });

  it("prepends https:// to scheme-less input", () => {
    const r = validateUrl("example.com/products");
    expect(r).toEqual({ ok: true, url: "https://example.com/products" });
  });

  it("rejects junk, other protocols, empty and oversized input", () => {
    expect(validateUrl("").ok).toBe(false);
    expect(validateUrl(123).ok).toBe(false);
    expect(validateUrl("ftp://example.com").ok).toBe(false);
    expect(validateUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateUrl("https://").ok).toBe(false);
    expect(validateUrl("https://" + "a".repeat(3000)).ok).toBe(false);
    expect(validateUrl("not a url at all !@#").ok).toBe(false);
  });
});

describe("validateAlias", () => {
  it("accepts valid aliases", () => {
    expect(validateAlias("my-page")).toEqual({ ok: true, alias: "my-page" });
    expect(validateAlias("abc_123")).toEqual({ ok: true, alias: "abc_123" });
  });

  it("rejects short, invalid, and reserved aliases", () => {
    expect(validateAlias("ab").ok).toBe(false);
    expect(validateAlias("has space!").ok).toBe(false);
    expect(validateAlias("api-docs").ok).toBe(false);
    expect(validateAlias("health").ok).toBe(false);
    expect(validateAlias(42).ok).toBe(false);
  });
});

describe("validateExpiresInSeconds", () => {
  it("accepts integers in range", () => {
    expect(validateExpiresInSeconds(1)).toEqual({ ok: true, seconds: 1 });
    expect(validateExpiresInSeconds(3600)).toEqual({ ok: true, seconds: 3600 });
  });

  it("rejects out-of-range and non-integer values", () => {
    expect(validateExpiresInSeconds(0).ok).toBe(false);
    expect(validateExpiresInSeconds(-5).ok).toBe(false);
    expect(validateExpiresInSeconds(1.5).ok).toBe(false);
    expect(validateExpiresInSeconds("soon").ok).toBe(false);
  });
});
