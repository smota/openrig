import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchResultRoot, readLaunchResult, type LaunchAttempt } from "./community-harness-launch-result.js";
import { loadCommunityHarnessPreset } from "./community-harness-presets.js";
import { isCommunityHarnessRuntime } from "./built-in-runtimes.js";
import type { SessionRegistry } from "./session-registry.js";
import { isShellForeground } from "./shell-classifier.js";

interface ChannelIdentity { sessionName: string; nodeId: string; generation: string }
interface ChannelRecord extends ChannelIdentity { attempt: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pointerName = "command-channel.json";

/** Prepare a fresh attempt without ever truncating an existing command stream. The pointer binds the launch record
 * to its occupant, so a daemon restart can recover the channel without guessing from file timestamps or tokens. */
export function createSeatCommandChannel(attempt: LaunchAttempt, identity: ChannelIdentity, root = launchResultRoot()): string {
  const dir = join(root, "commands");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${attempt.attempt}.jsonl`);
  closeSync(openSync(file, "wx", 0o600));
  const staging = join(attempt.dir, `${attempt.attempt}.command-channel.tmp`);
  writeFileSync(staging, JSON.stringify({ ...identity, attempt: attempt.attempt }), { flag: "wx", mode: 0o600 });
  renameSync(staging, join(attempt.dir, pointerName));
  return file;
}

export type SeatCommand = { type: "cancel" } | { type: "wake"; question: string; timeoutSeconds?: number };
export type SeatCommandResult =
  | { status: 202; body: { ok: true; id: string } }
  | { status: 200; body: { ok: true; id: string; answer: string; answeredAt: string } }
  | { status: 400 | 404 | 409 | 504; body: { error: string; detail?: string; id?: string } };
interface Seat { sessionId: string; sessionName: string; nodeId: string; runtime: string; communityHarness: string | null; status: string; boundSessionName: string | null }
interface PendingWake {
  registry: SessionRegistry; seat: Seat; generation: string; attempt: string;
  finish: (answer?: { answer: string; answeredAt: string }) => void;
}
// Shared by the seat and hook routes, never persisted. UUIDs keep concurrent requests independent.
const pendingWakes = new Map<string, PendingWake>();

export class SeatCommandService {
  constructor(private readonly registry: SessionRegistry, private readonly tmux?: {
    hasSession(session: string): Promise<boolean>;
    getPaneCommand(session: string): Promise<string | null>;
  }) {}

  private seat(sessionName: string): Seat | null {
    const seats = this.registry.db.prepare(`SELECT s.id AS sessionId, s.session_name AS sessionName, n.id AS nodeId,
      n.runtime, s.agent_app AS communityHarness, s.status, b.tmux_session AS boundSessionName FROM sessions s
      JOIN nodes n ON n.id=s.node_id JOIN rigs r ON r.id=n.rig_id
      LEFT JOIN bindings b ON b.node_id=n.id
      WHERE s.session_name=? AND r.archived_at IS NULL
      AND s.id=(SELECT id FROM sessions WHERE node_id=n.id ORDER BY id DESC LIMIT 1)`)
      .all(sessionName) as Seat[];
    return seats.length === 1 ? seats[0]! : null;
  }

  private channel(seat: Seat): { file: string; generation: string; attempt: string } | null {
    if (seat.boundSessionName !== seat.sessionName || !["running", "idle", "unknown"].includes(seat.status)) return null;
    try {
      const generation = this.registry.currentOccupantTenure(seat.nodeId)?.generationUuid;
      if (!generation) return null;
      const root = launchResultRoot();
      const dir = join(root, seat.sessionName.replace(/[^A-Za-z0-9@._-]/g, "_"));
      const pointer = join(dir, pointerName);
      if (!lstatSync(pointer).isFile() || lstatSync(pointer).size > 4096
        || realpathSync(pointer) !== join(realpathSync(root), seat.sessionName.replace(/[^A-Za-z0-9@._-]/g, "_"), pointerName)) return null;
      const record = JSON.parse(readFileSync(pointer, "utf8")) as ChannelRecord;
      if (record.nodeId !== seat.nodeId || record.sessionName !== seat.sessionName || record.generation !== generation
        || typeof record.attempt !== "string" || !UUID.test(record.attempt)) return null;
      if (!readLaunchResult({ attempt: record.attempt, dir, file: join(dir, `${record.attempt}.json`) }, seat.runtime, root).ok) return null;
      const file = join(root, "commands", `${record.attempt}.jsonl`);
      if (!lstatSync(file).isFile() || realpathSync(file) !== join(realpathSync(root), "commands", `${record.attempt}.jsonl`)) return null;
      return { file, generation, attempt: record.attempt };
    } catch { return null; }
  }

  async command(sessionName: string, input: unknown): Promise<SeatCommandResult> {
    const seat = this.seat(sessionName);
    if (!seat) return { status: 404, body: { error: "unknown_seat" } };
    const preset = isCommunityHarnessRuntime(seat.runtime) ? loadCommunityHarnessPreset(seat.runtime) : null;
    if (!preset?.ok || !preset.preset.commands) return { status: 409, body: { error: "no_command_channel", detail: "harness declares no command channel" } };
    if (!input || typeof input !== "object" || Array.isArray(input)) return { status: 400, body: { error: "invalid_command" } };
    const body = input as Record<string, unknown>;
    const timeoutSeconds = body.timeoutSeconds === undefined ? 60 : body.timeoutSeconds;
    if (body.type !== "cancel" && body.type !== "wake" || body.type === "wake" && (typeof body.question !== "string"
      || typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 300)) {
      return { status: 400, body: { error: "invalid_command" } };
    }
    if (!this.tmux || !await this.tmux.hasSession(sessionName)) return { status: 409, body: { error: "not_running" } };
    const foreground = await this.tmux.getPaneCommand(sessionName);
    // Re-read identity after the asynchronous process probes; renewal may have replaced this seat meanwhile.
    const current = this.seat(sessionName);
    const channel = current?.sessionId === seat.sessionId ? this.channel(current) : null;
    if (!channel || !foreground || isShellForeground(foreground)) return { status: 409, body: { error: "not_running" } };
    const id = randomUUID();
    const command = { type: body.type, id, at: new Date().toISOString(),
      ...(body.type === "wake" ? { question: body.question, timeoutSeconds } : {}) };
    let completion: Promise<SeatCommandResult> | undefined;
    if (body.type === "wake") {
      completion = new Promise(resolve => {
        const timer = setTimeout(() => finish(), (timeoutSeconds as number) * 1000);
        const finish = (answer?: { answer: string; answeredAt: string }) => {
          clearTimeout(timer); pendingWakes.delete(id);
          resolve(answer ? { status: 200, body: { ok: true, id, ...answer } } : { status: 504, body: { error: "wake_timeout", id } });
        };
        pendingWakes.set(id, { registry: this.registry, seat, generation: channel.generation, attempt: channel.attempt, finish });
      });
    }
    try {
      // O_APPEND without O_CREAT: losing the file cannot silently create a new, unread command channel.
      const fd = openSync(channel.file, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
      try {
        if (!fstatSync(fd).isFile()) throw new Error("Not a command file");
        writeFileSync(fd, JSON.stringify(command) + "\n");
      } finally { closeSync(fd); }
    } catch {
      pendingWakes.get(id)?.finish();
      return { status: 409, body: { error: "not_running" } };
    }
    return completion ?? { status: 202, body: { ok: true, id } };
  }

  resolveWakeAnswer(body: Record<string, unknown>): boolean {
    if (typeof body.id !== "string" || typeof body.answer !== "string" || typeof body.occurredAt !== "string"
      || !Number.isFinite(Date.parse(body.occurredAt))) return false;
    const pending = pendingWakes.get(body.id);
    if (!pending || pending.registry !== this.registry || body.sessionName !== pending.seat.sessionName
      || body.nodeId !== pending.seat.nodeId || body.generation !== pending.generation) return false;
    const seat = this.seat(pending.seat.sessionName);
    const channel = seat?.sessionId === pending.seat.sessionId ? this.channel(seat) : null;
    if (!channel || channel.generation !== pending.generation || channel.attempt !== pending.attempt) return false;
    pending.finish({ answer: body.answer, answeredAt: body.occurredAt });
    return true;
  }
}
