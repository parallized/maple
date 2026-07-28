import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectScreenshotArtifacts,
  prepareScreenshotDirectory,
  uploadScreenshotArtifacts
} from "../src/execution/screenshot-artifacts";

const temporaryDirectories: string[] = [];
const PNG_BYTES = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Playwright screenshot artifacts", () => {
  it("collects only real images from the attempt directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-screenshot-collect-"));
    temporaryDirectories.push(root);
    const project = join(root, "project");
    const mapleHome = join(root, "home", ".maple");
    mkdirSync(project, { recursive: true });
    const directory = await prepareScreenshotDirectory(mapleHome, "attempt/unsafe");
    writeFileSync(join(directory, "actual.png"), PNG_BYTES);
    writeFileSync(join(directory, "fake.png"), "not an image", "utf8");

    const result = await collectScreenshotArtifacts(directory);

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      fileName: "actual.png",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength
    });
    expect(result.warnings).toEqual(["截图格式无效：fake.png"]);
    expect(directory).toStartWith(join(mapleHome, "artifacts"));
    expect(existsSync(join(project, ".maple"))).toBe(false);
  });

  it("deletes each local screenshot only after its upload succeeds", async () => {
    const mapleHome = mkdtempSync(join(tmpdir(), "maple-screenshot-upload-"));
    temporaryDirectories.push(mapleHome);
    const directory = await prepareScreenshotDirectory(mapleHome, "attempt-1");
    const uploadedPath = join(directory, "a-uploaded.png");
    const retainedPath = join(directory, "b-retained.png");
    writeFileSync(uploadedPath, PNG_BYTES);
    writeFileSync(retainedPath, PNG_BYTES);

    const result = await uploadScreenshotArtifacts(directory, async (artifact) => {
      if (artifact.fileName === "b-retained.png") throw new Error("server unavailable");
      return {
        id: "artifact-1",
        todoId: "todo-1",
        attemptId: "attempt-1",
        kind: "screenshot",
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        createdAt: "2026-07-27T00:00:00.000Z"
      };
    });

    expect(result.uploaded.map((artifact) => artifact.fileName)).toEqual(["a-uploaded.png"]);
    expect(existsSync(uploadedPath)).toBe(false);
    expect(existsSync(retainedPath)).toBe(true);
    expect(result.warnings.join("\n")).toContain("截图上传失败，已保留本地文件：b-retained.png");
  });
});
