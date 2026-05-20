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
      <div className="container py-14">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Link
              href="/"
              className="font-mono text-base font-semibold lowercase tracking-tight text-fg-primary"
            >
              obscyro
            </Link>
            <p className="mt-3 max-w-xs text-sm text-fg-secondary">
              {t("footer.tagline")}
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-fg-secondary">
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

        <div className="mt-12 flex flex-col gap-4 border-t border-border-subtle pt-8 text-xs text-fg-secondary md:flex-row md:items-center md:justify-between">
          <p>{t("footer.copyright")}</p>
          <p className="max-w-2xl text-pretty">{t("footer.disclaimer")}</p>
        </div>
      </div>
    </footer>
  );
}
