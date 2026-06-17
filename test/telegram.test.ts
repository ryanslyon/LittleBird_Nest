import { describe, it, expect } from "vitest";
import { splitMessage } from "../src/telegram";

describe("splitMessage", () => {
  it("returns a single chunk when under the limit", () => {
    expect(splitMessage("hello world")).toEqual(["hello world"]);
  });

  it("splits long text into chunks that each respect the limit", () => {
    const text = Array.from({ length: 500 }, (_, i) => `sentence number ${i}.`).join(" ");
    const chunks = splitMessage(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });

  it("preserves all word content across the split", () => {
    const text = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const chunks = splitMessage(text, 50);
    const rejoined = chunks.join(" ").split(/\s+/).sort();
    expect(rejoined).toEqual(text.split(/\s+/).sort());
  });

  it("hard-cuts a single token longer than the limit", () => {
    const chunks = splitMessage("x".repeat(250), 100);
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });
});
