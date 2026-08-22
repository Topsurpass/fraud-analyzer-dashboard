import type { Metadata, Viewport } from "next";
import { inter, jetBrainsMono, spaceGrotesk } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fraud Analyzer",
  description: "Live instrument panel for saved fraud-detection SQL.",
};

export const viewport: Viewport = {
  themeColor: "#12151C",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetBrainsMono.variable} h-full`}
    >
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
