import { FFIType, dlopen, ptr, read, toArrayBuffer, type Pointer } from "bun:ffi";

const CRED_TYPE_GENERIC = 1;
const CRED_PERSIST_LOCAL_MACHINE = 2;
const ERROR_NOT_FOUND = 1168;

const OFFSETS = {
  flags: 0,
  type: 4,
  targetName: 8,
  credentialBlobSize: 32,
  credentialBlob: 40,
  persist: 48,
  userName: 72,
  size: 80
} as const;

let libraries: ReturnType<typeof openLibraries> | null = null;

function openLibraries() {
  const advapi = dlopen("Advapi32.dll", {
    CredWriteW: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    CredReadW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    CredDeleteW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32 },
    CredFree: { args: [FFIType.ptr], returns: FFIType.void }
  });
  const kernel = dlopen("Kernel32.dll", {
    GetLastError: { args: [], returns: FFIType.u32 }
  });
  return { advapi, kernel };
}

function nativeLibraries(): ReturnType<typeof openLibraries> {
  if (!isWindowsCredentialManagerSupported()) {
    throw new Error("Windows 凭据管理器仅支持 64 位 Windows Runner。");
  }
  libraries ??= openLibraries();
  return libraries;
}

function utf16(value: string): Uint16Array {
  const encoded = Buffer.from(`${value}\0`, "utf16le");
  return new Uint16Array(encoded.buffer, encoded.byteOffset, encoded.byteLength / 2);
}

function writePointer(view: DataView, offset: number, value: Pointer): void {
  view.setBigUint64(offset, BigInt(value), true);
}

function nativeError(action: string, code: number): Error {
  return new Error(`${action}失败（Windows 错误 ${code}）。`);
}

export function isWindowsCredentialManagerSupported(): boolean {
  return process.platform === "win32" && (process.arch === "x64" || process.arch === "arm64");
}

/** 保存 CRED_TYPE_GENERIC 凭据；密钥仅在调用期间保留于可清零的字节缓冲。 */
export function writeWindowsCredential(target: string, secret: string): void {
  if (!target.trim()) throw new Error("凭据名称不能为空。");
  if (!secret) throw new Error("凭据内容不能为空。");

  const { advapi, kernel } = nativeLibraries();
  const targetBuffer = utf16(target);
  const userNameBuffer = utf16("Maple");
  const secretBuffer = new TextEncoder().encode(secret);
  const credential = new Uint8Array(OFFSETS.size);
  const view = new DataView(credential.buffer, credential.byteOffset, credential.byteLength);
  view.setUint32(OFFSETS.flags, 0, true);
  view.setUint32(OFFSETS.type, CRED_TYPE_GENERIC, true);
  writePointer(view, OFFSETS.targetName, ptr(targetBuffer));
  view.setUint32(OFFSETS.credentialBlobSize, secretBuffer.byteLength, true);
  writePointer(view, OFFSETS.credentialBlob, ptr(secretBuffer));
  view.setUint32(OFFSETS.persist, CRED_PERSIST_LOCAL_MACHINE, true);
  writePointer(view, OFFSETS.userName, ptr(userNameBuffer));

  try {
    if (!advapi.symbols.CredWriteW(ptr(credential), 0)) {
      throw nativeError("保存凭据", kernel.symbols.GetLastError());
    }
  } finally {
    secretBuffer.fill(0);
    credential.fill(0);
  }
}

/** 读取凭据并立即释放 Windows 分配的 CREDENTIALW。 */
export function readWindowsCredential(target: string): string | null {
  if (!target.trim()) return null;
  const { advapi, kernel } = nativeLibraries();
  const targetBuffer = utf16(target);
  const output = new BigUint64Array(1);
  if (!advapi.symbols.CredReadW(ptr(targetBuffer), CRED_TYPE_GENERIC, 0, ptr(output))) {
    const code = kernel.symbols.GetLastError();
    if (code === ERROR_NOT_FOUND) return null;
    throw nativeError("读取凭据", code);
  }

  const credentialPointer = Number(output[0]) as Pointer;
  try {
    const byteLength = read.u32(credentialPointer, OFFSETS.credentialBlobSize);
    if (byteLength === 0) return "";
    const blobPointer = read.ptr(credentialPointer, OFFSETS.credentialBlob) as Pointer;
    const bytes = new Uint8Array(toArrayBuffer(blobPointer, 0, byteLength)).slice();
    try {
      return new TextDecoder().decode(bytes);
    } finally {
      bytes.fill(0);
    }
  } finally {
    advapi.symbols.CredFree(credentialPointer);
    output.fill(0n);
  }
}

export function deleteWindowsCredential(target: string): boolean {
  if (!target.trim()) return false;
  const { advapi, kernel } = nativeLibraries();
  const targetBuffer = utf16(target);
  if (advapi.symbols.CredDeleteW(ptr(targetBuffer), CRED_TYPE_GENERIC, 0)) return true;
  const code = kernel.symbols.GetLastError();
  if (code === ERROR_NOT_FOUND) return false;
  throw nativeError("删除凭据", code);
}
