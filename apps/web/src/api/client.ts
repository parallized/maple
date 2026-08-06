import type {
  AcceptanceSettings,
  AuthRequiredResponse,
  AuthSessionResponse,
  ChangePasswordRequest,
  CreateRunnerCommandRequest,
  CreateTodoRequest,
  DashboardSnapshot,
  DeepSeekConnectionResponse,
  DeviceAuthorizationApproveResponse,
  DeviceAuthorizationReview,
  HomeStatsResponse,
  LoginAccountRequest,
  ModelPricingResponse,
  Project,
  RegisterAccountRequest,
  RunnerCommand,
  SecurityEvent,
  Todo,
  TodoDetailResponse,
  UpdateAcceptanceSettingsRequest,
  UpdateRunnerModelSettingsRequest,
  UpdateRunnerModelSettingsResponse,
  UpdateUserPreferencesRequest,
  UpdateWorkspaceExecutionSettingsRequest,
  UpdateProfileRequest,
  UpdateProjectRequest,
  UpdateTodoRequest,
  VersionHistoryResponse,
  WebSessionSummary,
  UserPreferences,
  WorkspaceExecutionSettings,
  UploadTodoAssetResponse,
  WorkspaceSummary
} from "@maple/protocol";

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "DashboardApiError";
  }
}

export class DashboardApi {
  private csrfToken = "";
  private workspaceId = "";

  constructor(readonly serverUrl: string) {}

  setCsrfToken(value: string): void {
    this.csrfToken = value;
  }

  setWorkspaceId(value: string): void {
    this.workspaceId = value.trim();
  }

  session(): Promise<AuthSessionResponse | AuthRequiredResponse> {
    return this.request("GET", "/api/auth/session");
  }

  homeStats(): Promise<HomeStatsResponse> {
    return this.request("GET", "/api/home-stats");
  }

  versionHistory(): Promise<VersionHistoryResponse> {
    return this.request("GET", "/api/version-history");
  }

  register(input: RegisterAccountRequest): Promise<AuthSessionResponse> {
    return this.request("POST", "/api/auth/register", input, undefined, false);
  }

  login(input: LoginAccountRequest): Promise<AuthSessionResponse> {
    return this.request("POST", "/api/auth/login", input, undefined, false);
  }

  logout(): Promise<{ signedOut: true }> {
    return this.request("POST", "/api/auth/logout");
  }

  updateProfile(input: UpdateProfileRequest): Promise<AuthSessionResponse> {
    return this.request("PATCH", "/api/account/profile", input);
  }

  changePassword(input: ChangePasswordRequest): Promise<{ changed: true }> {
    return this.request("POST", "/api/account/password", input);
  }

  async uploadAvatar(file: File): Promise<AuthSessionResponse> {
    const form = new FormData();
    form.set("avatar", file);
    const response = await fetch(`${this.serverUrl}/api/account/avatar`, {
      method: "POST",
      credentials: "include",
      headers: this.workspaceHeaders({ "x-maple-csrf": this.csrfToken }),
      body: form
    });
    return this.readResponse<AuthSessionResponse>(response);
  }

  createWorkspace(name: string): Promise<AuthSessionResponse> {
    return this.request("POST", "/api/workspaces", { name });
  }

  switchWorkspace(workspaceId: string): Promise<AuthSessionResponse> {
    return this.request("POST", `/api/workspaces/${encodeURIComponent(workspaceId)}/switch`);
  }

  renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary> {
    return this.request("PATCH", `/api/workspaces/${encodeURIComponent(workspaceId)}`, { name });
  }

  accountSessions(): Promise<{ sessions: WebSessionSummary[] }> {
    return this.request("GET", "/api/account/sessions");
  }

  approveSession(sessionId: string): Promise<WebSessionSummary> {
    return this.request("POST", `/api/account/sessions/${encodeURIComponent(sessionId)}/approve`);
  }

  revokeSession(sessionId: string): Promise<{ revoked: true }> {
    return this.request("DELETE", `/api/account/sessions/${encodeURIComponent(sessionId)}`);
  }

  revokeOtherSessions(): Promise<{ revoked: true }> {
    return this.request("DELETE", "/api/account/sessions");
  }

  securityEvents(): Promise<{ events: SecurityEvent[] }> {
    return this.request("GET", "/api/account/security-events");
  }

  userPreferences(signal?: AbortSignal): Promise<UserPreferences> {
    return this.request("GET", "/api/account/preferences", undefined, signal);
  }

  updateUserPreferences(input: UpdateUserPreferencesRequest): Promise<UserPreferences> {
    return this.request("PATCH", "/api/account/preferences", input);
  }

  approveDevice(userCode: string, runnerName?: string): Promise<DeviceAuthorizationApproveResponse> {
    return this.request("POST", "/api/device-authorizations/approve", runnerName ? { userCode, runnerName } : { userCode });
  }

  deviceAuthorization(userCode: string): Promise<DeviceAuthorizationReview> {
    return this.request("GET", `/api/device-authorizations/${encodeURIComponent(userCode)}`);
  }

  snapshot(signal?: AbortSignal): Promise<DashboardSnapshot> {
    return this.request("GET", "/api/dashboard", undefined, signal);
  }

  modelPricing(signal?: AbortSignal): Promise<ModelPricingResponse> {
    return this.request("GET", "/api/model-pricing?limit=5000", undefined, signal);
  }

  createRunnerCommand(runnerId: string, input: CreateRunnerCommandRequest): Promise<RunnerCommand> {
    return this.request("POST", `/api/runners/${encodeURIComponent(runnerId)}/commands`, input);
  }

  updateRunnerModels(
    runnerId: string,
    input: UpdateRunnerModelSettingsRequest
  ): Promise<UpdateRunnerModelSettingsResponse> {
    return this.request("PATCH", `/api/runners/${encodeURIComponent(runnerId)}/models`, input);
  }

  revokeRunner(runnerId: string): Promise<{ revoked: true }> {
    return this.request("DELETE", `/api/runners/${encodeURIComponent(runnerId)}`);
  }

  runnerCommand(commandId: string, signal?: AbortSignal): Promise<RunnerCommand> {
    return this.request("GET", `/api/runner-commands/${encodeURIComponent(commandId)}`, undefined, signal);
  }

  createTodo(projectId: string, input: CreateTodoRequest): Promise<Todo> {
    return this.request("POST", `/api/projects/${encodeURIComponent(projectId)}/todos`, input);
  }

  updateProject(projectId: string, input: UpdateProjectRequest): Promise<Project> {
    return this.request("PATCH", `/api/projects/${encodeURIComponent(projectId)}`, input);
  }

  deleteProject(projectId: string): Promise<{ deleted: true }> {
    return this.request("DELETE", `/api/projects/${encodeURIComponent(projectId)}`);
  }

  updateTodo(todoId: string, input: UpdateTodoRequest): Promise<Todo> {
    return this.request("PATCH", `/api/todos/${encodeURIComponent(todoId)}`, input);
  }

  deleteTodo(todoId: string): Promise<{ deleted: true }> {
    return this.request("DELETE", `/api/todos/${encodeURIComponent(todoId)}`);
  }

  todoDetail(todoId: string, signal?: AbortSignal): Promise<TodoDetailResponse> {
    return this.request("GET", `/api/todos/${encodeURIComponent(todoId)}`, undefined, signal);
  }

  async artifactBlob(todoId: string, artifactId: string, variant?: "thumb" | "full", signal?: AbortSignal): Promise<Blob> {
    const query = variant === "thumb" ? "?size=thumb" : "";
    const response = await fetch(
      `${this.serverUrl}/api/todos/${encodeURIComponent(todoId)}/artifacts/${encodeURIComponent(artifactId)}${query}`,
      { credentials: "include", headers: this.workspaceHeaders(), signal }
    );
    if (!response.ok) {
      throw new DashboardApiError(`附件下载失败（HTTP ${response.status}）。`, response.status, "artifact_download_failed");
    }
    return response.blob();
  }

  acceptanceSettings(signal?: AbortSignal): Promise<AcceptanceSettings> {
    return this.request("GET", "/api/settings/acceptance", undefined, signal);
  }

  updateAcceptanceSettings(input: UpdateAcceptanceSettingsRequest): Promise<AcceptanceSettings> {
    return this.request("PATCH", "/api/settings/acceptance", input);
  }

  executionSettings(signal?: AbortSignal): Promise<WorkspaceExecutionSettings> {
    return this.request("GET", "/api/settings/execution", undefined, signal);
  }

  deepSeekConnection(signal?: AbortSignal): Promise<DeepSeekConnectionResponse> {
    return this.request("GET", "/api/provider-connections/deepseek", undefined, signal);
  }

  connectDeepSeek(apiKey: string): Promise<DeepSeekConnectionResponse> {
    return this.request("POST", "/api/provider-connections/deepseek/connect", { apiKey });
  }

  disconnectDeepSeek(): Promise<DeepSeekConnectionResponse> {
    return this.request("DELETE", "/api/provider-connections/deepseek");
  }

  updateExecutionSettings(
    input: UpdateWorkspaceExecutionSettingsRequest
  ): Promise<WorkspaceExecutionSettings> {
    return this.request("PATCH", "/api/settings/execution", input);
  }

  /** 下载完成提醒音频；未上传时抛 404。 */
  async workspaceReminderAudio(signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(`${this.serverUrl}/api/settings/reminder-audio`, {
      credentials: "include",
      headers: this.workspaceHeaders(),
      signal
    });
    if (!response.ok) {
      throw new DashboardApiError(
        `提醒音频下载失败（HTTP ${response.status}）。`,
        response.status,
        "reminder_audio_download_failed"
      );
    }
    return response.blob();
  }

  /** 上传完成提醒音频（≤500kB），返回最新执行设置。 */
  async uploadWorkspaceReminderAudio(
    data: Uint8Array,
    mimeType: string,
    fileName: string
  ): Promise<WorkspaceExecutionSettings> {
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    const response = await fetch(`${this.serverUrl}/api/settings/reminder-audio`, {
      method: "PUT",
      credentials: "include",
      headers: this.workspaceHeaders({
        "content-type": mimeType,
        "x-maple-file-name": encodeURIComponent(fileName),
        "x-maple-csrf": this.csrfToken
      }),
      body: new Blob([bytes.buffer], { type: mimeType })
    });
    return this.readResponse<WorkspaceExecutionSettings>(response);
  }

  /** 删除完成提醒音频，返回最新执行设置。 */
  removeWorkspaceReminderAudio(): Promise<WorkspaceExecutionSettings> {
    return this.request("DELETE", "/api/settings/reminder-audio");
  }

  async uploadTodoAsset(todoId: string, data: Uint8Array, mimeType: string): Promise<UploadTodoAssetResponse> {
    const form = new FormData();
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    form.set("file", new Blob([bytes.buffer], { type: mimeType }), "image");
    const response = await fetch(`${this.serverUrl}/api/todos/${encodeURIComponent(todoId)}/assets`, {
      method: "POST",
      credentials: "include",
      headers: this.workspaceHeaders({ "x-maple-csrf": this.csrfToken }),
      body: form
    });
    return this.readResponse<UploadTodoAssetResponse>(response);
  }

  async todoAssetBlob(todoId: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(
      `${this.serverUrl}/api/todos/${encodeURIComponent(todoId)}/assets/${encodeURIComponent(assetId)}`,
      { credentials: "include", headers: this.workspaceHeaders(), signal }
    );
    if (!response.ok) {
      throw new DashboardApiError(`正文图片下载失败（HTTP ${response.status}）。`, response.status, "todo_asset_download_failed");
    }
    return response.blob();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    includeCsrf = true
  ): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    if (this.workspaceId) headers.set("x-maple-workspace", this.workspaceId);
    if (body !== undefined) headers.set("content-type", "application/json");
    if (includeCsrf && method !== "GET" && method !== "HEAD" && this.csrfToken) {
      headers.set("x-maple-csrf", this.csrfToken);
    }
    const response = await fetch(`${this.serverUrl}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
    return this.readResponse<T>(response);
  }

  private workspaceHeaders(initial?: HeadersInit): Headers {
    const headers = new Headers(initial);
    if (this.workspaceId) headers.set("x-maple-workspace", this.workspaceId);
    return headers;
  }

  private async readResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as ApiErrorBody;
      throw new DashboardApiError(
        payload.error?.message || `Server 请求失败（HTTP ${response.status}）。`,
        response.status,
        payload.error?.code || "request_failed"
      );
    }
    return (await response.json()) as T;
  }
}
