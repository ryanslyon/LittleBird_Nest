// Minimal Telegram Bot API client (fetch-based, runs on Cloudflare Workers).
// Docs: https://core.telegram.org/bots/api

const API = "https://api.telegram.org";
const TELEGRAM_MAX_MESSAGE = 4096;

export interface TgChat {
  id: number;
}

export interface TgPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TgLocation {
  latitude: number;
  longitude: number;
}

export interface TgVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  location?: TgLocation;
  voice?: TgVoice;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}

export class Telegram {
  constructor(private token: string) {}

  private async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
    }
    return json.result as T;
  }

  async sendChatAction(chatId: number, action = "typing"): Promise<void> {
    try {
      await this.call("sendChatAction", { chat_id: chatId, action });
    } catch {
      // chat actions are best-effort; never let them break the run
    }
  }

  /** Sends text, automatically splitting on Telegram's 4096-char limit. */
  async sendMessage(chatId: number, text: string): Promise<void> {
    const chunks = splitMessage(text.trim() || "…");
    for (const chunk of chunks) {
      await this.call("sendMessage", {
        chat_id: chatId,
        text: chunk,
        // No parse_mode: agent output is free-form Markdown-ish prose and strict
        // Telegram parsers reject unescaped characters. Plain text is safest.
        disable_web_page_preview: true,
      });
    }
  }

  /** Sends a photo by URL with an optional caption. */
  async sendPhoto(chatId: number, photoUrl: string, caption?: string): Promise<void> {
    await this.call("sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      ...(caption ? { caption } : {}),
    });
  }

  /** Resolves a file_id to a temporary download path. */
  async getFilePath(fileId: string): Promise<string> {
    const result = await this.call<{ file_path: string }>("getFile", { file_id: fileId });
    return result.file_path;
  }

  /** Downloads file bytes for a resolved file_path. */
  async downloadFile(filePath: string): Promise<ArrayBuffer> {
    const res = await fetch(`${API}/file/bot${this.token}/${filePath}`);
    if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
    return res.arrayBuffer();
  }
}

export function splitMessage(text: string, max = TELEGRAM_MAX_MESSAGE): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    // Prefer to break on a newline, then a space, then hard-cut.
    let cut = remaining.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\s+/, "");
  }
  if (remaining) out.push(remaining);
  return out;
}
