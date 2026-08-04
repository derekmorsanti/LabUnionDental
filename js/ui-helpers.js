// ============================================================================
// ui-helpers.js — modal genérico + toast, compartidos por varios módulos.
// ============================================================================

export function openModal(innerHtml) {
  const overlay = document.getElementById('modal-overlay');
  const box = document.getElementById('modal-box');
  box.innerHTML = innerHtml;
  overlay.classList.remove('hidden');
  return box;
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

let toastTimer = null;
export function showToast(message, isError) {
  const toast = document.getElementById('toast');
  const text = document.getElementById('toast-text');
  text.textContent = message;
  toast.className = 'toast show' + (isError ? ' toast-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

export function openDownloadModal(onChoose) {
  const box = openModal(`
    <h3>Descargar</h3>
    <p>Elige el formato de la imagen.</p>
    <div class="modal-actions" style="justify-content:center;">
      <button class="btn btn-outline" id="dl-png">PNG</button>
      <button class="btn btn-brass" id="dl-jpg">JPG</button>
    </div>
  `);
  box.querySelector('#dl-png').addEventListener('click', async () => { closeModal(); await onChoose('png'); });
  box.querySelector('#dl-jpg').addEventListener('click', async () => { closeModal(); await onChoose('jpg'); });
}
