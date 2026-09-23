const extensions = {'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp','image/avif':'.avif','image/bmp':'.bmp','audio/webm':'.webm','audio/ogg':'.ogg','audio/wav':'.wav','audio/x-wav':'.wav','audio/mp4':'.m4a','audio/mpeg':'.mp3','video/webm':'.webm'};
export function decodeMediaDataUrl(dataUrl, maxBytes = 25 * 1024 * 1024) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(maxBytes * 4 / 3) + 1024) throw new Error('Pièce jointe trop volumineuse (25 Mo maximum).');
  const match=dataUrl.match(/^data:([^;,]+)(?:;[a-z0-9-]+=[^;,]*)*;base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match || !extensions[match[1].toLowerCase()]) throw new Error('Format de pièce jointe non pris en charge.');
  const [,type,data]=match;
  if (!data || data.length%4!==0) throw new Error('Données de pièce jointe invalides.');
  const bytes=Buffer.from(data,'base64');
  if (bytes.length>maxBytes || bytes.toString('base64')!==data) throw new Error('Données de pièce jointe invalides ou trop volumineuses.');
  return {mime:type.toLowerCase(),extension:extensions[type.toLowerCase()],bytes};
}
