// Solution by Mike Chen <mike2025@rocketship.com> created using Claude Fable 5 AI
// for the U.S. Department of Treasury as part of the candidate interview process.

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "aicola — TTB COLA Label Pre-Screener",
  description:
    "Checks front and back alcohol beverage label images against the 8 mandatory TTB COLA requirements.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
