import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CommunityHarnessRuntimeAdapter } from "../src/adapters/community-harness-runtime-adapter.js";
import { createFullTestDb, createTestApp } from "./helpers/test-app.js";

const EXAMPLE = resolve(__dirname, "../../../docs/reference/community-harness-examples/dsh");
const RUNNER = join(EXAMPLE, "openrig-dsh-runner.mjs");
const SESSION = "worker@command-e2e";
const TOKEN = "command-e2e-fixture-token";
const cleanups: Array<() => void | Promise<void>> = [];

// Like community-harness-dsh-example.test.ts, only the ACP agent is fake. The documented runner,
// adapter, JSONL channel, command route, pending-wake registry and activity route all run for real.
const FAKE_DSH = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
if (process.argv.includes("--version")) { console.log("dsh 0.2.1-rc.2"); process.exit(0); }
writeFileSync(process.env.FAKE_OBSERVATION, JSON.stringify({ commandPath: process.env.OPENRIG_COMMAND_PATH ?? null }));
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  const reply = result => console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  if (message.method === "initialize") reply({ protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "dsh", version: "0.2.1-rc.2" } });
  else if (message.method === "session/new") reply({ sessionId: "command-e2e-conversation" });
});
`;

afterEach(async () => {
  const failures: unknown[] = [];
  try {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
  } finally {
    vi.unstubAllEnvs();
  }
  if (failures.length) throw new AggregateError(failures, "command fixture cleanup failed");
});

function quote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

async function stopProcessGroup(child: ChildProcess) {
  if (!child.pid) return;
  // The shell is exec'd and detached: the runner and its ACP child belong to this fixture's group.
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise<void>(done => child.once("close", () => done()));
  const kill = (signal: NodeJS.Signals) => {
    try { process.kill(-child.pid!, signal); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([exited, new Promise<void>(done => { timer = setTimeout(done, 2_000); })]);
  } finally {
    if (timer) clearTimeout(timer);
    // Also catches a surviving ACP child if the runner exited first.
    kill("SIGKILL");
  }
}

interface HookReceipt { body: Record<string, unknown>; status: number; result: Record<string, unknown> }

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_done, reject) => {
      timer = setTimeout(() => reject(new Error("wake route exceeded its independent test deadline")), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function launch(commands = true, wrongChannel = false) {
  const home = mkdtempSync(join(tmpdir(), "openrig-command-e2e-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  vi.stubEnv("OPENRIG_HOME", home);
  mkdirSync(join(home, "community-harnesses"));
  const fake = join(home, "fake-dsh.mjs");
  const observation = join(home, "dsh-environment.json");
  const ignoredChannel = join(home, "unwatched-by-daemon.jsonl");
  writeFileSync(fake, FAKE_DSH);
  chmodSync(fake, 0o755);
  if (wrongChannel) writeFileSync(ignoredChannel, "", { mode: 0o600 });
  const runnerCommand = `${wrongChannel ? `/usr/bin/env OPENRIG_COMMAND_PATH=${quote(ignoredChannel)} ` : ""}${quote(process.execPath)} ${quote(RUNNER)}`;
  // Install the documented preset with only the executable path and selected command capability changed.
  writeFileSync(join(home, "community-harnesses", "dsh.yaml"), readFileSync(join(EXAMPLE, "dsh.yaml"), "utf8")
    .replace(/^command:.*$/m, `command: ${JSON.stringify(runnerCommand)}`)
    .replace(/^commands:.*$/m, `commands: ${commands}`));

  const db = createFullTestDb();
  cleanups.push(() => { db.close(); });
  const setup = createTestApp(db, { activityHookToken: TOKEN });
  const hooks: HookReceipt[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const forwarded = await setup.app.request(request.url!, {
        method: request.method,
        headers: { "Content-Type": "application/json", Authorization: request.headers.authorization ?? "" },
        body,
      });
      const result = await forwarded.text();
      hooks.push({ body: JSON.parse(body), status: forwarded.status, result: JSON.parse(result) });
      response.writeHead(forwarded.status, { "Content-Type": "application/json" });
      response.end(result);
    })().catch(error => { response.writeHead(500); response.end(String(error)); });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>((done, reject) => {
    server.close(error => error ? reject(error) : done());
    server.closeAllConnections();
  }));
  const port = (server.address() as { port: number }).port;
  const rig = setup.rigRepo.createRig("command-e2e");
  const node = setup.rigRepo.addNode(rig.id, "worker", { runtime: "dsh" });
  const session = setup.sessionRegistry.registerSession(node.id, SESSION);
  setup.sessionRegistry.recordCommunityHarnessSelection(session.id, "dsh", true);
  setup.sessionRegistry.updateStatus(session.id, "running");
  const binding = setup.sessionRegistry.updateBinding(node.id, { attachmentType: "tmux", tmuxSession: SESSION });
  const generation = setup.sessionRegistry.currentOccupantTenure(node.id)!.generationUuid;
  let child: ChildProcess | undefined;
  let output = "";
  let channel = "";
  let attempt = "";
  const alive = async () => !!child && child.exitCode === null && child.signalCode === null;
  vi.mocked(setup.tmuxAdapter.hasSession).mockImplementation(alive);
  setup.tmuxAdapter.getPaneCommand = async () => await alive() ? "node" : null;
  const adapter = new CommunityHarnessRuntimeAdapter("dsh", { tmux: {
    hasSession: alive,
    getPaneCommand: setup.tmuxAdapter.getPaneCommand,
    sendShellCommand: async (_name, command) => {
      attempt = /OPENRIG_LAUNCH_ATTEMPT=([^ ]+)/.exec(command)![1]!;
      channel = join(home, "state", "launch-results", "commands", `${attempt}.jsonl`);
      // Guards adapter launchPreset:181-186 and createSeatCommandChannel:21: private, empty before dispatch.
      if (commands) {
        expect(command).toContain(`OPENRIG_COMMAND_PATH=${quote(channel)}`);
        expect(readFileSync(channel, "utf8")).toBe("");
        expect(statSync(channel).mode & 0o777).toBe(0o600);
      }
      child = spawn("/bin/sh", ["-c", `exec ${command}`], { cwd: home, detached: true, stdio: "pipe", env: {
        PATH: process.env.PATH!, HOME: home, OPENRIG_HOME: home,
        DSH_SEAT_BIN: fake, FAKE_OBSERVATION: observation,
        OPENRIG_URL: `http://127.0.0.1:${port}`, OPENRIG_ACTIVITY_HOOK_TOKEN: TOKEN,
        OPENRIG_SESSION_NAME: SESSION, OPENRIG_NODE_ID: node.id,
        OPENRIG_OCCUPANT_GENERATION: generation, OPENRIG_RUNTIME: "dsh",
      } });
      cleanups.push(() => stopProcessGroup(child!));
      child.stdout!.on("data", data => { output += String(data); });
      child.stderr!.on("data", data => { output += String(data); });
      await new Promise<void>((done, reject) => { child!.once("spawn", done); child!.once("error", reject); });
      return { ok: true as const };
    },
  } });
  const launched = await adapter.launchHarness({ ...binding, cwd: home, launchGeneration: generation }, { name: SESSION });
  // Guards adapter waitForLaunchResult:212-228 and runner writeLaunchRecord:267: the real child reported its conversation.
  expect(launched, output).toMatchObject({ ok: true, resumeToken: "command-e2e-conversation", resumeType: "community:dsh" });
  return {
    home, channel, attempt, hooks, ignoredChannel,
    observedPath: () => JSON.parse(readFileSync(observation, "utf8")).commandPath as string | null,
    lines: () => readFileSync(channel, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)),
    post: (body: unknown) => setup.app.request(`/api/seats/${encodeURIComponent(SESSION)}/command`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  };
}

describe("community runner command channel with the real dsh example", () => {
  it("launches a private channel, answers a wake through hooks, and reports cancelled Stop", async () => {
    const seat = await launch();
    // Guards adapter launchPreset:186 across the process boundary, not just the shell command string.
    expect(seat.observedPath()).toBe(seat.channel);
    const question = `are you awake? ${randomUUID()}`;
    const wake = await seat.post({ type: "wake", question, timeoutSeconds: 3 });
    // Guards seat-command-service command:115/resolveWakeAnswer:133 and dsh runner wake handler:612.
    expect(wake.status).toBe(200);
    const answered = await wake.json();
    expect(answered).toEqual({ ok: true, id: expect.any(String), answer: `dsh-awake: ${question}`, answeredAt: expect.any(String) });
    // Guards activity.ts:345-347: the child's matching answer was accepted and resolved the registered wake.
    await vi.waitFor(() => expect(seat.hooks.find(hook => hook.body.eventFamily === "wake_answer" && hook.body.id === answered.id))
      .toMatchObject({ status: 200, result: { ok: true, resolved: true }, body: { answer: answered.answer, occurredAt: answered.answeredAt } }), { timeout: 5_000 });
    const wakeLines = seat.lines();
    // Guards service command:97-98/115: complete request and correlation id really reached JSONL.
    expect(wakeLines).toEqual([{ type: "wake", id: answered.id, at: expect.any(String), question, timeoutSeconds: 3 }]);

    const cancel = await seat.post({ type: "cancel" });
    // Guards service command:121: cancel appends and acknowledges without waiting for a wake answer.
    expect(cancel.status).toBe(202);
    const cancelled = await cancel.json();
    expect(cancelled).toEqual({ ok: true, id: expect.any(String) });
    // Guards runner tailCommands:610/616 and postIdle:341: consuming cancel emits an accepted cancelled Stop.
    await vi.waitFor(() => expect(seat.hooks.find(hook => hook.body.hookEvent === "Stop" && hook.body.reason === "cancelled"))
      .toMatchObject({ status: 200, result: { ok: true }, body: { sessionName: SESSION, subtype: "cancelled", reason: "cancelled" } }), { timeout: 5_000 });
    // Guards service O_APPEND:112/115 and runner tailCommands:208: neither side truncates prior commands.
    expect(seat.lines()).toEqual([...wakeLines, { type: "cancel", id: cancelled.id, at: expect.any(String) }]);
    expect(cancelled.id).not.toBe(answered.id);
  }, 15_000);

  it("seeded-fail: commands:false refuses the same real runner at the wake boundary", async () => {
    const seat = await launch(false);
    const wake = await seat.post({ type: "wake", question: `disabled ${randomUUID()}`, timeoutSeconds: 1 });
    // Guards seat-command-service command:82: the seeded opt-out fails at wake, after a successful real launch.
    expect(wake.status).toBe(409);
    expect(await wake.json()).toEqual({ error: "no_command_channel", detail: "harness declares no command channel" });
    // Guards adapter launchHarness:152-153/launchPreset:181: opt-out neither injects nor creates a channel.
    expect(seat.observedPath()).toBeNull();
    expect(existsSync(seat.channel)).toBe(false);
  }, 15_000);

  it("times out a real runner watching a different channel", async () => {
    const seat = await launch(true, true);
    // The seeded fault is solely the runner's watched path; the daemon retains a valid live launch/channel.
    expect(seat.observedPath()).toBe(seat.ignoredChannel);
    const question = `unanswered ${randomUUID()}`;
    const started = performance.now();
    const response = await within(seat.post({ type: "wake", question, timeoutSeconds: 1 }), 5_000);
    const elapsed = performance.now() - started;
    // Guards service command:102-107: real time expires an unanswered wake, rather than falsely returning success.
    expect(response.status).toBe(504);
    const result = await response.json();
    expect(result).toEqual({ error: "wake_timeout", id: expect.any(String) });
    expect(elapsed).toBeGreaterThanOrEqual(950);
    expect(elapsed).toBeLessThan(5_000);
    // Guards service command:115: timeout still follows a real append to the daemon's channel.
    expect(seat.lines()).toEqual([{ type: "wake", id: result.id, at: expect.any(String), question, timeoutSeconds: 1 }]);
    expect(seat.hooks.some(hook => hook.body.eventFamily === "wake_answer" && hook.body.id === result.id)).toBe(false);
  }, 15_000);
});
