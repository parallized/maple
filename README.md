# maple

Maple is a cross-platform AI-agent project workspace.

This repository is initialized as a monorepo so web, desktop, and mobile clients can share the same domain model and agent runtime contracts.

## Workspace layout

- `apps/web`: browser client bootstrap
- `apps/desktop`: desktop client bootstrap (Windows/macOS target)
- `apps/mobile`: mobile client bootstrap (Android-first)
- `packages/kanban-core`: task domain model and status helpers
- `packages/agent-runtime`: multi-agent execution interfaces
- `packages/mcp-tools`: MCP query helpers for TODO/context lookup
- `packages/worker-skills`: reusable worker prompt/skill templates
- `docs`: product and technical planning notes

## Quick start

1. Install `pnpm` (v9 or newer).
2. Run `pnpm install`.
3. Run `pnpm typecheck`.

## MCP / Skills setup

- `docs/mcp-skills-setup.md`
- `docs/windsurf-maple-setup.md`
- `scripts/installers/` (one-click installers for Codex / Claude / iFlow / Windsurf)
- `scripts/maple-install.sh` (single entry for all installers)

## Next milestones

- Replace app bootstraps with real UI stacks (React/Tauri/React Native).
- Add adapters for Claude, Codex, and iFlow execution.
- Add CI for lint/typecheck/build.
