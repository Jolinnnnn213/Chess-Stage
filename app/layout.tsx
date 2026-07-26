import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000/";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const publicAsset = (path: string) => new URL(`${basePath}${path}`, siteUrl).toString();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Chess Stage — Jolin Li",
    template: "%s — Jolin Li",
  },
  description:
    "An interactive chess and light experiment by Jolin Li.",
  icons: {
    icon: publicAsset("/mors-logo.svg"),
    shortcut: publicAsset("/mors-logo.svg"),
  },
  openGraph: {
    title: "Chess Stage — Jolin Li",
    description: "Swing the hanging light to wake a scattered collection of chess pieces.",
    type: "website",
    url: siteUrl,
    images: [{ url: publicAsset("/og.jpg"), width: 1200, height: 630, alt: "Chess Stage interactive light experiment by Jolin Li." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chess Stage — Jolin Li",
    description: "Swing the hanging light to wake a scattered collection of chess pieces.",
    images: [publicAsset("/og.jpg")],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" as="image" href={`${basePath}/chess-stage-intro.png`} fetchPriority="high" />
      </head>
      <body>{children}</body>
    </html>
  );
}
