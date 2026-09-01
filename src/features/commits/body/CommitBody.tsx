// The commit body, rendered (#253).
//
// Two things this component owes the user, and they pull in opposite
// directions: a long body with lists and code fences should READ well, and a
// commit message is a git object that sometimes has to be seen byte-for-byte.
// Hence the toggle — and hence the raw view being the plain `<pre>`-equivalent
// the panel has always shown, not a re-serialisation of the parse.
//
// Nothing here fetches. The AST has no image node, links are limited to
// http/https/mailto, and every node becomes a React element rather than an HTML
// string — so there is no sanitiser to get wrong and no
// `dangerouslySetInnerHTML` anywhere in the path.

import * as React from "react";

import { PGIconButton } from "@/design";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { openUrl } from "@/lib/tauri";

import { parseCommitBody, type Block, type Inline } from "./markdown";

export interface CommitBodyProps {
  text: string;
}

export function CommitBody({ text }: CommitBodyProps) {
  const rendered = useSettingsStore((s) => s.commitBodyMarkdown);
  const setSetting = useSettingsStore((s) => s.set);

  // Parsing is cheap, but it runs on every selection change in a list people
  // hold a key down to scroll, so it is worth not re-doing per render.
  const blocks = React.useMemo(
    () => (rendered ? parseCommitBody(text) : []),
    [rendered, text],
  );

  return (
    <div style={{ marginBottom: 10 }} data-testid="commit-body">
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          // Pulled up into the body's own top margin: the toggle is a control
          // for the block below it, not a row of its own.
          marginBottom: -4,
        }}
      >
        <PGIconButton
          icon={rendered ? "fileCode" : "fileDoc"}
          title={
            rendered
              ? "Show the raw commit message, byte for byte"
              : "Render the body as markdown"
          }
          data-testid="commit-body-toggle"
          onClick={() => setSetting("commitBodyMarkdown", !rendered)}
        />
      </div>
      {rendered ? (
        <div
          data-testid="commit-body-rendered"
          style={{
            color: "var(--fg-1)",
            fontSize: "var(--fs-12)",
            overflowWrap: "anywhere",
            lineHeight: 1.5,
          }}
        >
          {blocks.map((b, i) => (
            <BlockView key={i} block={b} />
          ))}
        </div>
      ) : (
        <div
          data-testid="commit-body-raw"
          style={{
            color: "var(--fg-1)",
            fontSize: "var(--fs-12)",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            fontFamily: "var(--font-mono)",
            lineHeight: 1.5,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p style={{ margin: "0 0 8px" }}>
          <InlineView nodes={block.children} />
        </p>
      );

    case "code":
      return (
        <pre
          data-testid="commit-body-code"
          style={{
            margin: "0 0 8px",
            padding: 8,
            background: "var(--bg-2)",
            border: "1px solid var(--border-0)",
            borderRadius: "var(--r-3)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
            // A fenced block is the one place a horizontal scrollbar is right:
            // wrapping code changes what it says.
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {block.text}
        </pre>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag style={{ margin: "0 0 8px", paddingLeft: 20 }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              <InlineView nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }

    case "trailers":
      return (
        <div
          data-testid="commit-body-trailers"
          style={{
            margin: "0 0 8px",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-11)",
          }}
        >
          {block.entries.map((t, i) => (
            <div key={i}>
              <span style={{ color: "var(--fg-3)" }}>{t.key}: </span>
              <InlineView nodes={t.value} />
            </div>
          ))}
        </div>
      );
  }
}

function InlineView({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => (
        <InlineNode key={i} node={n} />
      ))}
    </>
  );
}

function InlineNode({ node }: { node: Inline }) {
  switch (node.kind) {
    case "text":
      return <>{node.text}</>;

    case "code":
      return (
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.92em",
            background: "var(--bg-2)",
            padding: "0 3px",
            borderRadius: "var(--r-2)",
          }}
        >
          {node.text}
        </code>
      );

    case "em":
      return (
        <em>
          <InlineView nodes={node.children} />
        </em>
      );

    case "strong":
      return (
        <strong>
          <InlineView nodes={node.children} />
        </strong>
      );

    case "link":
      return (
        <a
          href={node.href}
          data-testid="commit-body-link"
          style={{ color: "var(--accent)", cursor: "pointer" }}
          onClick={(e) => {
            // The webview is not a browser tab: a plain navigation would
            // replace the APP. Every outbound link goes through the opener,
            // which validates the URL and hands it to the OS.
            e.preventDefault();
            void openUrl(node.href).catch(() => {});
          }}
        >
          <InlineView nodes={node.children} />
        </a>
      );

    case "issue":
      // Styled, not linked — see the `issue` node's comment in markdown.ts.
      return (
        <span
          data-testid="commit-body-issue"
          style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}
        >
          {node.text}
        </span>
      );
  }
}
