export function bitmapWithDeadline(makeBitmap,timeoutMs=4000) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timer=setTimeout(()=>{settled=true;reject(Error('Camera frame capture stalled. Stop and restart the camera.'));},timeoutMs);
    Promise.resolve().then(makeBitmap).then(bitmap=>{
      if(settled){bitmap.close();return;}
      settled=true;clearTimeout(timer);resolve(bitmap);
    },error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}});
  });
}

export async function captureVideoFrame(video,canvas,unmirror=false) {
  if(video.readyState<2||!video.videoWidth||!video.videoHeight)throw Error('The camera has not supplied a decoded frame.');
  if(canvas.width!==video.videoWidth)canvas.width=video.videoWidth;
  if(canvas.height!==video.videoHeight)canvas.height=video.videoHeight;
  const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);
  if(unmirror){ctx.translate(canvas.width,0);ctx.scale(-1,1);}
  // Materialize the displayed video orientation before transferring the frame.
  // Avoid createImageBitmap directly on a live camera HTMLVideoElement.
  ctx.drawImage(video,0,0,canvas.width,canvas.height);ctx.setTransform(1,0,0,1,0,0);
  return bitmapWithDeadline(()=>createImageBitmap(canvas));
}
