# Chapter 05: Daily Workflows, SDLC & Craft

OpenRig is more than a process manager; it embodies an engineering philosophy designed for agentic development. In traditional multi-agent systems, agents chat vaguely in unstructured loops. In OpenRig, work moves through explicit contracts, observable state, and verifiable proof.

This chapter covers the daily development lifecycle, operating postures, queue coordination, and the core epistemic craft principles that make OpenRig reliable.

---

## 1. The OpenRig SDLC Loop

Development in OpenRig follows a structured progression:

```
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ 1. Intent    │ ──► │ 2. Plan      │ ──► │ 3. Build     │
  │  (SPEC.md)   │     │ (Requirements│     │  (Worktree   │
  │              │     │  & Contract) │     │   & Tests)   │
  └──────────────┘     └──────────────┘     └──────┬───────┘
                                                   │
  ┌──────────────┐     ┌──────────────┐            │
  │ 5. Handoff   │ ◄── │ 4. Proof     │ ◄──────────┘
  │  (Clean Diff │     │ (Verify with │
  │   & PR)      │     │  Evidence)   │
  └──────────────┘     └──────────────┘
```

### 1. Intent
Every piece of work begins with clear intent recorded in a `SPEC.md`:
- **What is this for?** What problem are we solving?
- **Mini-requirements:** A numbered list of concise deliverables.
- **Proof contract:** Explicit checkboxes stating what tests and behaviors will prove done.

### 2. Plan (The Planning Dial)
Planning rigor adapts to the stakes of the change:
- **P0:** Mini-requirements only (for small, easily reversible changes).
- **P1 (Default):** Authored spec with a proof contract.
- **P2–P4:** Research rounds, adversarial reviews, or clean-sheet designs for complex architecture changes.

### 3. Build
- The builder (`dev-build`) isolates changes on a feature branch inside its own Git worktree.
- The builder writes implementation code and unit tests.

### 4. Proof (Not Just Green Tests)
- The builder runs checks with its own eyes.
- It records evidence in `PROOF.md` and generates proof artifacts in `proof/`.

### 5. Review & Handoff
- An independent reviewer (`dev-review`), typically running a different model or vantage point, inspects the commit and re-runs relevant checks.
- When verified, the change is handed back to you or integrated into the main branch.

---

## 2. Operating Postures: Human-Led vs. Delegated

OpenRig distinguishes between work you are actively guiding and work you have delegated:

```
Human-Led (Default)                  Delegated
───────────────────                  ─────────
• You steer directly                 • Autonomous squad execution
• Quiet diagnostics                  • Active health oversight
• No unsolicited interruptions       • Notifications on blocked conditions
```

### Inspecting Posture
Check the effective operating posture for a rig or mission:
```bash
rig mode effective --rig starter --json
```

### Switching Posture
When you want an orchestrator or team to run autonomously:
```bash
# Propose a delegated posture (shows what would change)
rig mode set delegated --scope mission --qualifier my-project/release-1 --evidence "Operator delegated this milestone"

# Apply with explicit confirmation
rig mode set delegated --scope mission --qualifier my-project/release-1 --evidence "Operator delegated this milestone" --confirm
```

To return to quiet interactive mode:
```bash
rig mode set human-led --scope mission --qualifier my-project/release-1 --evidence "Returning to interactive planning" --confirm
```

---

## 3. The Queue as the Central Artery

Chat logs are ephemeral. Context windows fill up and compact. To keep work durable across hours and sessions, OpenRig uses a SQLite-backed **Queue**.

```
                rig send (task instruction)
                           │
                           ▼
                 Agent logs Queue Item
                           │
       ┌───────────────────┴───────────────────┐
       ▼                                       ▼
  `pending`                               `in-progress`
  (Queued in database)                    (Agent active in worktree)
                                               │
                                               ▼
                                         `completed` / `failed`
                                         (Results & Review attached)
```

### Key Queue Commands

```bash
# List all pending and active tasks
rig queue list

# Filter queue items for a specific seat
rig queue list --destination dev-build@workshop

# Inspect task details and recorded artifacts
rig queue inspect <item-id>

# Hand off an item from one seat to another
rig queue handoff <item-id> --to dev-review@workshop
```

---

## 4. OpenRig Craft: How to Prove a Change

OpenRig's engineering culture is built on four epistemic rules (documented in `openrig-world/craft/`):

### Rule 1: Bugs Hide at Seams
The hardest bugs sit at the joint between two parts that are each correct on their own and wrong together. 
- **Lifecycle seams:** Pane IDs surviving reboots; process handles outliving sockets.
- **State sync seams:** Projections disagreeing with SQLite; cached status vs. live process.
- **Recovery seams:** What survives a context compaction or daemon restart, and what quietly breaks.

*When testing work, don't just test the parts—test the seam between them.*

### Rule 2: A Check That Cannot Fail Is Decoration
For every test or check you rely on, **plant the exact defect it claims to catch and watch it fail** at the intended assertion. A test that passes under all conditions proves nothing.

### Rule 3: Prove It by Its Effect
- A "success" message printed by a tool is not proof. Read back the actual state from the system surface.
- A status that says `stopped` does not prove the process exited. Check PID absence.
- Compare projected files with sources by hash, not by version label.

### Rule 4: Give Every Absence Its Scope
Never say *"it does not exist"*. Say *"not found in this database, on this host, under this path"*. Precision prevents false assumptions.

---

## 5. Surviving Context Compactions & Resets

AI models eventually reach context window limits, triggering compaction or truncation. OpenRig agents are trained to recover gracefully:

### What Agents Do After Compaction
1. **Never trust memory or conversation summaries:** Re-derive ground truth directly from the shell (`git status`, `git rev-parse HEAD`, `rig ps`).
2. **Reload context:**
   ```bash
   # Re-inject fresh grounding context after a compaction
   rig context profile openrig-world --situation post-compaction
   ```
3. **Re-inspect the queue:** Query `rig queue list` to find the exact task ID in progress.

---

### Continue Reading
👉 Proceed to [**Chapter 06: Troubleshooting & Operator Diagnostics**](06-troubleshooting-and-diagnostics.md)
