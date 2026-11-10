import { afterEach, describe, expect, it, vi } from "vitest";
import { getDaemonStatus } from "../src/daemon-lifecycle.js";
import { seatCommand, type SeatDeps } from "../src/commands/seat.js";

vi.mock("../src/daemon-lifecycle.js", async () => ({
  ...await vi.importActual("../src/daemon-lifecycle.js"),
  getDaemonStatus: vi.fn(async () => ({ state: "running", healthy: true, pid: 1, port: 7433 })),
  getDaemonUrl: vi.fn(() => "http://localhost:7433"),
}));
afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });

describe("rig seat cancel", () => {
  it("does not post when the daemon status guard refuses", async () => {
    vi.mocked(getDaemonStatus).mockResolvedValueOnce({ state: "stopped" } as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const post = vi.fn();
    const deps = { lifecycleDeps: {}, clientFactory: () => ({ post }) } as unknown as SeatDeps;
    await seatCommand(deps).parseAsync(["node", "rig", "cancel", "dev@rig"]);
    expect(post).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it("preserves a refusal body in JSON output", async () => {
    const body = { error: "no_command_channel", detail: "harness declares no command channel" };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = { lifecycleDeps: {}, clientFactory: () => ({ post: async () => ({ status: 409, data: body }) }) } as unknown as SeatDeps;
    await seatCommand(deps).parseAsync(["node", "rig", "cancel", "dev@rig", "--json"]);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual(body);
    expect(process.exitCode).toBe(1);
  });

  it.each([false, true])("posts the exact seat command and renders success (json=%s)", async json => {
    const post = vi.fn(async () => ({ status: 202, data: { ok: true, id: "cancel-id" } }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = { lifecycleDeps: {}, clientFactory: () => ({ post }) } as unknown as SeatDeps;
    await seatCommand(deps).parseAsync(["node", "rig", "cancel", "dev@rig", ...(json ? ["--json"] : [])]);
    expect(post).toHaveBeenCalledWith("/api/seats/dev%40rig/command", { type: "cancel" });
    expect(log.mock.calls.flat().join(" ")).toContain("cancel-id");
    if (json) expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ ok: true, id: "cancel-id" });
    expect(process.exitCode).toBeUndefined();
  });
  it.each([[404, { error: "unknown_seat" }, "unknown_seat"], [409, { error: "no_command_channel", detail: "harness declares no command channel" }, "harness declares no command channel"], [409, { error: "not_running" }, "not_running"]])("renders HTTP %s refusal verbatim", async (status, data, text) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = { lifecycleDeps: {}, clientFactory: () => ({ post: async () => ({ status, data }) }) } as unknown as SeatDeps;
    await seatCommand(deps).parseAsync(["node", "rig", "cancel", "dev@rig"]);
    expect(error).toHaveBeenCalledWith(text);
    expect(process.exitCode).toBe(1);
  });
});
