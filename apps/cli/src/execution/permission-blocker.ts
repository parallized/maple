interface PermissionBlockerInput {
  operationalOutput: string;
  assistantOutput: string;
}

export type PermissionBlockKind = "filesystem" | "network";

export interface PermissionBlock {
  kind: PermissionBlockKind;
  message: string;
}

const POLICY_DENIAL_PATTERNS = [
  /\b(?:rejected:\s*)?blocked by policy\b/i,
  /\bpermission denied\b/i,
  /\boperation not permitted\b/i,
  /\bsandbox.{0,80}\b(?:blocked|denied|read[- ]only)\b/is
];

const INCOMPLETE_PATTERNS = [
  /(?:无法|不能|未能).{0,120}(?:写入|落盘|修改|应用|执行|创建|删除)/s,
  /(?:写入|修改|进程执行).{0,100}(?:被|均被).{0,40}(?:拦截|阻止|拒绝)/s,
  /(?:只能|仅能).{0,100}(?:提供|给出).{0,60}(?:补丁|patch|方案|报告)/is,
  /\b(?:unable|cannot|can't|could not).{0,120}\b(?:write|persist|modify|edit|apply|execute|run|create|delete)\b/is,
  /\b(?:changes?|patch).{0,100}\bnot\b.{0,60}\b(?:applied|written|persisted)\b/is
];

const RECOVERY_PATTERNS = [
  /(?:最终|随后|现已).{0,80}(?:成功(?:写入|修改|应用|执行)|已(?:写入|落盘|应用|修改完成))/s,
  /\b(?:eventually|subsequently|now).{0,80}\b(?:successfully )?(?:applied|written|persisted|completed|fixed)\b/is
];

/**
 * 网络 / 出网上下文：SSH、TCP/代理、远程地址与中文出网描述。
 * 命中后把策略拦截归类为“出网受限”而非“工作区不可写”，便于给出宿主侧引导。
 */
const NETWORK_CONTEXT_PATTERNS = [
  /\bssh\b/i,
  /\b(?:tcp|udp|socket|connect|network|proxy)\b/i,
  /\b127\.0\.0\.1:\d{2,5}\b/,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  /(?:代理|出网|外网|部署服务器|远程连接|无法连接|不能连接)/
];

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const FILESYSTEM_BLOCK_MESSAGE =
  "Worker 被只读沙箱或权限策略拦截，未能把任务改动写入当前项目。";

const NETWORK_BLOCK_MESSAGE =
  "Worker 出网被沙箱或权限策略拦截（SSH、外部 TCP、本地代理均无法连接），未能连接部署服务器等外部资源。"
  + "请在本机非沙箱会话中运行 Maple CLI，或在宿主沙箱中放行网络后让 Worker 重试。";

/**
 * Provider 可能在工具被策略拦截后仍以退出码 0 结束 turn。
 * 只有“原始工具拒绝 + 最终明确未落盘”两个信号同时出现时才判定失败，
 * 避免把普通问答中提及权限、或中途失败但随后恢复的任务误伤。
 */
export function detectPermissionBlock(input: PermissionBlockerInput): PermissionBlock | null {
  if (!matchesAny(input.operationalOutput, POLICY_DENIAL_PATTERNS)) return null;
  if (!matchesAny(input.assistantOutput, INCOMPLETE_PATTERNS)) return null;
  if (matchesAny(input.assistantOutput, RECOVERY_PATTERNS)) return null;
  const context = `${input.operationalOutput}\n${input.assistantOutput}`;
  const network = matchesAny(context, NETWORK_CONTEXT_PATTERNS);
  return network
    ? { kind: "network", message: NETWORK_BLOCK_MESSAGE }
    : { kind: "filesystem", message: FILESYSTEM_BLOCK_MESSAGE };
}

/** 兼容旧入口：仅返回面向用户的失败说明。 */
export function detectPermissionBlocker(input: PermissionBlockerInput): string | null {
  return detectPermissionBlock(input)?.message ?? null;
}
