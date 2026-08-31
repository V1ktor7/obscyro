"use client";

import Link from "next/link";
import Mark from "@/components/brand/Mark";
import { useT } from "@/lib/i18n/context";

export default function Footer() {
  const t = useT();

  const columns = [
    {
      title: t("footer.product"),
      links: [
        { label: t("nav.docs"), href: "/docs" },
        { label: t("nav.pricing"), href: "/#contact" },
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
            <Link href="/" className="flex items-center gap-2.5 text-fg-primary">
              <Mark className="h-[1.05rem] w-auto" />
              <span className="text-[0.9375rem] font-medium lowercase tracking-tight">
                obscyro
              </span>
            </Link>
            <p className="mt-3 max-w-sm text-[0.75rem] leading-relaxed text-fg-secondary">
              {t("footer.tagline")}
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3 text-[0.75rem] font-medium text-fg-primary sm:mb-4">
                {col.title}
              </h4>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[0.75rem] text-fg-secondary transition-colors hover:text-fg-primary hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border-subtle pt-6 text-[0.75rem] text-fg-secondary sm:mt-12 sm:gap-4 sm:pt-8 md:flex-row md:items-center md:justify-between">
          <p>{t("footer.copyright")}</p>
          <p className="max-w-prose text-pretty">{t("footer.disclaimer")}</p>
        </div>
      </div>
    </footer>
  );
}
