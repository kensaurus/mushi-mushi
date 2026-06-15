import { MAX_SCREENSHOT_DATA_URL_BYTES } from '@mushi-mushi/core';

/**
 * Downscale a JPEG data URL until it fits under the wire budget.
 * Returns null when compression cannot get under the cap.
 */
export async function compressScreenshotDataUrl(
  dataUrl: string,
  maxBytes = MAX_SCREENSHOT_DATA_URL_BYTES,
): Promise<string | null> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl;
  if (estimateDataUrlBytes(dataUrl) <= maxBytes) return dataUrl;
  if (typeof document === 'undefined') return null;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('screenshot_decode_failed'));
    img.src = dataUrl;
  });

  const qualities = [0.65, 0.5, 0.35, 0.25];
  const scales = [1, 0.85, 0.7, 0.55, 0.4];

  for (const scale of scales) {
    const canvas = document.createElement('canvas');
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(img, 0, 0, w, h);

    for (const q of qualities) {
      const candidate = canvas.toDataURL('image/jpeg', q);
      if (estimateDataUrlBytes(candidate) <= maxBytes) return candidate;
    }
  }

  return null;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1);
  return Math.ceil((b64.length * 3) / 4);
}
