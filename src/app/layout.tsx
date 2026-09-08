import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (OFL) so builds never depend on Google Fonts being reachable.
const ui = localFont({
  variable: "--font-ui",
  display: "swap",
  src: [
    { path: "./fonts/instrument-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/instrument-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/instrument-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

const mono = localFont({
  variable: "--font-mono",
  display: "swap",
  src: [
    { path: "./fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Redline — design feedback on any live website",
  description:
    "Load any website, comment like Figma, draw on it, inspect fonts, colours and spacing, and share the marked-up canvas.",
};

export const viewport: Viewport = {
  themeColor: "#f6f5f1",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
