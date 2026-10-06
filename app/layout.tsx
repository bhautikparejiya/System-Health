import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "System Health Monitor",
  description: "One health score for workflows, AI agents, calendars, forms, inbox and more.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
