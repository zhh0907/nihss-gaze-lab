// Preview transforms never change anatomical measurements or recorded pixels.
export function cameraOrientation(requested, settings = {}, mirrorFront = true) {
  const reported = settings.facingMode;
  const known = reported === 'user' || reported === 'environment';
  const facing = known ? reported : requested;
  return {facing, known, previewMirrored: facing === 'user' && mirrorFront};
}
