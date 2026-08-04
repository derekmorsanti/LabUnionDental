// ============================================================================
// export.js
// ----------------------------------------------------------------------------
// Descarga de una tabla (agenda o calendario) como imagen PNG o JPG, tal
// como se ve en pantalla. Usa html2canvas (cargado por CDN en index.html).
// ============================================================================

/**
 * Captura un elemento del DOM y dispara la descarga como imagen.
 * @param {HTMLElement} element - Elemento a capturar (la tabla o el calendario).
 * @param {string} filename - Nombre de archivo SIN extensión.
 * @param {'png'|'jpg'} format
 */
export async function captureElementToImage(element, filename, format) {
  if (typeof html2canvas === 'undefined') {
    throw new Error('html2canvas no está disponible (revisa tu conexión a internet).');
  }
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true
  });
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpg' ? 0.95 : undefined;
  const dataUrl = canvas.toDataURL(mime, quality);

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${filename}.${format === 'jpg' ? 'jpg' : 'png'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
