export type WorkspaceRole = "owner" | "member";
export type WebSessionTrust = "trusted" | "review";
export type SecurityEventSeverity = "info" | "warning" | "critical";
export type DeploymentMode = "hosted" | "standalone";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UserThemeMode = "system" | "light" | "dark";
export type UserUiFont = "default" | "chill-round";
export type UserUiLanguage = "zh" | "en";

export interface UserPreferences {
  theme: UserThemeMode;
  uiFont: UserUiFont;
  uiLanguage: UserUiLanguage;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  theme: "system",
  uiFont: "chill-round",
  uiLanguage: "zh"
};

export type UpdateUserPreferencesRequest = Partial<UserPreferences>;

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export interface WebSessionSummary {
  id: string;
  trust: WebSessionTrust;
  current: boolean;
  ipAddress: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface SecurityEvent {
  id: string;
  type: string;
  severity: SecurityEventSeverity;
  ipAddress: string | null;
  deviceLabel: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface AuthSessionResponse {
  authenticated: true;
  deploymentMode: DeploymentMode;
  user: UserProfile;
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  session: WebSessionSummary;
  csrfToken: string;
}

export interface AuthRequiredResponse {
  authenticated: false;
}

export interface RegisterAccountRequest {
  email: string;
  password: string;
  name: string;
  workspaceName?: string;
}

export interface LoginAccountRequest {
  email: string;
  password: string;
}

export interface UpdateProfileRequest {
  name: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface UpdateWorkspaceRequest {
  name: string;
}

export interface DeviceAuthorizationStartRequest {
  runnerName: string;
  hostname: string;
  platform: string;
  version: string;
  codeChallenge: string;
  supportedWorkers?: import("./models").WorkerKind[];
  workerInventory?: import("./models").WorkerInventoryItem[];
  capabilities?: import("./models").RunnerCapability[];
}

export interface DeviceAuthorizationStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: string;
  intervalSeconds: number;
}

export interface DeviceAuthorizationApproveRequest {
  userCode: string;
  runnerName?: string;
}

export interface DeviceAuthorizationApproveResponse {
  approved: true;
  workspaceId: string;
  runnerName: string;
}

export interface DeviceAuthorizationReview {
  userCode: string;
  runnerName: string;
  hostname: string;
  platform: string;
  expiresAt: string;
}

export interface DeviceAuthorizationTokenRequest {
  deviceCode: string;
  codeVerifier: string;
}

export type DeviceAuthorizationTokenResponse =
  | { status: "pending"; retryAfterMs: number }
  | { status: "slow_down"; retryAfterMs: number }
  | { status: "expired" }
  | {
      status: "authorized";
      runner: import("./models").Runner;
      runnerToken: string;
      workspace: WorkspaceSummary;
    };
