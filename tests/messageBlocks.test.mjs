import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessageBlocks } from '../src/messageBlocks.js';
import { assertRichSource, maximumRichSourceLength } from '../src/richMessagePolicy.js';

test('longer matching fences preserve shorter fences as literal source', () => {
  const blocks = parseMessageBlocks(['````mermaid', 'flowchart LR', '```', 'A-->B', '````'].join('\n'));
  assert.deepEqual(blocks, [{ type: 'code', language: 'mermaid', closed: true, text: 'flowchart LR\n```\nA-->B' }]);
});
test('unfinished streaming Mermaid stays code and a suffix cannot close its fence', () => {
  assert.equal(parseMessageBlocks('~~~mermaid\nA-->B\n~~~not-a-close')[0].closed, false);
  assert.equal(parseMessageBlocks('~~~mermaid\nA-->B\n~~~')[0].closed, true);
});
test('display equations support paired dollar and bracket blocks without interpreting prices', () => {
  const blocks = parseMessageBlocks(['Prix : $20 et $30.', '', '$$x^2 + y^2$$', '', '\\[', 'E=mc^2', '\\]'].join('\n'));
  assert.deepEqual(blocks.map(b => [b.type, b.text]), [['paragraph', 'Prix : $20 et $30.'], ['math', 'x^2 + y^2'], ['math', 'E=mc^2']]);
});
test('unfinished math and math inside ordinary code retain their literal source', () => {
  assert.deepEqual(parseMessageBlocks('$$\nx+y')[0], { type: 'code', language: '', closed: false, text: '$$\nx+y' });
  assert.equal(parseMessageBlocks('```js\n$$x$$\n```')[0].text, '$$x$$');
  assert.equal(parseMessageBlocks('\\[x+y\\]')[0].type, 'math');
});
test('ordinary Markdown headings, quotes and both list types retain their content', () => {
  const blocks = parseMessageBlocks('# Titre\n\n> Citation\n- Premier\n- Second\n1. Ordonné\nTexte exact 😢');
  assert.deepEqual(blocks.map(b=>b.type), ['heading', 'quote', 'list', 'ordered-list', 'paragraph']);
  assert.deepEqual(blocks[2].items, ['Premier', 'Second']);
  assert.equal(blocks.at(-1).text, 'Texte exact 😢');
});
test('rich diagrams bound source and reject external image/CSS resources before rendering', () => {
  assert.doesNotThrow(() => assertRichSource('flowchart LR\nA[https://example.invalid]-->B', 'mermaid'));
  for (const source of ['flowchart LR\nA@{img: "https://example.invalid/i.png"}', 'flowchart LR\nA@{"img": "https://example.invalid/i.png"}', 'classDef x fill:url(https://example.invalid)', '@import "https://example.invalid"']) assert.throws(() => assertRichSource(source, 'mermaid'), /ressources externes/);
  assert.throws(() => assertRichSource('x'.repeat(maximumRichSourceLength+1), 'math'), /limite/);
});
