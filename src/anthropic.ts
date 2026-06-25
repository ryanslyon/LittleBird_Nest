// Minimal Anthropic Managed Agents REST client (fetch-based, Workers-compatible).
// Beta: managed-agents-2026-04-01. Files API: files-api-2025-04-14.
// Docs: https://platform.claude.com/docs/en/managed-agents/overview

const BASE = "https://api.anthropic.com";
const VERSION = "2023-06-01";
const MA_BETA = "managed-agents-2026-04-01";
const FILES_BETA = "files-api-2025-04-14";

export interface SessionEvent {
  id: string;
  type: string;
  processed_at: string | null;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: { type: string };
  // tolerate any other fields
  [k: string]: unknown;
}

export interface Session {
  id: string;
  status: "idle" | "running" | "rescheduling" | "terminated";
  [k: string]: unknown;
}

export class ManagedAgents {
  constructor(private apiKey: string) {}

  private headers(extraBeta?: string): Record<string, string> {
    const beta = extraBeta ? `${MA_BETA},${extraBeta}` : MA_BETA;
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": VERSION,
      "anthropic-beta": beta,
    };
  }

  private async json<T>(path: string, init: RequestInit, extraBeta?: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...this.headers(extraBeta), "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Anthropic ${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  // --- Sessions ---------------------------------------------------------

  createSession(agentId: string, environmentId: string, title?: string): Promise<Session> {
    return this.json<Session>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ agent: agentId, environment_id: environmentId, title }),
    });
  }

  getSession(sessionId: string): Promise<Session> {
    return this.json<Session>(`/v1/sessions/${sessionId}`, { method: "GET" });
  }

  sendUserMessage(sessionId: string, text: string): Promise<unknown> {
    return this.json(`/v1/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify({
        events: [{ type: "user.message", content: [{ type: "text", text }] }],
      }),
    });
  }

  /** Lists events for a session (single page, most recent first by default). */
  async listEvents(sessionId: string, limit = 1000): Promise<SessionEvent[]> {
    const data = await this.json<{ data: SessionEvent[] }>(
      `/v1/sessions/${sessionId}/events?limit=${limit}`,
      { method: "GET" },
    );
    return data.data ?? [];
  }

  /** Auto-approves pending agent tool-use events so MCP calls can proceed. */
  async confirmToolUse(sessionId: string, toolUseEventIds: string[]): Promise<void> {
    if (toolUseEventIds.length === 0) return;
    await this.json(`/v1/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify({
        events: toolUseEventIds.map((id) => ({
          type: "user.tool_confirmation",
          tool_use_event_id: id,
          confirmation: { type: "allow_session" },
        })),
      }),
    });
  }

  // --- Files & resources (image ingestion) -----------------------------

  /** Uploads bytes to the Files API and returns the file id. */
  async uploadFile(bytes: ArrayBuffer, filename: string, contentType: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    const res = await fetch(`${BASE}/v1/files`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": VERSION,
        "anthropic-beta": FILES_BETA,
      },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Files upload -> ${res.status}: ${text.slice(0, 500)}`);
    return (JSON.parse(text) as { id: string }).id;
  }

  /**
   * Mounts an uploaded file into the session container. Returns the ACTUAL
   * absolute mount path the API chose (it prefixes the requested path with
   * `/mnt/session/uploads/`), which is what we must hand to the agent.
   */
  async addFileResource(sessionId: string, fileId: string, mountPath: string): Promise<string> {
    const resp = await this.json<{ mount_path: string }>(`/v1/sessions/${sessionId}/resources`, {
      method: "POST",
      body: JSON.stringify({ type: "file", file_id: fileId, mount_path: mountPath }),
    });
    return resp.mount_path ?? mountPath;
  }
}

/** A stop_reason that means the agent is fully done with this turn. */
export function isTerminalIdle(ev: SessionEvent): boolean {
  if (ev.type !== "session.status_idle") return false;
  const t = ev.stop_reason?.type;
  // "requires_action" means it's waiting on us (we don't use custom tools here,
  // so it won't occur) — any other idle reason is terminal for the turn.
  return t !== "requires_action";
}
