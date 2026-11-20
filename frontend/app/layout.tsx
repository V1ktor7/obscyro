import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";

import SiteChrome from "@/components/site/SiteChrome";
import { LocaleProvider } from "@/lib/i18n/context";
import { SITE_URL } from "@/lib/site-url";

import "./globals.css";

// One family for the whole product, public pages and Studio: IBM Plex, the
// face the theme (Carbon Gray 100) was drawn for. It has details a reader
// notices without being able to name — the flat-topped a, the straight-legged
// g — which is exactly what a default grotesque does not.
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  // 300 is for large figures, which are set light.
  weight: ["300", "400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

// Code, step ids and figures in tables.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Obscyro — Decision Systems for Health Networks",
    template: "%s · Obscyro",
  },
  description:
    "Connect a health network's published data into one ontology, run it as a digital twin, and compare the responses on what each one costs.",
  keywords: [
    "health data interoperability",
    "health system operations",
    "hospital capacity planning",
    "digital twin",
    "health ontology",
    "decision support",
    "SNOMED",
    "ICD-10",
    "FHIR",
    "HL7",
  ],
  authors: [{ name: "Obscyro" }],
  openGraph: {
    title: "Obscyro — Decision Systems for Health Networks",
    description:
      "Connect a health network's published data into one ontology, run it as a digital twin, and compare the responses on what each one costs.",
    url: SITE_URL,
    siteName: "Obscyro",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Obscyro — Decision Systems for Health Networks",
    description:
      "One ontology for a health network, a digital twin on top, and responses ranked by dominance.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#161616",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${plex.variable} ${plexMono.variable} min-h-screen bg-bg-primary font-sans text-fg-primary antialiased`}
      >
        <LocaleProvider>
          <SiteChrome>{children}</SiteChrome>
          <Analytics />
        </LocaleProvider>
      </body>
    </html>
  );
}
