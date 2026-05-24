import Link from "next/link";
import { type ComponentPropsWithoutRef } from "react";
import type { MDXRemoteProps } from "next-mdx-remote/rsc";

import { slugify } from "@/lib/docs/headings";
import EndpointHeader from "./EndpointHeader";
import { Param, Parameters } from "./Parameters";
import ResponseExample from "./ResponseExample";
import ErrorTable, { ErrorRow } from "./ErrorTable";
import ComingSoon from "./ComingSoon";
import CodeTabs, { CodeTab } from "@/components/ui/CodeTabs";
import CodeBlock from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";

function makeHeading(depth: 2 | 3) {
  return function Heading(props: ComponentPropsWithoutRef<"h2">) {
    const text = typeof props.children === "string" ? props.children : "";
    const id = slugify(text);
    if (depth === 2) {
      return (
        <h2 id={id} className="group scroll-mt-24" {...props}>
          <a href={`#${id}`} className="no-underline">
            {props.children}
          </a>
        </h2>
      );
    }
    return (
      <h3 id={id} className="group scroll-mt-24" {...props}>
        <a href={`#${id}`} className="no-underline">
          {props.children}
        </a>
      </h3>
    );
  };
}

function MdxLink({ href = "", ...rest }: ComponentPropsWithoutRef<"a">) {
  if (href.startsWith("/")) {
    return <Link href={href} {...rest} />;
  }
  return <a href={href} target="_blank" rel="noreferrer" {...rest} />;
}

function MdxTable(props: ComponentPropsWithoutRef<"table">) {
  // Wrap raw markdown tables so they scroll horizontally on small screens
  // instead of overflowing the article and breaking the layout.
  return (
    <div className="not-prose my-6 overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-left text-sm" {...props} />
    </div>
  );
}

export const mdxComponents: MDXRemoteProps["components"] = {
  h2: makeHeading(2),
  h3: makeHeading(3),
  a: MdxLink,
  table: MdxTable,
  EndpointHeader,
  Parameters,
  Param,
  ResponseExample,
  ErrorTable,
  ErrorRow,
  ComingSoon,
  CodeTabs,
  CodeTab,
  CodeBlock,
  Badge,
};
