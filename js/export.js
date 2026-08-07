// ============================================================================
// export.js
// ----------------------------------------------------------------------------
// Descarga de una tabla (agenda o calendario) como imagen PNG o JPG, tal
// como se ve en pantalla. Usa html2canvas, cargado bajo demanda desde CDN
// (ver loadHtml2Canvas) solo cuando el usuario realmente descarga algo.
// ============================================================================

let html2canvasLoadPromise = null;

/** Carga html2canvas desde CDN una sola vez, solo cuando realmente se necesita (al descargar). */
function loadHtml2Canvas() {
  if (typeof html2canvas !== 'undefined') return Promise.resolve();
  if (html2canvasLoadPromise) return html2canvasLoadPromise;
  html2canvasLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onload = () => resolve();
    script.onerror = () => { html2canvasLoadPromise = null; reject(new Error('No se pudo cargar html2canvas (revisa tu conexión a internet).')); };
    document.head.appendChild(script);
  });
  return html2canvasLoadPromise;
}

/**
 * Captura un elemento del DOM y dispara la descarga como imagen.
 * @param {HTMLElement} element - Elemento a capturar (la tabla o el calendario).
 * @param {string} filename - Nombre de archivo SIN extensión.
 * @param {'png'|'jpg'} format
 */
export async function captureElementToImage(element, filename, format) {
  await loadHtml2Canvas();
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
