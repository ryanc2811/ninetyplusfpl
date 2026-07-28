import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });
const editorial = Instrument_Serif({ variable: "--font-editorial", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "NINETY+ — FPL AI Decision Engine",
  description: "Rules-aware squad optimisation, player projections, transfer paths and chip strategy for the 2026/27 Fantasy Premier League season.",
  metadataBase: new URL("https://ninety-plus.sites.openai.com"),
  openGraph: {
    title: "NINETY+ — See the points before they happen.",
    description: "The AI decision engine for FPL 26/27.",
    images: ["/og.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geist.variable} ${mono.variable} ${editorial.variable}`}>{children}</body></html>;
}
