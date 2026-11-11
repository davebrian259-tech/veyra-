import { EventEmitter } from "node:events";
import type { Db } from "../db.js";
import { json, now } from "../db.js";
import { randomId } from "../lib/crypto.js";

export interface Notification {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  data?: unknown;
  createdAt: string;
}

/** In-app notifications, persisted and pushed live over SSE. */
export class Notifier {
  private readonly bus = new EventEmitter();
  constructor(private readonly db: Db) {
    this.bus.setMaxListeners(1000);
  }

  notify(userId: string, kind: string, title: string, body: string, data?: unknown): Notification {
    const n: Notification = { id: randomId("ntf_"), userId, kind, title, body, data, createdAt: now() };
    this.db.run("INSERT INTO notifications (id, user_id, kind, title, body, data_json, created_at) VALUES (?,?,?,?,?,?,?)", [
      n.id, userId, kind, title, body, json(data), n.createdAt,
    ]);
    this.bus.emit(userId, n);
    return n;
  }

  /** Live events that are not persisted (status ticks). */
  emit(userId: string, kind: string, data: unknown) {
    this.bus.emit(userId, { id: randomId("evt_"), userId, kind, title: kind, body: "", data, createdAt: now(), ephemeral: true });
  }

  subscribe(userId: string, fn: (n: Notification) => void) {
    this.bus.on(userId, fn);
    return () => this.bus.off(userId, fn);
  }

  list(userId: string, unreadOnly = false) {
    return this.db
      .all<Record<string, unknown>>(
        `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? "AND read = 0" : ""} ORDER BY created_at DESC LIMIT 200`,
        [userId],
      )
      .map((r) => ({ ...r, data: r.data_json ? JSON.parse(r.data_json as string) : null, data_json: undefined }));
  }

  markRead(userId: string, ids: string[] | "all") {
    if (ids === "all") this.db.run("UPDATE notifications SET read = 1 WHERE user_id = ?", [userId]);
    else for (const id of ids) this.db.run("UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?", [userId, id]);
  }
}
