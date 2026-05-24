"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";

export default function Footer() {
  const t = useT();

  const columns = [
    {
      title: t("footer.product"),
      links: [
        { label: t("nav.docs"), href: "/docs" },
        { label: t("nav.pricing"), href: "/#pricing" },
        { label: t("nav.signin"), href: "/sign-in" },
        { label: t("footer.status"), href: "/docs/resources/status" },
      ],
    },
    {
      title: t("footer.standards"),
      links: [
        { label: "SNOMED CT", href: "/docs/standards/snomed" },
        { label: "ICD-10", href: "/docs/standards/icd10" },
        { label: "FHIR", href: "/docs/standards/fhir" },
        { label: "HL7", href: "/docs/standards/hl7" },
      ],
    },
    {
      title: t("footer.company"),
      links: [
        { label: t("footer.privacy"), href: "/privacy" },
        { label: t("footer.terms"), href: "/terms" },
        {
          label: t("footer.contact"),
          href: "mailto:obscyro-team@obscyro.com",
        },
      ],
    },
  ];

  return (
    <footer className="border-t border-border-subtle bg-bg-secondary">
      <div className="container py-10 sm:py-14">
        <div className="grid gap-8 sm:grid-cols-2 sm:gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="sm:col-span-2 md:col-span-1">
            <Link
              href="/"
              className="font-mono text-base font-semibold lowercase tracking-tight text-fg-primary md:text-lg"
            >
              obscyro
            </Link>
            <p className="mt-3 max-w-sm text-sm text-fg-secondary">
              {t("footer.tagline")}
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-secondary sm:mb-4 sm:text-[0.7rem] sm:tracking-[0.2em]">
                {col.title}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-fg-secondary transition-colors hover:text-fg-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border-subtle pt-6 text-xs text-fg-secondary sm:mt-12 sm:gap-4 sm:pt-8 md:flex-row md:items-center md:justify-between">
          <p>{t("footer.copyright")}</p>
          <p className="max-w-prose text-pretty">{t("footer.disclaimer")}</p>
        </div>
      </div>
    </footer>
  );
}
