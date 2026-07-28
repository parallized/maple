# Maple managed runtime

Maple CLI owns its agent runtime. Starting any installed CLI creates and maintains:

```text
~/.maple/runtime/
  mcp/mcp.json
  skills/maple/SKILL.md
  playwright/
  artifacts/
```

The MCP server is the CLI's built-in `maple mcp` command. It only exposes the current process role, project directory and managed Skill location. Task state and reports continue to flow through the authenticated Server API; MCP is not an alternate authorization path.

PM and Worker prompts include the managed Skill and MCP paths. Codex receives an invocation-scoped MCP configuration, and Claude receives `--mcp-config`. Maple does not write into `.codex`, `.claude`, `.gemini`, `.iflow` or `.windsurf`.

Playwright and Chromium are installed below `~/.maple/runtime/playwright`, with `PLAYWRIGHT_BROWSERS_PATH` pinned to that directory. No dependency or browser cache is written into a project directory.

Use the Server-hosted installers:

```powershell
irm https://your-maple-host/install.ps1 | iex
```

```sh
curl -fsSL https://your-maple-host/install.sh | sh
```

Set `MAPLE_SKIP_PLAYWRIGHT_INSTALL=1` before installation only when screenshot acceptance is intentionally unavailable.
