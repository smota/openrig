import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFullTestDb, createTestApp } from "./helpers/test-app.js";
import { loadCommunityHarnessPreset } from "../src/domain/community-harness-presets.js";
import { CommunityHarnessRuntimeAdapter } from "../src/adapters/community-harness-runtime-adapter.js";
import type { NodeBinding } from "../src/domain/runtime-adapter.js";
import { createSeatCommandChannel, SeatCommandService } from "../src/domain/seat-command-service.js";
import { rmSync } from "node:fs";

const appendProbe = vi.hoisted(() => ({ action: undefined as undefined | ((record: Record<string, unknown>) => void) }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
    if (typeof args[0] === "number" && typeof args[1] === "string" && args[1].startsWith('{"type":')) {
      appendProbe.action?.(JSON.parse(args[1]));
    }
    return actual.writeFileSync(...args);
  } };
});

const base = "format: 1\nname: synth\ncommand: synth-launch\nmaintainer: Example\n";
let home: string;
let db: ReturnType<typeof createFullTestDb>;
let setup: ReturnType<typeof createTestApp>;
let channel: string;
let attempt: string;
let nodeId: string;
let generation: string;
let sessionId: string;
const sessionName = "worker@commands";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "openrig-command-test-"));
  vi.stubEnv("OPENRIG_HOME", home);
  mkdirSync(join(home, "community-harnesses"));
  db = createFullTestDb();
  setup = createTestApp(db, { activityHookToken: "fixture-token" });
});
afterEach(() => { appendProbe.action = undefined; vi.useRealTimers(); vi.unstubAllEnvs(); db.close(); rmSync(home, { recursive: true, force: true }); });
function preset(extra = "launch_result: true\nrunner: true\ncommands: true\n") {
  writeFileSync(join(home, "community-harnesses", "synth.yaml"), base + extra);
}
async function launch(enabled = true) {
  preset(`launch_result: true\nrunner: true\n${enabled ? "commands: true\n" : ""}`);
  const rig = setup.rigRepo.createRig("commands");
  const node = setup.rigRepo.addNode(rig.id, "worker", { runtime: "synth" });
  nodeId = node.id;
  const session = setup.sessionRegistry.registerSession(nodeId, sessionName);
  sessionId = session.id;
  setup.sessionRegistry.updateStatus(session.id, "running");
  setup.sessionRegistry.recordCommunityHarnessSelection(session.id, "synth", true);
  setup.sessionRegistry.updateBinding(nodeId, { attachmentType: "tmux", tmuxSession: sessionName });
  generation = setup.sessionRegistry.currentOccupantTenure(nodeId)!.generationUuid;
  const sendShellCommand = vi.fn(async (_session: string, command: string) => {
    const file = /OPENRIG_LAUNCH_RESULT='([^']+)'/.exec(command)![1]!;
    attempt = /OPENRIG_LAUNCH_ATTEMPT=([^ ]+)/.exec(command)![1]!;
    channel = join(home, "state", "launch-results", "commands", `${attempt}.jsonl`);
    if (enabled) {
      expect(command).toContain(`OPENRIG_COMMAND_PATH='${channel}'`);
      expect(readFileSync(channel, "utf8")).toBe("");
      expect(statSync(channel).mode & 0o777).toBe(0o600);
    } else expect(command).not.toContain("OPENRIG_COMMAND_PATH=");
    writeFileSync(file, JSON.stringify({ format: 1, attempt, harness: "synth", nativeRef: "conversation", producer: "fixture" }));
    return { ok: true as const };
  });
  const adapter = new CommunityHarnessRuntimeAdapter("synth", { tmux: { sendShellCommand, hasSession: async () => true, getPaneCommand: async () => "node" } });
  expect(await adapter.launchHarness({ nodeId, tmuxSession: sessionName, launchGeneration: generation } as NodeBinding, { name: sessionName })).toMatchObject({ ok: true });
  vi.mocked(setup.tmuxAdapter.hasSession).mockResolvedValue(true);
  setup.tmuxAdapter.getPaneCommand = vi.fn(async () => "node");
}
function post(body: unknown, name = sessionName) {
  return setup.app.request(`/api/seats/${encodeURIComponent(name)}/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function lines() { return readFileSync(channel, "utf8").trim().split("\n").filter(Boolean).map(s => JSON.parse(s)); }
function answer(id: string, overrides = {}) {
  return setup.app.request("/api/activity/hooks", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer fixture-token" }, body: JSON.stringify({ eventFamily: "wake_answer", id, answer: "awake", sessionName, nodeId, generation, occurredAt: new Date().toISOString(), ...overrides }) });
}
async function waitForLines(count: number) { await vi.waitFor(() => expect(lines()).toHaveLength(count)); return lines(); }

describe("community command declaration", () => {
  it.each([["", false], ["commands: false\n", false], ["launch_result: true\nrunner: true\ncommands: true\n", true]])("parses %s", (extra, expected) => {
    preset(extra as string);
    expect(loadCommunityHarnessPreset("synth")).toMatchObject({ ok: true, preset: { commands: expected } });
  });
  it("requires a runner", () => {
    preset("commands: true\n");
    expect(loadCommunityHarnessPreset("synth")).toMatchObject({ ok: false, message: expect.stringContaining("commands needs runner: true: only a runner reads OPENRIG_COMMAND_PATH") });
  });
  it.each(["yes", "1", "null", "[]"])("refuses nonboolean %s", value => {
    preset(`commands: ${value}\n`);
    expect(loadCommunityHarnessPreset("synth")).toMatchObject({ ok: false, message: expect.stringContaining("commands must be true or false") });
  });
});
describe("seat commands", () => {
  it("returns unknown_seat", async () => { const r = await post({ type: "cancel" }); expect(r.status).toBe(404); expect(await r.json()).toEqual({ error: "unknown_seat" }); });
  it("creates private launch channels and appends independent cancellation IDs", async () => {
    await launch();
    const a = await post({ type: "cancel" }); const b = await post({ type: "cancel" });
    expect(a.status).toBe(202); expect(b.status).toBe(202);
    const first = await a.json(); expect(first).toEqual({ ok: true, id: expect.any(String) });
    expect(lines()).toEqual([{ type: "cancel", id: first.id, at: expect.any(String) }, { type: "cancel", id: expect.any(String), at: expect.any(String) }]);
    expect(lines()[0].id).not.toBe(lines()[1].id);
  });
  it("never truncates a command stream when asked to prepare the same attempt again", async () => {
    await launch();
    await post({ type: "cancel" });
    const previous = readFileSync(channel, "utf8");
    expect(() => createSeatCommandChannel({ attempt, dir: join(home, "state", "launch-results", sessionName), file: "unused" }, { nodeId, sessionName, generation })).toThrow();
    expect(readFileSync(channel, "utf8")).toBe(previous);
  });
  it("recovers the current attempt through a fresh service instance", async () => {
    await launch();
    const service = new SeatCommandService(setup.sessionRegistry, setup.tmuxAdapter);
    expect((await service.command(sessionName, { type: "cancel" })).status).toBe(202);
    expect(lines()).toHaveLength(1);
  });
  it("refuses a retained pointer whose generation no longer occupies the seat", async () => {
    await launch();
    const successor = setup.sessionRegistry.registerSession(nodeId, sessionName, "fresh");
    setup.sessionRegistry.recordCommunityHarnessSelection(successor.id, "synth", true);
    setup.sessionRegistry.updateStatus(successor.id, "running");
    const r = await post({ type: "cancel" });
    expect(r.status).toBe(409); expect(await r.json()).toEqual({ error: "not_running" });
    expect(lines()).toEqual([]);
  });
  it("opt-out has no channel", async () => { await launch(false); expect(existsSync(channel)).toBe(false); const r = await post({ type: "cancel" }); expect(r.status).toBe(409); expect(await r.json()).toEqual({ error: "no_command_channel", detail: "harness declares no command channel" }); });
  it("built-ins have no channel", async () => { await launch(false); db.prepare("UPDATE nodes SET runtime='codex' WHERE id=?").run(nodeId); expect((await post({ type: "cancel" })).status).toBe(409); });
  it.each(["missing", "dead", "shell", "no-attempt", "no-process", "invalid-record", "no-binding"])("refuses %s without recreating a channel", async kind => {
    await launch();
    if (kind === "missing") unlinkSync(channel);
    if (kind === "no-binding") db.prepare("DELETE FROM bindings WHERE node_id=?").run(nodeId);
    if (kind === "no-process") vi.mocked(setup.tmuxAdapter.hasSession).mockResolvedValue(false);
    if (kind === "invalid-record") writeFileSync(join(home, "state", "launch-results", sessionName, `${attempt}.json`), "{}");
    if (kind === "dead") setup.sessionRegistry.updateStatus(sessionId, "exited");
    if (kind === "shell") vi.mocked(setup.tmuxAdapter.getPaneCommand).mockResolvedValue("bash");
    if (kind === "no-attempt") rmSync(join(home, "state", "launch-results", sessionName), { recursive: true });
    const r = await post({ type: "cancel" }); expect(r.status).toBe(409); expect(await r.json()).toEqual({ error: "not_running" });
    if (kind === "missing") expect(existsSync(channel)).toBe(false);
  });
  it("answers concurrent wakes independently with default and maximum timeouts", async () => {
    await launch();
    const a = post({ type: "wake", question: "first" }); const b = post({ type: "wake", question: "second", timeoutSeconds: 300 });
    const commands = await waitForLines(2);
    expect(commands.map(c => c.timeoutSeconds)).toEqual([60, 300]);
    for (const command of commands.reverse()) { const r = await answer(command.id); expect(r.status).toBe(200); }
    for (const response of await Promise.all([a, b])) { expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, id: expect.any(String), answer: "awake", answeredAt: expect.any(String) }); }
  });
  it.each([{ type: "wake", question: "q", timeoutSeconds: 301 }, { type: "wake", question: "q", timeoutSeconds: 0 }, { type: "wake", question: 4 }, { type: "wake", question: "q", timeoutSeconds: "2" }, null, { type: "other" }])("validates input %j", async body => { await launch(); expect((await post(body)).status).toBe(400); expect(lines()).toEqual([]); });
  it("registers a wake before a synchronous answer can arrive during append", async () => {
    await launch();
    const service = new SeatCommandService(setup.sessionRegistry);
    appendProbe.action = command => {
      expect(service.resolveWakeAnswer({ id: command.id, answer: "immediate", sessionName, nodeId, generation, occurredAt: new Date().toISOString() })).toBe(true);
    };
    const response = await post({ type: "wake", question: "q" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ answer: "immediate" });
    expect(lines()).toHaveLength(1);
  });
  it("cleans pending wakes and timers when the append fails", async () => {
    await launch(); vi.useFakeTimers();
    let id: unknown;
    appendProbe.action = command => { id = command.id; throw new Error("fixture disk write failure"); };
    const response = await post({ type: "wake", question: "q" });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "not_running" });
    expect(vi.getTimerCount()).toBe(0); expect(lines()).toEqual([]);
    expect(await (await answer(id as string)).json()).toMatchObject({ resolved: false });
  });
  it("times out and discards late answers", async () => {
    await launch(); vi.useFakeTimers();
    const pending = post({ type: "wake", question: "q", timeoutSeconds: 1 });
    await vi.waitFor(() => expect(lines()).toHaveLength(1)); const id = lines()[0].id;
    await vi.advanceTimersByTimeAsync(1000);
    const r = await pending; expect(r.status).toBe(504); expect(await r.json()).toEqual({ error: "wake_timeout", id });
    expect(await (await answer(id)).json()).toMatchObject({ resolved: false });
  });
  it("ignores wrong identity and stale generations without consuming a pending wake", async () => {
    await launch(); const pending = post({ type: "wake", question: "q", timeoutSeconds: 1 });
    const [command] = await waitForLines(1);
    for (const overrides of [{ nodeId: "other" }, { sessionName: "other@commands" }, { generation: "old" }]) {
      expect(await (await answer(command.id, overrides)).json()).toMatchObject({ resolved: false });
    }
    expect(await (await answer(command.id)).json()).toMatchObject({ resolved: true });
    expect((await pending).status).toBe(200);
    expect(await (await answer(command.id)).json()).toMatchObject({ resolved: false });
  });
  it("rejects an answer after the seat changes generation", async () => {
    await launch(); vi.useFakeTimers(); const pending = post({ type: "wake", question: "q", timeoutSeconds: 1 });
    await vi.waitFor(() => expect(lines()).toHaveLength(1));
    setup.sessionRegistry.registerSession(nodeId, sessionName, "fresh");
    expect(await (await answer(lines()[0].id)).json()).toMatchObject({ resolved: false });
    await vi.advanceTimersByTimeAsync(1000); expect((await pending).status).toBe(504);
  });
});
