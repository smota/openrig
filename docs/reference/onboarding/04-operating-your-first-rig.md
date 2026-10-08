# Chapter 04: Choosing & Operating Your First Rig

Now comes the exciting part: booting your first agent team, observing them in action, and directing them to make a real, verified change in your repository.

This chapter walks you through selecting a rig, previewing the execution plan, booting the team, assigning a task, and managing the team's lifecycle.

---

## 1. Choosing Your First Rig

OpenRig comes with built-in teams and distributable bundles. For your first project, choose between **`starter`** and **`workshop`**:

| Team | Seats | Who to Talk To | Ideal Purpose |
| :--- | :--- | :--- | :--- |
| **`starter`** | 2 (`dev-build`, `dev-review`) | `dev-build@starter` | **Your very first bounded change.** Simple, lightweight, pairs a builder with an independent reviewer. |
| **`workshop`** | 4 (`orch-lead`, `dev-build`, `dev-review`, `dev-qa`) | `orch-lead@workshop` | **Ongoing repository development.** Includes an orchestrator lead, QA validation, and peer review. Shipped as a bundle with non-interruptive mode. |
| **`factory`** | 7 (lead, advisor, build, qa, design, rev-1, rev-2) | `orch-lead@factory` | **Full product squad.** Sustained multi-stream development with parallel review pairs. |

### Single-Provider vs. Multi-Provider

- As shipped, `starter` uses **Claude Code** for the builder and **Codex** for the reviewer.
- If you only have **one** provider (e.g. Claude Code only, or Codex only):
  - You can ask the kernel operator to adapt `starter` to your available provider.
  - Or, when using `workshop`, choose a preset such as `--preset all-claude` or `--preset all-codex`.

---

## 2. Preview Before Booting: The `--plan` Command

In OpenRig, you never have to guess what a launch command will do. The `--plan` flag inspects the topology, verifies dependencies, and prints the exact execution plan without creating any processes or tmux sessions.

Navigate to your target repository and run:

```bash
cd /path/to/your/repository

# 1. Preview the rig specification
rig specs preview starter --kind rig

# 2. Plan the launch against your repository
rig up starter --cwd . --plan
```

### What the Plan Tells You
- Which tmux sessions and windows will be created.
- Which harnesses will run (`claude-code`, `codex`).
- What working directory each seat will execute in.
- Which startup files and skills will be projected.

---

## 3. Launching Your Rig

### Option A: Launching `starter` (Built-in)

Once satisfied with the plan, launch the starter team:

```bash
cd /path/to/your/repository
rig up starter --cwd .
```

### Option B: Installing & Launching `workshop` (Bundle)

If you prefer the 4-seat `workshop` team with built-in QA and lead orchestration:

```bash
cd /path/to/your/repository

# Preview bundle installation
rig bundle install https://github.com/mvschwarz/openrig-world/tree/main/rigs/workshop \
  --preset recommended \
  --target ~/rigs/workshop \
  --cwd . \
  --plan

# Install and boot
rig bundle install https://github.com/mvschwarz/openrig-world/tree/main/rigs/workshop \
  --preset recommended \
  --target ~/rigs/workshop \
  --cwd .
```

*(Note: Replace `--preset recommended` with `--preset all-claude` or `--preset all-codex` if you use only one provider.)*

---

## 4. Verifying Readiness

After launching, check the status of your seats:

```bash
rig ps --nodes --rig starter
```

### Understanding `rig ps` Output

```text
RIG: starter
SEAT               RUNTIME      STATUS    PID    HEALTH  ATTENTION
dev-build@starter  claude-code  ready     48102  ok      idle
dev-review@starter codex        ready     48120  ok      idle
```

- **`ready`**: The harness booted, ingested startup instructions, and is awaiting instructions.
- **`starting`**: The harness process is initializing.
- **`prompt_waiting`**: The harness stopped at a permission, trust, or login prompt.
  - If a seat is waiting at a prompt, answer the prompt in its terminal window, then run:
    ```bash
    rig seat continue dev-build@starter
    ```
    This delivers the pending startup context.

---

## 5. Seeing Your Agents at Work

OpenRig provides multiple ways to watch your team:

### 1. The Terminal Workspace Window (Recommended)
```bash
rig terminal open saved:kernel --window
```
This opens a new terminal window or tab (via tmux or Herdr). It displays the kernel operator on one side and the live dashboard on the other.

### 2. The Interactive Terminal UI (TUI)
```bash
rig tui
```
*(Or simply run `rig` in an empty terminal).*  
The TUI displays:
- Active rigs and pods in a topology graph.
- Real-time seat statuses, token usage, and states.
- The task queue and mission progress.

### 3. Direct tmux Panes (Under the Hood)
Because seats run in ordinary `tmux` sessions, you can attach to them directly:
```bash
tmux list-sessions
tmux attach-session -t openrig-starter
```
Press `Ctrl+B` then `d` to detach at any time.

---

## 6. Assigning Your First Useful Change

Now that your team is ready, give the builder one concrete, bounded task.

### The Golden Prompt Pattern

Use `rig send` to dispatch a task with explicit requirements for verification and review:

```bash
rig send dev-build@starter 'Implement a helper function to validate email formatting in src/utils/email.ts, along with unit tests. Track the task in the queue and return its ID. Keep it local, verify the test behavior, ask dev-review in this rig to check the exact candidate, and record the result and how I can try it.'
```

> [!NOTE]
> **Why doesn't `rig send` automatically enqueue?**
> In OpenRig, `rig send` delivers a message to the agent's input stream. The agent reads your message, interprets the intent, and registers the structured work item in the queue. This ensures tasks in the queue reflect agreed-upon scopes, not raw stream chatter.

### Tracking the Task in the Queue

Inspect the active queue:

```bash
# List tasks assigned to the builder
rig queue list --destination dev-build@starter

# Inspect a specific task by ID
rig queue inspect <task-id>
```

---

## 7. Reviewing the Outcome

When the builder finishes:
1. It runs the project's tests locally.
2. It sends a message to `dev-review@starter` with the commit hash or diff.
3. The reviewer independently verifies the changes against project maps and tests.
4. The builder replies to you with the final summary, test evidence, and review verdict.

You can inspect the reviewer's commentary:

```bash
rig capture dev-review@starter
```

---

## 8. Stopping, Saving, and Restoring Rigs

When you are done with a work session, OpenRig allows you to cleanly pause or stop your team without losing continuity:

### 1. Warm Snapshot & Restore
To pause your team and preserve session context:
```bash
# Take a snapshot and stop the processes
rig down starter --snapshot
```

To resume the exact same team later:
```bash
# Bring back the snapshotted rig
rig up starter --existing
```

### 2. Complete Teardown
To permanently terminate the rig:
```bash
rig down starter
```

---

### Continue Reading
👉 Proceed to [**Chapter 05: Daily Workflows, SDLC & Craft**](05-daily-workflows-and-craft.md)
