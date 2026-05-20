import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";

import BetaBanner from "@/components/site/BetaBanner";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
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
    default: "Obscyro — Health data, finally fluent",
    template: "%s · Obscyro",
  },
  description:
    "One API for SNOMED, ICD-10, RxNorm, LOINC, FHIR, and HL7. Stop translating. Start building.",
  keywords: [
    "SNOMED",
    "ICD-10",
    "RxNorm",
    "LOINC",
    "FHIR",
    "HL7",
    "healthcare API",
    "semantic interoperability",
    "clinical NLP",
  ],
  authors: [{ name: "Obscyro" }],
  openGraph: {
    title: "Obscyro — Health data, finally fluent",
    description:
      "One API for SNOMED, ICD-10, RxNorm, LOINC, FHIR, and HL7. Stop translating. Start building.",
    url: SITE_URL,
    siteName: "Obscyro",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Obscyro — Health data, finally fluent",
    description:
      "One API for SNOMED, ICD-10, RxNorm, LOINC, FHIR, and HL7.",
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
          <BetaBanner />
          <Header />
          <main className="min-h-[calc(100vh-4rem)]">{children}</main>
          <Footer />
          <Analytics />
        </LocaleProvider>
      </body>
    </html>
  );
}
