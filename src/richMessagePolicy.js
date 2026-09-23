export const maximumRichSourceLength = 20000;
export const mermaidRenderConfig = {
  startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
  flowchart: { htmlLabels: false }, maxTextSize: maximumRichSourceLength, maxEdges: 500,
  fontFamily: 'Trebuchet MS, Arial, sans-serif', suppressErrorRendering: true,
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'flowchart', 'themeCSS', 'themeVariables', 'fontFamily']
};
export const equationRenderConfig = {
  displayMode: true, output: 'htmlAndMathml', trust: false, strict: 'error',
  throwOnError: true, maxExpand: 1000, maxSize: 10
};
export function assertRichSource(source, kind) {
  if (!source.trim()) throw new Error('La source est vide.');
  if (source.length > maximumRichSourceLength) throw new Error('La source dépasse la limite de rendu local.');
  if (kind === 'mermaid' && /\\u[0-9a-f]{4}|\\x[0-9a-f]{2}/i.test(source)) throw new Error('Les séquences d’échappement de ce diagramme ne sont pas prises en charge ; sa source reste disponible.');
  if (kind === 'mermaid' && (/\b(?:img|image)["\']?\s*:/i.test(source) || /url\s*\(|@import|@font-face/i.test(source))) {
    throw new Error('Ce diagramme contient des ressources externes ; sa source reste disponible.');
  }
}
