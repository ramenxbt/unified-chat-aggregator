import { describe, expect, it, vi } from "vitest";
import { XApiConnector } from "./xApiConnector";

const config = {
  bearerToken: "x-token",
  filterRules: ["Market Bubble"],
  spacesQuery: "Market Bubble",
  filteredStreamEndpoint: "https://example.test/stream",
  rulesEndpoint: "https://example.test/rules",
  spacesSearchEndpoint: "https://example.test/spaces",
  spacesPollMs: 60000
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init
  });
}

function streamResponse(lines: unknown[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        }
        controller.close();
      }
    }),
    { status: 200 }
  );
}

async function waitForExpectation(assertion: () => void) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }

  assertion();
}

describe("XApiConnector", () => {
  it("normalizes filtered stream posts into unified events", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ meta: { sent: "2026-06-04T18:00:00.000Z" } }))
      .mockResolvedValueOnce(
        streamResponse([
          {
            data: {
              id: "post-1",
              text: "Market Bubble stream is live",
              author_id: "user-1",
              created_at: "2026-06-04T18:00:00.000Z",
              conversation_id: "thread-1"
            },
            includes: {
              users: [
                {
                  id: "user-1",
                  username: "marketbubble",
                  name: "Market Bubble",
                  profile_image_url: "https://example.test/avatar.jpg",
                  verified: true
                }
              ]
            },
            matching_rules: [{ id: "rule-1", tag: "market" }]
          }
        ])
      );
    const connector = new XApiConnector(
      {
        ...config,
        spacesQuery: undefined
      },
      {
        fetch: fetcher as unknown as typeof fetch,
        now: () => new Date("2026-06-04T18:00:01.000Z")
      }
    );
    const events: unknown[] = [];
    connector.subscribe((event) => events.push(event));

    await connector.start();
    await waitForExpectation(() => expect(events).toHaveLength(1));
    await connector.stop();

    expect(events[0]).toMatchObject({
      id: "x:post-1",
      platform: "x",
      kind: "post",
      platformEventId: "post-1",
      sourceChannelName: "market",
      authorName: "marketbubble",
      text: "Market Bubble stream is live",
      badges: [{ type: "verified", label: "Verified" }]
    });
    expect(connector.status().state).toBe("stopped");
  });

  it("polls live Spaces and emits metadata events", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "space-1",
            state: "live",
            title: "Market Bubble Live",
            creator_id: "creator-1",
            participant_count: 420,
            started_at: "2026-06-04T18:00:00.000Z",
            updated_at: "2026-06-04T18:00:30.000Z"
          }
        ],
        includes: {
          users: [
            {
              id: "creator-1",
              username: "marketbubble",
              name: "Market Bubble",
              verified: true
            }
          ]
        }
      })
    );
    const connector = new XApiConnector(
      {
        bearerToken: "x-token",
        spacesQuery: "Market Bubble",
        spacesSearchEndpoint: "https://example.test/spaces"
      },
      {
        fetch: fetcher as unknown as typeof fetch,
        now: () => new Date("2026-06-04T18:01:00.000Z")
      }
    );
    const events: unknown[] = [];
    connector.subscribe((event) => events.push(event));

    await connector.start();
    await connector.stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "x",
      kind: "space_metadata",
      sourceChannelName: "live spaces",
      authorName: "marketbubble",
      text: "Live Space: Market Bubble Live - 420 participants"
    });
  });

  it("marks X API rate limits in connector health", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 }));
    const connector = new XApiConnector(
      {
        bearerToken: "x-token",
        spacesQuery: "Market Bubble",
        spacesSearchEndpoint: "https://example.test/spaces"
      },
      {
        fetch: fetcher as unknown as typeof fetch,
        now: () => new Date("2026-06-04T18:00:00.000Z")
      }
    );

    await connector.start();

    expect(connector.status()).toMatchObject({
      state: "rate_limited",
      lastError: "X Spaces search failed with HTTP 429"
    });
    await connector.stop();
  });
});
