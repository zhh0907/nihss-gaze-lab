import {recordingMime,extensionFor} from './recording.js?v=mobile2';

// Optional browser-local re-encoding. Originals and measurement files are untouched.
export async function convertVideo(blob,format,{signal,onProgress=()=>{},renderFrame=null,size=null}={}) {
  if(!renderFrame&&extensionFor(blob.type)===format)return blob;
  const mime=recordingMime(globalThis.MediaRecorder,format);
  if(!mime)throw Error(`${format.toUpperCase()} encoding is unavailable in this browser.`);
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
  const url=URL.createObjectURL(blob);const canvas=document.createElement('canvas');
  let stream,recorder,raf,timeout,stopped=false,detach=()=>{};
  const abortError=()=>new Error('Conversion cancelled. Original videos are unchanged.');
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>finish(Error('Cannot read this recording. Download the original format instead.')),15000);
      const cancel=()=>finish(abortError());
      function finish(error){clearTimeout(timer);signal?.removeEventListener('abort',cancel);video.onloadedmetadata=null;video.onerror=null;error?reject(error):resolve();}
      video.onloadedmetadata=()=>finish();video.onerror=()=>finish(Error('This browser cannot decode the source recording.'));
      signal?.addEventListener('abort',cancel,{once:true});video.src=url;if(signal?.aborted)cancel();
    });
    canvas.width=size?.width??video.videoWidth;canvas.height=size?.height??video.videoHeight;
    if(!canvas.width||!canvas.height)throw Error('The recording has no video frames.');
    const ctx=canvas.getContext('2d');stream=canvas.captureStream(30);
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4_000_000});const chunks=[];
    let failRender=()=>{};
    const finished=new Promise((resolve,reject)=>{
      const fail=error=>{if(stopped)return;stopped=true;if(recorder.state!=='inactive')recorder.stop();reject(error);};
      failRender=fail;
      const abort=()=>fail(abortError());const visibility=()=>{if(document.hidden)fail(Error('Conversion stopped because the tab was hidden. Keep the tab visible and retry.'));};
      signal?.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',visibility);
      detach=()=>{signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',visibility);};
      let bytes=0;
      recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;if(bytes>256*1024*1024)fail(Error('Encoded video exceeds the 256 MiB limit.'));}};
      recorder.onerror=()=>fail(Error('The video encoder failed. Download the original or try another format.'));
      video.onerror=()=>fail(Error('Video decoding failed during conversion.'));
      recorder.onstop=()=>{if(stopped)return;stopped=true;resolve(new Blob(chunks,{type:recorder.mimeType||mime}));};
      video.onended=()=>{if(recorder.state!=='inactive')recorder.stop();};
      const duration=Number.isFinite(video.duration)?video.duration:300;
      timeout=setTimeout(()=>fail(Error('Conversion timed out. The original remains available.')),duration*2000+15000);
      if(signal?.aborted)abort();
    });
    // Cleanup can throw before the final await (for example an immediate abort).
    // Keep the completion promise handled in that case as well.
    finished.catch(()=>{});
    if(signal?.aborted)throw abortError();
    recorder.start(1000);
    const draw=()=>{if(stopped)return;try{if(renderFrame)renderFrame(ctx,video,video.currentTime);else ctx.drawImage(video,0,0);onProgress(video.currentTime,video.duration);raf=requestAnimationFrame(draw);}catch(error){failRender(error);}};
    try{await video.play();draw();}catch(error){if(recorder.state!=='inactive')recorder.stop();throw error;}
    const converted=await finished;
    if(!converted.size)throw Error('The encoder produced an empty video. Download the original instead.');
    return converted;
  }finally{
    stopped=true;cancelAnimationFrame(raf);clearTimeout(timeout);detach();
    if(recorder&&recorder.state!=='inactive')recorder.stop();
    stream?.getTracks().forEach(track=>track.stop());video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);
  }
}
