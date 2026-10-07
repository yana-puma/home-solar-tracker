import { loadPropertyPackage } from '../property-package.js';

export function chooseLocalProperty(documentRef = document, expected = {}) {
  const loader = documentRef.getElementById('loader');
  loader.replaceChildren();
  loader.setAttribute('aria-busy', 'false');
  const panel = documentRef.createElement('section');
  panel.className = 'local-package-picker';
  const heading = documentRef.createElement('h1'); heading.textContent = 'Open your house';
  const help = documentRef.createElement('p');
  help.textContent = 'Choose the complete ZIP from the property builder. Your house stays in this browser; nothing is uploaded. Reopen the ZIP after reloading. Ground sunlight studies require a calibrated model containing the obstructions that matter.';
  const label = documentRef.createElement('label'); label.textContent = 'House package ZIP';
  const input = documentRef.createElement('input'); input.type = 'file'; input.accept = '.zip';
  label.appendChild(input);
  const status = documentRef.createElement('p'); status.setAttribute('role', 'status');
  const builder = documentRef.createElement('a'); builder.href = new URL('../../configure/', import.meta.url).href; builder.textContent = 'Build or edit a package';
  const demo = documentRef.createElement('a'); demo.href = '?property=demo'; demo.textContent = 'Explore the demo';
  panel.append(heading, help, label, status, builder, documentRef.createTextNode(' · '), demo);
  loader.appendChild(panel);
  return new Promise(resolve => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      input.disabled = true; status.textContent = 'Checking your package…';
      try {
        const loaded = await loadPropertyPackage(file, expected);
        const modelUrl = URL.createObjectURL(new Blob([loaded.modelBytes], { type: 'model/gltf-binary' }));
        loaded.config.model.url = modelUrl;
        status.textContent = 'Opening your house…';
        window.addEventListener('pagehide', () => URL.revokeObjectURL(modelUrl), { once: true });
        resolve(loaded);
      } catch (error) {
        status.textContent = error.message; input.disabled = false; input.value = '';
      }
    });
  });
}
