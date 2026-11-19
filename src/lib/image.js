// Shrink a photo in the browser before it is uploaded: long edge <= maxEdge px, re-encoded as JPEG.
// Re-encoding also drops EXIF (GPS position, camera serial) and applies the camera rotation, so people
// photographed at an event do not leak where/when from the file. Transparent PNGs get a white background.

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/** -> { blob, width, height, name }  (name = original base name + .jpg). Throws Error('decode') if the file is not a readable image. */
export async function shrinkImage(file, maxEdge = 2000, quality = 0.85) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error('decode');
  }
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  if (!sw || !sh) throw new Error('decode');
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, width, height);
  if (typeof source.close === 'function') source.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('decode');
  const base = (file.name || 'photo').replace(/\.[A-Za-z0-9]{1,10}$/, '') || 'photo';
  return { blob, width, height, name: `${base}.jpg` };
}
