const FILE_EXTENSION_RE =
  /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|svg|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)$/i;

const CAMERA_OR_DEVICE_PREFIX_RE =
  /^(img|vid|pxl|dsc|dcim|mov|mvi|mvimg|photo|video|image|picture|screenshot|screen[\s_-]?shot|whatsapp[\s_-]?(image|video)|fb_img|signal|clip|recording|capture|scan|untitled|media)[\s_-]*\d+/i;

const UUID_OR_HASH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPAQUE_MACHINE_ID_RE =
  /^[a-z0-9_-]*\d{6,}[a-z0-9_-]*$/i;

/**
 * Returns true if a caption string appears to be an unedited upload/camera filename
 * rather than a meaningful human-written caption.
 */
export function isAutoFilenameLike(raw?: string | null): boolean {
  const val = (raw ?? '').trim();
  if (!val) return true;
  if (FILE_EXTENSION_RE.test(val)) return true;
  if (CAMERA_OR_DEVICE_PREFIX_RE.test(val)) return true;
  if (UUID_OR_HASH_RE.test(val)) return true;
  if (!val.includes(' ') && OPAQUE_MACHINE_ID_RE.test(val) && val.length >= 10) return true;
  if (/^[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/i.test(val)) return true;
  return false;
}

/**
 * Strips filename-like captions from recipient/slideshow/video presentation surfaces
 * while preserving genuine creator-written captions.
 */
export function sanitizePresentationCaption(raw?: string | null): string {
  const val = (raw ?? '').trim();
  if (!val) return '';
  if (isAutoFilenameLike(val)) return '';
  return val;
}
