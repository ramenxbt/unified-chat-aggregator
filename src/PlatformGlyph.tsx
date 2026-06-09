import type { SourcePlatform } from "./domain/unifiedEvent";

// Official brand marks (simple-icons paths, 24x24 viewBox). Real logos only.
const glyphPaths: Record<SourcePlatform, string> = {
  twitch:
    "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
  kick: "M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z",
  x: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
};

export function PlatformGlyph({ platform, size = 13 }: { platform: SourcePlatform; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="platform-glyph"
      fill="currentColor"
      height={size}
      role="img"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={glyphPaths[platform]} />
    </svg>
  );
}
