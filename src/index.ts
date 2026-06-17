import { ChatSession } from "./chat-session";
import { parseAllowedChatIds, isChatAllowed } from "./access";
import type { TgUpdate } from "./telegram";

export interface Env {
  // Secrets (wrangler secret put / .dev.vars)
  ANTHROPIC_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN: string;
  // Vars (wrangler.jsonc / filled by `npm run setup`)
  AGENT_ID: string;
  ENVIRONMENT_ID: string;
  ANTHROPIC_MODEL: string;
  // Comma-separated Telegram chat IDs allowed to use the bot. Empty = open to all.
  ALLOWED_CHAT_IDS: string;
  // Bindings
  CHAT_SESSION: DurableObjectNamespace;
}

export { ChatSession };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      const configured = Boolean(env.AGENT_ID && env.ENVIRONMENT_ID);
      return Response.json({
        ok: true,
        service: "nature-bot",
        configured,
        agent_id: env.AGENT_ID || null,
        environment_id: env.ENVIRONMENT_ID || null,
      });
    }

    if (url.pathname === "/telegram/webhook" && request.method === "POST") {
      // Verify the request really came from our webhook registration.
      const secret = request.headers.get("x-telegram-bot-api-secret-token");
      if (!env.TELEGRAM_SECRET_TOKEN || secret !== env.TELEGRAM_SECRET_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      if (!env.AGENT_ID || !env.ENVIRONMENT_ID) {
        return new Response("not configured: run `npm run setup`", { status: 503 });
      }

      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return new Response("bad request", { status: 400 });
      }

      const msg = update.message ?? update.edited_message;
      const chatId = msg?.chat?.id;
      if (chatId == null) return new Response("ok", { status: 200 });

      // Allowlist gate. Unauthorized chats are silently dropped (ack 200 so
      // Telegram doesn't retry) — no engagement, no agent spend.
      if (!isChatAllowed(chatId, parseAllowedChatIds(env.ALLOWED_CHAT_IDS))) {
        console.log(`blocked unauthorized chat ${chatId}`);
        return new Response("ok", { status: 200 });
      }

      // Route to the per-chat Durable Object. It acks fast and continues the
      // agent run in the background via alarms.
      const id = env.CHAT_SESSION.idFromName(String(chatId));
      const stub = env.CHAT_SESSION.get(id);
      return stub.fetch("https://do/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      });
    }

    return new Response("nature-bot: see /healthz", { status: 200 });
  },
};
