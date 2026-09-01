// The restrained markdown subset for commit bodies (#253).
//
// Two kinds of assertion here, and the second matters more: what the subset
// RENDERS, and what it refuses to. A commit body is untrusted text that
// arrives from anyone who has ever pushed to the repository, so the refusals
// (no images, no javascript: links, no HTML passthrough) are the security
// surface — and the "leave it alone" cases are what stop a body that talks
// about syntax from being mangled by it.

import { describe, expect, it } from "vitest";

import {
  isSafeHref,
  isTrailerLine,
  parseCommitBody,
  parseInline,
  type Block,
  type Inline,
} from "./markdown";

/** The text of every inline node, concatenated — for shape-agnostic checks. */
function flatten(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
        case "code":
        case "issue":
          return n.text;
        default:
          return flatten(n.children);
      }
    })
    .join("");
}

const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);

describe("block structure", () => {
  it("renders a plain paragraph", () => {
    const blocks = parseCommitBody("Just some prose.");
    expect(kinds(blocks)).toEqual(["paragraph"]);
  });

  it("joins a hard-wrapped paragraph into one run", () => {
    // Commit bodies wrap at 72 columns. Rendering each physical line as its own
    // visual line is exactly the "reads badly" this feature is about.
    const blocks = parseCommitBody("one two\nthree four\n\nsecond para");
    expect(kinds(blocks)).toEqual(["paragraph", "paragraph"]);
    const first = blocks[0];
    if (first?.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(flatten(first.children)).toBe("one two three four");
  });

  it("honours markdown's two-space hard break", () => {
    const blocks = parseCommitBody("one  \ntwo");
    const b = blocks[0];
    if (b?.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(flatten(b.children)).toBe("one\ntwo");
  });

  it("reads a fenced code block, with its language", () => {
    const blocks = parseCommitBody("before\n\n```rust\nfn main() {}\n```\n\nafter");
    expect(kinds(blocks)).toEqual(["paragraph", "code", "paragraph"]);
    const code = blocks[1];
    if (code?.kind !== "code") throw new Error("expected code");
    expect(code.lang).toBe("rust");
    expect(code.text).toBe("fn main() {}");
  });

  it("keeps blank lines and markdown syntax INSIDE a fence literal", () => {
    // The whole point of a fence: a body pasting a diff or a config must come
    // out byte-for-byte, not re-parsed as lists and emphasis.
    const blocks = parseCommitBody("```\n- not a list\n\n*not emphasis*\n```");
    const code = blocks[0];
    if (code?.kind !== "code") throw new Error("expected code");
    expect(code.text).toBe("- not a list\n\n*not emphasis*");
  });

  it("still renders an unterminated fence as code", () => {
    // Commit bodies get truncated and hand-edited. Refusing to render one
    // because the closing fence is missing fails exactly when the content is
    // most unusual.
    const blocks = parseCommitBody("```\nsomething");
    expect(kinds(blocks)).toEqual(["code"]);
  });

  it("reads unordered and ordered lists", () => {
    const ul = parseCommitBody("- one\n- two\n* three");
    const list = ul[0];
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(list.ordered).toBe(false);
    expect(list.items.map(flatten)).toEqual(["one", "two", "three"]);

    const ol = parseCommitBody("1. first\n2. second");
    const olist = ol[0];
    if (olist?.kind !== "list") throw new Error("expected a list");
    expect(olist.ordered).toBe(true);
    expect(olist.items.map(flatten)).toEqual(["first", "second"]);
  });

  it("folds a wrapped bullet back into its item", () => {
    // At 72 columns a wrapped bullet is the normal case, not an edge one.
    const blocks = parseCommitBody("- a long bullet that\n  wrapped\n- second");
    const list = blocks[0];
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(list.items.map(flatten)).toEqual(["a long bullet that wrapped", "second"]);
  });

  it("recognises a trailer block", () => {
    const blocks = parseCommitBody(
      "Do the thing.\n\nCo-Authored-By: Ada <ada@example.com>\nSigned-off-by: Bo <bo@example.com>",
    );
    expect(kinds(blocks)).toEqual(["paragraph", "trailers"]);
    const t = blocks[1];
    if (t?.kind !== "trailers") throw new Error("expected trailers");
    expect(t.entries.map((e) => e.key)).toEqual(["Co-Authored-By", "Signed-off-by"]);
  });

  it("does not mistake prose with a colon for a trailer", () => {
    // git's own rule: the key may not contain a space. `See also: the README`
    // is prose, and styling it as metadata would be a confident wrong answer.
    expect(isTrailerLine("See also: the README")).toBe(false);
    expect(isTrailerLine("Fixes:#123")).toBe(true);
    expect(isTrailerLine("Co-Authored-By: Ada")).toBe(true);
    const blocks = parseCommitBody("Some body.\n\nSee also: the README");
    expect(kinds(blocks)).toEqual(["paragraph", "paragraph"]);
  });

  it("has no heading block at all", () => {
    // Deliberate: `#` at the start of a line in a commit body is far more
    // likely to be an issue reference than an ATX heading.
    const blocks = parseCommitBody("# 123 is not a heading");
    expect(kinds(blocks)).toEqual(["paragraph"]);
  });

  it("is empty for an empty body", () => {
    expect(parseCommitBody("")).toEqual([]);
    expect(parseCommitBody("\n\n  \n")).toEqual([]);
  });
});

describe("inline: what it renders", () => {
  it("emphasis and strong", () => {
    const nodes = parseInline("plain *em* and **strong** here");
    expect(nodes.map((n) => n.kind)).toEqual([
      "text",
      "em",
      "text",
      "strong",
      "text",
    ]);
  });

  it("underscore forms too", () => {
    expect(parseInline("_em_").map((n) => n.kind)).toEqual(["em"]);
    expect(parseInline("__strong__").map((n) => n.kind)).toEqual(["strong"]);
  });

  it("inline code", () => {
    const nodes = parseInline("run `git rebase -i` first");
    expect(nodes[1]).toEqual({ kind: "code", text: "git rebase -i" });
  });

  it("code spans win over emphasis", () => {
    // The single most common way a naive renderer mangles a body that is
    // talking ABOUT syntax.
    const nodes = parseInline("`a*b*c`");
    expect(nodes).toEqual([{ kind: "code", text: "a*b*c" }]);
  });

  it("an unclosed backtick stays literal", () => {
    expect(flatten(parseInline("a ` b"))).toBe("a ` b");
  });

  it("markdown links", () => {
    const nodes = parseInline("see [the docs](https://example.com/x)");
    const link = nodes[1];
    if (link?.kind !== "link") throw new Error("expected a link");
    expect(link.href).toBe("https://example.com/x");
    expect(flatten(link.children)).toBe("the docs");
  });

  it("bare URLs", () => {
    const nodes = parseInline("see https://example.com/a?b=1 for more");
    const link = nodes[1];
    if (link?.kind !== "link") throw new Error("expected a link");
    expect(link.href).toBe("https://example.com/a?b=1");
  });

  it("does not swallow trailing punctuation into a bare URL", () => {
    const nodes = parseInline("see https://example.com.");
    const link = nodes[1];
    if (link?.kind !== "link") throw new Error("expected a link");
    expect(link.href).toBe("https://example.com");
    expect(flatten(nodes)).toBe("see https://example.com.");
  });

  it("issue references, as a token rather than a guess at a URL", () => {
    const nodes = parseInline("fixes #123 and (#456)");
    const issues = nodes.filter((n) => n.kind === "issue");
    expect(issues.map((n) => (n.kind === "issue" ? n.text : ""))).toEqual([
      "#123",
      "#456",
    ]);
  });

  it("leaves a # that is not an issue reference alone", () => {
    // A hex colour and a fragment in the middle of a word are both common.
    expect(parseInline("#fff").every((n) => n.kind === "text")).toBe(true);
    expect(parseInline("abc#1").every((n) => n.kind === "text")).toBe(true);
  });
});

describe("inline: what it refuses", () => {
  it("never produces an image node — there is no image node", () => {
    // "No remote content of any kind" is the constraint. `![alt](url)` parses
    // as a LINK labelled by its alt text, which is the useful non-fetching
    // reading, and nothing in the AST can cause a request.
    const nodes = parseInline("![a picture](https://example.com/x.png)");
    const link = nodes[0];
    if (link?.kind !== "link") throw new Error("expected a link");
    expect(link.href).toBe("https://example.com/x.png");
    expect(flatten(link.children)).toBe("a picture");
    expect(JSON.stringify(nodes)).not.toContain("image");
  });

  it("drops a javascript: destination but keeps the words", () => {
    // The two properties that matter: no link node reaches the renderer, and
    // the label survives as text. A destination containing parentheses leaves
    // the unmatched `)` as literal text, which is cosmetic and strictly safer
    // than trying to balance parens inside a URL we have already rejected.
    const nodes = parseInline("[click me](javascript:alert(1))");
    expect(nodes.some((n) => n.kind === "link")).toBe(false);
    expect(flatten(nodes)).toContain("click me");
    expect(flatten(nodes)).not.toContain("javascript:");

    // The ordinary shape, with no parens in the destination, is exact.
    const plain = parseInline("[click me](javascript:alert)");
    expect(plain.some((n) => n.kind === "link")).toBe(false);
    expect(flatten(plain)).toBe("click me");
  });

  it("drops a data: destination too", () => {
    const nodes = parseInline("[x](data:text/html;base64,AAA)");
    expect(nodes.some((n) => n.kind === "link")).toBe(false);
  });

  it("allows exactly http, https and mailto", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:ada@example.com")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,x")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
    expect(isSafeHref("vbscript:x")).toBe(false);
    expect(isSafeHref("//example.com")).toBe(false);
  });

  it("leaves raw HTML as literal text", () => {
    // Not parsed, not passed through. The renderer builds React elements from
    // this AST, so there is no HTML string anywhere in the path — but the AST
    // must not carry markup either.
    const nodes = parseInline("<script>alert(1)</script>");
    expect(nodes.every((n) => n.kind === "text")).toBe(true);
    expect(flatten(nodes)).toBe("<script>alert(1)</script>");
  });

  it("survives adversarial nesting without throwing", () => {
    for (const input of [
      "*".repeat(200),
      "`".repeat(200),
      "[".repeat(200),
      "![".repeat(100) + "]".repeat(100),
      "**a*b**c*",
      "[a](b",
      "```".repeat(50),
    ]) {
      expect(() => parseCommitBody(input)).not.toThrow();
    }
  });
});

describe("round-tripping the text", () => {
  it("keeps every character of a plain paragraph", () => {
    // Nothing may be silently dropped: the rendered view is the default, and a
    // renderer that eats content would hide part of a commit message.
    const text = "Do the thing, then the other thing (see below).";
    const blocks = parseCommitBody(text);
    const p = blocks[0];
    if (p?.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(flatten(p.children)).toBe(text);
  });

  it("keeps the words of a body full of syntax", () => {
    const text = "Use `--force-with-lease`, not **--force**, when [rewriting](https://example.com).";
    const blocks = parseCommitBody(text);
    const p = blocks[0];
    if (p?.kind !== "paragraph") throw new Error("expected a paragraph");
    expect(flatten(p.children)).toBe(
      "Use --force-with-lease, not --force, when rewriting.",
    );
  });
});
