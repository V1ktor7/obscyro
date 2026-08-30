import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";

import SiteChrome from "@/components/site/SiteChrome";
import { LocaleProvider } from "@/lib/i18n/context";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Obscyro — Decisions a health network can defend",
    template: "%s · Obscyro",
  },
  description:
    "Connect a health network's published data into one ontology, run it as a digital twin, and compare the responses on what each one costs. Public beta.",
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
    title: "Obscyro — Decisions a health network can defend",
    description:
      "Connect a health network's published data into one ontology, run it as a digital twin, and compare the responses on what each one costs. Public beta.",
    url: SITE_URL,
    siteName: "Obscyro",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Obscyro — Decisions a health network can defend",
    description:
      "One ontology for a health network, a digital twin on top, and responses ranked by dominance. Public beta.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} min-h-screen bg-bg-primary font-sans text-fg-primary antialiased`}
      >
        <LocaleProvider>
          <SiteChrome>{children}</SiteChrome>
          <Analytics />
        </LocaleProvider>
      </body>
    </html>
  );
}
