import React, { useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';
import './richMessageBlock.css';
import 'katex/dist/katex.min.css';
import { assertRichSource, equationRenderConfig, mermaidRenderConfig } from './richMessagePolicy.js';

let mermaidModule;
function loadMermaid() {
  if (!mermaidModule) mermaidModule = import('mermaid').then(({ default: mermaid }) => { mermaid.initialize(mermaidRenderConfig); return mermaid; });
  return mermaidModule;
}

const svgCssProperties = new Set(['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'display', 'visibility', 'line-height', 'white-space', 'text-align', 'background-color', 'border-color']);
function safeDeclarations(style) {
  const values = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    const value = style.getPropertyValue(name);
    if (svgCssProperties.has(name) && !/(?:url|var)\s*\(/i.test(value)) values.push(name + ':' + value);
  }
  return values.join(';');
}
function safeDiagramCss(text, svgId) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  return [...sheet.cssRules].filter(rule => rule.type === 1 && rule.selectorText.split(',').every(selector => selector.trim().startsWith('#' + svgId))).map(rule => rule.selectorText + '{' + safeDeclarations(rule.style) + '}').join('\n');
}

function sanitizeDiagram(svg) {
  const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'object', 'embed', 'image', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'],
    });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (!doc.documentElement || doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Le diagramme n’a pas produit de SVG lisible.');
  for (const node of doc.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || /(?:^|:)href$/i.test(attribute.name) && !attribute.value.startsWith('#') || /url\s*\(\s*(?!['"]?#)|@import|@font-face/i.test(attribute.value)) node.removeAttribute(attribute.name);
    }
    if (node.hasAttribute('style')) { const style = document.createElement('span').style; style.cssText = node.getAttribute('style'); node.setAttribute('style', safeDeclarations(style)); }
    if (node.localName === 'style') node.textContent = safeDiagramCss(node.textContent, doc.documentElement.id);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function RichMessageBlock({ kind, source }) {
  const id = 'message-rich-' + useId().replace(/[^a-z0-9-]/gi, '');
  const [rendered, setRendered] = useState({ source: '', html: '', error: '', pending: true });
  useEffect(() => {
    let current = true;
    setRendered({ source, html: '', error: '', pending: true });
    (async () => {
      assertRichSource(source, kind);
      let html;
      if (kind === 'mermaid') {
        const mermaid = await loadMermaid();
        const valid = await mermaid.parse(source, { suppressErrors: true });
        if (!valid) throw new Error('La syntaxe Mermaid ne permet pas de créer ce diagramme.');
        const result = await mermaid.render(id, source);
        html = sanitizeDiagram(result.svg);
      } else {
        const { default: katex } = await import('katex');
        html = katex.renderToString(source, equationRenderConfig);
      }
      if (current) setRendered({ source, html, error: '', pending: false });
    })().catch(error => { if (current) setRendered({ source, html: '', error: error.message, pending: false }); });
    return () => { current = false; };
  }, [source, kind, id]);
  const state = rendered.source === source ? rendered : { html: '', error: '', pending: true };
  const label = kind === 'mermaid' ? 'Diagramme Mermaid' : 'Équation mathématique';
  return <figure className={'message-rich-block ' + kind}>
    <figcaption id={id + '-caption'}>{label}</figcaption>
    {state.pending ? <p role="status">Rendu en cours…</p> : null}
    {state.error ? <p className="message-rich-error" role="status">{state.error}</p> : null}
    {state.html ? <div className="message-rich-output" role={kind === 'mermaid' ? 'img' : undefined} aria-labelledby={kind === 'mermaid' ? id + '-caption' : undefined} dangerouslySetInnerHTML={{ __html: state.html }} /> : null}
    <details open={Boolean(state.error)}><summary>Source {kind === 'mermaid' ? 'du diagramme' : 'de l’équation'}</summary><pre><code>{source}</code></pre></details>
  </figure>;
}
