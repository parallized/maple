import sharp from "sharp";
import {
  DEFAULT_SCREENSHOT_COMPRESSION_PRESET,
  type ScreenshotCompressionPreset,
  type TodoScreenshotMimeType
} from "@maple/protocol";

export interface ScreenshotCompressionProfile {
  maxEdge: number;
  quality: number;
}

export const SCREENSHOT_COMPRESSION_PROFILES = {
  high: { maxEdge: 3200, quality: 95 },
  balanced: { maxEdge: 1600, quality: 80 },
  compact: { maxEdge: 800, quality: 70 }
} as const satisfies Record<ScreenshotCompressionPreset, ScreenshotCompressionProfile>;

const SCREENSHOT_MAX_INPUT_PIXELS = 40_000_000;

export interface NormalizedScreenshot {
  bytes: Uint8Array;
  fileName: string;
  mimeType: "image/webp";
  width: number;
  height: number;
}

/** 缩略图规格:网格里显示约 320-400px 宽,按 2x DPR 给到 720px,文字不再因浏览器暴力缩小而锯齿。 */
const THUMBNAIL_MAX_EDGE = 720;
const THUMBNAIL_QUALITY = 78;

export class ScreenshotNormalizationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ScreenshotNormalizationError";
  }
}

export function screenshotMimeType(bytes: Uint8Array): TodoScreenshotMimeType | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
    && bytes.at(-2) === 0xff
    && bytes.at(-1) === 0xd9
  ) return "image/jpeg";
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

function webpFileName(value: string): string {
  const leaf = value
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const base = leaf?.replace(/\.[^.]*$/, "").trim() || "screenshot";
  return `${base.slice(0, 155)}.webp`;
}

export async function normalizeScreenshot(
  bytes: Uint8Array,
  originalFileName: string,
  compressionPreset: ScreenshotCompressionPreset = DEFAULT_SCREENSHOT_COMPRESSION_PRESET
): Promise<NormalizedScreenshot> {
  try {
    const profile = SCREENSHOT_COMPRESSION_PROFILES[compressionPreset];
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: SCREENSHOT_MAX_INPUT_PIXELS
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new ScreenshotNormalizationError("截图缺少有效尺寸。");
    }

    const output = await image
      .rotate()
      .resize({
        width: profile.maxEdge,
        height: profile.maxEdge,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({
        quality: profile.quality,
        effort: 4,
        smartSubsample: true
      })
      .toBuffer({ resolveWithObject: true });

    if (!output.info.width || !output.info.height) {
      throw new ScreenshotNormalizationError("截图压缩后缺少有效尺寸。");
    }

    return {
      bytes: new Uint8Array(output.data),
      fileName: webpFileName(originalFileName),
      mimeType: "image/webp",
      width: output.info.width,
      height: output.info.height
    };
  } catch (error) {
    if (error instanceof ScreenshotNormalizationError) throw error;
    throw new ScreenshotNormalizationError("截图无法解码或压缩。", { cause: error });
  }
}

/** 由已规范化的截图生成小尺寸缩略图;失败返回 null(不阻断主流程,前端回退原图)。 */
export async function createScreenshotThumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const output = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: SCREENSHOT_MAX_INPUT_PIXELS
    })
      .rotate()
      .resize({
        width: THUMBNAIL_MAX_EDGE,
        height: THUMBNAIL_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
        kernel: "lanczos3"
      })
      .webp({ quality: THUMBNAIL_QUALITY, effort: 4, smartSubsample: true })
      .toBuffer();
    return new Uint8Array(output);
  } catch {
    return null;
  }
}
