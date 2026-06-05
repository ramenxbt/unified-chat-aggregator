import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type ArchiveLookupOptions = {
  archivePath?: string;
  archiveDir?: string;
};

export async function resolveArchivePath(options: ArchiveLookupOptions, fallbackArchiveDir = "data/feed-sessions") {
  if (options.archivePath) return options.archivePath;

  return findLatestArchivePath(options.archiveDir ?? fallbackArchiveDir);
}

export async function findLatestArchivePath(archiveDir: string) {
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const sessionDirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sessionPath = path.join(archiveDir, entry.name);
        const stats = await stat(sessionPath);

        return {
          path: sessionPath,
          modifiedAt: stats.mtimeMs
        };
      })
  );

  const latestSession = sessionDirs.sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
  if (!latestSession) {
    throw new Error(`No feed archive sessions found in ${archiveDir}`);
  }

  return latestSession.path;
}
