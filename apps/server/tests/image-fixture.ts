import { Buffer } from "node:buffer";

const SOLID_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** 生成指定尺寸的纯色 PNG，作为图片处理测试夹具（无需 sharp）。 */
export async function solidPngBytes(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await new Bun.Image(SOLID_1X1_PNG)
    .resize(width, height, { fit: "fill", filter: "nearest" })
    .png()
    .bytes();
  return new Uint8Array(bytes);
}
