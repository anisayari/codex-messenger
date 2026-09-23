export function normalizeConversationInputs(items) {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('Envoyez entre 1 et 20 éléments.');
  let textLength = 0;
  const result = items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Élément de conversation invalide.');
    if (item.type === 'text') {
      if (typeof item.text !== 'string' || item.text.includes('\0')) throw new Error('Texte invalide.');
      textLength += item.text.length;
      if (textLength > 200000) throw new Error('Le message dépasse 200 000 caractères.');
      return {type:'text',text:item.text};
    }
    if (!['localImage','skill','mention'].includes(item.type)) throw new Error('Type de pièce jointe non pris en charge.');
    if (typeof item.path !== 'string' || !item.path.trim() || item.path.length > 4096 || item.path.includes('\0')) throw new Error('Chemin de pièce jointe invalide.');
    if (item.type === 'localImage') return {type:item.type,path:item.path};
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 256 || item.name.includes('\0')) throw new Error('Nom de l’activité invalide.');
    return {type:item.type,name:item.name,path:item.path};
  }).filter(item=>item.type!=='text'||item.text.trim());
  if (!result.length) throw new Error('Le message est vide.');
  return result;
}
