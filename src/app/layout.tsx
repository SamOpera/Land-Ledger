import type { Metadata, Viewport } from "next";
import "./globals.css";

const url = "https://landedger.vercel.app";
const title = "Land-Ledger: check a land title before you pay";
const description =
  "Land-Ledger is an on-chain land title registry by Samson Olakeye (SamOpera). Each survey plan is registered once, land moves only with the owner's offer and a registrar's approval, and anyone can verify a title for free. Tested Solidity on Ethereum Sepolia, with a demo you can try without a wallet.";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title,
  description,
  authors: [{ name: "Samson Olakeye", url: "https://samsonolakeye.com" }],
  creator: "Samson Olakeye",
  openGraph: { type: "website", title, description, url, siteName: "Land-Ledger" },
  twitter: { card: "summary", title, description, creator: "@TheSamOpera" },
};

export const viewport: Viewport = { themeColor: "#05060a", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/osk-sans-var.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
