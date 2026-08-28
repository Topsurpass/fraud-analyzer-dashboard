import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/services/auth/AuthContext";
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
      <body className="min-h-full bg-bg text-ink">
        {/* Above both route groups: the signed-out screens need to know when a
            session already exists, and the app needs it to render at all. */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
