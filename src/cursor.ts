// Pure helpers for the Durable Object's event-polling logic. Kept dependency-free
// (types only) so they can be unit-tested without the Workers runtime.

import type { SessionEvent } from "./anthropic";
import type { TgMessage } from "./telegram";

/** Largest photo in a Telegram message (by pixel area), or null. */
export function pickLargestPhoto(msg: TgMessage): { fileId: string } | null {
  if (!msg.photo || msg.photo.length === 0) return null;
  const largest = msg.photo.reduce((a, b) =>
    (b.width ?? 0) * (b.height ?? 0) > (a.width ?? 0) * (a.height ?? 0) ? b : a,
  );
  return { fileId: largest.file_id };
}

/**
 * Events not yet handled, given a (cursorTs, recentIds) watermark. Returns them
 * in ascending order. Events with a null `processed_at` are still queued and are
 * skipped until the harness processes them.
 */
export function newEvents(events: SessionEvent[], cursorTs: string, recentIds: string[]): SessionEvent[] {
  const fresh = events.filter((e) => {
    if (!e.processed_at) return false;
    if (e.processed_at > cursorTs) return true;
    if (e.processed_at === cursorTs) return !recentIds.includes(e.id);
    return false;
  });
  fresh.sort((a, b) =>
    a.processed_at! < b.processed_at! ? -1 : a.processed_at! > b.processed_at! ? 1 : a.id < b.id ? -1 : 1,
  );
  return fresh;
}

/** New watermark = max processed_at over all events (monotonic vs. prior). */
export function maxCursor(events: SessionEvent[], prevTs: string): { ts: string; ids: string[] } {
  let ts = prevTs;
  for (const e of events) {
    if (e.processed_at && e.processed_at > ts) ts = e.processed_at;
  }
  const ids = events.filter((e) => e.processed_at === ts).map((e) => e.id);
  return { ts, ids };
}
