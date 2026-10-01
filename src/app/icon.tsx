import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/Logo";

/**
 * The browser-tab icon: the same shield mark the sidebar draws, rendered to PNG
 * at build time. It reuses `LogoMark` rather than a copy of its paths, so the
 * favicon cannot drift from the logo, and generating it from code means no
 * binary image lives in the repo.
 *
 * 64px, drawn edge to edge: a tab shows it at 16 to 32 CSS pixels, so the extra
 * resolution is for high-density screens, and any padding would only shrink a
 * mark that is already small. The background is transparent so it sits on
 * whatever the browser's tab strip is, light or dark.
 */
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        <LogoMark size={size.width} />
      </div>
    ),
    { ...size },
  );
}
