import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import remarkGfm from "remark-gfm";

import TableOfContents from "@/components/docs/TableOfContents";
import { mdxComponents } from "@/components/docs/MDXComponents";
import { listDocFiles, loadDoc } from "@/lib/docs/load";
import {
  DOCS_DEFAULT_SLUG,
  findNavItem,
  getAdjacent,
} from "@/lib/docs/nav";
import { PRETTY_CODE_OPTIONS } from "@/lib/shiki";

interface PageProps {
  params: { slug?: string[] };
}

function resolveSlug(raw?: string[]): string[] {
  if (!raw || raw.length === 0) return DOCS_DEFAULT_SLUG;
  return raw;
}

export async function generateStaticParams(): Promise<Array<{ slug: string[] }>> {
  const files = await listDocFiles();
  return files.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const slug = resolveSlug(params.slug);
  const doc = await loadDoc(slug);
  const navItem = findNavItem(slug);
  const title = (doc?.frontmatter.title as string | undefined) ?? navItem?.title ?? "Docs";
  const description = (doc?.frontmatter.description as string | undefined) ?? undefined;
  return { title, description };
}

export default async function DocPage({ params }: PageProps) {
  const slug = resolveSlug(params.slug);
  const doc = await loadDoc(slug);
  if (!doc) notFound();
  const navItem = findNavItem(slug);
  const { prev, next } = getAdjacent(slug);
  const title =
    (doc.frontmatter.title as string | undefined) ?? navItem?.title ?? "Documentation";
  const description = doc.frontmatter.description as string | undefined;

  return (
    <div className="grid grid-cols-1 gap-8 px-6 py-12 xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-12 xl:px-12">
      <article className="prose prose-neutral mx-auto w-full max-w-3xl">
        <header className="not-prose mb-8">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
            {breadcrumb(slug)}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tighter sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 text-lg text-fg-secondary">{description}</p>
          ) : null}
        </header>
        <MDXRemote
          source={doc.content}
          components={mdxComponents}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
              rehypePlugins: [[rehypePrettyCode, PRETTY_CODE_OPTIONS]],
            },
          }}
        />
        <hr className="my-12 border-border-subtle" />
        <nav className="not-prose flex flex-col gap-3 sm:flex-row sm:justify-between">
          {prev ? (
            <Link
              href={`/docs/${prev.slug.join("/")}`}
              className="group flex flex-1 flex-col rounded-lg border border-border-subtle bg-bg-secondary p-4 transition-colors hover:border-fg-secondary/40 sm:max-w-[48%]"
            >
              <span className="flex items-center gap-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                <ArrowLeft className="h-3 w-3" /> Previous
              </span>
              <span className="mt-1 text-sm font-medium text-fg-primary">{prev.title}</span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {next ? (
            <Link
              href={`/docs/${next.slug.join("/")}`}
              className="group flex flex-1 flex-col items-end rounded-lg border border-border-subtle bg-bg-secondary p-4 transition-colors hover:border-fg-secondary/40 sm:max-w-[48%]"
            >
              <span className="flex items-center gap-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
                Next <ArrowRight className="h-3 w-3" />
              </span>
              <span className="mt-1 text-sm font-medium text-fg-primary">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      </article>
      <aside className="hidden xl:sticky xl:top-16 xl:block xl:h-[calc(100vh-4rem)]">
        <TableOfContents headings={doc.headings} />
      </aside>
    </div>
  );
}

function breadcrumb(slug: string[]): string {
  return slug
    .map((seg) =>
      seg
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    )
    .join(" / ");
}
