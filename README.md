# maple

Maple is a cross-platform AI-agent project workspace.

This repository is initialized as a monorepo so web, desktop, and mobile clients can share the same domain model, agent runtime contracts, and Notion bridge code.

## Workspace layout

- `apps/web`: browser client bootstrap
- `apps/desktop`: desktop client bootstrap (Windows/macOS target)
- `apps/mobile`: mobile client bootstrap (Android-first)
- `packages/kanban-core`: task domain model and status helpers
- `packages/agent-runtime`: multi-agent execution interfaces
- `packages/notion-bridge`: minimal Notion API helper for active-task query
- `docs`: product and technical planning notes

## Quick start

1. Install `pnpm` (v9 or newer).
2. Run `pnpm install`.
3. Run `pnpm typecheck`.

## Next milestones

- Replace app bootstraps with real UI stacks (React/Tauri/React Native).
- Add persistence and auth flow for Notion OAuth/API keys.
- Add adapters for Claude, Codex, and iFlow execution.
- Add CI for lint/typecheck/build.
