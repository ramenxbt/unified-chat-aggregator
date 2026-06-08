import {
  formatSourceDisplayLabel,
  platformLabels,
  type ConnectorStatus,
  type SourcePlatform
} from "./unifiedEvent";

export type ObsPresetAccount = {
  key: string;
  label: string;
  platform: SourcePlatform;
};

export type ObsPresetLink = {
  title: string;
  detail: string;
  href: string;
};

export function buildObsPresetLinks(accounts: ObsPresetAccount[], statuses: ConnectorStatus[]): ObsPresetLink[] {
  const focusedAccountLinks = buildObsPresetSources(accounts, statuses).map((source) => {
    const accountName = getAccountNameFromSourceLabel(source.label);
    const query = accountName.replace(/^@/, "").toLowerCase();

    return {
      title: `${platformLabels[source.platform]} ${accountName}`,
      detail: "Focused proof shot for this source account.",
      href: buildObsPresetHref({
        sources: [source.platform],
        limit: 8,
        query
      })
    };
  });

  return [
    {
      title: "All sources",
      detail: "Full overlay for the main submission shot.",
      href: buildObsPresetHref({
        sources: ["twitch", "kick", "x"],
        limit: 14
      })
    },
    {
      title: "Twitch and Kick",
      detail: "Chat-native view without X posts.",
      href: buildObsPresetHref({
        sources: ["twitch", "kick"],
        limit: 12
      })
    },
    ...focusedAccountLinks,
    {
      title: "Signal only",
      detail: "High-signal clip view for fast review.",
      href: buildObsPresetHref({
        signal: true,
        limit: 10
      })
    }
  ];
}

function buildObsPresetSources(accounts: ObsPresetAccount[], statuses: ConnectorStatus[]): ObsPresetAccount[] {
  const sources = new Map<string, ObsPresetAccount>();

  for (const account of accounts) {
    sources.set(account.key, account);
  }

  for (const status of statuses) {
    const key = `${status.platform}:${status.sourceName}`;

    if (!sources.has(key)) {
      sources.set(key, {
        key,
        platform: status.platform,
        label: formatSourceDisplayLabel(status.platform, status.sourceName)
      });
    }
  }

  return [...sources.values()].slice(0, 3);
}

function buildObsPresetHref({
  sources,
  limit,
  query,
  signal
}: {
  sources?: SourcePlatform[];
  limit?: number;
  query?: string;
  signal?: boolean;
}) {
  const baseUrl =
    typeof window === "undefined"
      ? new URL("http://127.0.0.1:5173/")
      : new URL(`${window.location.origin}${window.location.pathname}`);

  baseUrl.searchParams.set("obs", "1");

  if (sources?.length) {
    baseUrl.searchParams.set("sources", sources.join(","));
  }

  if (limit) {
    baseUrl.searchParams.set("limit", limit.toString());
  }

  if (query) {
    baseUrl.searchParams.set("q", query);
  }

  if (signal) {
    baseUrl.searchParams.set("signal", "1");
  }

  return baseUrl.toString();
}

function getAccountNameFromSourceLabel(label: string) {
  return label.match(/\(([^)]+)\)/)?.[1] ?? label;
}
