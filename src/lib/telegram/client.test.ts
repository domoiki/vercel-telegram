import { describe, expect, it } from "vitest";

import { splitMessage } from "./client";

const TELEGRAM_LIMIT = 4096;

describe("splitMessage", () => {
  it("returns short text as a single message", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
    expect(splitMessage("  padded  ")).toEqual(["padded"]);
  });

  it("returns an empty string as one empty chunk rather than nothing", () => {
    expect(splitMessage("")).toEqual([""]);
  });

  it("leaves text exactly at the limit intact", () => {
    const exact = "a".repeat(TELEGRAM_LIMIT);
    expect(splitMessage(exact)).toEqual([exact]);
  });

  it("never emits a chunk Telegram would reject", () => {
    const text = Array.from({ length: 200 }, (_, i) => `Paragraph number ${i}.`).join("\n\n");
    for (const chunk of splitMessage(text)) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    }
  });

  it("preserves every word when splitting a long single paragraph", () => {
    const words = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const chunks = splitMessage(words);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(chunks.join(" ")).toBe(words);
  });

  it("hard-wraps a single unbreakable block of text", () => {
    const blob = "x".repeat(TELEGRAM_LIMIT * 2 + 50);
    const chunks = splitMessage(blob);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toHaveLength(blob.length);
  });

  it("prefers paragraph breaks over mid-sentence cuts", () => {
    const para = "a".repeat(2000);
    const text = `${para}\n\n${para}\n\n${para}`;
    const chunks = splitMessage(text);
    // Two paragraphs fit in one chunk; the third starts a new one.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${para}\n\n${para}`);
  });

  it("never returns an empty chunk", () => {
    const text = `${"a".repeat(5000)}\n\n\n\n${"b".repeat(10)}`;
    for (const chunk of splitMessage(text)) expect(chunk.length).toBeGreaterThan(0);
  });
});
