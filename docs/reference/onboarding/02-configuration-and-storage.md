# Chapter 02: Configuration Files, Storage & Machine State

One of the most important questions for any new user is: **Where does OpenRig put files, what settings does it change on my machine, and what is the intention of each file?**

OpenRig is explicit and auditable about filesystem mutations. It does not sprinkle hidden configuration across unpredictable locations. This document maps every directory and file touched by OpenRig.

---

## 1. The Primary State Root: `$OPENRIG_HOME`

By default, OpenRig stores its durable instance state in:
```text
~/.openrig
```
You can relocate this directory at any time by setting the `OPENRIG_HOME` environment variable (e.g., `export OPENRIG_HOME=/opt/openrig`).

### Directory Layout

When the daemon starts (`rig daemon start`), it reconciles the following directory structure:

```text
$OPENRIG_HOME/
├── config.json             # Typed instance configuration
├── openrig.sqlite          # SQLite database (WAL mode, schema migrations)
├── openrig.sqlite-wal      # SQLite write-ahead log
├── context/                # Context library (`context.root`)
│   └── system/
│       └── system-world.yaml  # System World baseline context
├── skills/                 # Managed skill catalog (`skills.root`)
├── workspace/              # Default project work tree (`workspace.root`)
│   ├── SPEC.md             # Top-level workspace intent
│   ├── project.yaml        # Project context & skill selectors
│   ├── workspace.yaml      # Project catalog mapping IDs to paths
│   ├── .gitignore
│   ├── missions/           # Authored missions
│   └── exhaust/            # Non-versioned runtime outputs
├── specs/                  # Canonical spec library (rig and agent definitions)
├── topology/               # Continuity trees for rigs, pods, and seats
├── plugins/                # Managed OpenRig plugins
├── run/                    # Runtime sockets and PID coordination files
├── logs/                   # Process and operation logs
│   ├── daemon.log          # Daemon standard output
│   └── daemon-err.log      # Daemon error output
├── transcripts/            # Durable per-seat terminal transcripts
├── backups/                # Recovery and snapshot archives
├── secrets/                # Connector credentials & host secrets
└── bundle-imports/         # Pinned bundle archives and `bundle-audit.jsonl`
```

### Key Files in `$OPENRIG_HOME`

| Path | Purpose & Intention |
| :--- | :--- |
| `config.json` | Stores global settings (HTTP port, host bind, feature flags). Created as an empty JSON object `{}` if absent. Updated atomically. |
| `openrig.sqlite` | The single source of truth for the daemon. Stores registered rigs, pods, seats, queue items, telemetry, and operating posture bindings. |
| `context/system/system-world.yaml` | Declares the baseline rules and skills provided to all agents in the instance. |
| `workspace/workspace.yaml` | The catalog connecting project IDs to their directory roots on disk and associated rigs. |
| `transcripts/` | Captures terminal logs from each seat so you can inspect agent output after sessions close. |

---

## 2. Managing Configuration with the CLI

You can read and modify `$OPENRIG_HOME/config.json` using `rig config`:

```bash
# View all effective configuration values
rig config dump

# Get a specific setting
rig config get daemon.port

# Change a setting (e.g., bind host or port)
rig config set daemon.port 7433
rig config set daemon.host 127.0.0.1

# Re-scaffold the default workspace if needed
rig config init-workspace
```

### Common Configuration Keys

| Config Key | Environment Variable | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `daemon.port` | `OPENRIG_PORT` | `7433` | Port for the local daemon HTTP server. |
| `daemon.host` | `OPENRIG_HOST` | `127.0.0.1` | Local bind address (`127.0.0.2` recommended for WSL2 mirrored networking). |
| `context.root` | `OPENRIG_CONTEXT_ROOT` | `$OPENRIG_HOME/context` | Location of installed context packs. |
| `workspace.root` | `OPENRIG_WORKSPACE_ROOT`| `$OPENRIG_HOME/workspace` | Root directory for project missions and specs. |
| `skills.root` | `OPENRIG_SKILLS_ROOT` | `$OPENRIG_HOME/skills` | Managed catalog of reusable agent skills. |

---

## 3. User-Level Files Modified by OpenRig

During `rig setup` and daemon initialization, OpenRig configures necessary integration hooks with your shell and harness runtimes:

### 1. Terminal & Multiplexer (`~/.tmux.conf`)
- **What changes:** `rig setup` adds a clearly marked `# BEGIN OpenRig configuration` block.
- **Why:** Enables mouse scrolling, 50,000-line scrollback buffer, and UTF-8 pane handling required for multi-agent terminal management.

### 2. Claude Code Integration
- **`~/.claude.json` / `<CLAUDE_CONFIG_DIR>/.claude.json`:** OpenRig marks workspace trust and onboarding completion for project paths where Claude Code operates.
- **`~/.claude/settings.json`:** OpenRig registers discovery skills. It does *not* inject arbitrary command allowlists without your explicit approval.
- **`~/.claude/skills/`:** Seeds links to `openrig-skills`, `refocusing`, and `rigs`.

### 3. Codex Integration
- **`~/.codex/config.toml` (`CODEX_HOME`):**
  - Enables Codex activity hooks.
  - Registers the OpenRig activity relay commands with trusted execution hashes.
  - Configures default sandbox workspace permissions.
- **`~/.agents/skills/`:** Seeds OpenRig skills for Codex and agents following the Agent Skills Standard.

---

## 4. Repository-Local Files (Inside Your Codebase)

When a rig runs in your repository (e.g., `/path/to/my-repo`), OpenRig projects runtime files to connect the agent sessions to the daemon. 

### Why You Must Exclude OpenRig Files in Git

OpenRig writes runtime projections directly into the workspace. **These files should never be committed into your Git history.**

To protect your repository, add this one-liner to your repository's local Git exclude file:

```bash
printf '%s\n' CLAUDE.local.md AGENTS.md /.openrig/ .claude/settings.local.json gate-lane-verdict.json >> .git/info/exclude
```

*(Note: `.git/info/exclude` is local to your machine and clone; it will not dirty your `.gitignore` or appear in pull requests.)*

### Files Created Inside the Working Repository

| Path | Purpose & Intention |
| :--- | :--- |
| `/.openrig/` | Ephemeral runtime directory containing skill loadouts, context status collectors, and ownership receipts. |
| `.claude/settings.local.json` | Configures Claude Code's statusLine collector and telemetry hooks for the local daemon. |
| `.codex/plugins/shared:openrig-core/` | Activity relay hooks for Codex sessions. |
| `CLAUDE.local.md` & `AGENTS.md` | Local guidance files generated for agent startup (kept untracked via `.git/info/exclude`). |

---

## 5. Security & Permission Boundary

OpenRig runs in your **trusted local environment**. Here is how permissions work:

1. **Default Team Launch:**
   - Claude Code runs with `acceptEdits`. It can edit files, read projects, and execute common test and `rig` commands without asking. High-impact lifecycle commands (`rig up`, `rig down`) still require interactive confirmation.
   - Codex runs with `-s workspace-write`. The workspace directory and state directory are writable. Network access is enabled so Codex can talk to the local daemon at `127.0.0.1:7433`.
2. **Explicit Allowances:**
   - Agent-guided setup offers to remember standard `rig` commands in your personal settings only if you explicitly choose to approve them.
3. **Non-Interruptive Mode:**
   - Specialized bundles (like the `workshop` bundle) can enable `non-interruptive-mode: true` in their spec to eliminate repetitive prompt friction during unattended runs.

---

### Continue Reading
👉 Proceed to [**Chapter 03: Onboarding Your First Project**](03-onboarding-your-first-project.md)
