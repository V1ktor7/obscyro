import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Status", href: "/docs/resources/status" },
    ],
  },
  {
    title: "Standards",
    links: [
      { label: "SNOMED CT", href: "/docs/standards/snomed" },
      { label: "ICD-10", href: "/docs/standards/icd10" },
      { label: "FHIR", href: "/docs/standards/fhir" },
      { label: "HL7", href: "/docs/standards/hl7" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Contact", href: "mailto:hello@obscyro.com" },
    ],
  },
] as const;

export default function Footer() {
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
              The semantic interoperability layer for healthcare data. SNOMED,
              ICD-10, RxNorm, LOINC, FHIR, and HL7 — one API.
            </p>
          </div>
          {COLUMNS.map((col) => (
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
          <p>&copy; 2026 Obscyro. All rights reserved.</p>
          <p className="max-w-2xl text-pretty">
            Obscyro is not a medical device. Always validate clinical decisions
            with qualified healthcare professionals.
          </p>
        </div>
      </div>
    </footer>
  );
}
