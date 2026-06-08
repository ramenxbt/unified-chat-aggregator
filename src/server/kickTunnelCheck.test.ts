import { describe, expect, it } from "vitest";
import { checkKickTunnel, formatKickTunnelCheck } from "./kickTunnelCheck";

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
