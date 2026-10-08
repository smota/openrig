# Chapter 03: Onboarding Your First Project

Now that you understand the concepts and file layout, let us onboard your first codebase into OpenRig. 

Whether your project is written in TypeScript, Python, Go, Rust, or C++, the onboarding contract is uniform. This chapter walks you through connecting your repository to OpenRig cleanly and safely.

---

## The Onboarding Mental Model

Connecting a project to OpenRig consists of three distinct steps:

```
┌─────────────────────────────────┐
│ 1. Git Hygiene                  │ Prevent OpenRig runtime projections from
│    `.git/info/exclude`          │ dirtying your commits.
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 2. Catalog Registration         │ Register your repository root in
│    `workspace.yaml`             │ OpenRig's project catalog.
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 3. Intent & Context Setup       │ Define what the project is (`SPEC.md` /
│    `project.yaml` & context     │ `project.yaml`) so agents understand goals.
└─────────────────────────────────┘
```

---

## Step 1: Git Hygiene in Your Repository

OpenRig agents write local instruction files (`CLAUDE.local.md`, `AGENTS.md`), telemetry configurations (`.claude/settings.local.json`), and temporary caches (`.openrig/`) into the active project directory.

To ensure your Git status remains completely clean without editing the project's tracked `.gitignore`, add these entries to your local `.git/info/exclude`:

```bash
cd /path/to/your/repository

# Append OpenRig runtime paths to your local git exclude file:
printf '%s\n' CLAUDE.local.md AGENTS.md /.openrig/ .claude/settings.local.json gate-lane-verdict.json >> .git/info/exclude
```

> [!TIP]
> **Why `.git/info/exclude` instead of `.gitignore`?**
> `.git/info/exclude` is private to your local clone. It will never be committed, will never show up in pull requests, and will apply to any git worktrees created by your agents.

Verify that your working tree is clean:

```bash
git status
```

---

## Step 2: Registering Your Project in the Workspace Catalog

OpenRig tracks projects in a central catalog located at `$OPENRIG_HOME/workspace/workspace.yaml`.

This catalog tells OpenRig:
1. What the project is called (`id`).
2. Where the project lives on disk (`root`).
3. Which rigs are assigned to work on it (`rigs`).

### Inspecting Your Catalog

Check if `$OPENRIG_HOME/workspace/workspace.yaml` exists:

```bash
cat ~/.openrig/workspace/workspace.yaml 2>/dev/null
```

If it does not exist, initialize the default workspace:

```bash
rig config init-workspace
```

### Adding Your Project

Open `~/.openrig/workspace/workspace.yaml` in your editor and add your project:

```yaml
schema: openrig.workspace/v0alpha1
projects:
  - id: default
    root: .
  - id: my-app
    root: /home/sam/code/my-app
    rigs: [starter, workshop]
```

### How OpenRig Resolves Which Project to Use

When an agent or command runs, OpenRig determines the active project using this strict order:
1. An explicit `--project <id>` CLI flag.
2. If only one project is declared in the catalog, it selects that one.
3. The project whose catalog entry explicitly lists the calling seat's rig in `rigs: [...]`.
4. The deepest declared project `root` that contains the working directory (`--cwd`).
5. The only unclaimed project (one that lists no `rigs`).

---

## Step 3: Defining Project Intent (`project.yaml` & `SPEC.md`)

Agents work best when given an authoritative source of truth about what the project is and what standards apply.

In the root of your project (or under `$OPENRIG_HOME/workspace/projects/<id>/`), create a `project.yaml`:

```yaml
schema: openrig.project/v0alpha1
kind: project
install:
  intent: SPEC.md
  context:
    - README.md
    - docs/architecture.md
  skills:
    - repository-maintenance
```

### Authoring the Initial `SPEC.md`

Create a `SPEC.md` in your project root to define high-altitude intent:

```markdown
# Project Intent

## Intent
Build and maintain the core features of `my-app`, preserving test coverage and clean architecture.

## Mini-requirements
1. All changes must pass existing unit and integration tests.
2. New features must include automated test coverage.
3. Every commit must be verified locally before review handoff.

## Proof contract
- [ ] Build passes cleanly (`npm run build` or `cargo build`)
- [ ] Test suite passes without warnings
- [ ] Changes verified against running local service
```

---

## Step 4: Adding Context Packs

OpenRig allows you to inject structured context packs that teach agents project-specific conventions.

For example, to load the canonical OpenRig public context pack (which teaches agents how to prove changes and navigate OpenRig):

```bash
rig context add --git https://github.com/mvschwarz/openrig-world.git
```

Verify installed context packs:

```bash
rig context list
```

You can preview how an agent will read this context:

```bash
rig context profile openrig-world --situation fresh
```

---

## Step 5: Resolving & Testing the Project Environment

To test that OpenRig correctly resolves your project settings and skills without launching a full rig, run:

```bash
# Preview what context and skills OpenRig resolves for your project
rig context work-install --project my-app --runtime claude-code --json
```

If you want to project the resolved skills into your local harness directories (`.claude/skills/` or `.agents/skills/`), add `--apply-skills`:

```bash
rig context work-install --project my-app --runtime claude-code --apply-skills --cwd /path/to/your/repository
```

---

## Step 6: Isolation Best Practice — Git Worktrees

In multi-agent setups (like `workshop` or `factory`), multiple agents may write and test code simultaneously. 

If multiple agents edit files in the exact same working directory, their edits will collide. OpenRig builders (such as `dev-build@workshop`) are designed to create and operate inside isolated **Git worktrees**:

```text
/home/sam/code/my-app/            # Main repository checkout (operator view)
├── .git/
└── ...
/home/sam/code/my-app/.worktrees/ # Agent worktrees
    ├── feat-auth/                # Builder worktree
    └── fix-cache/                # Builder worktree
```

Ensure your repository's build system and dependencies support worktree checkouts (e.g. running `npm install` or running build tools per worktree).

---

### Continue Reading
👉 Proceed to [**Chapter 04: Choosing & Operating Your First Rig**](04-operating-your-first-rig.md)
