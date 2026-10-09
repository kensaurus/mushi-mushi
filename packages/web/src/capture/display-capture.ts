/**
 * Explicit, user-consented fallback for when the DOM capturer can't produce an
 * image: the browser's own picker asks the reporter to share this tab, one
 * frame is grabbed, and every track stops immediately. Loaded lazily — only a
 * reporter who clicks "Share this tab instead" pays for it.
 *
 * The caller requests the stream itself, synchronously inside the click
 * (getDisplayMedia needs the transient user activation, which an awaited
 * dynamic import would lose), and passes the pending stream in.
 *
 * A tab share is real pixels, so DOM-level redaction can't reach it. While the
 * frame is taken, a temporary stylesheet blacks out the same sensitive
 * selectors on the live page; the caller passes them (the always-on baseline
 * plus the host's lists) so this chunk imports nothing from the main bundle.
 * The reporter still reviews the preview before anything is sent.
 * Rejects with the browser's error (NotAllowedError when the reporter cancels).
 */
export async function grabMaskedTabFrame(
  pendingStream: Promise<MediaStream>,
  maskSelectors: readonly string[],
): Promise<string> {
  const stream = await pendingStream;
  // Masking only reaches this page: refuse a window or the whole screen rather
  // than capture it unmasked. (A different browser tab also reports 'browser'
  // and can't be told apart here; preferCurrentTab makes this tab the default
  // choice, and the reporter reviews the preview before sending.)
  const surface = stream.getVideoTracks?.()[0]?.getSettings?.().displaySurface;
  if (surface && surface !== 'browser') {
    stream.getTracks().forEach((track) => track.stop());
    throw Object.assign(new Error('Only this tab can be captured'), { name: 'NotAllowedError' });
  }
  const selectors = maskSelectors.join(',');
  const mask = document.createElement('style');
  mask.setAttribute('data-mushi-capture-mask', '');
  mask.textContent =
    `:is(${selectors}){background:#000!important;color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}` +
    `:is(${selectors}) *{visibility:hidden!important}`;
  document.head.appendChild(mask);
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // Let the masked page reach the stream before grabbing a frame.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    mask.remove();
  }
}
