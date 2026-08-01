import type {
  AppendJobLogRequest,
  AppendJobLogsRequest,
  AppendJobLogsResponse,
  BlockProjectManagerJobRequest,
  BlockProjectManagerJobResponse,
  ClaimJobResponse,
  ClaimProjectManagerJobResponse,
  ClaimRunnerCommandResponse,
  CompleteJobRequest,
  CompleteProjectManagerJobRequest,
  CompleteProjectManagerJobResponse,
  CompleteRunnerCommandRequest,
  DeviceAuthorizationStartRequest,
  DeviceAuthorizationStartResponse,
  DeviceAuthorizationTokenRequest,
  DeviceAuthorizationTokenResponse,
  JobMutationResponse,
  RegisterProjectRequest,
  RegisterProjectResponse,
  ReconcileRunnerAttemptsRequest,
  ReconcileRunnerAttemptsResponse,
  RunnerHeartbeatResponse,
  RunnerCapability,
  RunnerCommand,
  RunnerRunListResponse,
  RunnerRunLogResponse,
  StartJobRequest,
  TodoScreenshotMimeType,
  UploadTodoArtifactResponse,
  WorkspaceExecutionSettings,
  WorkerInventoryItem,
  WorkerKind
} from "@maple/protocol";

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class MapleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "MapleApiError";
  }
}

export class MapleApiClient {
  constructor(
    readonly serverUrl: string,
    private readonly token: string | null = null
  ) {}

  withToken(token: string): MapleApiClient {
    return new MapleApiClient(this.serverUrl, token);
  }

  startDeviceAuthorization(input: DeviceAuthorizationStartRequest): Promise<DeviceAuthorizationStartResponse> {
    return this.request("POST", "/api/device-authorizations", input, false);
  }

  exchangeDeviceAuthorization(input: DeviceAuthorizationTokenRequest): Promise<DeviceAuthorizationTokenResponse> {
    return this.request("POST", "/api/device-authorizations/token", input, false);
  }

  heartbeat(
    version: string,
    supportedWorkers?: WorkerKind[],
    capabilities?: RunnerCapability[],
    workerInventory?: WorkerInventoryItem[]
  ): Promise<RunnerHeartbeatResponse> {
    return this.request("POST", "/api/runner/heartbeat", {
      version,
      supportedWorkers,
      capabilities,
      workerInventory
    });
  }

  reconcile(input: ReconcileRunnerAttemptsRequest): Promise<ReconcileRunnerAttemptsResponse> {
    return this.request("POST", "/api/runner/reconcile", input);
  }

  disconnectRunner(): Promise<{ revoked: true }> {
    return this.request("DELETE", "/api/runner/connection");
  }

  claimRunnerCommand(): Promise<ClaimRunnerCommandResponse> {
    return this.request("POST", "/api/runner/commands/claim");
  }

  completeRunnerCommand(commandId: string, input: CompleteRunnerCommandRequest): Promise<RunnerCommand> {
    return this.request(
      "POST",
      `/api/runner/commands/${encodeURIComponent(commandId)}/complete`,
      input,
      true,
      4
    );
  }

  registerProject(input: RegisterProjectRequest): Promise<RegisterProjectResponse> {
    return this.request("POST", "/api/runner/projects", input);
  }

  removeProject(projectId: string): Promise<{ removed: true }> {
    return this.request("DELETE", `/api/runner/projects/${encodeURIComponent(projectId)}`);
  }

  claim(): Promise<ClaimJobResponse> {
    return this.request("POST", "/api/runner/jobs/claim");
  }

  claimProjectManagerJob(): Promise<ClaimProjectManagerJobResponse> {
    return this.request("POST", "/api/runner/project-manager/claim");
  }

  executionSettings(): Promise<WorkspaceExecutionSettings> {
    return this.request("GET", "/api/settings/execution");
  }

  /** 下载工作区完成提醒音频；未上传时返回 null。 */
  async reminderAudio(): Promise<Uint8Array | null> {
    if (!this.token) return null;
    const response = await fetch(`${this.serverUrl}/api/runner/reminder-audio`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new MapleApiError(
        `提醒音频下载失败（HTTP ${response.status}）。`,
        response.status,
        "reminder_audio_download_failed"
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  completeProjectManagerJob(
    todoId: string,
    input: CompleteProjectManagerJobRequest
  ): Promise<CompleteProjectManagerJobResponse> {
    return this.request(
      "POST",
      `/api/runner/project-manager/${encodeURIComponent(todoId)}/complete`,
      input
    );
  }

  blockProjectManagerJob(
    todoId: string,
    input: BlockProjectManagerJobRequest
  ): Promise<BlockProjectManagerJobResponse> {
    return this.request(
      "POST",
      `/api/runner/project-manager/${encodeURIComponent(todoId)}/block`,
      input
    );
  }

  startJob(todoId: string, input: StartJobRequest): Promise<JobMutationResponse> {
    return this.request("POST", `/api/runner/jobs/${encodeURIComponent(todoId)}/start`, input);
  }

  heartbeatJob(todoId: string, leaseToken: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/runner/jobs/${encodeURIComponent(todoId)}/heartbeat`, { leaseToken });
  }

  appendLog(todoId: string, input: AppendJobLogRequest): Promise<{ ok: true }> {
    return this.request("POST", `/api/runner/jobs/${encodeURIComponent(todoId)}/logs`, input);
  }

  appendLogs(todoId: string, input: AppendJobLogsRequest): Promise<AppendJobLogsResponse> {
    return this.request("POST", `/api/runner/jobs/${encodeURIComponent(todoId)}/logs/batch`, input);
  }

  listRuns(limit = 50): Promise<RunnerRunListResponse> {
    return this.request("GET", `/api/runner/runs?limit=${encodeURIComponent(String(limit))}`);
  }

  getRunLogs(attemptId: string, after = 0, limit = 500): Promise<RunnerRunLogResponse> {
    const query = new URLSearchParams({ after: String(after), limit: String(limit) });
    return this.request("GET", `/api/runner/runs/${encodeURIComponent(attemptId)}/logs?${query}`);
  }

  completeJob(todoId: string, input: CompleteJobRequest): Promise<JobMutationResponse> {
    return this.request("POST", `/api/runner/jobs/${encodeURIComponent(todoId)}/complete`, input);
  }

  uploadScreenshot(
    todoId: string,
    leaseToken: string,
    deliveryId: string,
    input: { fileName: string; mimeType: TodoScreenshotMimeType; bytes: Uint8Array }
  ): Promise<UploadTodoArtifactResponse> {
    return this.requestMultipart(
      `/api/runner/jobs/${encodeURIComponent(todoId)}/artifacts`,
      () => {
        const form = new FormData();
        const bytes = new Uint8Array(input.bytes.byteLength);
        bytes.set(input.bytes);
        form.set("leaseToken", leaseToken);
        form.set("deliveryId", deliveryId);
        form.set("file", new Blob([bytes.buffer], { type: input.mimeType }), input.fileName);
        return form;
      }
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    authenticated = true,
    retries = 0
  ): Promise<T> {
    return this.performRequest(
      method,
      path,
      body === undefined
        ? undefined
        : () => ({ body: JSON.stringify(body), contentType: "application/json" }),
      authenticated,
      retries
    );
  }

  private requestMultipart<T>(
    path: string,
    createBody: () => FormData,
    retries = 0
  ): Promise<T> {
    return this.performRequest("POST", path, () => ({ body: createBody() }), true, retries, 60_000);
  }

  private async performRequest<T>(
    method: string,
    path: string,
    createBody: (() => { body: BodyInit; contentType?: string }) | undefined,
    authenticated: boolean,
    retries: number,
    timeoutMs = 15_000
  ): Promise<T> {
    if (authenticated && !this.token) throw new Error("CLI 尚未获得 Maple Server 授权。");
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const headers = new Headers({ accept: "application/json" });
        const requestBody = createBody?.();
        if (requestBody?.contentType) headers.set("content-type", requestBody.contentType);
        if (authenticated && this.token) headers.set("authorization", `Bearer ${this.token}`);
        const response = await fetch(`${this.serverUrl}${path}`, {
          method,
          headers,
          body: requestBody?.body,
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as ApiErrorBody;
          throw new MapleApiError(
            payload.error?.message || `Server 请求失败（HTTP ${response.status}）。`,
            response.status,
            payload.error?.code || "request_failed"
          );
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        if (error instanceof MapleApiError || attempt >= retries) throw error;
        await Bun.sleep(Math.min(500 * 2 ** attempt, 4_000));
      }
    }
    throw lastError;
  }
}
