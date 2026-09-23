import React from "react";
import { parseMessageBlocks } from "./messageBlocks.js";
import { RichMessageBlock } from "./richMessageBlock.jsx";
import msnEmoticons from "./msnEmoticons.js";
import { localFilePathForHref, normalizeMarkdownHref } from "./messageLinks.js";

export const animatedInlineEmoticons = [];
const inlineEmoticons = msnEmoticons;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const emoticonTokens = inlineEmoticons
  .flatMap((emoticon) => [emoticon.code, ...(emoticon.aliases ?? [])].map((code) => [code, emoticon]))
  .filter(([code]) => code)
  .sort(([left], [right]) => right.length - left.length);
const emoticonByToken = Object.fromEntries(emoticonTokens);

const markdownDestination = "(?:<[^>\\n]+>|[^\\s)]+)";
const inlineTokenSource = [
  "!\\[[^\\]\\n]*\\]\\(" + markdownDestination + "\\)",
  "\\[[^\\]\\n]+\\]\\(" + markdownDestination + "\\)",
  "https?:\\/\\/[^\\s<>()]+",
  "`[^`\\n]+`",
  "\\*\\*[^*\\n]+\\*\\*",
  "__[^_\\n]+__",
  "~~[^~\\n]+~~",
  "\\*[^*\\n]+\\*",
  ...emoticonTokens.map(([code]) => escapeRegExp(code))
].join("|");

const markdownImagePattern = /^!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)\)$/;
const markdownLinkPattern = /^\[([^\]\n]+)\]\((<[^>\n]+>|[^)\s]+)\)$/;
const internalMentionProtocols = new Set(["plugin", "app", "skill"]);

function protocolForHref(href) {
  const match = String(href ?? "").trim().match(/^([a-z][a-z0-9+.-]*):/i);
  return match ? match[1].toLowerCase() : "";
}

function isSafeExternalHref(href) {
  const protocol = protocolForHref(href);
  return protocol === "http" || protocol === "https" || protocol === "mailto";
}

function encodeFilePathForImage(pathValue) {
  const normalized = String(pathValue ?? "").trim().replace(/\\/g, "/");
  if (!normalized) return "";
  const encoded = encodeURI(normalized).replace(/[#?]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${encoded}`;
  if (normalized.startsWith("/")) return `file://${encoded}`;
  return "";
}

function imageSrcForHref(href) {
  const text = String(href ?? "").trim();
  if (!text) return "";
  const protocol = protocolForHref(text);
  if (protocol === "http" || protocol === "https" || protocol === "file") return text;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(text)) return text;
  return encodeFilePathForImage(text);
}

function internalMentionKind(href) {
  const protocol = protocolForHref(href);
  return internalMentionProtocols.has(protocol) ? protocol : "";
}

function splitTrailingUrlPunctuation(value) {
  let href = String(value ?? "");
  let suffix = "";
  while (href.length > 0 && /[.,!?;:]$/.test(href)) {
    suffix = `${href.slice(-1)}${suffix}`;
    href = href.slice(0, -1);
  }
  return { href, suffix };
}

function renderMarkdownLinkToken(token, keyPrefix) {
  const match = String(token ?? "").match(markdownLinkPattern);
  if (!match) return null;
  const label = match[1].trim();
  const href = normalizeMarkdownHref(match[2]);
  const mentionKind = internalMentionKind(href);
  if (mentionKind) {
    return (
      <span
        className={`message-mention ${mentionKind}`}
        data-kind={mentionKind}
        key={`${keyPrefix}-mention`}
        title={href}
      >
        {renderInlineFormattedText(label, `${keyPrefix}-mention-label`)}
      </span>
    );
  }
  const localPath = localFilePathForHref(href);
  if (localPath) {
    return (
      <button className="message-link local-file-link" type="button" key={`${keyPrefix}-local`} title={href} onClick={async () => {
        try {
          const result = await window.codexMsn?.app?.openPath(localPath);
          if (result?.ok === false) window.alert(result.error || 'Fichier impossible à ouvrir.');
        } catch (error) {
          window.alert(error.message);
        }
      }}>
        {renderInlineFormattedText(label, `${keyPrefix}-local-label`)}
      </button>
    );
  }
  if (!isSafeExternalHref(href)) {
    return (
      <span className="message-link disabled" key={`${keyPrefix}-link-disabled`} title={href}>
        {renderInlineFormattedText(label, `${keyPrefix}-link-disabled-label`)}
      </span>
    );
  }
  return (
    <a className="message-link" key={`${keyPrefix}-link`} href={href} target="_blank" rel="noreferrer noopener">
      {renderInlineFormattedText(label, `${keyPrefix}-link-label`)}
    </a>
  );
}

function renderMarkdownImageToken(token, keyPrefix) {
  const match = String(token ?? "").match(markdownImagePattern);
  if (!match) return null;
  const label = match[1].trim() || "image";
  const src = imageSrcForHref(normalizeMarkdownHref(match[2]));
  if (!src) {
    return (
      <span className="message-link disabled" key={`${keyPrefix}-image-disabled`} title={match[2]}>
        {label}
      </span>
    );
  }
  return (
    <a className="message-image-link inline" key={`${keyPrefix}-image`} href={src} target="_blank" rel="noreferrer noopener" title={label}>
      <img className="message-inline-image" src={src} alt={label} loading="lazy" draggable="false" />
    </a>
  );
}

function renderUrlToken(token, keyPrefix) {
  const { href, suffix } = splitTrailingUrlPunctuation(token);
  if (!isSafeExternalHref(href)) return token;
  return [
    <a className="message-link" key={`${keyPrefix}-url`} href={href} target="_blank" rel="noreferrer noopener">
      {href}
    </a>,
    suffix
  ].filter(Boolean);
}

function renderInlineFormattedText(text, keyPrefix = "inline") {
  const source = String(text ?? "");
  if (!source) return null;
  const pattern = new RegExp(inlineTokenSource, "g");
  const nodes = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(source))) {
    const token = match[0];
    if (match.index > lastIndex) nodes.push(source.slice(lastIndex, match.index));
    const emoticon = emoticonByToken[token];
    if (markdownImagePattern.test(token)) {
      nodes.push(renderMarkdownImageToken(token, `${keyPrefix}-mdimage-${match.index}`));
    } else if (markdownLinkPattern.test(token)) {
      nodes.push(renderMarkdownLinkToken(token, `${keyPrefix}-mdlink-${match.index}`));
    } else if (/^https?:\/\//i.test(token)) {
      nodes.push(renderUrlToken(token, `${keyPrefix}-url-${match.index}`));
    } else if (emoticon) {
      nodes.push(
        <img
          key={`${keyPrefix}-emoticon-${match.index}`}
          className="message-emoticon"
          src={emoticon.src}
          alt={token}
          title={`${emoticon.label} ${emoticon.code}`}
          draggable="false"
        />
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code className="message-code" key={`${keyPrefix}-code-${match.index}`}>{token.slice(1, -1)}</code>);
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{renderInlineFormattedText(token.slice(2, -2), `${keyPrefix}-strong-${match.index}`)}</strong>);
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(<del key={`${keyPrefix}-del-${match.index}`}>{renderInlineFormattedText(token.slice(2, -2), `${keyPrefix}-del-${match.index}`)}</del>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-em-${match.index}`}>{renderInlineFormattedText(token.slice(1, -1), `${keyPrefix}-em-${match.index}`)}</em>);
    } else {
      nodes.push(token);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < source.length) nodes.push(source.slice(lastIndex));
  return nodes;
}

export function renderFormattedMessageText(text) {
  const blocks = parseMessageBlocks(text);
  if (!blocks.length) return null;
  return blocks.map((block, index) => {
    if (block.type === "paragraph") {
      return <p key={`p-${index}`}>{renderInlineFormattedText(block.text, `p-${index}`)}</p>;
    }
    if (block.type === "math" || (block.type === "code" && block.closed && ["math", "latex", "tex"].includes(block.language))) {
      return <RichMessageBlock key={"math-" + index} kind="math" source={block.text} />;
    }
    if (block.type === "code" && block.closed && block.language === "mermaid") {
      return <RichMessageBlock key={"mermaid-" + index} kind="mermaid" source={block.text} />;
    }
    if (block.type === "code") {
      return <pre key={`code-${index}`}><code>{block.text}</code></pre>;
    }
    if (block.type === "heading") {
      const HeadingTag = `h${Math.min(4, block.level + 2)}`;
      return <HeadingTag key={`heading-${index}`}>{renderInlineFormattedText(block.text, `heading-${index}`)}</HeadingTag>;
    }
    if (block.type === "quote") {
      return <blockquote key={`quote-${index}`}>{renderInlineFormattedText(block.text, `quote-${index}`)}</blockquote>;
    }
    const ListTag = block.type === "ordered-list" ? "ol" : "ul";
    return (
      <ListTag key={`list-${index}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`item-${index}-${itemIndex}`}>{renderInlineFormattedText(item, `item-${index}-${itemIndex}`)}</li>
        ))}
      </ListTag>
    );
  });
}
