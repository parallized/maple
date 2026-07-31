/**
 * Audited subset of DeepSeek's official Codex model catalog (2026-07-31).
 * Maple currently exposes only the model that officially supports Responses/Codex.
 */
const DEEPSEEK_CODEX_BASE_INSTRUCTIONS = `You are Codex, a coding agent. Collaborate with the user in the current workspace until their goal is genuinely handled. Follow the active system, developer, project, and user instructions; inspect the relevant code before changing it; make scoped edits; verify the result in proportion to risk; and report the outcome clearly. Use the provided tools when needed and preserve unrelated user changes.`;

export const DEEPSEEK_CODEX_MODELS_JSON = `${JSON.stringify({
  models: [
    {
      slug: "deepseek-v4-flash",
      prefer_websockets: false,
      support_verbosity: true,
      default_verbosity: "low",
      apply_patch_tool_type: "freeform",
      web_search_tool_type: "text",
      input_modalities: ["text"],
      supports_image_detail_original: false,
      truncation_policy: { mode: "tokens", limit: 10_000 },
      supports_parallel_tool_calls: true,
      tool_mode: null,
      multi_agent_version: "v2",
      use_responses_lite: false,
      include_skills_usage_instructions: false,
      auto_review_model_override: null,
      context_window: 1_048_576,
      max_context_window: 1_048_576,
      effective_context_window_percent: 95,
      auto_compact_token_limit: null,
      comp_hash: "3000",
      reasoning_summary_format: "experimental",
      default_reasoning_summary: "none",
      display_name: "DeepSeek-V4-Flash",
      description: "Latest frontier agentic coding model.",
      default_reasoning_level: "high",
      supported_reasoning_levels: [
        { effort: "low", description: "Fast responses with lighter reasoning" },
        { effort: "high", description: "Extra high reasoning depth for complex problems" },
        { effort: "max", description: "Maximum reasoning depth for the hardest problems" }
      ],
      shell_type: "shell_command",
      visibility: "list",
      minimal_client_version: "0.144.0",
      supported_in_api: true,
      availability_nux: null,
      upgrade: null,
      priority: 1,
      experimental_supported_tools: [],
      supports_search_tool: true,
      default_service_tier: null,
      supports_reasoning_summaries: true,
      base_instructions: DEEPSEEK_CODEX_BASE_INSTRUCTIONS
    }
  ]
}, null, 2)}\n`;
