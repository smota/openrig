# OpenRig Onboarding Guide: The New Operator's Handbook

Welcome to OpenRig. If you have completed installation and run `rig setup`, you are in the right place. 

OpenRig turns AI coding agents (Claude Code, Codex, Pi, and custom runners) from isolated terminal sessions into a coordinated, persistent, and accountable team. This handbook is designed for you—the human operator. It guides you from your very first post-install check all the way to operating an autonomous agent rig on your existing repositories.

---

## How to Navigate This Guide

This documentation is structured using a progressive disclosure model. Whether you want to launch a team in five minutes or deeply understand the configuration and contracts under the hood, choose the path that fits your goals:

```
                  ┌────────────────────────────────────────┐
                  │          Post-Installation             │
                  │   `rig --version` & `rig doctor`       │
                  └───────────────────┬────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
   ┌───────────────────────────┐             ┌───────────────────────────┐
   │    Fast Path (Hands-On)   │             │ Deep Path (Foundational)  │
   │  Get agents working now   │             │  Understand how it works  │
   └─────────────┬─────────────┘             └─────────────┬─────────────┘
                 │                                         │
                 │   ┌─────────────────────────────────┐   │
                 └──►│ 01. Core Architecture & Mental  │◄──┘
                     │     Model                       │
                     └────────────────┬────────────────┘
                                      ▼
                     ┌─────────────────────────────────┐
                     │ 02. Configuration, Storage &    │
                     │     Machine State               │
                     └────────────────┬────────────────┘
                                      ▼
                     ┌─────────────────────────────────┐
                     │ 03. Onboarding Your First       │
                     │     Project                     │
                     └────────────────┬────────────────┘
                                      ▼
                     ┌─────────────────────────────────┐
                     │ 04. Choosing & Operating Your   │
                     │     First Rig                   │
                     └────────────────┬────────────────┘
                                      ▼
                     ┌─────────────────────────────────┐
                     │ 05. Daily Workflows, SDLC &     │
                     │     Craft                       │
                     └────────────────┬────────────────┘
                                      ▼
                     ┌─────────────────────────────────┐
                     │ 06. Troubleshooting & Operator  │
                     │     Diagnostics                 │
                     └─────────────────────────────────┘
```

---

## The Handbook Chapters

| Chapter | Title | What It Covers |
| :--- | :--- | :--- |
| [**01. Core Architecture & Mental Model**](01-core-concepts.md) | The Anatomy of OpenRig | Demystifies Rigs, Pods, Seats, Harnesses, the Daemon, the Kernel, Context Packs, Missions, Slices, and the Queue. |
| [**02. Configuration, Storage & Machine State**](02-configuration-and-storage.md) | File Locations & Intention | Every configuration file, default location, environment variable, and change made to `$OPENRIG_HOME`, `~/.tmux.conf`, provider settings, and project repositories. |
| [**03. Onboarding Your First Project**](03-onboarding-your-first-project.md) | Bringing Your Repository In | Step-by-step setup for an existing codebase: Git hygiene (`.git/info/exclude`), workspace cataloging (`workspace.yaml`), project manifests (`project.yaml`), intent specs (`SPEC.md`), and context projection. |
| [**04. Choosing & Operating Your First Rig**](04-operating-your-first-rig.md) | Launching & Driving Teams | Comparing `starter` vs `workshop`, previewing topologies with `--plan`, booting with `rig up`, monitoring via TUI and tmux, assigning tasks with `rig send`, tracking the queue, and lifecycle snapshot/restore. |
| [**05. Daily Workflows, SDLC & Craft**](05-daily-workflows-and-craft.md) | How Work Gets Done | The full loop: Intent → Plan → Build → Proof → Review. Operating postures (`human-led` vs `delegated`), task batons, proof-by-effect principles, and handling context compactions. |
| [**06. Troubleshooting & Operator Diagnostics**](06-troubleshooting-and-diagnostics.md) | Getting Unstuck | Practical remedies for harness permission blocks, stuck seats, port 7433 loopback issues (including WSL2 mirrored networking), reading daemon logs, and recovering state. |

---

## 1-Minute Sanity Check: Is OpenRig Ready?

Before jumping into your first project, run these three quick commands in your terminal to verify that your environment is healthy:

```bash
# 1. Verify CLI installation
rig --version

# 2. Run system diagnostic (checks Node 22/24, tmux, SQLite, and provider logins)
rig doctor

# 3. Ensure the local daemon is running
rig daemon status
```

If `rig daemon status` reports stopped, start it with:

```bash
rig daemon start
```

If you see green checkmarks across `rig doctor`, your system is ready. Let us proceed to understanding the core concepts.

---

### Continue Reading
👉 Proceed to [**Chapter 01: Core Architecture & Mental Model**](01-core-concepts.md)
