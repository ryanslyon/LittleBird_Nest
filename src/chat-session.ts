import { ManagedAgents, type SessionEvent, isTerminalIdle } from "./anthropic";
import { Telegram, type TgUpdate, type TgMessage } from "./telegram";
import type { Env } from "./index";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 240; // ~8 minutes ceiling per turn
const IMAGE_MOUNT_DIR = "/mnt/inputs";

interface Persisted {
  sessionId?: string;
  chatId?: number;
  cursorTs: string; // max processed_at handled so far (monotonic)
  recentIds: string[]; // event ids observed exactly at cursorTs
  active: boolean; // is an alarm/poll loop running for this chat
  polls: number; // polls since this turn started
  sentThisTurn: boolean;
}

const DEFAULT_STATE: Persisted = {
  cursorTs: "",
  recentIds: [],
  active: false,
  polls: 0,
  sentThisTurn: false,
};

/**
 * One instance per Telegram chat. Owns a long-lived Managed Agent session
 * (conversation memory) and drives each turn with DO alarms so the Telegram
 * webhook can be acked instantly while the agent researches in the background.
 */
export class ChatSession {
  private tg: Telegram;
  private ma: ManagedAgents;

  constructor(private state: DurableObjectState, private env: Env) {
    this.tg = new Telegram(env.TELEGRAM_BOT_TOKEN);
    this.ma = new ManagedAgents(env.ANTHROPIC_API_KEY);
  }

  private async load(): Promise<Persisted> {
    const stored = await this.state.storage.get<Persisted>("state");
    return { ...DEFAULT_STATE, ...(stored ?? {}) };
  }
  private async save(s: Persisted): Promise<void> {
    await this.state.storage.put("state", s);
  }

  // Worker forwards the parsed Telegram update here.
  async fetch(request: Request): Promise<Response> {
    const update = (await request.json()) as TgUpdate;
    const msg = update.message ?? update.edited_message;
    if (!msg) return new Response("ignored", { status: 200 });
    try {
      await this.handleMessage(msg);
    } catch (err) {
      console.error("handleMessage error", err);
      try {
        await this.tg.sendMessage(msg.chat.id, "🌿 Something went wrong on my end. Please try again.");
      } catch {}
    }
    return new Response("ok", { status: 200 });
  }

  private async handleMessage(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    const text = (msg.text ?? msg.caption ?? "").trim();

    // /start and /help — quick local replies, no agent round-trip.
    if (text === "/start" || text === "/help") {
      await this.tg.sendMessage(
        chatId,
        "🌿 Hi, I'm NatureBuddy — a nature expert.\n\n" +
          "Ask me about plants, animals, fungi, birds, geology, ecology, or anything in the natural world. " +
          "I can also identify a photo — just send me a picture (with an optional question as the caption).\n\n" +
          "I research carefully, so detailed answers can take a little while. 🦋",
      );
      return;
    }

    await this.tg.sendChatAction(chatId, "typing");

    const sessionId = await this.ensureSession(chatId, msg);

    // Build the message the agent receives. Image (if any) is mounted into the
    // container and referenced by path; the agent reads it with its `read` tool.
    let userText = text;
    const photo = pickLargestPhoto(msg);
    if (photo) {
      const mountPath = await this.ingestImage(sessionId, photo.fileId);
      const note = `[The user sent an image. It is saved in the container at ${mountPath}. Use your \`read\` tool to view the image, then answer.]`;
      userText = text ? `${note}\n\nUser's message: ${text}` : `${note}\n\nIdentify what's in this image and tell me about it.`;
    }

    if (!userText) return; // nothing actionable (e.g. a sticker)

    const state = await this.load();

    // If no run is currently active, baseline the cursor to "now" so we don't
    // replay agent messages from earlier turns.
    if (!state.active) {
      const events = await this.ma.listEvents(sessionId);
      const { ts, ids } = maxCursor(events, state.cursorTs);
      state.cursorTs = ts;
      state.recentIds = ids;
      state.sentThisTurn = false;
    }
    state.polls = 0; // (re)start the budget for this turn

    await this.ma.sendUserMessage(sessionId, userText);

    state.active = true;
    await this.save(state);
    await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
  }

  // Poll loop: runs on each alarm until the agent is idle/terminated.
  async alarm(): Promise<void> {
    const state = await this.load();
    if (!state.active || !state.sessionId || state.chatId == null) return;
    const { sessionId, chatId } = { sessionId: state.sessionId, chatId: state.chatId };

    state.polls += 1;

    let events: SessionEvent[];
    try {
      events = await this.ma.listEvents(sessionId);
    } catch (err) {
      console.error("listEvents failed", err);
      if (state.polls < MAX_POLLS) {
        await this.save(state);
        await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
      } else {
        await this.finish(state, chatId, "🌿 I lost connection while researching. Please ask again.");
      }
      return;
    }

    const fresh = newEvents(events, state.cursorTs, state.recentIds);
    let terminal = false;
    for (const ev of fresh) {
      if (ev.type === "agent.message") {
        const out = (ev.content ?? [])
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text as string)
          .join("");
        if (out.trim()) {
          console.log(`agent.message -> chat ${chatId} (${out.length} chars)`);
          // A bad send (e.g. unknown chat) must not crash-loop the alarm.
          try {
            await this.tg.sendMessage(chatId, out);
          } catch (err) {
            console.error("sendMessage failed", err);
          }
          state.sentThisTurn = true;
        }
      } else if (ev.type === "session.error") {
        try {
          await this.tg.sendMessage(chatId, "🌿 The research run hit an error. Please try again.");
        } catch {}
      }
      if (isTerminalIdle(ev) || ev.type === "session.status_terminated") terminal = true;
    }

    // Advance the cursor past everything we've now observed.
    const { ts, ids } = maxCursor(events, state.cursorTs);
    state.cursorTs = ts;
    state.recentIds = ids;

    if (terminal) {
      await this.finish(state, chatId, state.sentThisTurn ? null : "🌿 I finished but had nothing to add.");
      return;
    }

    if (state.polls >= MAX_POLLS) {
      await this.finish(state, chatId, "🌿 That's taking longer than expected — let me stop here. Try a more specific question?");
      return;
    }

    await this.tg.sendChatAction(chatId, "typing");
    await this.save(state);
    await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
  }

  private async finish(state: Persisted, chatId: number, note: string | null): Promise<void> {
    if (note) {
      try {
        await this.tg.sendMessage(chatId, note);
      } catch {}
    }
    state.active = false;
    state.polls = 0;
    await this.save(state);
    await this.state.storage.deleteAlarm();
  }

  private async ensureSession(chatId: number, _msg: TgMessage): Promise<string> {
    const state = await this.load();
    if (state.sessionId) {
      // Reuse unless the session has terminated; if so, start fresh.
      try {
        const s = await this.ma.getSession(state.sessionId);
        if (s.status !== "terminated") return state.sessionId;
      } catch {
        // fall through and create a new one
      }
    }
    const session = await this.ma.createSession(
      this.env.AGENT_ID,
      this.env.ENVIRONMENT_ID,
      `Telegram chat ${chatId}`,
    );
    state.sessionId = session.id;
    state.chatId = chatId;
    state.cursorTs = "";
    state.recentIds = [];
    await this.save(state);
    return session.id;
  }

  private async ingestImage(sessionId: string, fileId: string): Promise<string> {
    const filePath = await this.tg.getFilePath(fileId);
    const bytes = await this.tg.downloadFile(filePath);
    const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const filename = `${fileId}.${ext === "png" || ext === "webp" ? ext : "jpg"}`;
    const uploadedId = await this.ma.uploadFile(bytes, filename, contentType);
    // The API prefixes the requested path; use the actual returned mount path.
    const actualPath = await this.ma.addFileResource(sessionId, uploadedId, `${IMAGE_MOUNT_DIR}/${filename}`);
    return actualPath;
  }
}

// --- helpers ------------------------------------------------------------

function pickLargestPhoto(msg: TgMessage): { fileId: string } | null {
  if (!msg.photo || msg.photo.length === 0) return null;
  const largest = msg.photo.reduce((a, b) => ((b.width ?? 0) * (b.height ?? 0) > (a.width ?? 0) * (a.height ?? 0) ? b : a));
  return { fileId: largest.file_id };
}

/** Events not yet handled, given a (cursorTs, recentIds) watermark. Ascending. */
function newEvents(events: SessionEvent[], cursorTs: string, recentIds: string[]): SessionEvent[] {
  const fresh = events.filter((e) => {
    if (!e.processed_at) return false;
    if (e.processed_at > cursorTs) return true;
    if (e.processed_at === cursorTs) return !recentIds.includes(e.id);
    return false;
  });
  fresh.sort((a, b) => (a.processed_at! < b.processed_at! ? -1 : a.processed_at! > b.processed_at! ? 1 : a.id < b.id ? -1 : 1));
  return fresh;
}

/** New watermark = max processed_at over all events (monotonic vs. prior). */
function maxCursor(events: SessionEvent[], prevTs: string): { ts: string; ids: string[] } {
  let ts = prevTs;
  for (const e of events) {
    if (e.processed_at && e.processed_at > ts) ts = e.processed_at;
  }
  const ids = events.filter((e) => e.processed_at === ts).map((e) => e.id);
  return { ts, ids };
}
