// A restrained markdown subset for commit message BODIES (#253).
//
// ## Why a parser of our own rather than a dependency
//
// The issue asks for "restrained markdown" under two hard constraints: no
// remote content of any kind, and a raw/rendered toggle. It also says any
// markdown dependency needs a look at bundle size and sanitisation first — and
// that look does not end well for the general-purpose libraries. They exist to
// render arbitrary documents, which means HTML passthrough, images, and a
// sanitiser you have to configure correctly forever. The subset a commit body
// actually uses is small enough to parse in a few hundred lines, and parsing it
// into a TYPED AST that the renderer turns into React elements removes the
// whole `dangerouslySetInnerHTML` class of bug by construction: there is no
// HTML string anywhere in this path.
//
// ## What is deliberately NOT in the subset
//
// - **Headings.** `#` at the start of a line is far more likely to be an issue
//   reference in a commit body than an ATX heading, and getting that wrong on
//   the first line of someone's message is worse than not supporting headings.
// - **Images.** Nothing here may fetch. `![alt](url)` is parsed, but it renders
//   as a LINK labelled with its alt text — the useful non-fetching reading —
//   never as an `<img>`.
// - **Raw HTML.** Not parsed, not passed through; it stays literal text.
// - **Tables, footnotes, definition lists.** Not what commit bodies contain.
//
// The raw toggle is what makes all of this safe to be wrong about: a commit
// message is a git object, and the user can always see it byte-for-byte.

/** A run of inline content. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "em"; children: Inline[] }
  | { kind: "strong"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  /**
   * An issue reference like `#123`.
   *
   * Deliberately NOT a link. Turning it into one means guessing which forge and
   * which repository the number belongs to, and there is no helper in the tree
   * that resolves a remote to a web URL. A link to the wrong issue is worse
   * than no link — so this is a styled token, and linking it is a follow-up
   * that starts by building that resolver.
   */
  | { kind: "issue"; text: string };

/** One trailer line, e.g. `Co-Authored-By: Ada <ada@example.com>`. */
export interface Trailer {
  key: string;
  value: Inline[];
}

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; lang: string | null; text: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "trailers"; entries: Trailer[] };

/**
 * Schemes a link may use.
 *
 * An allow-list, not a deny-list: `javascript:` is the one everybody remembers
 * and `data:` is the one they forget. Anything not named here is not a link at
 * all — the text stays, the href is dropped.
 */
const SAFE_SCHEMES = ["http://", "https://", "mailto:"];

export function isSafeHref(href: string): boolean {
  const h = href.trim().toLowerCase();
  return SAFE_SCHEMES.some((s) => h.startsWith(s));
}

/**
 * git's own trailer rule: a key of `[A-Za-z0-9-]+` immediately followed by `:`.
 *
 * The same rule `signature.rs::is_trailer_line` applies in Rust, and for the
 * same reason: it rejects prose that merely contains ": " (`See also: the
 * README` — the key would contain a space) while accepting `Fixes:#123`.
 */
const TRAILER_RE = /^([A-Za-z0-9-]+):[ \t]?(.*)$/;

export function isTrailerLine(line: string): boolean {
  return TRAILER_RE.test(line.trimEnd());
}

const FENCE_RE = /^\s*```+\s*(\S*)\s*$/;
const UL_RE = /^[ \t]*[-*+][ \t]+(.*)$/;
const OL_RE = /^[ \t]*\d+[.)][ \t]+(.*)$/;

/**
 * Parse a commit body into blocks.
 *
 * The SUBJECT is never passed here. It is one line, it is not markdown, and
 * rendering `*` in it as emphasis would change what the commit appears to say.
 */
export function parseCommitBody(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // ── fenced code ──────────────────────────────────────────────────────
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1] ? fence[1] : null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      // An unterminated fence still produces a code block. Commit bodies get
      // truncated and hand-edited; refusing to render one because its closing
      // fence is missing would fail exactly when the content is most unusual.
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    // ── lists ────────────────────────────────────────────────────────────
    const isUl = UL_RE.test(line);
    const isOl = !isUl && OL_RE.test(line);
    if (isUl || isOl) {
      const re = isUl ? UL_RE : OL_RE;
      const items: Inline[][] = [];
      let current: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? "";
        const m = re.exec(l);
        if (m) {
          if (current.length > 0) items.push(parseInline(current.join(" ")));
          current = [m[1] ?? ""];
          i += 1;
          continue;
        }
        // A continuation line: indented, non-blank, and not the start of the
        // other kind of list. Commit bodies wrap at 72 columns, so a wrapped
        // bullet is the normal case rather than an edge one.
        if (l.trim() !== "" && /^[ \t]+/.test(l) && !UL_RE.test(l) && !OL_RE.test(l)) {
          current.push(l.trim());
          i += 1;
          continue;
        }
        break;
      }
      if (current.length > 0) items.push(parseInline(current.join(" ")));
      blocks.push({ kind: "list", ordered: isOl, items });
      continue;
    }

    // ── paragraph (or trailer block) ─────────────────────────────────────
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (l.trim() === "" || FENCE_RE.test(l) || UL_RE.test(l) || OL_RE.test(l)) break;
      para.push(l);
      i += 1;
    }

    // A block whose every line is a trailer is a trailer block, wherever it
    // sits. git only recognises them at the end, but a body with a trailer
    // block followed by a postscript is common enough, and styling them is
    // useful in both positions.
    if (para.length > 0 && para.every((l) => isTrailerLine(l))) {
      blocks.push({
        kind: "trailers",
        entries: para.map((l) => {
          const m = TRAILER_RE.exec(l.trimEnd());
          return {
            key: m?.[1] ?? "",
            value: parseInline(m?.[2] ?? ""),
          };
        }),
      });
      continue;
    }

    blocks.push({ kind: "paragraph", children: parseInline(joinWrapped(para)) });
  }

  return blocks;
}

/**
 * Join a hard-wrapped paragraph into one run.
 *
 * Commit bodies are wrapped at 72 columns by convention, and rendering each
 * physical line as its own visual line is exactly the "reads badly" the issue
 * is about. Markdown's own rule applies: a line ending in two spaces is a hard
 * break and survives.
 */
function joinWrapped(lines: string[]): string {
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    out += line.replace(/[ \t]+$/, "");
    if (i === lines.length - 1) break;
    out += /[ ]{2,}$/.test(line) ? "\n" : " ";
  }
  return out;
}

// ── inline ──────────────────────────────────────────────────────────────────

const BARE_URL_RE = /^(https?:\/\/[^\s<>()[\]]+[^\s<>()[\].,;:!?'"])/;

/**
 * Parse inline content.
 *
 * Code spans win over everything, which is what makes `` `a*b*c` `` render
 * literally — the single most common way a naive renderer mangles a commit
 * body that is talking ABOUT syntax.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // `code`
    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > i) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    // ![alt](url) — a link, never an image. Checked before `[` so the `!` is
    // consumed rather than left dangling in front of the link.
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (img) {
      const href = img[2] ?? "";
      const label = img[1] || href;
      flush();
      if (isSafeHref(href)) {
        out.push({ kind: "link", href, children: [{ kind: "text", text: label }] });
      } else {
        out.push({ kind: "text", text: label });
      }
      i += img[0].length;
      continue;
    }

    // [text](url)
    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = link[2] ?? "";
      const label = link[1] || href;
      flush();
      if (isSafeHref(href)) {
        out.push({ kind: "link", href, children: parseInline(label) });
      } else {
        // Not a scheme we will open. Keep the words, drop the destination —
        // silently rendering it as plain text is better than a link that does
        // something the user did not ask for.
        out.push(...parseInline(label));
      }
      i += link[0].length;
      continue;
    }

    // bare URL
    const bare = BARE_URL_RE.exec(rest);
    if (bare) {
      const href = bare[1] ?? "";
      flush();
      out.push({ kind: "link", href, children: [{ kind: "text", text: href }] });
      i += href.length;
      continue;
    }

    // **strong** / __strong__
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      flush();
      out.push({ kind: "strong", children: parseInline(strong[2] ?? "") });
      i += strong[0].length;
      continue;
    }

    // *em* / _em_
    const em = /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (em) {
      flush();
      out.push({ kind: "em", children: parseInline(em[2] ?? "") });
      i += em[0].length;
      continue;
    }

    // #123 — only at a word boundary, so `abc#1` and a hex colour are left be.
    const issue = /^#(\d+)\b/.exec(rest);
    if (issue && (i === 0 || /[\s([{]/.test(text[i - 1] ?? " "))) {
      flush();
      out.push({ kind: "issue", text: `#${issue[1]}` });
      i += issue[0].length;
      continue;
    }

    buf += text[i];
    i += 1;
  }

  flush();
  return out;
}
