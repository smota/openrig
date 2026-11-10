import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityHarnessRuntimeAdapter } from "../src/adapters/community-harness-runtime-adapter.js";
import { shellQuote } from "../src/adapters/shell-quote.js";
import type { NodeBinding } from "../src/domain/runtime-adapter.js";
import { createFullTestDb, createTestApp } from "./helpers/test-app.js";

let home: string;
let db: ReturnType<typeof createFullTestDb>;
let setup: ReturnType<typeof createTestApp>;
const sessionName = "worker@command-edges";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "openrig-command-edges-"));
  vi.stubEnv("OPENRIG_HOME", home);
  mkdirSync(join(home, "community-harnesses"));
  db = createFullTestDb();
  setup = createTestApp(db);
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

function preset(command: string, declaration = "commands: true\n") {
  writeFileSync(join(home, "community-harnesses", "synth.yaml"),
    `format: 1\nname: synth\ncommand: ${JSON.stringify(command)}\nmaintainer: Fixture\nlaunch_result: true\nrunner: true\n${declaration}`);
}

function register(runtime: string) {
  const rig = setup.rigRepo.createRig("command-edges");
  const node = setup.rigRepo.addNode(rig.id, "worker", { runtime });
  const session = setup.sessionRegistry.registerSession(node.id, sessionName);
  if (runtime === "synth") setup.sessionRegistry.recordCommunityHarnessSelection(session.id, runtime, true);
  expect(db.prepare("SELECT node_id FROM bindings WHERE node_id=?").get(node.id)).toBeUndefined();
  return { rig, node, session };
}

function post(name = sessionName) {
  return setup.app.request(`/api/seats/${encodeURIComponent(name)}/command`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "cancel" }),
  });
}

describe("registered seats without bindings", () => {
  it("reports the exact unsupported-channel response for a known built-in seat", async () => {
    register("codex");
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no_command_channel", detail: "harness declares no command channel" });
  });

  it("reports not_running for a known opted-in community seat before launch", async () => {
    preset("fixture-runner");
    register("synth");
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not_running" });
  });

  it("keeps genuinely unknown seats unknown", async () => {
    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "unknown_seat" });
  });

  it("does not resolve an older session name after a newer registration", async () => {
    const { node } = register("codex");
    setup.sessionRegistry.registerSession(node.id, "replacement@command-edges", "fresh");
    const response = await post();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "unknown_seat" });
    const current = await post("replacement@command-edges");
    expect(current.status).toBe(409);
    expect(await current.json()).toEqual({ error: "no_command_channel", detail: "harness declares no command channel" });
  });
});

describe("runner command environment", () => {
  it.each([undefined, false, true])("isolates inherited command paths with commands=%s", async commands => {
    const child = join(home, "child.cjs");
    const runner = join(home, "runner.cjs");
    const observed = join(home, "child-environment.json");
    writeFileSync(child, 'process.stdout.write(JSON.stringify({ commandPath: process.env.OPENRIG_COMMAND_PATH ?? null }));');
    writeFileSync(runner, `
      const { execFileSync } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      writeFileSync(${JSON.stringify(observed)}, execFileSync(process.execPath, [${JSON.stringify(child)}]));
      writeFileSync(process.env.OPENRIG_LAUNCH_RESULT, JSON.stringify({
        format: 1, attempt: process.env.OPENRIG_LAUNCH_ATTEMPT,
        harness: "synth", nativeRef: "fixture-conversation", producer: "fixture"
      }));
    `);
    preset(`${shellQuote(process.execPath)} ${shellQuote(runner)}`,
      commands === undefined ? "" : `commands: ${commands}\n`);
    const { node } = register("synth");
    const adapter = new CommunityHarnessRuntimeAdapter("synth", {
      tmux: {
        hasSession: async () => true,
        getPaneCommand: async () => "node",
        sendShellCommand: async (_session, command) => {
          execFileSync("/bin/sh", ["-c", command], {
            env: { ...process.env, OPENRIG_COMMAND_PATH: "inherited-command-path-sentinel" },
          });
          return { ok: true };
        },
      },
    });
    const result = await adapter.launchHarness({ nodeId: node.id, tmuxSession: sessionName,
      launchGeneration: setup.sessionRegistry.currentOccupantTenure(node.id)!.generationUuid } as NodeBinding, { name: sessionName });
    expect(result).toMatchObject({ ok: true, resumeToken: "fixture-conversation" });
    const { commandPath } = JSON.parse(readFileSync(observed, "utf8"));
    if (commands) {
      expect(commandPath).toMatch(new RegExp(`^${home}/state/launch-results/commands/`));
      expect(existsSync(commandPath)).toBe(true);
      expect(readFileSync(commandPath, "utf8")).toBe("");
    } else {
      expect(commandPath).toBeNull();
      expect(existsSync(join(home, "state", "launch-results", "commands"))).toBe(false);
    }
  });
});
