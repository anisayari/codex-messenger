import React from "react";
import msnEmoticons from "./msnEmoticons.js";

export const animatedInlineEmoticons = [
  { id: "animated-butterfly", label: "Papillon animé", code: ":butterfly:", aliases: ["[emoji:butterfly]", "[emote:butterfly]"], src: "./msn-assets/winks/butterfly-small.gif" },
  { id: "animated-surprise", label: "Surprise animée", code: ":surprise:", aliases: ["[emoji:surprise]", "[emote:surprise]"], src: "./msn-assets/winks/surprise.gif" },
  { id: "animated-flash", label: "Flash animé", code: ":flash:", aliases: ["[emoji:flash]", "[emote:flash]"], src: "./msn-assets/winks/flash.gif" },
  { id: "animated-wizz", label: "Wizz animé", code: ":wizz:", aliases: ["[emoji:wizz]", "[emote:wizz]"], src: "./msn-assets/winks/nudge-burst.gif" },
  { id: "animated-flow", label: "MSN animé", code: ":msn-flow:", aliases: ["[emoji:msn-flow]", "[emote:msn-flow]"], src: "./msn-assets/winks/msn-flow.gif" }
];

const msnEmoticonById = Object.fromEntries(msnEmoticons.map((emoticon) => [emoticon.id, emoticon]));
const unicodeEmojiEmoticons = [
  ["big-smile", "Sourire", "\u{1F600}", ["\u{1F603}", "\u{1F604}", "\u{1F601}", "\u{1F642}"]],
  ["smile", "Sourire doux", "\u{1F60A}", ["\u263A\uFE0F", "\u263A"]],
  ["laughing", "Rire", "\u{1F602}", ["\u{1F923}"]],
  ["wink", "Clin d'oeil", "\u{1F609}", []],
  ["kiss", "Bisou", "\u{1F618}", ["\u{1F617}", "\u{1F619}", "\u{1F61A}", "\u{1F48B}"]],
  ["sad", "Triste", "\u{1F622}", ["\u{1F62D}", "\u2639\uFE0F", "\u2639", "\u{1F641}", "\u{1F61E}"]],
  ["surprised", "Surpris", "\u{1F62E}", ["\u{1F62F}", "\u{1F632}", "\u{1F631}"]],
  ["cool", "Cool", "\u{1F60E}", []],
  ["blank-face", "Neutre", "\u{1F610}", ["\u{1F611}", "\u{1F636}"]],
  ["thinking", "Pensif", "\u{1F914}", ["\u{1F615}"]],
  ["angry-soft", "Fache", "\u{1F620}", ["\u{1F621}"]],
  ["angel", "Ange", "\u{1F607}", []],
  ["sleep", "Sommeil", "\u{1F634}", []],
  ["rose", "Rose", "\u{1F339}", []],
  ["star", "Etoile", "\u2B50", ["\u{1F31F}"]],
  ["gift", "Cadeau", "\u{1F381}", []],
  ["butterfly", "Papillon", "\u{1F98B}", []],
  ["sun", "Soleil", "\u2600\uFE0F", ["\u2600", "\u{1F31E}"]],
  ["cloud", "Nuage", "\u2601\uFE0F", ["\u2601"]],
  ["rain", "Pluie", "\u{1F327}\uFE0F", ["\u{1F327}"]],
  ["umbrella", "Parapluie", "\u2614", ["\u2602\uFE0F", "\u2602"]],
  ["storm", "Orage", "\u26C8\uFE0F", ["\u26C8"]],
  ["moon-happy", "Lune", "\u{1F319}", ["\u{1F31B}", "\u{1F31C}"]]
].map(([sourceId, label, code, aliases]) => ({
  id: `unicode-${sourceId}-${code.codePointAt(0).toString(16)}`,
  label,
  code,
  aliases,
  src: msnEmoticonById[sourceId]?.src
})).filter((emoticon) => emoticon.src);

const extraUnicodeEmojiEmoticons = [
  {
    id: "unicode-heart",
    label: "Coeur",
    code: "\u2764\uFE0F",
    aliases: ["\u2764", "\u2665\uFE0F", "\u2665", "\u{1F496}", "\u{1F499}", "\u{1F49A}", "\u{1F49B}", "\u{1F49C}"],
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1129_9/heart.png"
  },
  {
    id: "unicode-lightbulb",
    label: "Idee",
    code: "\u{1F4A1}",
    aliases: [],
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1123_9/lightbulb.jpg"
  }
];

const inlineEmoticons = [...msnEmoticons, ...animatedInlineEmoticons, ...unicodeEmojiEmoticons, ...extraUnicodeEmojiEmoticons];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const emoticonTokens = inlineEmoticons
  .flatMap((emoticon) => [emoticon.code, ...(emoticon.aliases ?? [])].map((code) => [code, emoticon]))
  .filter(([code]) => code);
const emoticonByToken = Object.fromEntries(emoticonTokens);

const inlineTokenSource = [
  "!\\[[^\\]\\n]*\\]\\([^\\s)]+\\)",
  "\\[[^\\]\\n]+\\]\\([^\\s)]+\\)",
  "https?:\\/\\/[^\\s<>()]+",
  "`[^`\\n]+`",
  "\\*\\*[^*\\n]+\\*\\*",
  "__[^_\\n]+__",
  "~~[^~\\n]+~~",
  "\\*[^*\\n]+\\*",
  ...emoticonTokens.map(([code]) => escapeRegExp(code))
].join("|");

const markdownImagePattern = /^!\[([^\]\n]*)\]\(([^)\s]+)\)$/;
const markdownLinkPattern = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;
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
  const href = match[2].trim();
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
  const src = imageSrcForHref(match[2]);
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
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let codeBlock = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    blocks.push(list);
    list = null;
  }

  function flushCodeBlock() {
    if (!codeBlock) return;
    blocks.push({ type: "code", text: codeBlock.join("\n") });
    codeBlock = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      if (codeBlock) flushCodeBlock();
      else codeBlock = [];
      continue;
    }
    if (codeBlock) {
      codeBlock.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s+(.+)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: quoteMatch[1] });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bulletMatch || orderedMatch) {
      flushParagraph();
      const type = orderedMatch ? "ordered-list" : "list";
      if (!list || list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((bulletMatch ?? orderedMatch)[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushCodeBlock();

  if (!blocks.length) return null;
  return blocks.map((block, index) => {
    if (block.type === "paragraph") {
      return <p key={`p-${index}`}>{renderInlineFormattedText(block.text, `p-${index}`)}</p>;
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
