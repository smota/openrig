# Chapter 06: Troubleshooting & Operator Diagnostics

When orchestrating multiple AI agents, processes, and terminal sessions, unexpected conditions can arise. OpenRig provides rich diagnostic tools to quickly identify what is happening and get your team unstuck.

---

## 1. The 4-Step Triage Ladder

Whenever something seems wrong or unresponsive, run these four commands in order:

```bash
# Step 1: Check OpenRig version
rig --version

# Step 2: Run automated environment diagnostics
rig doctor --json

# Step 3: Check daemon status and port connectivity
rig daemon status

# Step 4: Check individual seat states in your active rig
rig ps --nodes --rig <rig-name>
```

---

## 2. Common Friction Points & Remedies

### Problem A: Seat Is Stuck at a Permission Prompt

**Symptom:**  
`rig ps` reports seat status as `prompt_waiting` or `starting` indefinitely, or an agent pauses without executing shell commands.

**Cause:**  
- Claude Code or Codex is waiting for interactive user permission to execute a tool, write to a file, or access the network.
- Claude Code's auto-mode occasionally flags certain actions (such as `[Create Unsafe Agents]` or `[Self-Modification]`).
- Codex's sandbox may block network requests if not properly configured.

**Remedy:**  
1. Attach to the seat's tmux window or open the Herdr workspace:
   ```bash
   rig terminal open saved:kernel --window
   # or attach directly:
   tmux attach-session -t openrig-<rig-name>
   ```
2. Read the prompt in the seat's pane and grant the requested permission (e.g., press `y` or approve the tool).
3. If the seat paused before ingesting startup context, deliver it with:
   ```bash
   rig seat continue <seat-name>@<rig-name>
   ```

> [!TIP]
> **Want to eliminate permission friction?**  
> Use the [**workshop bundle**](https://github.com/mvschwarz/openrig-world/tree/main/rigs/workshop). It ships with broad access and **non-interruptive mode** enabled, allowing agents to execute safely without stalling on interactive confirmation prompts.

---

### Problem B: Daemon Won't Start or Port 7433 Unresponsive

**Symptom:**  
`rig daemon start` fails with:
```text
Daemon on port 7433 is unresponsive, and daemon state is missing — recover it before starting a new daemon.
```

**Cause:**  
1. Another process is occupying port 7433.
2. Under **WSL2** with experimental `networkingMode=mirrored` and `firewall=true`, Windows Defender Firewall's Stealth Mode drops closed-port TCP SYN packets, triggering OpenRig's pre-flight port safety probe timeout.

**Remedy for WSL2 Mirrored Networking:**  
Bind OpenRig to `127.0.0.2` (which stays on the Linux kernel's local `lo` loopback interface and is not intercepted by Windows Firewall):

```bash
# Configure daemon host to 127.0.0.2
rig config set daemon.host 127.0.0.2

# Start the daemon
rig daemon start
```

**General Daemon Recovery:**  
Inspect the daemon log files to see the exact crash or port conflict error:

```bash
# Print daemon logs
rig daemon logs

# Or inspect the log files directly
tail -n 100 ~/.openrig/logs/daemon-err.log
```

---

### Problem C: Desktop Window (`--window`) Doesn't Open

**Symptom:**  
Running `rig terminal open saved:kernel --window` prints an error or nothing happens.

**Cause:**  
- You are connected over a headless SSH session without an X11/Wayland display.
- macOS has not granted Automation permissions to Terminal / Ghostty.

**Remedy:**  
1. **Headless / SSH fallback:** Use the shared TUI dashboard instead:
   ```bash
   rig tui --shared
   ```
2. **Direct tmux attachment:**
   ```bash
   tmux list-sessions
   tmux attach-session -t openrig-kernel
   ```
3. **Herdr First-Run Panels:** If Herdr opens with welcome modals, press `Return` to advance and `Esc` to dismiss dialogs.

---

### Problem D: Seat Process Crashed or Unresponsive

**Symptom:**  
A seat shows `errored`, `stopped`, or has stopped replying to `rig send`.

**Remedy:**  
1. Capture the latest output from the seat:
   ```bash
   rig capture <seat>@<rig>
   ```
2. Inspect the durable session transcript:
   ```bash
   cat ~/.openrig/transcripts/<rig>-<seat>.log | tail -n 50
   ```
3. Restart the specific seat cleanly without terminating the entire rig:
   ```bash
   rig restart <seat>@<rig>
   ```

---

## 3. Gathering Diagnostics & Getting Help

If you encounter an issue that you cannot resolve:

1. **Dump environment diagnostics:**
   ```bash
   rig doctor --json > openrig-doctor.json
   ```
2. **Capture recent daemon logs:**
   ```bash
   tail -n 200 ~/.openrig/logs/daemon.log > openrig-daemon.log
   tail -n 200 ~/.openrig/logs/daemon-err.log >> openrig-daemon.log
   ```
3. **Contact OpenRig Support:**
   - Email **hello@openrig.dev** with your diagnostic output and description. No GitHub account is required.
   - Or open a discussion in [GitHub Discussions Q&A](https://github.com/mvschwarz/openrig/discussions/categories/q-a).

---

### End of Onboarding Guide
🎉 **You are now fully equipped to operate OpenRig.**  
Return to the [**Onboarding Guide Index**](index.md) or explore the advanced references in `openrig/docs/reference/`.
