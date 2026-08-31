"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { useT } from "@/lib/i18n/context";

/**
 * One call to action, and the panel behind it.
 *
 * The reference offers a choice between requesting a demo and starting to
 * build. Only the first applies here: there is no self-serve product to start
 * building on yet, and a second button leading somewhere thinner would spend
 * the reader's attention on the weaker of two paths.
 *
 * **The panel submits nothing.** It composes the message and hands it to the
 * reader's own mail client, so no field ever reaches a server of ours: nothing
 * is stored, nothing is logged, and there is no database of prospects to
 * secure or to answer for. That is a deliberate trade — a posted form would
 * capture people who will not bother opening a mail client, and it would also
 * mean holding their details before we have anything to hold them in.
 */

interface Field {
  id: string;
  label: string;
  type?: "text" | "email" | "textarea";
  required?: boolean;
}

export default function DemoRequest() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const fields: Field[] = [
    { id: "name", label: t("demo.f.name"), required: true },
    { id: "email", label: t("demo.f.email"), type: "email", required: true },
    { id: "role", label: t("demo.f.role") },
    { id: "org", label: t("demo.f.org"), required: true },
    { id: "network", label: t("demo.f.network") },
    { id: "problem", label: t("demo.f.problem"), type: "textarea" },
  ];

  const [values, setValues] = useState<Record<string, string>>({});
  const set = (id: string, v: string) => setValues((s) => ({ ...s, [id]: v }));

  const ready = Boolean(values.name?.trim() && values.email?.trim() && values.org?.trim());

  // Escape closes, focus moves in on open and back to the button on close, and
  // the page behind does not scroll while the panel is over it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      openerRef.current?.focus();
    };
  }, [open]);

  function send() {
    const lines = fields
      .map((f) => `${f.label}: ${values[f.id]?.trim() ?? ""}`)
      .join("\n");
    const href =
      "mailto:obscyro-team@obscyro.com" +
      "?subject=" +
      encodeURIComponent(t("demo.subject")) +
      "&body=" +
      encodeURIComponent(lines);
    window.location.href = href;
  }

  return (
    <>
      <section id="contact" className="bg-bg-secondary py-24 text-center sm:py-32">
        <div className="container max-w-[720px]">
          <h2 className="display-lg text-balance">{t("demo.title")}</h2>
          <p className="body-lg mt-5 text-balance">{t("demo.blurb")}</p>
          <button
            ref={openerRef}
            type="button"
            onClick={() => setOpen(true)}
            className="pill mt-9"
          >
            {t("demo.cta")}
          </button>
        </div>
      </section>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-fg-primary/25 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("demo.title")}
            className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-bg-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6 sm:px-10 sm:pt-8">
              <p className="caption">{t("demo.eyebrow")}</p>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("demo.close")}
                className="rounded p-1 text-fg-secondary transition-colors hover:text-fg-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 pb-10 sm:px-10">
              <h2 className="display-md mt-8 text-balance">{t("demo.drawerTitle")}</h2>
              <p className="body-md mt-3">{t("demo.intro")}</p>

              <div className="mt-8 flex flex-col gap-6">
                {fields.map((f) => (
                  <label key={f.id} className="block">
                    <span className="caption">
                      {f.label}
                      {f.required ? <span className="ml-1 text-accent">*</span> : null}
                    </span>
                    {f.type === "textarea" ? (
                      <textarea
                        rows={4}
                        value={values[f.id] ?? ""}
                        onChange={(e) => set(f.id, e.target.value)}
                        className="mt-2 w-full resize-y border-b border-border-subtle bg-transparent pb-2 text-[1.0625rem] text-fg-primary outline-none transition-colors focus:border-accent"
                      />
                    ) : (
                      <input
                        type={f.type ?? "text"}
                        value={values[f.id] ?? ""}
                        onChange={(e) => set(f.id, e.target.value)}
                        className="mt-2 w-full border-b border-border-subtle bg-transparent pb-2 text-[1.0625rem] text-fg-primary outline-none transition-colors focus:border-accent"
                      />
                    )}
                  </label>
                ))}
              </div>

              <button
                type="button"
                disabled={!ready}
                onClick={send}
                className="pill mt-10 disabled:opacity-40"
              >
                {t("demo.send")}
                <ArrowRight className="h-4 w-4" />
              </button>

              <p className="caption mt-4">{t("demo.privacy")}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
