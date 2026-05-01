// Read a PNG file's intrinsic pixel dimensions. The blob is passed straight
// through to the renderer — no rasterization is needed for PNGs.

/**
 * @param {Blob|File} file
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function rasterize(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return { blob: file, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}
