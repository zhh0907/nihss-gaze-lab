// Shared by the live view and recordings. A missing estimate is never zero.
export function eyeUsable(frame,side){
  const eye=frame?.[side];
  return !frame?.reasons?.length && eye?.valid===true && Number.isFinite(eye.corrected);
}
const labels={
  'no-face':'No face','multiple-faces':'Multiple faces','pose-unavailable':'Head pose unavailable',
  'head-out-of-range':'Head outside limits','eye-unavailable':'Eye not found',
  'eye-out-of-frame':'Outside frame','eye-too-small':'Eye too small',
  'blink-or-occlusion':'Blink / occlusion','iris-outside-eye':'Unreliable iris position',
};
export function eyeQualityLabel(frame,side){
  if(!frame)return 'Waiting';
  if(eyeUsable(frame,side))return 'Tracked';
  const reason=frame.reasons?.[0]??frame[side]?.reasons?.[0];
  return labels[reason]??'Tracking unavailable';
}
