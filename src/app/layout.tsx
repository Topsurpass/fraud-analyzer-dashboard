import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/services/auth/AuthContext";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { inter, jetBrainsMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fraud Analyzer",
  description: "Detect, monitor and review fraud across every connected database.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#080a13" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the init script sets `data-theme` before React
    // hydrates, which is the whole point of it and would otherwise warn.
    <html
      lang="en"
      className={`${inter.variable} ${jetBrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before first paint so a saved dark theme never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-bg text-ink">
        {/* Above both route groups: the signed-out screens need to know when a
            session already exists, and the app needs it to render at all. */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
