import { mkdir, mkdtemp, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findLatestArchivePath, resolveArchivePath } from "./feedArchiveLookup";

describe("feed archive lookup", () => {
  it("returns an explicit archive path before scanning directories", async () => {
    await expect(
      resolveArchivePath({
        archivePath: "data/feed-sessions/explicit",
        archiveDir: "data/feed-sessions"
      })
    ).resolves.toBe("data/feed-sessions/explicit");
  });

  it("finds the newest archive session directory", async () => {
    const archiveDir = await mkdtemp(path.join(os.tmpdir(), "feed-archive-lookup-"));
    const older = path.join(archiveDir, "older");
    const newer = path.join(archiveDir, "newer");

    await mkdir(older);
    await mkdir(newer);
    await utimes(older, new Date("2026-06-05T12:00:00.000Z"), new Date("2026-06-05T12:00:00.000Z"));
    await utimes(newer, new Date("2026-06-05T13:00:00.000Z"), new Date("2026-06-05T13:00:00.000Z"));

    await expect(findLatestArchivePath(archiveDir)).resolves.toBe(newer);
  });
});
