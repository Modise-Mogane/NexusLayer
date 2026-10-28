import type { Metadata } from "next";
import "./globals.css";

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
      <body className="h-screen bg-slate-100 text-slate-900">{children}</body>
    </html>
  );
}
