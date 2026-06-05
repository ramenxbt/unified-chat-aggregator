import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFixtureEvent, initialConnectorStatuses } from "../fixtures/fixtureEvents";
import { createFeedSessionId, FileFeedArchive } from "./feedArchive";
import {
  buildLiveProofGateReport,
  formatLiveProofGateReport,
  watchLiveProofGate
} from "./liveProofGate";

describe("live proof gate", () => {
  it("passes when the archive has enough events, all platforms, statuses, labels, and latency", async () => {
    const { archivePath } = await createProofFixture([0, 1, 2, 3, 4, 5], initialConnectorStatuses);
    const report = await buildLiveProofGateReport({
      archivePath,
      minEvents: 6,
      minSourceLabels: 3,
      maxP95LatencyMs: 1500
    });
    const formatted = formatLiveProofGateReport(report);

    expect(report.ok).toBe(true);
    expect(report.platformCounts).toMatchObject({
      twitch: 2,
      kick: 2,
      x: 2
    });
    expect(report.statusPlatformCounts).toMatchObject({
      twitch: 1,
      kick: 1,
      x: 1
    });
    expect(report.sourceLabels).toContain("KICK (MARKETBUBBLE)");
    expect(report.performance.p95LatencyMs).toBeLessThanOrEqual(1500);
    expect(formatted).toContain("Live proof gate: ready");
    expect(formatted).toContain("PASS Event volume");
  });

  it("reports the missing proof needed before recording", async () => {
    const { archivePath } = await createProofFixture([0, 4], [initialConnectorStatuses[1]]);
    const report = await buildLiveProofGateReport({
      archivePath,
      minEvents: 6,
      minSourceLabels: 3
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "Event volume",
        ok: false,
        detail: "2/6 events captured"
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "Event platforms",
        ok: false,
        detail: "missing twitch, x events"
      })
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "Connector statuses",
        ok: false,
        detail: "missing twitch, x status samples"
      })
    );
  });

  it("can find and watch the latest archive directory", async () => {
    const { archiveDir } = await createProofFixture([0, 1, 2], initialConnectorStatuses);
    const report = await watchLiveProofGate({
      archiveDir,
      minEvents: 3,
      minSourceLabels: 3,
      timeoutMs: 50,
      intervalMs: 5
    });

    expect(report.ok).toBe(true);
    expect(report.eventCount).toBe(3);
  });
});

async function createProofFixture(eventIndexes: number[], statuses = initialConnectorStatuses) {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "live-proof-gate-"));
  const archiveDir = path.join(baseDir, "feed-sessions");
  const archive = new FileFeedArchive(archiveDir);
  const startedAt = "2026-06-05T15:00:00.000Z";
  const sessionId = createFeedSessionId(startedAt, "fixture");

  await archive.start({
    sessionId,
    startedAt,
    mode: "fixture",
    bufferSize: 250,
    fixtureIntervalMs: 1100,
    connectorPlatforms: []
  });

  for (const eventIndex of eventIndexes) {
    archive.recordEvent(createFixtureEvent(eventIndex, new Date(Date.parse(startedAt) + eventIndex * 1000)));
  }

  for (const status of statuses) {
    archive.recordStatus(status);
  }

  await archive.stop("2026-06-05T15:00:10.000Z");

  return {
    archiveDir,
    archivePath: path.join(archiveDir, sessionId)
  };
}
