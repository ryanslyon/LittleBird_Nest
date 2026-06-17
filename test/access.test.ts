import { describe, it, expect } from "vitest";
import { parseAllowedChatIds, isChatAllowed, checkRate } from "../src/access";

describe("parseAllowedChatIds", () => {
  it("returns an empty set for unset/empty input", () => {
    expect(parseAllowedChatIds(undefined).size).toBe(0);
    expect(parseAllowedChatIds("").size).toBe(0);
  });

  it("parses comma-separated ids, trimming and ignoring junk", () => {
    const s = parseAllowedChatIds(" 123, 456 ,abc, 789 ");
    expect([...s].sort((a, b) => a - b)).toEqual([123, 456, 789]);
  });
});

describe("isChatAllowed", () => {
  it("allows everyone when the allowlist is empty", () => {
    expect(isChatAllowed(999, new Set())).toBe(true);
  });

  it("allows only listed chats when the allowlist is non-empty", () => {
    const allow = new Set([111]);
    expect(isChatAllowed(111, allow)).toBe(true);
    expect(isChatAllowed(222, allow)).toBe(false);
  });
});

describe("checkRate", () => {
  it("allows events under the limit and records them", () => {
    const r = checkRate([], 1000, 60_000, 3);
    expect(r.allowed).toBe(true);
    expect(r.history).toEqual([1000]);
  });

  it("blocks once the window is full", () => {
    const r = checkRate([100, 200, 300], 400, 60_000, 3);
    expect(r.allowed).toBe(false);
    expect(r.history).toEqual([100, 200, 300]); // unchanged on block
  });

  it("prunes timestamps outside the window so old activity doesn't count", () => {
    // two old (outside 60s) + one recent; max 3 -> allowed, old ones dropped
    const r = checkRate([1, 2, 70_000], 70_500, 60_000, 3);
    expect(r.allowed).toBe(true);
    expect(r.history).toEqual([70_000, 70_500]);
  });
});
