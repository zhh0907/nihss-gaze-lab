import {ReviewArchive} from './review-archive.js?v=adaptive19';
import {eyeUsable,eyeQualityLabel} from './eye-quality.js';
import {GuidedExam,GuideSpeech,GUIDED_VERSION} from './guided-exam.js?v=adaptive19';
// All media stays in memory until the user downloads it. Detection frames are
// copied BEFORE transfer to the worker; overlays never use a newer camera frame.
export const RECORDING_SCHEMA='gaze-recording-1';
const GUIDED_SAMPLE_RATE_HZ=20;
const OBSERVATION_SAMPLE_RATE_HZ=12;
const GUIDED_PHASE_BYTES=Object.freeze({center:8*1024*1024,left:20*1024*1024,right:20*1024*1024});
export function recordingMime(Recorder=globalThis.MediaRecorder,format='auto') {
  if(!Recorder)return null;
  const types={mp4:['video/mp4;codecs=avc1.42E01E','video/mp4'],webm:['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm']};
  return (format==='auto'?[...types.mp4,...types.webm]:types[format]??[]).find(type=>Recorder.isTypeSupported(type))??null;
}
export const extensionFor=mime=>mime.startsWith('video/mp4')?'mp4':'webm';
const fmt=(n,d=3)=>Number.isFinite(n)?n.toFixed(d):'—';
const phases={center:'Center / rest',left:'Subject looks left',right:'Subject looks right',reflex:'Clinical reflex exam',unlabelled:'Unlabelled / preparation'};

export function drawEyeMarkers(ctx,sample,width,height,{flipX=false}={}) {
  const scale=Math.max(1,width/900),x=p=>(flipX?1-p.x:p.x)*width;
  for(const [side,color] of [['left','#61dcc3'],['right','#80baff']]){
    const eye=sample?.[side];if(!eye?.points)continue;
    const pts=eye.points,good=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
    if(!good(pts.a)||!good(pts.b))continue;
    const usable=eyeUsable(sample,side),label=side==='left'?'L':'R';
    ctx.save();ctx.strokeStyle=usable?color:'#f2bb70';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2*scale;
    ctx.setLineDash(usable?[]:[5*scale,4*scale]);
    ctx.beginPath();ctx.moveTo(x(pts.a),pts.a.y*height);ctx.lineTo(x(pts.b),pts.b.y*height);ctx.stroke();
    ctx.font=`${13*scale}px Segoe UI`;
    if(!usable){
      // Rejected iris landmarks can sit near the center. Do not draw them as an eye position.
      ctx.textAlign='center';ctx.fillText(`${label} ?`,(x(pts.a)+x(pts.b))/2,Math.min(pts.a.y,pts.b.y)*height-10*scale);
      ctx.restore();continue;
    }
    for(const key of ['a','b','iris','top','bottom']){const p=pts[key];if(!good(p))continue;ctx.beginPath();ctx.arc(x(p),p.y*height,key==='iris'?4*scale:2*scale,0,Math.PI*2);ctx.fill();}
    if(good(pts.iris)&&good(pts.top))ctx.fillText(label,x(pts.iris),pts.top.y*height-10*scale);
    ctx.restore();
  }
}

export function recordingCsv(data) {
  const columns=['capture_time_s','analysis_video_time_s','raw_video_time_estimate_s','session_time_s','phase','valid','left_valid','right_valid','left_raw','left_corrected','right_raw','right_corrected','head_yaw_deg','head_pitch_deg','head_roll_deg','inference_ms','reasons'];
  const rows=data.samples.map(s=>[s.recordingTimeSeconds,s.analysisVideoTimeSeconds,s.rawVideoTimeSeconds,s.t,s.phase,s.valid,s.left?.valid,s.right?.valid,s.left?.raw,s.left?.corrected,s.right?.raw,s.right?.corrected,s.head?.yaw,s.head?.pitch,s.head?.roll,s.inferenceMs,[...s.reasons,...(s.left?.reasons??[]).map(r=>'left:'+r),...(s.right?.reasons??[]).map(r=>'right:'+r)].join('|')]);
  const escape=value=>`"${String(value??'').replaceAll('"','""')}"`;
  return [columns,...rows].map(row=>row.map(escape).join(',')).join('\r\n');
}

function makeRecorder(stream,mimeType,onError,onBytes) {
  const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:3_000_000});
  const chunks=[];let error=null;
  const done=new Promise(resolve=>{
    recorder.ondataavailable=({data})=>{if(data.size){chunks.push(data);onBytes(data.size);}};
    recorder.onerror=event=>{error=event.error?.message??'Browser encoder failed';onError(error);};
    recorder.onstop=()=>resolve({blob:new Blob(chunks,{type:recorder.mimeType||mimeType}),error});
  });
  return {recorder,done,stream};
}

export class GazeRecorder {
  constructor({onState=()=>{},onClip=()=>{},onError=()=>{},onPrompt=()=>{},onGuideEnd=()=>{},guideSpeakerFactory=()=>new GuideSpeech()}={}) {
    this.onState=onState;this.onClip=onClip;this.onError=onError;this.current=null;this.finishing=null;
    this.onPrompt=onPrompt;this.onGuideEnd=onGuideEnd;this.guideSpeakerFactory=guideSpeakerFactory;
  }
  get active(){return !!this.current && !this.current.stopping;}
  get busy(){return !!this.current || !!this.finishing;}
  get id(){return this.active?this.current.id:null;}
  get supported(){return !!recordingMime() && typeof HTMLCanvasElement.prototype.captureStream==='function';}

  start({stream,video,sessionOriginPerf,metadata,phase,format='auto',guided=false}) {
    if(this.busy)throw Error('The previous clip is still being finalized. Try again shortly.');
    if(!this.supported)throw Error('Recording is unavailable in this browser. Try a browser with MediaRecorder and canvas capture support.');
    if(!stream?.getVideoTracks().some(t=>t.readyState==='live') || !video.videoWidth)throw Error('Start the camera and wait for detection first.');
    const guideSpeaker=guided?this.guideSpeakerFactory():null;
    if(guideSpeaker?.supported===false)throw Error('Voice guidance is unavailable in this browser. Use a browser with speech support and restart the exam.');
    const mime=recordingMime(globalThis.MediaRecorder,format),canvas=document.createElement('canvas');
    if(!mime)throw Error(`${format.toUpperCase()} recording is unavailable in this browser. Choose another format.`);
    const scale=Math.min(1,1280/video.videoWidth,960/video.videoHeight);
    const width=Math.round(video.videoWidth*scale/2)*2,frameHeight=Math.round(video.videoHeight*scale/2)*2;
    canvas.width=width;canvas.height=frameHeight+144;
    const reviewObservation=guided&&GUIDED_VERSION==='guided-exam-v4';
    const reviewWindowed=reviewObservation||(guided&&GUIDED_VERSION==='guided-exam-v3');
    const item={id:crypto.randomUUID(),canvas,frameHeight,width,metadata:structuredClone(metadata),
      startedAt:new Date().toISOString(),phase,frames:[],events:[],errors:[],bytes:0,stopping:false,
      reviewWindowed,reviewObservation,
      sampleRateLimitHz:reviewObservation?OBSERVATION_SAMPLE_RATE_HZ:reviewWindowed?GUIDED_SAMPLE_RATE_HZ:null,lastSampleTime:null,
      reviewArchive:new ReviewArchive(48*1024*1024,{phaseQuotas:reviewWindowed?GUIDED_PHASE_BYTES:null})};
    this.current=item;
    const onBytes=n=>{item.bytes+=n;if(item.bytes>256*1024*1024)this.stop('size-limit');};
    const onError=message=>{item.errors.push(message);this.onError(message);this.stop('encoder-error');};
    try{
      item.ctx=canvas.getContext('2d');
      // Initial frame explicitly carries no eye measurements; no previous result
      // is borrowed from before the recording started.
      item.ctx.save();
      if(metadata.source.inputMirrored){item.ctx.translate(width,0);item.ctx.scale(-1,1);}
      item.ctx.drawImage(video,0,144,width,frameHeight);item.ctx.restore();
      this.drawHud(item,null,0);
      item.analysisStream=canvas.captureStream(30);
      // Clone only video tracks. Ending this recording never stops the camera.
      item.rawStream=new MediaStream(stream.getVideoTracks().map(track=>track.clone()));
      item.analysis=makeRecorder(item.analysisStream,mime,onError,onBytes);
      item.raw=makeRecorder(item.rawStream,mime,onError,onBytes);
      item.startedPerf=performance.now();item.startSessionTime=(item.startedPerf-sessionOriginPerf)/1000;
      item.analysis.recorder.start(1000);
      item.rawStartedPerf=performance.now();item.raw.recorder.start(1000);
      item.events.push({type:'start',recordingTimeSeconds:0,phase});
      // Keep this synchronous: the first spoken cue must remain inside the
      // Start exam user gesture for Safari and other mobile speech engines.
      if(guided)item.guide=new GuidedExam({originPerf:item.rawStartedPerf,onPrompt:this.onPrompt,speaker:guideSpeaker});
      item.timer=setInterval(()=>{
        const now=performance.now(),elapsed=(now-item.startedPerf)/1000;
        const guide=item.guide?.tick(now);
        if(guide&&guide.status!=='running'){
          const reason=guide.status==='complete'?'guided-complete':'guided-interrupted';
          const detail=item.guide.failureReason??null;
          if(detail)this.onError('Voice guidance stopped. Check device volume and restart the exam.');
          this.stop(reason);queueMicrotask(()=>this.onGuideEnd(reason,detail));return;
        }
        this.onState({state:'recording',elapsed,frames:item.frames.length});
        if(elapsed>=300)this.stop('time-limit');
      },250);
      this.onState({state:'recording',elapsed:0,frames:0});
    }catch(error){
      guideSpeaker?.cancel();
      for(const r of [item.analysis,item.raw])if(r?.recorder.state==='recording')r.recorder.stop();
      for(const s of [item.analysisStream,item.rawStream])s?.getTracks().forEach(t=>t.stop());
      this.current=null;throw error;
    }
  }

  wantsFrame(t){
    const item=this.current;
    if(!this.active||!Number.isFinite(t)||t<item.startSessionTime)return false;
    // Select the sample and its image together. Archiving every Nth image while
    // retaining every sample would break adjacent checked-frame coverage.
    return !item.sampleRateLimitHz||item.lastSampleTime===null||t-item.lastSampleTime>=1/item.sampleRateLimitHz-1e-9;
  }

  capturePhase(sessionTime){
    const item=this.current;
    if(!this.active||!item.guide)return {phase:'unlabelled',phaseStart:0};
    const rawOrigin=item.startSessionTime+(item.rawStartedPerf-item.startedPerf)/1000;
    if(item.reviewObservation){
      const observation=item.guide.observationAt(sessionTime-rawOrigin);
      return observation?{phase:observation.phase,phaseStart:rawOrigin+observation.start}:{phase:'unlabelled',phaseStart:0};
    }
    const p=item.guide.phaseAt(sessionTime-rawOrigin);
    return {phase:p.phase,phaseStart:p.phase==='unlabelled'?0:rawOrigin+p.phaseStart};
  }

  addFrame(image,sample,id) {
    try{
      const item=this.current;
      if(!image || !this.wantsFrame(sample.t) || id!==item.id)return;
      const renderedAt=performance.now();
      const frame={...structuredClone(sample),
        recordingTimeSeconds:sample.t-item.startSessionTime,
        analysisVideoTimeSeconds:(renderedAt-item.startedPerf)/1000,
        rawVideoTimeSeconds:sample.t-item.startSessionTime-(item.rawStartedPerf-item.startedPerf)/1000};
      if(frame.rawVideoTimeSeconds<0)return;
      if(item.guide){const stage=this.capturePhase(sample.t);frame.phase=stage.phase;frame.phaseStart=stage.phaseStart;}
      if(item.reviewWindowed){
        const window=item.reviewObservation?item.guide.observationAt(frame.rawVideoTimeSeconds):item.guide.analysisAt(frame.rawVideoTimeSeconds);
        frame.recordScope=frame.reviewScope=window?(item.reviewObservation?'observation':'analysis'):'buffer';
        if(window)item.reviewArchive.add(image,item.frames.length,window.phase);
      }else item.reviewArchive.add(image,item.frames.length,frame.phase??'unlabelled');
      item.ctx.drawImage(image,0,144,item.width,item.frameHeight);
      item.ctx.save();item.ctx.translate(0,144);
      drawEyeMarkers(item.ctx,sample,item.width,item.frameHeight);item.ctx.restore();
      this.drawHud(item,frame,frame.analysisVideoTimeSeconds);
      item.frames.push(frame);
      item.lastSampleTime=sample.t;
    }finally{image?.close();}
  }

  drawHud(item,sample,time) {
    const {ctx,width}=item,y=0;
    ctx.fillStyle='#0b1520';ctx.fillRect(0,y,width,144);
    const font=Math.max(13,Math.min(20,width/46));ctx.font=`${font}px Segoe UI, Microsoft YaHei`;
    ctx.fillStyle='#cee6ec';
    ctx.fillText(`GAZE LAB · ${time.toFixed(2)}s · ${phases[sample?.phase??item.phase]??'Unlabelled'}`,16,y+28,width-32);
    ctx.fillStyle=sample?.valid?'#77e0bf':'#ffcc7d';
    const quality=sample?`L: ${eyeQualityLabel(sample,'left')} · R: ${eyeQualityLabel(sample,'right')}`:'Waiting for this clip to be analyzed';
    ctx.fillText(quality,16,y+52,width-32);
    // Rejected estimates remain in JSON for troubleshooting, never as valid-looking video positions.
    ctx.fillStyle='#61dcc3';ctx.fillText(`Left L: ${eyeUsable(sample,'left')?fmt(sample.left.corrected):'—'}`,16,y+78);
    ctx.fillStyle='#80baff';ctx.fillText(`Right R: ${eyeUsable(sample,'right')?fmt(sample.right.corrected):'—'}`,Math.max(175,width*.28),y+78);
    ctx.fillStyle='#a5bacc';const head=sample?.head;
    ctx.fillText(`Head Y/P/R: ${head?[head.yaw,head.pitch,head.roll].map(n=>fmt(n,1)+'°').join(' / '):'—'}`,16,y+104,width-32);
    ctx.fillText(sample?`Sample ${sample.recordingTimeSeconds.toFixed(3)}s · ? / — = unavailable, not center`:'? / — = unavailable, not center',16,y+130,width-32);
  }

  markPhase(phase,sessionTime){
    if(!this.active)return;
    this.current.phase=phase;
    this.current.events.push({type:'phase',phase,recordingTimeSeconds:sessionTime-this.current.startSessionTime});
  }

  stop(reason='user') {
    if(this.finishing)return this.finishing;
    const item=this.current;if(!item)return Promise.resolve(null);
    item.stopping=true;clearInterval(item.timer);
    const endPerf=performance.now(),duration=(endPerf-item.startedPerf)/1000;
    const guidedExam=item.guide?.finish(endPerf,reason)??null;
    item.events.push({type:'stop',recordingTimeSeconds:duration,reason});
    this.onState({state:'finalizing',elapsed:duration,frames:item.frames.length,reason});
    // Freeze metadata now. A subsequent input reset must not relabel old media.
    const data={schema:RECORDING_SCHEMA,...item.metadata,recording:{id:item.id,startedAt:item.startedAt,durationSeconds:duration,
      startSessionTimeSeconds:item.startSessionTime,endSessionTimeSeconds:item.startSessionTime+duration,stopReason:reason,
      rawStartsAfterAnalysisSeconds:(item.rawStartedPerf-item.startedPerf)/1000,
      analysisWidth:item.canvas.width,analysisHeight:item.canvas.height,analysisFrameHeight:item.frameHeight,analysisFrameOffsetY:144,
      rawInputMirrored:item.metadata.source.inputMirrored??false,analysisMirrored:false,audio:false,
      sampleRateLimitHz:item.sampleRateLimitHz,
      reviewArchivePolicy:{strategy:item.reviewObservation?'prompt-response-observation':item.reviewWindowed?'fixed-analysis-windows':'all-recorded-samples',
        phaseBudgetsBytes:item.reviewWindowed?{...GUIDED_PHASE_BYTES}:null,limitBytes:item.reviewArchive.limit,
        maximumImageSide:1280,jpegQuality:.94,
        sampling:'Recorded samples and their source images are selected together. Live tracking and raw video are not rate-limited by this policy.'},
      guidedExam,
      timing:'Capture and canvas-presentation times share a monotonic browser clock. Video offsets are estimates, not hardware/encoder frame timestamps. Analysis frames are held between detections; raw video preserves camera motion.'},
      samples:item.frames,events:item.events,errors:item.errors};
    for(const r of [item.analysis,item.raw])if(r.recorder.state!=='inactive')r.recorder.stop();
    this.finishing=Promise.all([item.analysis.done,item.raw.done,item.reviewArchive.finish()]).then(([analysis,raw,reviewFrames])=>{
      data.recording.analysisMime=analysis.blob.type;data.recording.rawMime=raw.blob.type;
      if(!analysis.blob.size||!raw.blob.size)data.errors.push('Empty media: recording may have ended before a video frame was encoded.');
      const archiveStats=item.reviewArchive.summary();
      data.recording.selfCheckFrameCoverage={...archiveStats,total:item.frames.length,required:archiveStats.requested,
        bufferSamples:item.reviewWindowed?item.frames.filter(frame=>frame.reviewScope==='buffer').length:0,
        strategy:data.recording.reviewArchivePolicy.strategy};
      const clip={data,analysis:analysis.blob,raw:raw.blob,reviewFrames};
      this.onClip(clip);return clip;
    }).catch(error=>{this.onError(error.message);return null;}).finally(()=>{
      for(const s of [item.analysisStream,item.rawStream])s.getTracks().forEach(t=>t.stop());
      this.current=null;this.finishing=null;this.onState({state:'idle',elapsed:duration,frames:item.frames.length});
    });
    return this.finishing;
  }
}
