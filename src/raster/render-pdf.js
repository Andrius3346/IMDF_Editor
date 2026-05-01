// Rasterize the first page of a PDF into a PNG Blob using pdf.js.
// Loaded from esm.sh; the worker URL must match the same major version.

import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@4/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://esm.sh/pdfjs-dist@4/build/pdf.worker.min.mjs';

const MAX_SIDE = 4096; // cap PNG size to keep memory and IndexedDB writes sane

/**
 * @param {Blob|File} file
 * @returns {Promise<{ blob: Blob, width: number, height: number, inferredBounds?: undefined }>}
 */
export async function rasterize(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  try {
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const longest = Math.max(baseViewport.width, baseViewport.height);
    const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    // White background — many CAD PDFs have transparent paper that would otherwise
    // sample to alpha-zero on the map and look invisible against dark basemaps.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    await pdf.cleanup?.();
    await pdf.destroy?.();
  }
}
