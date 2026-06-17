import { describe, it, expect } from "vitest";
import { isTerminalIdle, type SessionEvent } from "../src/anthropic";

describe("isTerminalIdle", () => {
  it("is true for an idle event with a terminal stop reason", () => {
    const e: SessionEvent = { id: "1", type: "session.status_idle", processed_at: "t", stop_reason: { type: "end_turn" } };
    expect(isTerminalIdle(e)).toBe(true);
  });

  it("is false while the session is waiting on the client (requires_action)", () => {
    const e: SessionEvent = { id: "1", type: "session.status_idle", processed_at: "t", stop_reason: { type: "requires_action" } };
    expect(isTerminalIdle(e)).toBe(false);
  });

  it("is false for non-idle event types", () => {
    expect(isTerminalIdle({ id: "1", type: "agent.message", processed_at: "t" })).toBe(false);
    expect(isTerminalIdle({ id: "1", type: "session.status_running", processed_at: "t" })).toBe(false);
  });
});
