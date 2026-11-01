import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { AppShell } from "./_components/shell/app-shell";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const editorial = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "NINETY+ - FPL AI Decision Engine",
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

/**
 * Applies the stored theme before first paint. Without this the page renders
 * in the default theme and then snaps, which is worse than no toggle at all.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("ninety-plus:theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${mono.variable} ${editorial.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
