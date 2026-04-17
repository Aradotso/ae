---
name: ae
description: |
  Complete guide to cmux — AI-native terminal multiplexer. Covers topology control (windows/workspaces/panes/surfaces), terminal splits, browser automation (WKWebView, Playwright-style API), markdown viewer, sidebar status/progress, notifications, and multi-agent team coordination.
triggers:
  - "use cmux"
  - "open a split"
  - "cmux browser"
  - "browser automation"
  - "agent workspace"
  - "parallel splits"
  - "cmux send command"
  - "set status"
  - "set progress"
  - "markdown viewer"
  - "agent teams"
  - "claude teams"
---

# cmux

cmux is a macOS terminal multiplexer with a programmable CLI/socket API built for AI coding agents. It provides terminal splits, an embedded WKWebView browser with a Playwright-style API, sidebar status/progress reporting, notifications, and multi-agent team coordination.

---

## Orient Yourself First

```bash
cmux identify --json        # who/where am I? returns window/workspace/pane/surface refs
cmux list-windows
cmux list-workspaces
cmux list-panes
cmux list-pane-surfaces --pane pane:1
```

Env vars auto-set in every cmux terminal:
- `$CMUX_SURFACE_ID` — current surface ref
- `$CMUX_WORKSPACE_ID` — current workspace ref

**Handle model:** short refs everywhere — `window:N`, `workspace:N`, `pane:N`, `surface:N`. UUIDs accepted as input; only request UUID output when needed (`--id-format uuids|both`).

---

## Topology

```bash
# Workspaces (tabs)
cmux new-workspace --name "feat/x"
cmux workspace-action --action rename --workspace workspace:2 --title "build"

# Splits
cmux --json new-split right    # side-by-side (preferred for parallel work)
cmux --json new-split down     # stacked (good for logs)

# Surface management
cmux focus-pane --pane pane:2
cmux move-surface --surface surface:7 --pane pane:2 --focus true
cmux reorder-surface --surface surface:7 --before surface:3
cmux close-surface --surface surface:7
cmux swap-pane --pane pane:1 --target-pane pane:2

# Attention cue
cmux trigger-flash --surface surface:7
```

---

## Terminal Splits

### Capture the ref immediately

```bash
WORKER=$(cmux --json new-split right | python3 -c "import sys,json; print(json.load(sys.stdin)['surface_ref'])")
```

### Send commands and read output

```bash
cmux send-surface --surface "$WORKER" "npm run build\n"   # \n to execute
cmux send-key-surface --surface "$WORKER" ctrl-c
cmux send-key-surface --surface "$WORKER" enter
cmux capture-pane --surface "$WORKER"              # current screen
cmux capture-pane --surface "$WORKER" --scrollback # full history
```

**Never steal focus** — always use `--surface` targeting.

### Worker split pattern

```bash
WORKER=$(cmux --json new-split right | python3 -c "import sys,json; print(json.load(sys.stdin)['surface_ref'])")
cmux send-surface --surface "$WORKER" "make test 2>&1; echo EXIT_CODE=\$?\n"
sleep 3
cmux capture-pane --surface "$WORKER"
cmux close-surface --surface "$WORKER"
```

---

## Browser Automation

Browser engine: **WKWebView** (Apple-native, Playwright-style API ported from `vercel-labs/agent-browser`). No external Chrome required.

### Stable loop

```
navigate → get url → wait for load → snapshot --interactive → act with refs → re-snapshot
```

### Open and navigate

```bash
BROWSER=$(cmux --json browser open https://example.com | python3 -c "import sys,json; print(json.load(sys.stdin)['surface_ref'])")
cmux browser $BROWSER get url
cmux browser $BROWSER goto https://other.com
cmux browser $BROWSER back
cmux browser $BROWSER forward
cmux browser $BROWSER reload
cmux browser $BROWSER get title
```

### Snapshot and element refs

Snapshot returns stable element refs (`e1`, `e2`, ...) instead of CSS selectors. Refs go stale after DOM mutations — always re-snapshot after navigation or clicks.

```bash
cmux browser $BROWSER wait --load-state complete --timeout-ms 15000
cmux browser $BROWSER snapshot --interactive
cmux browser $BROWSER snapshot --interactive --compact
cmux browser $BROWSER snapshot --selector "form#login" --interactive  # scoped

# Auto re-snapshot after action
cmux --json browser $BROWSER click e2 --snapshot-after
```

### Interact

```bash
# Click
cmux browser $BROWSER click e1
cmux browser $BROWSER dblclick e2
cmux browser $BROWSER hover e3
cmux browser $BROWSER focus e4

# Input
cmux browser $BROWSER fill e5 "hello@example.com"   # clear + type
cmux browser $BROWSER fill e5 ""                      # clear only
cmux browser $BROWSER type e6 "search"                # type without clearing

# Keys
cmux browser $BROWSER press Enter
cmux browser $BROWSER press Tab
cmux browser $BROWSER keydown Shift

# Forms
cmux browser $BROWSER check e7
cmux browser $BROWSER uncheck e7
cmux browser $BROWSER select e8 "option-value"

# Scroll
cmux browser $BROWSER scroll --dy 500
cmux browser $BROWSER scroll --selector ".container" --dy 300
cmux browser $BROWSER scroll-into-view e9
```

### Wait

```bash
cmux browser $BROWSER wait --load-state complete --timeout-ms 15000
cmux browser $BROWSER wait --selector "#ready" --timeout-ms 10000
cmux browser $BROWSER wait --text "Success" --timeout-ms 10000
cmux browser $BROWSER wait --url-contains "/dashboard" --timeout-ms 10000
cmux browser $BROWSER wait --function "document.readyState === 'complete'" --timeout-ms 10000
```

### Read page content

```bash
cmux browser $BROWSER get text body
cmux browser $BROWSER get html body
cmux browser $BROWSER get value e5
cmux browser $BROWSER get attr e9 --attr href
cmux browser $BROWSER get count ".items"
cmux browser $BROWSER get box e1           # bounding box
cmux browser $BROWSER get styles e1 --property color

cmux browser $BROWSER is visible "#modal"
cmux browser $BROWSER is enabled "#submit"
cmux browser $BROWSER is checked "#agree"
```

### Locators (Playwright-style)

```bash
cmux browser $BROWSER find role button
cmux browser $BROWSER find text "Sign In"
cmux browser $BROWSER find label "Email"
cmux browser $BROWSER find placeholder "Enter email"
cmux browser $BROWSER find testid "submit-btn"
cmux browser $BROWSER find first ".item"
cmux browser $BROWSER find nth ".item" 3
```

### JS evaluation

```bash
cmux browser $BROWSER eval "document.title"
cmux browser $BROWSER eval "document.querySelectorAll('.item').length"
cmux browser $BROWSER eval "window.scrollTo(0, document.body.scrollHeight)"
```

### Frames, dialogs, tabs

```bash
cmux browser $BROWSER frame "#iframe-selector"
cmux browser $BROWSER frame main
cmux browser $BROWSER dialog accept
cmux browser $BROWSER dialog dismiss "prompt text"
cmux browser $BROWSER tab new
cmux browser $BROWSER tab list
cmux browser $BROWSER tab 2
```

### Cookies, storage, state

```bash
cmux browser $BROWSER cookies get
cmux browser $BROWSER cookies set session_token "abc123"
cmux browser $BROWSER cookies clear
cmux browser $BROWSER storage local get
cmux browser $BROWSER storage local set myKey "myValue"
cmux browser $BROWSER storage session clear

# Save/restore full session (cookies + storage + tabs)
cmux browser $BROWSER state save ./auth-state.json
cmux browser $BROWSER state load ./auth-state.json
```

### Authentication pattern

```bash
BROWSER=$(cmux --json browser open https://app.example.com/login | python3 -c "import sys,json; print(json.load(sys.stdin)['surface_ref'])")
cmux browser $BROWSER wait --load-state complete --timeout-ms 15000
cmux browser $BROWSER snapshot --interactive
cmux browser $BROWSER fill e1 "user@example.com"
cmux browser $BROWSER fill e2 "my-password"
cmux --json browser $BROWSER click e3 --snapshot-after
cmux browser $BROWSER wait --url-contains "/dashboard" --timeout-ms 20000
cmux browser $BROWSER state save ./auth-state.json
```

### Script injection and diagnostics

```bash
cmux browser $BROWSER addscript "console.log('injected')"
cmux browser $BROWSER addstyle "body { background: red; }"
cmux browser $BROWSER addinitscript "window.__injected = true"
cmux browser $BROWSER screenshot
cmux browser $BROWSER console list
cmux browser $BROWSER errors list
cmux browser $BROWSER highlight e1
```

### WKWebView limits (not supported)

These return `not_supported` — no CDP in WKWebView:
- viewport/device emulation
- offline emulation
- trace/screencast recording
- network route interception/mocking
- low-level raw input injection

Fall back to `get text body` / `get html body` when `snapshot --interactive` returns `js_error`.

---

## Markdown Viewer

Open a markdown file in a live-reload split panel alongside the terminal.

```bash
cmux markdown open plan.md
cmux markdown open /path/to/PLAN.md
cmux markdown open plan.md --workspace workspace:2
cmux markdown open plan.md --surface surface:5
```

Panel auto-updates when the file changes on disk. Useful for agent plans, task lists, docs. Renders headings, code blocks, tables, lists, links, images (light + dark mode).

**Pattern — write plan, then show it:**

```bash
cat > plan.md << 'EOF'
# Plan
1. Step one
2. Step two
EOF
cmux markdown open plan.md
# Panel live-reloads as you append steps
echo "3. Step three" >> plan.md
```

---

## Sidebar Status, Progress, Logs, Notifications

Show live status without interrupting the user's flow.

```bash
# Status badge
cmux set-status agent "working" --icon hammer --color "#ff9500"
cmux set-status agent "done" --icon checkmark --color "#34c759"
cmux clear-status agent

# Progress bar
cmux set-progress 0.33 --label "Building..."
cmux set-progress 1.0 --label "Complete"
cmux clear-progress

# Log messages
cmux log "Starting build"
cmux log --level success "All tests passed"
cmux log --level error --source build "Compilation failed"

# Notifications
cmux notify --title "Task Complete" --body "All tests passing"
cmux notify --title "Need Input" --subtitle "Approval" --body "Approve deployment?"
```

---

## Multi-Agent Teams

Coordinate parallel subagents with cmux splits so all work is visible to the user.

### Pattern

1. Create splits for each teammate before spawning
2. Pass each agent its surface ref in the prompt
3. Agents run commands via `cmux send-surface`, report via `cmux set-status` / `cmux log`
4. Coordinate via SendMessage — not by reading each other's terminal output
5. Clean up with `cmux close-surface` when done

```bash
BUILD=$(cmux --json new-split right | python3 -c "import sys,json; print(json.load(sys.stdin)['surface_ref'])")
TEST=$(cmux --json new-split down  | python3 -c "import sys,json; print(json.load(sys.stdin)['surface_ref'])")
DOCS=$(cmux --json browser open https://docs.example.com | python3 -c "import sys,json; print(json.load(sys.stdin)['surface_ref'])")
```

Teammate prompt template:
```
You have cmux surface $BUILD.
Run:    cmux send-surface --surface $BUILD "command\n"
Read:   cmux capture-pane --surface $BUILD
Status: cmux set-status build "working" --icon hammer
Log:    cmux log "message"
Never steal focus — always use --surface targeting.
```

**Rules:**
- Never spawn `claude -p` directly in splits — use the Agent tool
- Create all splits before spawning teammates
- One split per teammate
- Always clean up surfaces when done

---

## Status-Driven Long Task Pattern

```bash
cmux set-status task "starting" --icon clock --color "#ff9500"
cmux set-progress 0.0 --label "Initializing..."
# step 1
cmux set-progress 0.33 --label "Building..."
# step 2
cmux set-progress 0.66 --label "Testing..."
# step 3
cmux set-progress 1.0 --label "Done"
cmux set-status task "complete" --icon checkmark --color "#34c759"
cmux clear-progress
cmux notify --title "Task complete" --body "All steps passed"
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Where am I? | `cmux identify --json` |
| Split right | `cmux --json new-split right` |
| Split down | `cmux --json new-split down` |
| Send command | `cmux send-surface --surface <ref> "cmd\n"` |
| Read output | `cmux capture-pane --surface <ref>` |
| Read full history | `cmux capture-pane --surface <ref> --scrollback` |
| Close surface | `cmux close-surface --surface <ref>` |
| Flash attention | `cmux trigger-flash --surface <ref>` |
| Open browser | `cmux --json browser open <url>` |
| Snapshot | `cmux browser <ref> snapshot --interactive` |
| Click | `cmux browser <ref> click e1` |
| Fill | `cmux browser <ref> fill e1 "text"` |
| Wait load | `cmux browser <ref> wait --load-state complete --timeout-ms 15000` |
| Read text | `cmux browser <ref> get text body` |
| Eval JS | `cmux browser <ref> eval "expr"` |
| Save auth | `cmux browser <ref> state save ./auth.json` |
| Load auth | `cmux browser <ref> state load ./auth.json` |
| Screenshot | `cmux browser <ref> screenshot` |
| Open markdown | `cmux markdown open plan.md` |
| Set status | `cmux set-status <key> "text" --icon <name>` |
| Progress | `cmux set-progress 0.5 --label "Working..."` |
| Log | `cmux log "message"` |
| Notify | `cmux notify --title "T" --body "B"` |
