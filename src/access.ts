// Access control & rate limiting — pure helpers, unit-tested.

/** Parse a comma-separated allowlist of chat IDs into a Set. */
export function parseAllowedChatIds(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n)),
  );
}

/**
 * Is this chat allowed? An empty allowlist means "open to everyone" (so an
 * unset/empty ALLOWED_CHAT_IDS doesn't accidentally lock everyone out).
 */
export function isChatAllowed(chatId: number, allow: Set<number>): boolean {
  return allow.size === 0 || allow.has(chatId);
}

/**
 * Sliding-window rate limit. Given prior event timestamps (ms), returns whether
 * this event is allowed and the pruned history to persist.
 */
export function checkRate(
  history: number[],
  now: number,
  windowMs: number,
  max: number,
): { allowed: boolean; history: number[] } {
  const recent = history.filter((t) => now - t < windowMs);
  if (recent.length >= max) return { allowed: false, history: recent };
  recent.push(now);
  return { allowed: true, history: recent };
}
