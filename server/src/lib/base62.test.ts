import { describe, expect, it } from "vitest";
import { decode, encode, randomCode } from "./base62.js";

describe("base62 encode/decode", () => {
  it("encodes known values", () => {
    expect(encode(0n)).toBe("0");
    expect(encode(10n)).toBe("a");
    expect(encode(35n)).toBe("z");
    expect(encode(36n)).toBe("A");
    expect(encode(61n)).toBe("Z");
    expect(encode(62n)).toBe("10");
    expect(encode(3844n)).toBe("100"); // 62^2
  });

  it("roundtrips arbitrary values", () => {
    for (const n of [0n, 1n, 61n, 62n, 123456789n, 3_500_000_000_000n]) {
      expect(decode(encode(n))).toBe(n);
    }
  });

  it("rejects negative input and invalid characters", () => {
    expect(() => encode(-1n)).toThrow();
    expect(() => decode("abc$")).toThrow();
    expect(() => decode("")).toThrow();
  });
});

describe("randomCode", () => {
  it("generates codes of the requested length from the alphabet", () => {
    for (const len of [1, 5, 7, 12]) {
      const code = randomCode(len);
      expect(code).toMatch(/^[0-9a-zA-Z]+$/);
      expect(code.length).toBe(len);
    }
  });

  it("does not produce obviously sequential or repeated output", () => {
    const codes = new Set(Array.from({ length: 100 }, () => randomCode(7)));
    expect(codes.size).toBe(100);
  });
});
