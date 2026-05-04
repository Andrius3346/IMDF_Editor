// Read a PNG file's intrinsic pixel dimensions and produce a display blob
// for the map renderer. Large source PNGs are downscaled to TARGET_MAX along
// the longest edge so MapLibre doesn't upload a huge texture (which both
// burns VRAM and aliases visibly at low zoom because image sources don't
// generate mipmaps).
//
// Returned `width` / `height` are always the *original* image dimensions —
// `rowFromCorners` uses them as a logical pixel anchor for GCPs, and the
// MapLibre image source stretches whatever bitmap it gets to the four
// lng/lat corners, so texture pixel dimensions are decoupled from the
// affine. Persisting the originals keeps georeferencing math identical.

const TARGET_MAX = 4096;

/**
 * @param {Blob|File} file
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function rasterize(file) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  try {
    const longest = Math.max(width, height);
    if (longest <= TARGET_MAX) {
      return { blob: file, width, height };
    }
    const scale = TARGET_MAX / longest;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const blob = await downscaleToBlob(bitmap, targetW, targetH);
    return { blob, width, height };
  } finally {
    bitmap.close?.();
  }
}

async function downscaleToBlob(bitmap, w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvas.convertToBlob({ type: 'image/png' });
  }
  // Fallback for browsers without OffscreenCanvas (older Safari).
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob produced no blob'))),
      'image/png',
    );
  });
}
