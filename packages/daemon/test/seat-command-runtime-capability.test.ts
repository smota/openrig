import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFullTestDb, createTestApp } from "./helpers/test-app.js";

let home: string;
let db: ReturnType<typeof createFullTestDb>;
let setup: ReturnType<typeof createTestApp>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "openrig-command-runtime-capability-"));
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

describe("command capability from the seat runtime", () => {
  it.each([true, false, undefined])("uses the preset with commands=%s when no harness selection was retained", async commands => {
    writeFileSync(join(home, "community-harnesses", "synth.yaml"),
      "format: 1\nname: synth\ncommand: fixture-runner\nmaintainer: Fixture\nlaunch_result: true\nrunner: true\n"
      + (commands === undefined ? "" : `commands: ${commands}\n`));
    const rig = setup.rigRepo.createRig("runtime-capability");
    const node = setup.rigRepo.addNode(rig.id, "worker", { runtime: "synth" });
    const session = setup.sessionRegistry.registerSession(node.id, "worker@runtime-capability");
    expect(db.prepare("SELECT agent_app FROM sessions WHERE id=?").get(session.id)).toEqual({ agent_app: null });

    const response = await setup.app.request("/api/seats/worker@runtime-capability/command", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "cancel" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(commands
      ? { error: "not_running" }
      : { error: "no_command_channel", detail: "harness declares no command channel" });
  });
});
