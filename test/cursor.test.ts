import { describe, it, expect } from "vitest";
import { pickLargestPhoto, newEvents, maxCursor } from "../src/cursor";
import type { SessionEvent } from "../src/anthropic";
import type { TgMessage } from "../src/telegram";

const ev = (id: string, type: string, processed_at: string | null): SessionEvent => ({ id, type, processed_at });

describe("pickLargestPhoto", () => {
  it("returns null when there is no photo", () => {
    expect(pickLargestPhoto({ message_id: 1, chat: { id: 1 } } as TgMessage)).toBeNull();
    expect(pickLargestPhoto({ message_id: 1, chat: { id: 1 }, photo: [] } as TgMessage)).toBeNull();
  });

  it("picks the largest photo by pixel area", () => {
    const msg = {
      message_id: 1,
      chat: { id: 1 },
      photo: [
        { file_id: "small", file_unique_id: "a", width: 90, height: 90 },
        { file_id: "big", file_unique_id: "b", width: 1280, height: 960 },
        { file_id: "mid", file_unique_id: "c", width: 320, height: 320 },
      ],
    } as TgMessage;
    expect(pickLargestPhoto(msg)?.fileId).toBe("big");
  });
});

describe("newEvents", () => {
  const events: SessionEvent[] = [
    ev("e1", "session.status_running", "2026-06-17T00:00:01.000Z"),
    ev("e2", "agent.message", "2026-06-17T00:00:02.000Z"),
    ev("e3", "user.message", null), // queued, not yet processed
    ev("e4", "agent.message", "2026-06-17T00:00:03.000Z"),
  ];

  it("returns all processed events (ascending) from an empty watermark, skipping null processed_at", () => {
    const fresh = newEvents(events, "", []);
    expect(fresh.map((e) => e.id)).toEqual(["e1", "e2", "e4"]);
  });

  it("excludes events at or before the cursor timestamp", () => {
    const fresh = newEvents(events, "2026-06-17T00:00:02.000Z", ["e2"]);
    expect(fresh.map((e) => e.id)).toEqual(["e4"]);
  });

  it("dedupes by id at the exact cursor timestamp boundary", () => {
    const sameTs: SessionEvent[] = [
      ev("a", "agent.message", "2026-06-17T00:00:05.000Z"),
      ev("b", "agent.message", "2026-06-17T00:00:05.000Z"),
    ];
    // 'a' already handled at this ts; only 'b' is fresh.
    expect(newEvents(sameTs, "2026-06-17T00:00:05.000Z", ["a"]).map((e) => e.id)).toEqual(["b"]);
  });

  it("sorts by timestamp then id for stable ordering", () => {
    const unordered: SessionEvent[] = [
      ev("z", "agent.message", "2026-06-17T00:00:09.000Z"),
      ev("y", "agent.message", "2026-06-17T00:00:08.000Z"),
      ev("x", "agent.message", "2026-06-17T00:00:09.000Z"),
    ];
    expect(newEvents(unordered, "", []).map((e) => e.id)).toEqual(["y", "x", "z"]);
  });
});

describe("maxCursor", () => {
  it("advances to the max processed_at and lists ids at that timestamp", () => {
    const events: SessionEvent[] = [
      ev("e1", "x", "2026-06-17T00:00:01.000Z"),
      ev("e2", "x", "2026-06-17T00:00:03.000Z"),
      ev("e3", "x", "2026-06-17T00:00:03.000Z"),
      ev("e4", "x", null),
    ];
    const { ts, ids } = maxCursor(events, "");
    expect(ts).toBe("2026-06-17T00:00:03.000Z");
    expect(ids.sort()).toEqual(["e2", "e3"]);
  });

  it("is monotonic: never moves backwards from the previous watermark", () => {
    const events: SessionEvent[] = [ev("e1", "x", "2026-06-17T00:00:01.000Z")];
    const { ts } = maxCursor(events, "2026-06-17T00:00:09.000Z");
    expect(ts).toBe("2026-06-17T00:00:09.000Z");
  });

  it("keeps the previous watermark when there are no processed events", () => {
    const { ts, ids } = maxCursor([ev("e1", "x", null)], "");
    expect(ts).toBe("");
    expect(ids).toEqual([]);
  });
});
