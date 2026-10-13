import {CHECK_VERSION,SIDES,eyeAppearance,compareEye} from './self-check-core.js';
import {bitmapWithDeadline} from './frame-capture.js';

export async function runSelfCheck(clip,{signal,onProgress=()=>{}}={}) {
  const archive=clip.reviewFrames;
  if(!archive?.length)throw Error('No synchronized clean frames are available for this clip. Record a new clip to use image self-check.');
  const worker=new Worker('./self-check-worker.js?v=review7');
  let nextId=0,pending=null;
  const abort=()=>{pending?.reject(new DOMException('Self-check stopped.','AbortError'));worker.terminate();};
  signal?.addEventListener('abort',abort,{once:true});
  function request(message,transfer=[]){
    if(signal?.aborted)return Promise.reject(new DOMException('Self-check stopped.','AbortError'));
    const id=++nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Image recheck timed out. You can retry.')),45000);
      pending={reject};
      worker.onmessage=({data})=>{if(data.id!==id)return;clearTimeout(timer);pending=null;data.error?reject(Error(data.error)):resolve(data);};
      worker.onerror=e=>{clearTimeout(timer);pending=null;reject(Error(e.message||'Image recheck failed.'));};
      worker.postMessage({...message,id},transfer);
      pending.reject=e=>{clearTimeout(timer);reject(e);};
    });
  }
  const report={schema:'gaze-image-review-1',version:CHECK_VERSION,createdAt:new Date().toISOString(),sourceRecordingId:clip.data.recording.id,
    clinicalUse:false,originalDataModified:false,method:'Stateless full-frame and mirrored-image detections plus iris-image support check',
    limitations:['Same model family as live tracking; agreement does not prove correctness.','Image-support thresholds are experimental and can fail on reflections, eyelids or light irises.','No automatic NIHSS rescore.','Only saved analysis frames are checked; motion between them is not inspected.'],
    frames:[],coverage:{checked:0,total:clip.data.samples.length,unchecked:clip.data.samples.length},reviewer:''};
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  try{
    onProgress(0,archive.length);await request({type:'init'});
    for(const entry of archive){
      if(signal?.aborted)throw new DOMException('Self-check stopped.','AbortError');
      const original=clip.data.samples[entry.sourceIndex];if(!original)continue;
      const image=await bitmapWithDeadline(()=>createImageBitmap(entry.blob));
      canvas.width=image.width;canvas.height=image.height;ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      let alternatives;
      try{({alternatives}=await request({type:'frame',image,config:clip.data.config},[image]));}
      finally{image.close();}
      const frame={sourceIndex:entry.sourceIndex,time:original.recordingTimeSeconds,phase:original.phase};
      for(const side of SIDES)frame[side]=compareEye(original,alternatives,side,{
        original:eyeAppearance(pixels,original[side]),alternatives:alternatives.map(s=>eyeAppearance(pixels,s[side]))});
      frame.flagged=SIDES.some(side=>frame[side].flagged);
      report.frames.push(frame);
      onProgress(report.frames.length,archive.length);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    report.coverage.checked=report.frames.length;report.coverage.unchecked=report.coverage.total-report.frames.length;
    report.flaggedFrames=report.frames.filter(f=>f.flagged).length;
    report.suggestions=report.frames.reduce((n,f)=>n+SIDES.filter(s=>f[s].proposal).length,0);
    return report;
  }finally{signal?.removeEventListener('abort',abort);worker.terminate();}
}
