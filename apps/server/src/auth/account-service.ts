import type { Database } from "bun:sqlite";
import type {
  ChangePasswordRequest,
  LoginAccountRequest,
  RegisterAccountRequest,
  UpdateProfileRequest
} from "@maple/protocol";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { ServerConfig } from "../config";
import { HttpError } from "../http/responses";
import { nowIso } from "../lib/time";
import { WorkspaceRepository } from "../repositories/workspace-repository";
import { SettingsRepository } from "../repositories/settings-repository";
import { UserSettingsRepository } from "../repositories/user-settings-repository";
import { PersistentRateLimiter } from "./rate-limiter";
import { SessionService, type CreatedSession, type SessionPrincipal, type UserRow } from "./session-service";

interface AccountRow extends UserRow {
  password_hash: string;
}

const DUMMY_PASSWORD_HASH = Bun.password.hash("maple-invalid-account-password", {
  algorithm: "argon2id",
  memoryCost: 65_536,
  timeCost: 3
});

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function cleanName(value: string, field: string): string {
  const result = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!result) throw new HttpError(422, `${field}_required`, field === "name" ? "名称不能为空。" : "工作区名称不能为空。");
  return result;
}

function assertEmail(email: string): void {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, "email_invalid", "请输入有效的邮箱地址。");
  }
}

function assertPassword(password: string): void {
  if (password.length < 10 || password.length > 200) {
    throw new HttpError(422, "password_invalid", "密码长度需为 10 至 200 个字符。");
  }
}

async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65_536,
    timeCost: 3
  });
}

export class AccountService {
  readonly sessions: SessionService;
  readonly workspaces: WorkspaceRepository;
  readonly userSettings: UserSettingsRepository;
  readonly rateLimiter: PersistentRateLimiter;
  private readonly avatarDirectory: string;

  constructor(
    private readonly database: Database,
    private readonly config: ServerConfig
  ) {
    this.sessions = new SessionService(database, config);
    this.workspaces = new WorkspaceRepository(database);
    this.userSettings = new UserSettingsRepository(database);
    this.rateLimiter = new PersistentRateLimiter(database);
    this.avatarDirectory = join(config.dataDir, "avatars");
    const settings = new SettingsRepository(database);
    for (const row of database.query("SELECT id FROM workspaces").all() as Array<{ id: string }>) {
      settings.seedDefaults(row.id);
    }
    for (const row of database.query("SELECT id FROM users").all() as Array<{ id: string }>) {
      this.userSettings.seedDefaults(row.id);
    }
  }

  async register(input: RegisterAccountRequest, ipAddress: string, userAgent: string): Promise<CreatedSession> {
    if (this.config.registrationEnabled === false) {
      throw new HttpError(403, "registration_disabled", "当前服务未开放注册。");
    }
    const email = normalizeEmail(input.email);
    assertEmail(email);
    assertPassword(input.password);
    const name = cleanName(input.name, "name").slice(0, 80);
    const workspaceName = cleanName(
      input.workspaceName === undefined ? `${name}的工作区` : input.workspaceName,
      "workspace"
    ).slice(0, 100);
    const ipAttempt = this.rateLimiter.reserve("register_ip", ipAddress, 5, 60 * 60);
    let emailAttempt: number;
    try {
      emailAttempt = this.rateLimiter.reserve("register_email", email, 3, 60 * 60);
    } catch (error) {
      this.rateLimiter.settle(ipAttempt, true);
      throw error;
    }
    if (this.findByEmail(email)) {
      throw new HttpError(409, "account_unavailable", "该邮箱无法用于创建新账户。");
    }

    const passwordHash = await hashPassword(input.password);
    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const now = nowIso();
    try {
      this.database.transaction(() => {
        this.database.run(
          "INSERT INTO users(id, email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [userId, email, passwordHash, name, now, now]
        );
        this.database.run(
          "INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          [workspaceId, workspaceName, userId, now, now]
        );
        this.database.run(
          "INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
          [workspaceId, userId, now]
        );
        new SettingsRepository(this.database).seedDefaults(workspaceId);
        this.userSettings.seedDefaults(userId);
      }).immediate();
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) {
        throw new HttpError(409, "account_unavailable", "该邮箱无法用于创建新账户。");
      }
      throw error;
    }
    // IP 名额保留以限制批量注册；邮箱名额成功结算，避免正常账户长期占用。
    this.rateLimiter.settle(emailAttempt, true);
    return this.sessions.create(userId, workspaceId, ipAddress, userAgent);
  }

  async login(input: LoginAccountRequest, ipAddress: string, userAgent: string): Promise<CreatedSession> {
    const email = normalizeEmail(input.email);
    assertEmail(email);
    const ipAttempt = this.rateLimiter.reserve("login_ip", ipAddress, 20, 15 * 60);
    let emailAttempt: number;
    try {
      emailAttempt = this.rateLimiter.reserve("login_email", email, 8, 15 * 60);
    } catch (error) {
      this.rateLimiter.settle(ipAttempt, true);
      throw error;
    }
    const account = this.findByEmail(email);
    const valid = await Bun.password.verify(input.password, account?.password_hash ?? await DUMMY_PASSWORD_HASH);
    if (!account || !valid) {
      if (account) {
        const workspace = this.workspaces.listForUser(account.id)[0];
        this.sessions.recordEvent({
          workspaceId: workspace?.id ?? null,
          userId: account.id,
          sessionId: null,
          type: "login.failed",
          severity: "warning",
          ipAddress,
          deviceLabel: null,
          metadata: {}
        });
      }
      throw new HttpError(401, "invalid_credentials", "邮箱或密码不正确。");
    }
    const workspace = this.workspaces.defaultForUser(account.id);
    if (!workspace) throw new HttpError(403, "workspace_required", "账户尚未加入工作区。");
    this.rateLimiter.settle(ipAttempt, true);
    this.rateLimiter.settle(emailAttempt, true);
    return this.sessions.create(account.id, workspace.id, ipAddress, userAgent);
  }

  updateProfile(principal: SessionPrincipal, input: UpdateProfileRequest): void {
    const name = cleanName(input.name, "name").slice(0, 80);
    const now = nowIso();
    this.database.run("UPDATE users SET name = ?, updated_at = ? WHERE id = ?", [name, now, principal.user.id]);
    principal.user.name = name;
    principal.user.updated_at = now;
  }

  async changePassword(principal: SessionPrincipal, input: ChangePasswordRequest): Promise<void> {
    assertPassword(input.newPassword);
    const account = this.findById(principal.user.id);
    if (!account || !await Bun.password.verify(input.currentPassword, account.password_hash)) {
      throw new HttpError(401, "current_password_invalid", "当前密码不正确。");
    }
    if (await Bun.password.verify(input.newPassword, account.password_hash)) {
      throw new HttpError(422, "password_unchanged", "新密码不能与当前密码相同。");
    }
    const nextHash = await hashPassword(input.newPassword);
    this.database.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [nextHash, nowIso(), principal.user.id]);
    this.sessions.revokeOthers(principal);
    this.sessions.recordEvent({
      workspaceId: principal.session.active_workspace_id,
      userId: principal.user.id,
      sessionId: principal.session.id,
      type: "account.password_changed",
      severity: "critical",
      ipAddress: principal.session.ip_address,
      deviceLabel: principal.session.device_label,
      metadata: { otherSessionsRevoked: true }
    });
  }

  async updateAvatar(principal: SessionPrincipal, file: File): Promise<void> {
    if (!(file instanceof File) || file.size <= 0 || file.size > 3 * 1024 * 1024) {
      throw new HttpError(422, "avatar_invalid", "头像需为不超过 3 MB 的图片。");
    }
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: "error", limitInputPixels: 16_000_000 });
    const metadata = await image.metadata().catch(() => null);
    if (!metadata?.width || !metadata.height) throw new HttpError(422, "avatar_invalid", "无法读取这张图片。");
    mkdirSync(this.avatarDirectory, { recursive: true });
    const fileName = `${principal.user.id}.webp`;
    const target = join(this.avatarDirectory, fileName);
    const temporary = `${target}.${process.pid}.tmp`;
    await image.rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 86 }).toFile(temporary);
    renameSync(temporary, target);
    const now = nowIso();
    this.database.run("UPDATE users SET avatar_file = ?, updated_at = ? WHERE id = ?", [fileName, now, principal.user.id]);
    principal.user.avatar_file = fileName;
    principal.user.updated_at = now;
  }

  avatarPath(userId: string): string | null {
    const user = this.findById(userId);
    if (!user?.avatar_file || !/^[0-9a-f-]+\.webp$/i.test(user.avatar_file)) return null;
    return join(this.avatarDirectory, user.avatar_file);
  }

  private findByEmail(email: string): AccountRow | null {
    return this.database.query("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as AccountRow | null;
  }

  private findById(userId: string): AccountRow | null {
    return this.database.query("SELECT * FROM users WHERE id = ?").get(userId) as AccountRow | null;
  }
}
