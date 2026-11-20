import type { Metadata } from "next";
import type { ReactNode } from "react";
import { themeScript } from "@/components/theme";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HostPog — Your product analytics. Your rules.", template: "%s · HostPog" },
  description: "Open-source, AI-native product analytics compatible with existing PostHog installations. Your data. Your infrastructure. Your AI keys. Built by DevLabs.",
  applicationName: "HostPog",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
