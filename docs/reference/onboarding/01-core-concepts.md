# Chapter 01: Core Architecture & Mental Model

> **"A harness wraps a model. A rig wraps your harnesses."**

To use OpenRig effectively, you do not need to memorize every daemon internal, but you do need an accurate mental model of how the pieces fit together. 

Many users start with a single terminal running Claude Code or Codex. That works for a single task, but it quickly breaks down when work spans multiple hours, requires independent verification, or involves different specialized tasks. OpenRig organizes those individual agent sessions into a structured, persistent, and accountable engineering organization.

---

## 1. What OpenRig Is (and What It Isn't)

- **It is a coordination engine:** OpenRig launches unmodified coding agent sessions inside `tmux`, routes messages between them, keeps tasks in a persistent queue, injects relevant skills and context, and captures proof of completed work.
- **It is local-first and self-hosted:** Everything runs on your own machine. State is stored in a local SQLite database. No proprietary cloud service acts as a middleman.
- **It uses real, unmodified harnesses:** When OpenRig launches Claude Code or Codex, it runs the exact CLI binaries you installed. It does not wrap the model in a custom prompt wrapper; it orchestrates the actual agent tool.
- **It is not an autonomous black box:** OpenRig gives the human operator high-altitude visibility and control. You define intent, you review proofs, and you choose when to step in.

---

## 2. The Core Taxonomy

Understanding OpenRig requires learning five structural terms:

```
┌───────────────────────────────────────────────────────────────────────┐
│ RIG: "starter" / "workshop" / "factory"                               │
│                                                                       │
│  ┌───────────────────────────────┐  ┌──────────────────────────────┐  │
│  │ POD: "orch" (Orchestration)   │  │ POD: "dev" (Development)     │  │
│  │                               │  │                              │  │
│  │  ┌─────────────────────────┐  │  │  ┌────────────────────────┐  │  │
│  │  │ SEAT: orch-lead         │  │  │  │ SEAT: dev-build        │  │  │
│  │  │ Runtime: Codex          │  │  │  │ Runtime: Claude Code   │  │  │
│  │  │ Role: Scoping & Routing │  │  │  │ Role: Implementation   │  │  │
│  │  └───────────┬─────────────┘  │  │  └───────────┬────────────┘  │  │
│  └──────────────┼────────────────┘  └──────────────┼───────────────┘  │
│                 │                                  │                  │
│                 └───────────► [Communication] ◄────┘                  │
│                               (edges / queue)                         │
└───────────────────────────────────────────────────────────────────────┘
```

### The Rig
A **rig** is an authored team specification. It defines the team name, culture, members, communication edges, working directories, and lifecycle hooks. 
- Examples: `starter` (a simple build + review pair), `workshop` (lead + builder + QA + reviewer), `factory` (a 7-seat full-lifecycle software factory).
- Defined in: `rig.yaml` or distributed as a `.rigbundle`.

### The Pod
A **pod** is a functional department or grouping within a rig. Pods group seats by domain:
- `orch`: Orchestration (leads, advisors, project managers).
- `dev`: Development (builders, implementers, QA).
- `rev`: Independent review (code reviewers, security auditors).
- `infra`: Auxiliary infrastructure (background monitors, test stubs).

### The Seat
A **seat** is an individual agent session running in its own tmux window.
- Address format: `seat@rig` (e.g., `dev-build@starter`, `orch-lead@workshop`).
- Each seat has an assigned role, instructions, runtime, working directory (`cwd`), and skill projections.
- Seats communicate with each other along declared communication edges via `rig send` or queue handoffs.

### The Harness / Runtime
The **runtime** is the underlying agent software powering a seat. OpenRig supports:
- `claude-code`: Anthropic's Claude Code CLI.
- `codex`: OpenAI's Codex CLI.
- `pi` / `omp`: Pi and Oh My Pi agents.
- `terminal`: An interactive bash shell or monitoring script.
- `stub`: Scripted test agent stubs for testing workflows hermetically.

### The Daemon
The **daemon** is the background service (`packages/daemon`) that coordinates the entire system.
- Listens locally at `http://127.0.0.1:7433` by default.
- Manages the SQLite database at `$OPENRIG_HOME/openrig.sqlite`.
- Interfaces with `tmux` to manage sessions and capture pane output.
- Dispatches messages, records activity telemetry, and serves the REST and WebSocket APIs.

---

## 3. Work & Context Concepts

### The Kernel
When the daemon boots, it also manages the **Kernel**. The kernel is a lightweight background management rig consisting of:
- `operator`: An agent dedicated to helping you manage OpenRig, diagnose issues, and launch rigs.
- `advisor`: An agent that helps frame product questions and architecture.

### Context Packs & Worlds
Agents need context to do good work. OpenRig organizes context in distinct layers:
1. **System World:** Fundamental rules of being an agent in OpenRig (how to use the queue, how to message peers, command etiquette). Ships built-in with OpenRig.
2. **Project World (Context Packs):** Knowledge about the specific repository or project being worked on (e.g., `openrig-world` contains the purpose, craft, and PR rules for contributing to OpenRig). Agents load this via `rig context profile <pack>`.
3. **Repository Maps:** In-repo documentation such as `ARCHITECTURE.md`, `README.md`, and local skills.

### Intent, Missions, and Slices
OpenRig structures development using a hierarchical SDLC model:
- **Intent (`SPEC.md`):** What problem are we solving? What does done look like?
- **Mission:** A major feature, release, or objective (stored under `missions/<mission-id>/`).
- **Slice:** A bounded, testable vertical slice of work (stored under `missions/<mission-id>/slices/<slice-id>/`).
  - `SPEC.md`: The slice intent and proof contract.
  - `PROGRESS.md`: The acceptance log.
  - `PROOF.md` & `proof/`: Retained evidence proving that the changes work.

### The Queue & Batons
Instead of relying on ephemeral chat messages that get lost when a context window compacts, OpenRig provides a persistent **Queue**:
- Work items are queued with clear descriptions, tags (`project:<id>`, `slice:<id>`), and destinations.
- Agents pick up tasks, update status (`pending` → `in-progress` → `completed`), and hand off batons to reviewers.

---

## 4. User Interaction Surfaces

You interact with OpenRig through four complementary interfaces:

| Interface | Command / URL | Intended For |
| :--- | :--- | :--- |
| **CLI** | `rig <command>` | Direct shell control, scripting, inspection (`rig ps`, `rig send`, `rig queue list`). |
| **Terminal UI (TUI)** | `rig tui` (or `rig`) | High-level interactive dashboard showing rigs, pods, seats, health, and queue items. |
| **Workspace Window** | `rig terminal open saved:kernel --window` | Desktop terminal window (tmux or Herdr) showing the kernel operator and dashboard side-by-side. |
| **MCP Server** | `rig mcp serve` | Exposes 18 OpenRig coordination tools to AI assistants over standard Model Context Protocol stdio. |

---

## Summary Diagram

```
                 ┌─────────────────────────────────────────┐
                 │             Human Operator              │
                 └──────────────┬───────────────────┬──────┘
                                │                   │
                    CLI / TUI / Terminal       MCP Server
                                │                   │
                                ▼                   ▼
                 ┌─────────────────────────────────────────┐
                 │              OpenRig Daemon             │
                 │      (HTTP / SQLite / Event Bus)        │
                 └──────────────┬───────────────────┬──────┘
                                │                   │
                      tmux session manager    State Store
                                │             (~/.openrig)
                                ▼
         ┌────────────────────────────────────────────────────────┐
         │                      Active Rigs                       │
         │                                                        │
         │  ┌──────────────────────┐    ┌──────────────────────┐  │
         │  │ Kernel Rig           │    │ Project Rig (e.g.    │  │
         │  │ • operator           │    │   workshop)          │  │
         │  │ • advisor            │    │ • orch-lead          │  │
         │  └──────────────────────┘    │ • dev-build          │  │
         │                              │ • dev-qa             │  │
         │                              │ • dev-review         │  │
         │                              └──────────────────────┘  │
         └────────────────────────────────────────────────────────┘
```

---

### Continue Reading
👉 Proceed to [**Chapter 02: Configuration Files, Storage & Machine State**](02-configuration-and-storage.md)
