import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import AssistantProvider from "@/components/assistant/AssistantProvider";

export const metadata: Metadata = {
  title: "NexusLayer",
  description: "AI-assisted heterogeneous network engineering and simulation platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-screen bg-nx-workspace font-sans text-nx-ink">
        {/* Shell-level assistant: conversations and voice survive route changes. */}
        <AssistantProvider>{children}</AssistantProvider>
      </body>
    </html>
  );
}
