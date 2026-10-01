import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/Logo";

/**
 * The home-screen icon (iOS "Add to Home Screen"). Same mark as `icon.tsx`, on
 * the dark ground the dark theme uses: iOS fills transparency with black and
 * rounds the corners itself, so the tile is drawn opaque and square, with the
 * mark inset so the rounded mask never clips the shield.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0e18",
        }}
      >
        <LogoMark size={120} />
      </div>
    ),
    { ...size },
  );
}
