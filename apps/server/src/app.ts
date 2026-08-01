import type { Database } from "bun:sqlite";
import { cors } from "@elysiajs/cors";
import {
  AI_OUTPUT_LANGUAGES,
  RUN_LOG_KINDS,
  RUN_LOG_LEVELS,
  RUN_LOG_STATUSES,
  RUNNER_CAPABILITIES,
  SCREENSHOT_COMPRESSION_PRESETS,
  REMINDER_AUDIO_MAX_BYTES,
  TODO_STATUSES,
  WORKER_KINDS,
  type ClaimJobResponse,
  type ClaimProjectManagerJobResponse,
  type ClaimRunnerCommandResponse,
  type DashboardSnapshot,
  type ExchangePairingRequest,
  type HealthResponse,
  type HomeStatsResponse,
  type ModelPricingResponse,
  type ExecutionJob,
  type ProjectManagerJob,
  type RecordInstallShDownloadResponse,
  type Runner,
  type RunnerCapability,
  type VersionHistoryResponse,
  type WorkerInventoryItem,
  type WorkerKind
} from "@maple/protocol";
import { Elysia, t } from "elysia";
import { RequestAuth } from "./auth/request-auth";
import { AccountService } from "./auth/account-service";
import { networkKey, resolveClientIp } from "./auth/network";
import type { ServerConfig } from "./config";
import { readRevision } from "./database/revision";
import { apiError, conflict, HttpError, notFound, unauthorized } from "./http/responses";
import { ArtifactRepository, ArtifactValidationError } from "./repositories/artifact-repository";
import { DownloadRateLimitError } from "./repositories/download-statistics-repository";
import { ProjectRepository } from "./repositories/project-repository";
import {
  DEFAULT_MODEL_PRICING_SOURCE_URL,
  ModelPricingRepository
} from "./repositories/model-pricing-repository";
import { RunnerCommandRepository } from "./repositories/runner-command-repository";
import { RunnerRepository } from "./repositories/runner-repository";
import { RunRepository } from "./repositories/run-repository";
import { ReminderAudioRepository } from "./repositories/reminder-audio-repository";
import { SettingsRepository } from "./repositories/settings-repository";
import { TodoRepository } from "./repositories/todo-repository";
import { TaskAssetRepository, TaskAssetValidationError } from "./repositories/task-asset-repository";
import { DispatchService } from "./services/dispatch-service";
import { ProjectManagerService } from "./services/project-manager-service";
import { DeviceAuthorizationService } from "./services/device-authorization-service";
import { ReleaseService } from "./services/release-service";
import { RunnerReconciliationService } from "./services/runner-reconciliation-service";
import { createHostedProviderCredentialService } from "./services/hosted-provider-credential-service";
import type { ModelPricingSyncService } from "./services/model-pricing-sync-service";
import {
  ProviderCredentialServiceError,
  type ProviderCredentialService
} from "./services/provider-credential-service";
import { SERVER_VERSION } from "./releases/catalog";
import { DashboardAssets } from "./web/dashboard-assets";
import type { StandaloneIdentity } from "./standalone/identity";

const workerKindSchema = t.Union(WORKER_KINDS.map((kind) => t.Literal(kind)));
const tokenUsageSchema = t.Object({
  inputTokens: t.Integer({ minimum: 0 }),
  cachedInputTokens: t.Integer({ minimum: 0 }),
  outputTokens: t.Integer({ minimum: 0 }),
  reasoningOutputTokens: t.Integer({ minimum: 0 })
});
const optionalTokenUsageSchema = t.Optional(t.Union([t.Null(), tokenUsageSchema]));
const supportedWorkersSchema = t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 32 }));
const workerInventorySchema = t.Optional(t.Array(t.Object({
  kind: t.String({ maxLength: 40 }),
  available: t.Boolean(),
  modelId: t.Nullable(t.String({ maxLength: 200 })),
  modelName: t.Nullable(t.String({ maxLength: 120 })),
  reasoningEffort: t.Nullable(t.String({ maxLength: 40 }))
}), { maxItems: 32 }));
const runnerCapabilitiesSchema = t.Optional(t.Array(t.String({ maxLength: 80 }), { maxItems: 32 }));

/**
 * 宽松解析 CLI 上报的 Worker 能力：只保留 WORKER_KINDS 内的字符串，非法项忽略。
 * 字段缺失时返回 undefined，调用方据此区分「未上报」与「上报为空」。
 */
function sanitizeSupportedWorkers(value: string[] | undefined): WorkerKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((kind): kind is WorkerKind => (WORKER_KINDS as readonly string[]).includes(kind));
}
function sanitizeWorkerInventory(value: Array<{
  kind: string;
  available: boolean;
  modelId: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
}> | undefined): WorkerInventoryItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<WorkerKind>();
  const inventory: WorkerInventoryItem[] = [];
  for (const item of value) {
    if (!(WORKER_KINDS as readonly string[]).includes(item.kind)) continue;
    const kind = item.kind as WorkerKind;
    if (seen.has(kind)) continue;
    seen.add(kind);
    inventory.push({
      kind,
      available: item.available,
      modelId: item.modelId?.trim() || null,
      modelName: item.modelName?.trim() || null,
      reasoningEffort: item.reasoningEffort?.trim() || null
    });
  }
  return inventory;
}
function sanitizeRunnerCapabilities(value: string[] | undefined): RunnerCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (capability): capability is RunnerCapability => (
      (RUNNER_CAPABILITIES as readonly string[]).includes(capability)
    )
  );
}
const todoStatusSchema = t.Union(TODO_STATUSES.map((status) => t.Literal(status)));
const runLogKindSchema = t.Union(RUN_LOG_KINDS.map((kind) => t.Literal(kind)));
const runLogLevelSchema = t.Union(RUN_LOG_LEVELS.map((level) => t.Literal(level)));
const runLogStatusSchema = t.Union(RUN_LOG_STATUSES.map((status) => t.Literal(status)));
const screenshotCompressionPresetSchema = t.Union(
  SCREENSHOT_COMPRESSION_PRESETS.map((preset) => t.Literal(preset))
);
const aiOutputLanguageSchema = t.Union(AI_OUTPUT_LANGUAGES.map((language) => t.Literal(language)));

function readIntegerQuery(
  request: Request,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function isSecureProviderCredentialTransport(config: ServerConfig, deploymentMode: "hosted" | "standalone"): boolean {
  if (deploymentMode === "standalone") return true;
  try {
    const url = new URL(config.publicUrl || `http://${config.host}:${config.port}`);
    return url.protocol === "https:"
      || url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

export interface CreateServerAppOptions {
  config: ServerConfig;
  database: Database;
  standaloneIdentity?: StandaloneIdentity;
  providerCredentials?: ProviderCredentialService;
  modelPricingSync?: ModelPricingSyncService;
}

export function createServerApp(options: CreateServerAppOptions) {
  const { config, database, standaloneIdentity } = options;
  const deploymentMode = config.deploymentMode ?? "hosted";
  if (deploymentMode === "standalone" && !standaloneIdentity) {
    throw new Error("Maple Local 缺少本地身份，Server 无法启动。");
  }
  const runners = new RunnerRepository(database, config.runnerOfflineSeconds);
  const projects = new ProjectRepository(database, config.runnerOfflineSeconds);
  const runnerCommands = new RunnerCommandRepository(database);
  const runHistory = new RunRepository(database);
  const todos = new TodoRepository(database);
  const settings = new SettingsRepository(database);
  const modelPricing = new ModelPricingRepository(database);
  modelPricing.configureSource(config.modelPricingSourceUrl?.trim() || DEFAULT_MODEL_PRICING_SOURCE_URL);
  const artifacts = new ArtifactRepository(database, config.dataDir);
  const taskAssets = new TaskAssetRepository(database, config.dataDir);
  const reminderAudio = new ReminderAudioRepository(config.dataDir);
  const projectManager = new ProjectManagerService(
    database,
    projects,
    todos,
    runners,
    settings,
    config.runnerCommandTtlSeconds,
    config.runnerOfflineSeconds
  );
  const dispatch = new DispatchService(
    database,
    projects,
    todos,
    projectManager,
    settings,
    config.leaseSeconds
  );
  const reconciliation = new RunnerReconciliationService(
    database,
    config.leaseSeconds,
    config.runnerCommandTtlSeconds
  );
  const accounts = new AccountService(database, config);
  const releases = new ReleaseService(database);
  const auth = new RequestAuth(runners, accounts.sessions);
  const deviceAuthorizations = new DeviceAuthorizationService(database, runners, accounts.sessions, config);
  const dashboard = new DashboardAssets(config.webRoot, config.publicUrl);
  const webAccess = (request: Request, mutating = false) => auth.workspace(request, { mutating });

  const serveReminderAudio = (workspaceId: string): Response => {
    const execution = settings.getExecution(workspaceId);
    if (!execution.reminderAudioName || !execution.reminderAudioMime) {
      return apiError(404, "reminder_audio_not_found", "尚未上传提醒音频。");
    }
    if (!reminderAudio.exists()) {
      return apiError(404, "reminder_audio_not_found", "提醒音频文件缺失。");
    }
    return new Response(Bun.file(reminderAudio.path()), {
      headers: {
        "Content-Type": execution.reminderAudioMime
      }
    });
  };
  const providerCredentials = options.providerCredentials
    ?? (deploymentMode === "hosted" ? createHostedProviderCredentialService(database, config) : null);
  const providerCredentialTransportSecure = isSecureProviderCredentialTransport(config, deploymentMode);
  const hostedOnly = () => {
    if (deploymentMode === "standalone") {
      throw new HttpError(403, "hosted_feature_unavailable", "Maple Local 不需要账户登录或执行端授权。");
    }
  };

  const providerCredentialRoutes = providerCredentials
    ? new Elysia({ name: "maple-provider-credentials" })
        .get("/api/provider-connections/deepseek", async ({ request }) => {
          const { workspaceId } = webAccess(request);
          const status = await providerCredentials.deepSeekStatus({ workspaceId });
          return providerCredentialTransportSecure
            ? status
            : {
                ...status,
                supported: false,
                configured: false,
                message: "在线 Server 必须通过 HTTPS 才能管理和下发 DeepSeek 凭据。"
              };
        })
        .post(
          "/api/provider-connections/deepseek/connect",
          async ({ request, body }) => {
            const { workspaceId } = webAccess(request, true);
            if (!providerCredentialTransportSecure) {
              throw new ProviderCredentialServiceError(
                409,
                "provider_https_required",
                "在线 Server 必须通过 HTTPS 才能连接 DeepSeek。"
              );
            }
            return providerCredentials.connectDeepSeek({ workspaceId }, body.apiKey);
          },
          {
            body: t.Object({
              apiKey: t.String({ minLength: 8, maxLength: 512 })
            })
          }
        )
        .delete("/api/provider-connections/deepseek", async ({ request }) => {
          const { workspaceId } = webAccess(request, true);
          return providerCredentials.disconnectDeepSeek({ workspaceId });
        })
    : new Elysia({ name: "maple-provider-credentials-unavailable" })
        .get("/api/provider-connections/deepseek", ({ request }) => {
          webAccess(request);
          return {
            provider: "deepseek" as const,
            supported: false,
            configured: false,
            source: "unavailable" as const,
            message: "当前 Server 未启用 DeepSeek 凭据服务。"
          };
        });

  const acceptsRuntimeProviderCredentials = (runner: Runner): boolean => (
    runner.capabilities?.includes("provider_credentials_v1") ?? false
  );

  const deepSeekRuntimeCredentials = async (
    runner: Runner,
    required: boolean
  ): Promise<{ deepseekApiKey: string } | undefined> => {
    if (
      !required
      || !providerCredentials
      || !providerCredentialTransportSecure
      || !runner.workspaceId
      || !acceptsRuntimeProviderCredentials(runner)
    ) {
      return undefined;
    }
    const apiKey = await providerCredentials.readDeepSeekApiKey({ workspaceId: runner.workspaceId });
    return apiKey ? { deepseekApiKey: apiKey } : undefined;
  };

  const decorateExecutionJob = async (job: ExecutionJob | null, runner: Runner): Promise<ExecutionJob | null> => {
    if (!job) return null;
    const runtimeProviderCredentials = await deepSeekRuntimeCredentials(
      runner,
      job.attempt.workerKind === "deepseek" || job.managerWorkerKind === "deepseek"
    );
    return runtimeProviderCredentials ? { ...job, runtimeProviderCredentials } : job;
  };

  const decorateProjectManagerJob = async (
    job: ProjectManagerJob | null,
    runner: Runner
  ): Promise<ProjectManagerJob | null> => {
    if (!job) return null;
    const preferredManager = job.executionSettings?.leaderWorker ?? job.executionSettings?.baseWorker;
    const runtimeProviderCredentials = await deepSeekRuntimeCredentials(
      runner,
      preferredManager === "deepseek" && job.availableWorkers.includes("deepseek")
    );
    return runtimeProviderCredentials ? { ...job, runtimeProviderCredentials } : job;
  };

  return new Elysia({ name: "maple-server" })
    .use(
      cors({
        origin: config.allowedOrigins,
        allowedHeaders: ["authorization", "content-type", "x-maple-csrf", "x-maple-workspace"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        credentials: true
      })
    )
    .onAfterHandle(({ request, set }) => {
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["x-frame-options"] = "DENY";
      set.headers["referrer-policy"] = "same-origin";
      set.headers["permissions-policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
      set.headers["cross-origin-opener-policy"] = "same-origin";
      if ((config.publicUrl || "").startsWith("https://")) {
        set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
      }
      if (new URL(request.url).pathname.startsWith("/api/")) set.headers["cache-control"] = "no-store";
    })
    .onError(({ code, error }) => {
      if (code === "VALIDATION") return apiError(422, "validation_error", "请求内容不符合接口约束。");
      if (error instanceof HttpError) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status, headers: error.headers }
        );
      }
      if (error instanceof ProviderCredentialServiceError) {
        return apiError(error.status, error.code, error.message);
      }
      if (
        error instanceof Error
        && "status" in error
        && error.status === 422
        && "code" in error
        && error.code === "INVALID_FILE_TYPE"
      ) {
        return apiError(422, "validation_error", "上传的截图格式无效。");
      }
      if (code === "NOT_FOUND") return apiError(404, "not_found", "请求的接口或资源不存在。");
      if (error instanceof TaskAssetValidationError) {
        return apiError(error.status, error.code, error.message);
      }
      console.error("[maple-server] request failed", error);
      return apiError(500, "internal_error", "Server 处理请求时发生错误。");
    })
    .use(providerCredentialRoutes)
    .get("/health", (): HealthResponse => ({
      name: "maple-server",
      version: SERVER_VERSION,
      status: "ok",
      deploymentMode,
      now: new Date().toISOString()
    }))
    .get("/api/home-stats", (): HomeStatsResponse => releases.homeStats())
    .get("/api/version-history", (): VersionHistoryResponse => releases.versionHistory())
    .post("/api/downloads/install-sh", ({ request, server }): RecordInstallShDownloadResponse => {
      const eventId = request.headers.get("x-maple-install-id")?.trim() ?? "";
      if (!/^[a-zA-Z0-9_-]{16,128}$/.test(eventId)) {
        throw new HttpError(422, "install_event_invalid", "安装统计事件无效。");
      }
      const clientIp = resolveClientIp(request, config.trustProxy === true, server?.requestIP(request)?.address);
      try {
        return releases.recordInstallSh(eventId, networkKey(clientIp));
      } catch (error) {
        if (error instanceof DownloadRateLimitError) {
          throw new HttpError(429, "download_rate_limited", "安装统计请求过于频繁，请稍后再试。", {
            "retry-after": "3600"
          });
        }
        throw error;
      }
    })
    .post(
      "/api/auth/register",
      async ({ request, body, set, server }) => {
        hostedOnly();
        const ipAddress = resolveClientIp(request, config.trustProxy === true, server?.requestIP(request)?.address);
        const created = await accounts.register(body, ipAddress, request.headers.get("user-agent") || "Unknown browser");
        set.headers["set-cookie"] = accounts.sessions.sessionCookie(created.token);
        return accounts.sessions.describe(created.principal);
      },
      {
        body: t.Object({
          email: t.String({ minLength: 3, maxLength: 254 }),
          password: t.String({ minLength: 10, maxLength: 200 }),
          name: t.String({ minLength: 1, maxLength: 80 }),
          workspaceName: t.Optional(t.String({ minLength: 1, maxLength: 100 }))
        })
      }
    )
    .post(
      "/api/auth/login",
      async ({ request, body, set, server }) => {
        hostedOnly();
        const ipAddress = resolveClientIp(request, config.trustProxy === true, server?.requestIP(request)?.address);
        const created = await accounts.login(body, ipAddress, request.headers.get("user-agent") || "Unknown browser");
        set.headers["set-cookie"] = accounts.sessions.sessionCookie(created.token);
        return accounts.sessions.describe(created.principal);
      },
      {
        body: t.Object({
          email: t.String({ minLength: 3, maxLength: 254 }),
          password: t.String({ minLength: 1, maxLength: 200 })
        })
      }
    )
    .get("/api/auth/session", ({ request, set, server }) => {
      let principal = auth.account(request.headers);
      if (!principal && standaloneIdentity) {
        const ipAddress = resolveClientIp(request, false, server?.requestIP(request)?.address);
        const created = accounts.sessions.create(
          standaloneIdentity.userId,
          standaloneIdentity.workspaceId,
          ipAddress,
          request.headers.get("user-agent") || "Local browser"
        );
        set.headers["set-cookie"] = accounts.sessions.sessionCookie(created.token);
        principal = created.principal;
      }
      if (!principal) return { authenticated: false as const };
      const workspaceId = accounts.sessions.resolveWorkspaceId(
        principal,
        request.headers.get("x-maple-workspace")
      );
      return accounts.sessions.describe(principal, workspaceId);
    })
    .post("/api/auth/logout", ({ request, set }) => {
      hostedOnly();
      const principal = auth.account(request.headers);
      if (principal) {
        accounts.sessions.assertCsrf(principal, request);
        accounts.sessions.revoke(principal, principal.session.id);
      }
      set.headers["set-cookie"] = accounts.sessions.clearCookie();
      return { signedOut: true };
    })
    .patch(
      "/api/account/profile",
      ({ request, body }) => {
        const access = webAccess(request, true);
        accounts.updateProfile(access.principal, body);
        return accounts.sessions.describe(access.principal, access.workspaceId);
      },
      { body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }) }) }
    )
    .get("/api/account/preferences", ({ request }) => {
      const access = webAccess(request);
      return accounts.userSettings.get(access.principal.user.id);
    })
    .patch(
      "/api/account/preferences",
      ({ request, body }) => {
        const access = webAccess(request, true);
        return accounts.userSettings.update(access.principal.user.id, body);
      },
      {
        body: t.Object({
          theme: t.Optional(t.Union([t.Literal("system"), t.Literal("light"), t.Literal("dark")])),
          uiFont: t.Optional(t.Union([t.Literal("default"), t.Literal("chill-round")])),
          uiLanguage: t.Optional(t.Union([t.Literal("zh"), t.Literal("en")]))
        })
      }
    )
    .post(
      "/api/account/password",
      async ({ request, body }) => {
        hostedOnly();
        const access = webAccess(request, true);
        await accounts.changePassword(access.principal, body);
        return { changed: true };
      },
      {
        body: t.Object({
          currentPassword: t.String({ minLength: 1, maxLength: 200 }),
          newPassword: t.String({ minLength: 10, maxLength: 200 })
        })
      }
    )
    .post(
      "/api/account/avatar",
      async ({ request, body }) => {
        const access = webAccess(request, true);
        await accounts.updateAvatar(access.principal, body.avatar);
        return accounts.sessions.describe(access.principal, access.workspaceId);
      },
      { body: t.Object({ avatar: t.File({ maxSize: "3m", type: "image" }) }) }
    )
    .get("/api/account/avatar/:userId", ({ request, params }) => {
      const principal = auth.account(request.headers);
      if (!principal) return unauthorized();
      const path = accounts.avatarPath(params.userId);
      return path ? new Response(Bun.file(path), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" } }) : notFound("头像不存在。");
    })
    .get("/api/account/sessions", ({ request }) => {
      const principal = auth.account(request.headers);
      if (!principal) return unauthorized();
      return { sessions: accounts.sessions.listUserSessions(principal) };
    })
    .post("/api/account/sessions/:sessionId/approve", ({ request, params }) => {
      const principal = auth.account(request.headers);
      if (!principal) return unauthorized();
      accounts.sessions.assertCsrf(principal, request);
      return accounts.sessions.approve(principal, params.sessionId);
    })
    .delete("/api/account/sessions/:sessionId", ({ request, params, set }) => {
      const principal = auth.account(request.headers);
      if (!principal) return unauthorized();
      accounts.sessions.assertCsrf(principal, request);
      accounts.sessions.revoke(principal, params.sessionId);
      if (params.sessionId === principal.session.id) set.headers["set-cookie"] = accounts.sessions.clearCookie();
      return { revoked: true };
    })
    .delete("/api/account/sessions", ({ request }) => {
      const access = webAccess(request, true);
      accounts.sessions.revokeOthers(access.principal);
      return { revoked: true };
    })
    .get("/api/account/security-events", ({ request }) => {
      const principal = auth.account(request.headers);
      if (!principal) return unauthorized();
      return { events: accounts.sessions.listSecurityEvents(principal) };
    })
    .post(
      "/api/workspaces",
      ({ request, body }) => {
        hostedOnly();
        const access = webAccess(request, true);
        const workspace = accounts.workspaces.createForUser(access.principal.user.id, body.name);
        return accounts.sessions.switchWorkspace(access.principal, workspace.id);
      },
      { body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }) }
    )
    .post(
      "/api/workspaces/:workspaceId/switch",
      ({ request, params }) => {
        const access = webAccess(request, true);
        return accounts.sessions.switchWorkspace(access.principal, params.workspaceId);
      }
    )
    .patch(
      "/api/workspaces/:workspaceId",
      ({ request, params, body }) => {
        const access = webAccess(request, true);
        return accounts.workspaces.rename(params.workspaceId, access.principal.user.id, body.name);
      },
      { body: t.Object({ name: t.String({ minLength: 1, maxLength: 100 }) }) }
    )
    .post(
      "/api/device-authorizations",
      ({ request, body, server }) => {
        hostedOnly();
        const ipAddress = resolveClientIp(request, config.trustProxy === true, server?.requestIP(request)?.address);
        accounts.rateLimiter.reserve("device_authorization_ip", ipAddress, 30, 10 * 60);
        return deviceAuthorizations.start({
          ...body,
          supportedWorkers: sanitizeSupportedWorkers(body.supportedWorkers),
          workerInventory: sanitizeWorkerInventory(body.workerInventory),
          capabilities: sanitizeRunnerCapabilities(body.capabilities)
        });
      },
      {
        body: t.Object({
          runnerName: t.String({ minLength: 1, maxLength: 80 }),
          hostname: t.String({ minLength: 1, maxLength: 255 }),
          platform: t.String({ minLength: 1, maxLength: 80 }),
          version: t.String({ minLength: 1, maxLength: 40 }),
          codeChallenge: t.String({ minLength: 43, maxLength: 128 }),
          supportedWorkers: supportedWorkersSchema,
          workerInventory: workerInventorySchema,
          capabilities: runnerCapabilitiesSchema
        })
      }
    )
    .post(
      "/api/device-authorizations/token",
      ({ body }) => {
        hostedOnly();
        return deviceAuthorizations.exchange(body.deviceCode, body.codeVerifier);
      },
      {
        body: t.Object({
          deviceCode: t.String({ minLength: 32, maxLength: 200 }),
          codeVerifier: t.String({ minLength: 43, maxLength: 128 })
        })
      }
    )
    .post(
      "/api/device-authorizations/approve",
      ({ request, body }) => {
        hostedOnly();
        const access = webAccess(request, true);
        return deviceAuthorizations.approve(access.principal, access.workspaceId, body.userCode, body.runnerName);
      },
      {
        body: t.Object({
          userCode: t.String({ minLength: 6, maxLength: 20 }),
          runnerName: t.Optional(t.String({ minLength: 1, maxLength: 80 }))
        })
      }
    )
    .get("/api/device-authorizations/:userCode", ({ request, params }) => {
      hostedOnly();
      webAccess(request);
      return deviceAuthorizations.inspect(params.userCode);
    })
    .post(
      "/api/pairings/exchange",
      ({ body }) => {
        hostedOnly();
        const result = runners.exchangePairing({
          ...(body as ExchangePairingRequest),
          supportedWorkers: sanitizeSupportedWorkers(body.supportedWorkers),
          workerInventory: sanitizeWorkerInventory(body.workerInventory),
          capabilities: sanitizeRunnerCapabilities(body.capabilities)
        });
        return result ?? apiError(410, "pairing_expired", "配对码无效、已使用或已经过期。");
      },
      {
        body: t.Object({
          code: t.String({ minLength: 6, maxLength: 20 }),
          runnerName: t.String({ minLength: 1, maxLength: 80 }),
          hostname: t.String({ minLength: 1, maxLength: 255 }),
          platform: t.String({ minLength: 1, maxLength: 80 }),
          version: t.String({ minLength: 1, maxLength: 40 }),
          supportedWorkers: supportedWorkersSchema,
          workerInventory: workerInventorySchema,
          capabilities: runnerCapabilitiesSchema
        })
      }
    )
    .get("/api/dashboard", ({ request }) => {
      const { workspaceId } = webAccess(request);
      const snapshot: DashboardSnapshot = {
        projects: projects.list(workspaceId),
        bindings: projects.listBindings(workspaceId),
        runners: runners.list(workspaceId),
        todos: todos.list(workspaceId),
        tokenUsage: todos.sumTokenUsage(workspaceId),
        settings: settings.get(workspaceId),
        revision: readRevision(database),
        serverTime: new Date().toISOString()
      };
      return snapshot;
    })
    .get("/api/model-pricing", ({ request }) => {
      webAccess(request);
      const limit = readIntegerQuery(request, "limit", 1_000, 1, 5_000);
      const offset = readIntegerQuery(request, "offset", 0, 0, Number.MAX_SAFE_INTEGER);
      if (limit === null || offset === null) {
        return apiError(422, "invalid_pagination", "价格矩阵分页参数无效。");
      }
      const query = new URL(request.url).searchParams;
      const providerId = query.get("provider")?.trim() || undefined;
      const modelId = query.get("model")?.trim() || undefined;
      if ((providerId && providerId.length > 200) || (modelId && modelId.length > 300)) {
        return apiError(422, "invalid_model_pricing_filter", "价格矩阵筛选条件无效。");
      }
      const response: ModelPricingResponse = modelPricing.list({
        providerId,
        modelId,
        limit,
        offset,
        enabled: options.modelPricingSync?.isEnabled === true
      });
      return response;
    })
    .get("/api/model-pricing/status", ({ request }) => {
      webAccess(request);
      return modelPricing.status(
        options.modelPricingSync?.isEnabled === true
      );
    })
    .get("/api/settings/acceptance", ({ request }) => {
      const { workspaceId } = webAccess(request);
      return settings.getAcceptance(workspaceId);
    })
    .patch(
      "/api/settings/acceptance",
      ({ request, body }) => {
        const { workspaceId } = webAccess(request, true);
        return settings.updateAcceptance(body, workspaceId);
      },
      {
        body: t.Object({
          backgroundPlaywrightScreenshot: t.Optional(t.Boolean()),
          screenshotCompressionPreset: t.Optional(screenshotCompressionPresetSchema)
        })
      }
    )
    .get("/api/settings/execution", ({ request }) => {
      const { workspaceId } = webAccess(request);
      return settings.getExecution(workspaceId);
    })
    .patch(
      "/api/settings/execution",
      ({ request, body }) => {
        const { workspaceId } = webAccess(request, true);
        return settings.updateExecution(body, workspaceId);
      },
      {
        body: t.Object({
          defaultWorker: t.Optional(workerKindSchema),
          leaderWorker: t.Optional(workerKindSchema),
          baseWorker: t.Optional(workerKindSchema),
          aiOutputLanguage: t.Optional(aiOutputLanguageSchema),
          constitution: t.Optional(t.String({ maxLength: 100_000 })),
          leaderConstitution: t.Optional(t.String({ maxLength: 100_000 })),
          concurrency: t.Optional(t.Integer({ minimum: 1, maximum: 16 })),
          retryIntervalSeconds: t.Optional(t.Integer({ minimum: 1, maximum: 600 })),
          retryMaxAttempts: t.Optional(t.Integer({ minimum: 1, maximum: 20 })),
          reminderAudioName: t.Optional(t.Union([t.String({ maxLength: 120 }), t.Null()])),
          reminderAudioMime: t.Optional(t.Union([t.String({ maxLength: 120 }), t.Null()])),
          reminderPlayCli: t.Optional(t.Boolean()),
          reminderPlayMaple: t.Optional(t.Boolean())
        })
      }
    )
    .get("/api/settings/reminder-audio", ({ request }) => {
      const { workspaceId } = webAccess(request);
      return serveReminderAudio(workspaceId);
    })
    .put("/api/settings/reminder-audio", async ({ request }) => {
      const { workspaceId } = webAccess(request, true);
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.startsWith("audio/")) {
        return apiError(422, "invalid_reminder_audio_type", "提醒音频必须是 audio/* 类型。");
      }
      const rawName = request.headers.get("x-maple-file-name") || "";
      let fileName = "reminder-audio";
      try {
        const decoded = decodeURIComponent(rawName).replace(/[\\/]/g, "_").trim();
        if (decoded) fileName = decoded.slice(0, 120);
      } catch {
        // 非法文件名回退默认值。
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > REMINDER_AUDIO_MAX_BYTES) {
        return apiError(422, "invalid_reminder_audio_size", "提醒音频大小需在 1B ~ 500kB 之间。");
      }
      reminderAudio.save(bytes);
      settings.updateExecution(
        { reminderAudioName: fileName, reminderAudioMime: contentType },
        workspaceId
      );
      return settings.getExecution(workspaceId);
    })
    .delete("/api/settings/reminder-audio", ({ request }) => {
      const { workspaceId } = webAccess(request, true);
      reminderAudio.remove();
      settings.updateExecution(
        { reminderAudioName: null, reminderAudioMime: null },
        workspaceId
      );
      return settings.getExecution(workspaceId);
    })
    .get("/api/runner/reminder-audio", ({ request }) => {
      const runner = auth.runner(request.headers);
      if (!runner?.workspaceId) return unauthorized();
      return serveReminderAudio(runner.workspaceId);
    })
    .post("/api/pairings", ({ request }) => {
      hostedOnly();
      const { workspaceId } = webAccess(request, true);
      return runners.createPairing(workspaceId, config.pairingTtlSeconds);
    })
    .post(
      "/api/runners/:runnerId/commands",
      ({ request, params, body }) => {
        const { workspaceId } = webAccess(request, true);
        const runner = runners.getById(params.runnerId, workspaceId);
        if (!runner) return notFound("执行端不存在。");
        if (runner.state !== "online") return conflict("执行端当前离线，无法打开目录选择器。");
        return runnerCommands.create(params.runnerId, body, config.runnerCommandTtlSeconds);
      },
      {
        body: t.Object({
          type: t.Literal("select_project_directory")
        })
      }
    )
    .get("/api/runners/:runnerId/commands", ({ request, params }) => {
      const { workspaceId } = webAccess(request);
      if (!runners.getById(params.runnerId, workspaceId)) return notFound("执行端不存在。");
      return { commands: runnerCommands.listByRunner(params.runnerId) };
    })
    .get("/api/runner-commands/:commandId", ({ request, params }) => {
      const { workspaceId } = webAccess(request);
      const command = runnerCommands.get(params.commandId);
      if (!command || !runners.getById(command.runnerId, workspaceId)) return notFound("目录选择请求不存在。");
      return command;
    })
    .delete("/api/runners/:runnerId", ({ request, params }) => {
      const { workspaceId } = webAccess(request, true);
      return runners.revoke(params.runnerId, workspaceId) ? { revoked: true } : notFound("执行端不存在。");
    })
    .get("/api/projects", ({ request }) => {
      const { workspaceId } = webAccess(request);
      return { projects: projects.list(workspaceId), bindings: projects.listBindings(workspaceId) };
    })
    .get("/api/projects/:projectId/todos", ({ request, params }) => {
      const { workspaceId } = webAccess(request);
      if (!projects.getById(params.projectId, workspaceId)) return notFound("项目不存在。");
      return { todos: todos.listByProject(params.projectId, workspaceId) };
    })
    .delete("/api/projects/:projectId", async ({ request, params }) => {
      const { workspaceId } = webAccess(request, true);
      if (!projects.getById(params.projectId, workspaceId)) return notFound("项目不存在。");
      const storageNames = artifacts.storageNamesForProject(params.projectId);
      const taskAssetStorageNames = taskAssets.storageNamesForProject(params.projectId);
      if (!projects.remove(params.projectId, workspaceId)) return notFound("项目不存在。");
      await Promise.all([
        artifacts.removeStorageFiles(storageNames),
        taskAssets.removeStorageFiles(taskAssetStorageNames)
      ]).catch((error) => console.error("[maple-server] failed to remove project assets", error));
      return { deleted: true };
    })
    .patch(
      "/api/projects/:projectId",
      ({ request, params, body }) => {
        const { workspaceId } = webAccess(request, true);
        return projects.update(params.projectId, body, workspaceId) ?? notFound("项目不存在。");
      },
      {
        body: t.Object({
          tagCatalog: t.Optional(t.String({ maxLength: 100_000 }))
        })
      }
    )
    .post(
      "/api/projects/:projectId/todos",
      ({ request, params, body }) => {
        const { workspaceId } = webAccess(request, true);
        if (!projects.getById(params.projectId, workspaceId)) return notFound("项目不存在。");
        if (!body.title.trim()) return apiError(422, "title_required", "Todo 标题不能为空。");
        const todo = todos.create(params.projectId, body, workspaceId);
        if (todo.status !== "draft" && projectManager.enqueue(todo.id)) {
          return todos.get(todo.id, workspaceId) ?? todo;
        }
        return todo;
      },
      {
          body: t.Object({
            id: t.Optional(t.String({ minLength: 6, maxLength: 64 })),
            title: t.String({ minLength: 1, maxLength: 300 }),
            details: t.Optional(t.String({ maxLength: 100_000 })),
            parentId: t.Optional(t.Union([t.String({ minLength: 1, maxLength: 80 }), t.Null()])),
            priority: t.Optional(t.Integer({ minimum: -100, maximum: 100 })),
          workerKind: workerKindSchema,
          status: t.Optional(t.Union([t.Literal("draft"), t.Literal("todo")])),
          tags: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 40 }), { maxItems: 20 }))
        })
      }
    )
    .get("/api/todos/:todoId", ({ request, params }) => {
      const { workspaceId } = webAccess(request);
      const detail = todos.detail(params.todoId, workspaceId);
      return detail
        ? { ...detail, artifacts: artifacts.listByTodo(params.todoId) }
        : notFound("Todo 不存在。");
    })
    .get("/api/todos/:todoId/artifacts/:artifactId", ({ request, params }) => {
      const { workspaceId } = webAccess(request);
      if (!todos.get(params.todoId, workspaceId)) return notFound("截图不存在。");
      const variant = new URL(request.url).searchParams.get("size") === "thumb" ? "thumb" as const : undefined;
      return artifacts.response(params.todoId, params.artifactId, variant) ?? notFound("截图不存在。");
    })
    .post(
      "/api/todos/:todoId/assets",
      async ({ request, params, body }) => {
        const { workspaceId } = webAccess(request, true);
        if (!todos.get(params.todoId, workspaceId)) return notFound("Todo 不存在。");
        return { asset: await taskAssets.store(params.todoId, body.file) };
      },
      {
        body: t.Object({
          file: t.File({
            type: ["image/png", "image/jpeg", "image/webp", "image/gif"],
            minSize: 1,
            maxSize: "8m"
          })
        })
      }
    )
    .get("/api/todos/:todoId/assets/:assetId", ({ request, params }) => {
      const { workspaceId } = webAccess(request);
      if (!todos.get(params.todoId, workspaceId)) return notFound("正文图片不存在。");
      return taskAssets.response(params.todoId, params.assetId) ?? notFound("正文图片不存在。");
    })
    .patch(
      "/api/todos/:todoId",
      ({ request, params, body }) => {
        const { workspaceId } = webAccess(request, true);
        if (body.title !== undefined && !body.title.trim()) {
          return apiError(422, "title_required", "Todo 标题不能为空。");
        }
        if (body.status === "queued" || body.status === "running") {
          const current = todos.get(params.todoId, workspaceId);
          if (!current) return notFound("Todo 不存在。");
          if (current.status !== body.status) {
            return apiError(422, "managed_status", "队列中和进行中状态只能由 CLI 执行租约更新。");
          }
        }
          const todo = todos.update(params.todoId, body, workspaceId);
          if (!todo) return notFound("Todo 不存在。");
          // 父任务状态变更时，子任务跟随调整；前端菜单里已对含子任务的任务给出提示。
          if (body.status !== undefined && todos.subtaskCount(todo.id) > 0) {
            todos.setDescendantsStatus(todo.id, body.status, workspaceId);
          }
          if (
          (todo.status === "todo" || todo.status === "rework")
          && (body.title !== undefined || body.details !== undefined || body.status !== undefined)
        ) {
          if (projectManager.enqueue(todo.id, true)) return todos.get(todo.id, workspaceId) ?? todo;
        }
        return todo;
      },
      {
        body: t.Object({
          title: t.Optional(t.String({ maxLength: 300 })),
            details: t.Optional(t.String({ maxLength: 100_000 })),
            parentId: t.Optional(t.Union([t.String({ minLength: 1, maxLength: 80 }), t.Null()])),
            priority: t.Optional(t.Integer({ minimum: -100, maximum: 100 })),
          workerKind: t.Optional(workerKindSchema),
          status: t.Optional(todoStatusSchema),
          tags: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 40 }), { maxItems: 20 })),
          detailsDoc: t.Optional(t.String({ maxLength: 1_000_000 }))
        })
      }
    )
    .delete("/api/todos/:todoId", async ({ request, params }) => {
      const { workspaceId } = webAccess(request, true);
      if (!todos.get(params.todoId, workspaceId)) return notFound("Todo 不存在。");
      const storageNames = artifacts.storageNamesForTodo(params.todoId);
      const taskAssetStorageNames = taskAssets.storageNamesForTodo(params.todoId);
      const result = todos.delete(params.todoId, workspaceId);
      if (result === "missing") return notFound("Todo 不存在。");
      if (result === "active") return conflict("Todo 正在执行，需先取消任务再删除。");
      await Promise.all([
        artifacts.removeStorageFiles(storageNames),
        taskAssets.removeStorageFiles(taskAssetStorageNames)
      ]).catch((error) => console.error("[maple-server] failed to remove todo assets", error));
      return { deleted: true };
    })
    .delete("/api/runner/connection", ({ request }) => {
      const runner = auth.runner(request.headers);
      if (!runner?.workspaceId) return unauthorized();
      return runners.revoke(runner.id, runner.workspaceId)
        ? { revoked: true as const }
        : unauthorized();
    })
    .post(
      "/api/runner/heartbeat",
      async ({ request, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        const updated = runners.heartbeat(
          runner.id,
          body.version,
          sanitizeSupportedWorkers(body.supportedWorkers),
          sanitizeRunnerCapabilities(body.capabilities),
          sanitizeWorkerInventory(body.workerInventory)
        );
        if (!updated?.workspaceId) return unauthorized();
        const workspace = database
          .query("SELECT id, name, updated_at FROM workspaces WHERE id = ?")
          .get(updated.workspaceId) as { id: string; name: string; updated_at: string } | null;
        if (!workspace) return unauthorized();
        const providerConnections = providerCredentials && acceptsRuntimeProviderCredentials(updated)
          ? {
              deepseek: {
                configured: providerCredentialTransportSecure
                  && (await providerCredentials.deepSeekStatus({ workspaceId: updated.workspaceId })).configured
              }
            }
          : undefined;
        return {
          runner: updated,
          workspace: { id: workspace.id, name: workspace.name, updatedAt: workspace.updated_at },
          ...(providerConnections ? { providerConnections } : {})
        };
      },
      {
        body: t.Object({
          version: t.String({ minLength: 1, maxLength: 40 }),
          supportedWorkers: supportedWorkersSchema,
          workerInventory: workerInventorySchema,
          capabilities: runnerCapabilitiesSchema
        })
      }
    )
    .post(
      "/api/runner/reconcile",
      ({ request, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        return { attempts: reconciliation.reconcile(runner.id, body.attempts) };
      },
      {
        body: t.Object({
          attempts: t.Array(t.Object({
            scope: t.Union([t.Literal("execution"), t.Literal("project_manager")]),
            todoId: t.String({ minLength: 1, maxLength: 200 }),
            attemptId: t.String({ minLength: 1, maxLength: 200 }),
            leaseToken: t.String({ minLength: 20, maxLength: 200 })
          }), { maxItems: 256 })
        })
      }
    )
    .post("/api/runner/commands/claim", ({ request }) => {
      const runner = auth.runner(request.headers);
      if (!runner) return unauthorized();
      runners.heartbeat(runner.id);
      const response: ClaimRunnerCommandResponse = runnerCommands.claim(runner.id);
      return response;
    })
    .post("/api/runner/project-manager/claim", async ({ request }) => {
      const runner = auth.runner(request.headers);
      if (!runner) return unauthorized();
      runners.heartbeat(runner.id);
      const claimed = projectManager.claim(runner.id);
      const response: ClaimProjectManagerJobResponse = {
        ...claimed,
        job: await decorateProjectManagerJob(claimed.job, runner)
      };
      return response;
    })
    .post(
      "/api/runner/project-manager/:todoId/complete",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        return projectManager.complete(runner.id, params.todoId, body)
          ?? conflict("项目经理任务执行权已撤销或不属于当前执行端。");
      },
      {
        body: t.Object({
          leaseToken: t.String({ minLength: 20, maxLength: 200 }),
          managerWorkerKind: workerKindSchema,
          usage: optionalTokenUsageSchema,
          selectedWorkerKind: workerKindSchema,
          workflowId: t.Union([t.String({ minLength: 1, maxLength: 100 }), t.Null()]),
          workflowTitle: t.String({ minLength: 1, maxLength: 160 }),
          workflowSummary: t.String({ minLength: 1, maxLength: 4_000 }),
          dispatchBrief: t.String({ minLength: 1, maxLength: 2_000 }),
          tags: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 40 }), { maxItems: 8 }))
        })
      }
    )
    .post(
      "/api/runner/project-manager/:todoId/block",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        return projectManager.block(runner.id, params.todoId, body)
          ?? conflict("项目经理任务执行权已撤销或不属于当前执行端。");
      },
      {
        body: t.Object({
          leaseToken: t.String({ minLength: 20, maxLength: 200 }),
          managerWorkerKind: workerKindSchema,
          usage: optionalTokenUsageSchema,
          report: t.Optional(t.String({ minLength: 1, maxLength: 100_000 })),
          technicalError: t.Optional(t.String({ minLength: 1, maxLength: 100_000 }))
        })
      }
    )
    .post(
      "/api/runner/commands/:commandId/complete",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        return runnerCommands.complete(runner.id, params.commandId, body)
          ?? conflict("目录选择请求无效、已过期或结果不属于当前执行端。");
      },
      {
        body: t.Object({
          leaseToken: t.String({ minLength: 20, maxLength: 200 }),
          outcome: t.Union([t.Literal("succeeded"), t.Literal("cancelled"), t.Literal("failed")]),
          projectId: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          bindingId: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          error: t.Optional(t.String({ maxLength: 1_000 }))
        })
      }
    )
    .post(
      "/api/runner/projects",
      ({ request, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        runners.heartbeat(runner.id);
        return projects.register(runner.id, body);
      },
      {
        body: t.Object({
          externalKey: t.String({ minLength: 8, maxLength: 500 }),
          name: t.String({ minLength: 1, maxLength: 120 }),
          repositoryUrl: t.Optional(t.Union([t.String({ maxLength: 1000 }), t.Null()])),
          defaultBranch: t.Optional(t.Union([t.String({ maxLength: 255 }), t.Null()])),
          workspaceLabel: t.String({ minLength: 1, maxLength: 255 }),
          gitBranch: t.Optional(t.Union([t.String({ maxLength: 255 }), t.Null()])),
          gitHead: t.Optional(t.Union([t.String({ maxLength: 80 }), t.Null()]))
        })
      }
    )
    .delete("/api/runner/projects/:projectId", ({ request, params }) => {
      const runner = auth.runner(request.headers);
      if (!runner) return unauthorized();
      return projects.removeBinding(runner.id, params.projectId)
        ? { removed: true }
        : notFound("当前执行端没有绑定这个项目。");
    })
    .get("/api/runner/runs", ({ request }) => {
      const runner = auth.runner(request.headers);
      if (!runner) return unauthorized();
      const limit = readIntegerQuery(request, "limit", 50, 1, 100);
      if (limit === null) return apiError(422, "invalid_pagination", "运行记录分页参数无效。");
      return runHistory.listByRunner(runner.id, limit);
    })
    .get("/api/runner/runs/:attemptId/logs", ({ request, params }) => {
      const runner = auth.runner(request.headers);
      if (!runner) return unauthorized();
      const afterId = readIntegerQuery(request, "after", 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = readIntegerQuery(request, "limit", 500, 1, 1_000);
      if (afterId === null || limit === null) {
        return apiError(422, "invalid_pagination", "运行日志分页参数无效。");
      }
      return runHistory.logsByRunner(runner.id, params.attemptId, afterId, limit)
        ?? notFound("运行记录不存在。");
    })
    .post("/api/runner/jobs/claim", async ({ request }) => {
      const runner = auth.runner(request.headers);
      if (!runner) return unauthorized();
      runners.heartbeat(runner.id);
      const response: ClaimJobResponse = {
        job: await decorateExecutionJob(dispatch.claim(runner.id), runner),
        retryAfterMs: 1500
      };
      return response;
    })
    .post(
      "/api/runner/jobs/:todoId/start",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        return dispatch.start(runner.id, params.todoId, body) ?? conflict("任务执行权已撤销。");
      },
      { body: t.Object({ leaseToken: t.String({ minLength: 20, maxLength: 200 }) }) }
    )
    .post(
      "/api/runner/jobs/:todoId/heartbeat",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        const ok = dispatch.heartbeat(runner.id, params.todoId, body);
        return ok ? { ok: true } : conflict("任务执行权已撤销。");
      },
      { body: t.Object({ leaseToken: t.String({ minLength: 20, maxLength: 200 }) }) }
    )
    .post(
      "/api/runner/jobs/:todoId/logs",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        const ok = dispatch.appendLog(runner.id, params.todoId, body);
        return ok ? { ok: true } : conflict("任务执行权已撤销。");
      },
      {
        body: t.Object({
          leaseToken: t.String({ minLength: 20, maxLength: 200 }),
          deliveryId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
          stream: t.Union([t.Literal("stdout"), t.Literal("stderr"), t.Literal("system")]),
          content: t.String({ minLength: 1, maxLength: 65_536 }),
          sequence: t.Optional(t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
          occurredAt: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
          kind: t.Optional(runLogKindSchema),
          level: t.Optional(runLogLevelSchema),
          status: t.Optional(runLogStatusSchema),
          title: t.Optional(t.String({ maxLength: 300 })),
          groupId: t.Optional(t.String({ maxLength: 300 }))
        })
      }
    )
    .post(
      "/api/runner/jobs/:todoId/logs/batch",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        const accepted = dispatch.appendLogs(runner.id, params.todoId, body);
        return accepted === null
          ? conflict("任务执行权已撤销。")
          : { ok: true as const, accepted };
      },
      {
        body: t.Object({
          leaseToken: t.String({ minLength: 20, maxLength: 200 }),
          logs: t.Array(t.Object({
            deliveryId: t.String({ minLength: 1, maxLength: 200 }),
            stream: t.Union([t.Literal("stdout"), t.Literal("stderr"), t.Literal("system")]),
            content: t.String({ minLength: 1, maxLength: 65_536 }),
            sequence: t.Optional(t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
            occurredAt: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
            kind: t.Optional(runLogKindSchema),
            level: t.Optional(runLogLevelSchema),
            status: t.Optional(runLogStatusSchema),
            title: t.Optional(t.String({ maxLength: 300 })),
            groupId: t.Optional(t.String({ maxLength: 300 }))
          }), { minItems: 1, maxItems: 100 })
        })
      }
    )
    .post(
      "/api/runner/jobs/:todoId/artifacts",
      async ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        const upload = dispatch.artifactUploadContext(runner.id, params.todoId, body.leaseToken);
        if (!upload) return conflict("任务执行权已撤销。");
        if (!upload.backgroundPlaywrightScreenshot) {
          return conflict("本次任务没有开启后台 Playwright 截图验收。");
        }
        try {
          return {
            artifact: await artifacts.storeScreenshot(
              params.todoId,
              upload.attemptId,
              body.deliveryId,
              body.file,
              upload.screenshotCompressionPreset
            )
          };
        } catch (error) {
          if (error instanceof ArtifactValidationError) {
            return apiError(error.status, error.code, error.message);
          }
          throw error;
        }
      },
      {
        body: t.Object({
          leaseToken: t.String({ minLength: 20, maxLength: 200 }),
          deliveryId: t.String({ minLength: 1, maxLength: 200 }),
          file: t.File({
            type: ["image/png", "image/jpeg", "image/webp"],
            minSize: 1,
            maxSize: "8m"
          })
        })
      }
    )
    .post(
      "/api/runner/jobs/:todoId/complete",
      ({ request, params, body }) => {
        const runner = auth.runner(request.headers);
        if (!runner) return unauthorized();
        return dispatch.complete(runner.id, params.todoId, body) ?? conflict("任务执行权已撤销。");
      },
      {
        body: t.Object({
          leaseToken: t.String({ minLength: 20, maxLength: 200 }),
          success: t.Boolean(),
          exitCode: t.Optional(t.Union([t.Integer(), t.Null()])),
          summary: t.Optional(t.String({ maxLength: 100_000 })),
          error: t.Optional(t.String({ maxLength: 100_000 })),
          failureDisposition: t.Optional(t.Union([t.Literal("retry"), t.Literal("blocked")])),
          usage: optionalTokenUsageSchema,
          leaderUsage: optionalTokenUsageSchema
        })
      }
    )
    .get("/", ({ request }) => dashboard.handle(request))
    .get("/*", ({ request }) => dashboard.handle(request));
}

export type MapleServerApp = ReturnType<typeof createServerApp>;
