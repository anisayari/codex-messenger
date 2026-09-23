export function parseMessageBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;
  let math = null;
  const flushParagraph = () => { if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join('\n') }); paragraph = []; };
  const flushList = () => { if (list) blocks.push(list); list = null; };
  const flushCode = (closed) => { blocks.push({ type: 'code', text: code.lines.join('\n'), language: code.language, closed }); code = null; };
  for (const line of lines) {
    const trimmed = line.trim();
    if (code) {
      const closing = trimmed.match(/^(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === code.marker && closing[1].length >= code.length) flushCode(true);
      else code.lines.push(line);
      continue;
    }
    if (math) {
      if (trimmed === math.closing) { blocks.push({ type: 'math', text: math.lines.join('\n'), closed: true }); math = null; }
      else math.lines.push(line);
      continue;
    }
    const fence = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    if (fence) {
      flushParagraph(); flushList();
      code = { marker: fence[1][0], length: fence[1].length, language: fence[2].trim().split(/\s+/)[0].toLowerCase(), lines: [] };
      continue;
    }
    if (trimmed === '$$' || trimmed === '\\[') {
      flushParagraph(); flushList();
      math = { opening: line, closing: trimmed === '$$' ? '$$' : '\\]', lines: [] };
      continue;
    }
    const equation = trimmed.match(/^\$\$(.+)\$\$$/) || trimmed.match(/^\\\[(.+)\\\]$/);
    if (equation) { flushParagraph(); flushList(); blocks.push({ type: 'math', text: equation[1], closed: true }); continue; }
    if (!trimmed) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] }); continue; }
    const quote = line.match(/^\s*>\s+(.+)$/);
    if (quote) { flushParagraph(); flushList(); blocks.push({ type: 'quote', text: quote[1] }); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      flushParagraph();
      const type = ordered ? 'ordered-list' : 'list';
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((bullet ?? ordered)[1]);
      continue;
    }
    flushList(); paragraph.push(line);
  }
  flushParagraph(); flushList();
  if (code) flushCode(false);
  if (math) blocks.push({ type: 'code', text: [math.opening, ...math.lines].join('\n'), language: '', closed: false });
  return blocks;
}
