import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkKickTunnel, formatKickTunnelCheck, writeKickTunnelCheckProof } from "./kickTunnelCheck";

describe("Kick tunnel check", () => {
  it("passes when the public URL reaches the Kick receiver health payload", async () => {
    const check = await checkKickTunnel(
      {
        KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/webhooks/kick"
      },
      {
        fetch: async () => response(200, {
          ok: true,
          platform: "kick",
          receiver: "ready",
          path: "/webhooks/kick"
        })
      }
    );

    expect(check.ok).toBe(true);
    expect(formatKickTunnelCheck(check)).toContain("Kick tunnel: ready");
    expect(formatKickTunnelCheck(check)).toContain("Kick tunnel reaches the local receiver");
  });

  it("formats and writes commit-qualified proof output", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "kick-tunnel-check-"));
    const proofPath = path.join(tempDir, "qa", "kick-tunnel-check.txt");
    const output = formatKickTunnelCheck(
      {
        ok: true,
        url: "https://market-bubble-tunnel.example/webhooks/kick",
        detail: "Kick tunnel reaches the local receiver at /webhooks/kick."
      },
      {
        commit: "abc1234",
        checkedAt: "2026-06-08T00:00:00.000Z"
      }
    );

    await writeKickTunnelCheckProof(proofPath, output);

    expect(output).toContain("Repo commit: abc1234");
    expect(output).toContain("Checked at: 2026-06-08T00:00:00.000Z");
    expect(await readFile(proofPath, "utf8")).toBe(`${output}\n`);
  });

  it("fails when no public URL is configured", async () => {
    const check = await checkKickTunnel({});

    expect(check).toEqual({
      ok: false,
      url: null,
      detail: "KICK_WEBHOOK_PUBLIC_URL is not configured."
    });
  });

  it("fails when the public URL does not use the configured receiver path", async () => {
    const check = await checkKickTunnel({
      KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/wrong",
      KICK_WEBHOOK_PATH: "/webhooks/kick"
    });

    expect(check.ok).toBe(false);
    expect(check.detail).toBe("KICK_WEBHOOK_PUBLIC_URL must end in /webhooks/kick.");
  });

  it("fails when the tunnel returns an HTTP error", async () => {
    const check = await checkKickTunnel(
      {
        KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/webhooks/kick"
      },
      {
        fetch: async () => response(502, "bad gateway")
      }
    );

    expect(check.ok).toBe(false);
    expect(check.detail).toContain("Tunnel returned HTTP 502");
  });

  it("fails when the tunnel response is not the Kick receiver health payload", async () => {
    const check = await checkKickTunnel(
      {
        KICK_WEBHOOK_PUBLIC_URL: "https://market-bubble-tunnel.example/webhooks/kick"
      },
      {
        fetch: async () => response(200, {
          ok: true,
          platform: "other",
          receiver: "ready",
          path: "/webhooks/kick"
        })
      }
    );

    expect(check.ok).toBe(false);
    expect(check.detail).toBe("Tunnel response did not match the Kick receiver health payload.");
  });
});

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  };
}
