// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Icon, { contentType, size } from "./icon";
import AppleIcon, { contentType as appleType, size as appleSize } from "./apple-icon";

/**
 * The tab icon and the home-screen icon are the app logo, drawn from the same
 * component the sidebar uses. The pixels are checked by looking (see the
 * commit); what is held here is that they are real PNGs of the size they
 * advertise, built from `LogoMark`, and that the old default favicon cannot
 * come back and sit beside them as a second `<link rel="icon">`.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function render(make: () => Response) {
  const bytes = new Uint8Array(await make().arrayBuffer());
  const view = new DataView(bytes.buffer);
  return {
    signature: [...bytes.slice(0, 8)],
    // IHDR: width and height are the first two big-endian words after the tag.
    width: view.getUint32(16),
    height: view.getUint32(20),
    length: bytes.length,
  };
}

describe("app icons", () => {
  it("serves a PNG of the declared size for the tab icon", async () => {
    expect(contentType).toBe("image/png");
    const png = await render(Icon);
    expect(png.signature).toEqual(PNG_SIGNATURE);
    expect([png.width, png.height]).toEqual([size.width, size.height]);
    expect(png.length).toBeGreaterThan(200);
  });

  it("serves a PNG of the declared size for the home-screen icon", async () => {
    expect(appleType).toBe("image/png");
    const png = await render(AppleIcon);
    expect(png.signature).toEqual(PNG_SIGNATURE);
    expect([png.width, png.height]).toEqual([appleSize.width, appleSize.height]);
  });

  it("draws the logo from LogoMark, not a copy of it", () => {
    for (const file of ["icon.tsx", "apple-icon.tsx"]) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source, file).toContain('import { LogoMark } from "@/components/Logo"');
      expect(source, file).toContain("<LogoMark");
    }
  });

  it("has no static favicon.ico left to shadow them", () => {
    expect(existsSync(join(__dirname, "favicon.ico"))).toBe(false);
  });
});
