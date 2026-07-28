import type { Runner } from "@maple/protocol";
import type { RunnerRepository } from "../repositories/runner-repository";
import { HttpError } from "../http/responses";
import type { SessionPrincipal, SessionService } from "./session-service";

export function readBearerToken(headers: Headers): string | null {
  const value = headers.get("authorization")?.trim();
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export class RequestAuth {
  constructor(
    private readonly runners: RunnerRepository,
    private readonly sessions: SessionService
  ) {}

  runner(headers: Headers): Runner | null {
    return this.runners.authenticate(readBearerToken(headers));
  }

  account(headers: Headers): SessionPrincipal | null {
    return this.sessions.authenticate(headers);
  }

  workspace(request: Request, options: { mutating?: boolean; trusted?: boolean } = {}): {
    workspaceId: string;
    principal: SessionPrincipal;
  } {
    const principal = this.account(request.headers);
    if (!principal) throw new HttpError(401, "unauthorized", "认证信息无效或已经过期。");
    if (options.trusted !== false) this.sessions.assertTrusted(principal);
    if (options.mutating) this.sessions.assertCsrf(principal, request);
    return {
      workspaceId: this.sessions.resolveWorkspaceId(principal, request.headers.get("x-maple-workspace")),
      principal
    };
  }
}
