import {cameraOrientation} from './camera-orientation.js';
import {runSelfCheck} from './self-check.js?v=segment8';
import {createSelfCheckUI} from './self-check-ui.js?v=segment8';
import {simplifyUI} from './simplify-ui.js';
import {eyeUsable,eyeQualityLabel} from './eye-quality.js';
import {DEFAULTS,VERSION,measureFrame,DisplayFilter} from './geometry.js?v=quality5';
import {parseIntervals,phaseAt,summarize,scoreNIHSS} from './assessment.js';
import {demoInput} from './fixtures.js';
import {GazeRecorder,drawEyeMarkers,extensionFor,recordingCsv,recordingMime} from './recording.js?v=segment8';
import {convertVideo} from './video-export.js?v=repair6';
import {startLiveLoop} from './live-loop.js?v=live3';
import {captureVideoFrame,bitmapWithDeadline} from './frame-capture.js?v=live3';

// Non-camera demos still work on HTTP; camera access is checked separately.
const sessionUUID=()=>globalThis.crypto?.randomUUID?.()??'session-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const $=id=>document.getElementById(id);
for(const option of $('recordFormat').options){option.disabled=!recordingMime(globalThis.MediaRecorder,option.value);if(option.disabled)option.textContent+=' · unavailable';}
$('recordFormat').value=Array.from($('recordFormat').options).find(o=>!o.disabled)?.value??'';
$('formatHint').textContent='Choose before recording. MP4 and WebM availability depends on this browser. You can also convert supported formats in Clips.';
let activeConversion=null,preparedDownload=null;
function clearPreparedDownload(){preparedDownload?.();preparedDownload=null;}
const video=$('video'),overlay=$('overlay'),filter=new DisplayFilter();
let source='none',sourceInfo={},samples=[],summary=summarize([]),sessionId=sessionUUID();
let config={...DEFAULTS},worker=null,stream=null,fileUrl=null,generation=0,running=false;
let nextId=0,pending=new Map(),stopLiveLoop=null,healthTimer=null,startTime=0,phaseStart=0,frameNo=0;
let lastTrackingUpdate=0,recentUpdates=[];
let intervals=[],captureCanvas=document.createElement('canvas');
let clinicalHistory=[];
let cameraReady=false,recordedClips=[];
const recording=new GazeRecorder({
  onState:state=>{
    $('recordIndicator').textContent=state.state==='recording'?`● Recording ${state.elapsed.toFixed(1)} s · ${state.frames} analysis frames`:state.state==='finalizing'?'Finalizing recording…':'Recording saved. Open Clips to replay or download.';
    $('recordIndicator').classList.toggle('recording',state.state==='recording');
    // State callbacks occur inside the recorder's transition.
    queueMicrotask(refreshRecordingControls);
  },
  onClip:clip=>{recordedClips.push(clip);renderRecordings();enqueueSelfCheck(clip);window.dispatchEvent(new Event('clipcreated'));},
  onError:message=>{$('recordIndicator').textContent='Recording error: '+message;},
});
const reasonNames={'no-face':'No face detected','multiple-faces':'Multiple faces','pose-unavailable':'Head pose unavailable','head-out-of-range':'Head pose outside current limits','eye-unavailable':'Eye landmarks missing','eye-out-of-frame':'Eye outside frame','eye-too-small':'Eye too small in image','blink-or-occlusion':'Blink / occlusion','iris-outside-eye':'Iris location invalid'};
const phaseNames={center:'Center / rest',left:'Subject looks left',right:'Subject looks right',reflex:'Clinical reflex exam',unlabelled:'Unlabelled'};
const fmt=(v,n=3)=>Number.isFinite(v)?v.toFixed(n):'—';

function observation(){return {reviewer:$('reviewer').value.trim(),examAdequate:$('examAdequate').value,finding:$('finding').value,overcome:$('overcome').value,reflexAssessed:$('reflexAssessed').value,useVideoEvidence:$('evidenceSource').value==='video'};}
function status(message){$('status').textContent=message;}
function trackingHealth(){
  const now=performance.now(),age=lastTrackingUpdate?now-lastTrackingUpdate:now-startTime;
  recentUpdates=recentUpdates.filter(t=>now-t<1000);
  if(age>1500){
    $('trackingHealth').textContent=`Tracking delayed · no update for ${(age/1000).toFixed(1)} s`;
    $('trackingHealth').classList.add('warning');
    $('leftValue').textContent=$('rightValue').textContent=$('headValue').textContent='—';
    for(const side of ['left','right']){$(side+'Quality').textContent='Tracking delayed';$(side+'Quality').classList.add('warning');}
    filter.reset();overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  }else{
    $('trackingHealth').textContent=lastTrackingUpdate?`Tracking · ${samples.length} updates · ${recentUpdates.length} / s`:'Waiting for the first eye-tracking result…';
    $('trackingHealth').classList.remove('warning');
  }
}
function setRunning(value){
  running=value;
  for(const id of ['cameraStart','cameraFacing','videoFile','demo','demoScenario','fov','inputMirrored','intervals']) $(id).disabled=value;
  $('analyze').disabled=value || source!=='file';$('stop').disabled=!value;
  $('phase').disabled=source==='file'||source==='demo';
  refreshRecordingControls();
}
function resetClinical(){
  for(const id of ['examAdequate','finding','overcome','reflexAssessed']) $(id).value='unknown';
  clinicalHistory=[];
}
function clearMeasurements(){
  samples=[];summary=summarize([]);filter.reset();sessionId=sessionUUID();resetClinical();
  $('trackingHealth').hidden=source!=='camera';$('trackingHealth').textContent='Waiting for eye tracking…';$('trackingHealth').classList.remove('warning');
  $('exportJson').disabled=true;$('exportCsv').disabled=true;
  $('leftValue').textContent=$('rightValue').textContent=$('headValue').textContent='—';
  for(const side of ['left','right']){$(side+'Quality').textContent='Waiting';$(side+'Quality').classList.remove('warning');}
  $('coverageValue').textContent='0 / 0';$('progress').value=0;updateSummary();drawTrace();
}
function disposeWorker(){
  worker?.terminate();worker=null;
  for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(Error('Operation stopped.'));}pending.clear();
}
function stop(){
  recording.stop('camera-stopped');cameraReady=false;
  generation++;stopLiveLoop?.();stopLiveLoop=null;clearInterval(healthTimer);healthTimer=null;disposeWorker();
  if(source==='camera'){$('trackingHealth').textContent=`Tracking stopped · ${samples.length} updates`;video.hidden=true;$('empty').hidden=false;$('empty').textContent='Camera stopped. Open Clips to review.';$('sourceBadge').textContent='Camera stopped';overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);}
  stream?.getTracks().forEach(t=>t.stop());stream=null;
  video.pause();if(video.srcObject)video.srcObject=null;video.controls=source==='file';
  setRunning(false);filter.reset();updateSummary();
}
function cleanupInput(){
  stop();if(fileUrl){URL.revokeObjectURL(fileUrl);fileUrl=null;}
  video.removeAttribute('src');video.load();video.hidden=true;
  overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
}
function readConfig(){
  const fov=Number($('fov').value);
  if(!Number.isFinite(fov)||fov<20||fov>120) throw Error('Vertical field of view must be 20–120 degrees.');
  config={...DEFAULTS,verticalFov:fov};
}
function waitFor(target,event,action,timeout=20000){
  return new Promise((resolve,reject)=>{
    const finish=(error)=>{clearTimeout(timer);target.removeEventListener(event,ok);target.removeEventListener('error',bad);error?reject(error):resolve();};
    const ok=()=>finish(),bad=()=>finish(Error('Cannot decode this video. Use an MP4 or WebM file supported by this browser.'));
    const timer=setTimeout(()=>finish(Error('Video decoding timed out.')),timeout);
    target.addEventListener(event,ok,{once:true});target.addEventListener('error',bad,{once:true});
    try{action();}catch(e){finish(e);}
  });
}
async function initWorker(token){
  status('Loading local face and iris model…');
  worker=new Worker('./face-worker.js');
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete('ready');reject(Error('Model initialization timed out.'));},45000);
    pending.set('ready',{resolve,reject,timer});
  });
  worker.onmessage=({data})=>{
    if(token!==generation)return;
    const id=data.type==='ready'?'ready':data.id ?? 'ready';
    const item=pending.get(id);if(!item)return;
    clearTimeout(item.timer);pending.delete(id);
    if(data.type==='error')item.reject(Error(data.message));else item.resolve(data);
  };
  worker.onerror=e=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error(e.message||'Detector failed'));}pending.clear();};
  worker.postMessage({type:'init'});await ready;
}
async function bitmap(){
  // Canonical, unmirrored coordinates throughout; never swap anatomical eyes.
  return captureVideoFrame(video,captureCanvas,source==='file'&&$('inputMirrored').checked);
}
async function detect(t,token){
  const image=await bitmap();
  if(token!==generation){image.close();throw Error('Operation stopped.');}
  const recordingId=recording.wantsFrame(t)?recording.id:null;
  let recordingImage=null;
  try{
  if(recordingId)recordingImage=await bitmapWithDeadline(()=>createImageBitmap(image));
  if(token!==generation){image.close();throw Error('Operation stopped.');}
  const id=++nextId;
  const response=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Frame detection timed out. Stop and try again.'));},20000);
    pending.set(id,{resolve,reject,timer});
    worker.postMessage({type:'frame',id,image,timestamp:t*1000+1},[image]);
  });
  return {...response,recordingImage,recordingId};
  }catch(error){recordingImage?.close();image.close();throw error;}
}
function accept(result,t,phase,phaseStartValue,inferenceMs=null,truth=null){
  const width=result.frameSize?.width??(source==='demo'?1280:video.videoWidth),height=result.frameSize?.height??(source==='demo'?720:video.videoHeight);
  const measured=measureFrame(result,width,height,config);
  const sample={t,phase,phaseStart:phaseStartValue,...measured,inferenceMs,frameSize:{width,height}};
  if(truth)sample.syntheticTruth=truth;
  samples.push(sample);const smoothed=filter.step(measured,t);
  if(source==='camera'){lastTrackingUpdate=performance.now();recentUpdates.push(lastTrackingUpdate);trackingHealth();}
  $('leftValue').textContent=smoothed?fmt(smoothed[0]):'—';$('rightValue').textContent=smoothed?fmt(smoothed[1]):'—';
  for(const side of ['left','right']){$(side+'Quality').textContent=eyeQualityLabel(measured,side);$(side+'Quality').classList.toggle('warning',!eyeUsable(measured,side));}
  $('headValue').textContent=measured.head?['yaw','pitch','roll'].map(k=>fmt(measured.head[k],1)+'°').join(' / '):'—';
  drawOverlay(sample,width,height);
  if(frameNo++%5===0){updateSummary();drawTrace();}
  const reasons=[...measured.reasons,...(measured.left?.reasons??[]),...(measured.right?.reasons??[])];
  status(`${source==='demo'?'Synthetic demo · ':''}${t.toFixed(2)} s · ${phaseNames[phase]} · ${measured.valid?'Both eyes valid':Array.from(new Set(reasons)).map(r=>reasonNames[r]??r).join(' / ')}${inferenceMs===null?'':` · inference ${inferenceMs.toFixed(0)} ms`}`);
  return sample;
}
function previewFlipped(){return source==='camera' && cameraOrientation($('cameraFacing').value,sourceInfo.settings,$('previewFlip').checked).previewMirrored;}
function applyPreviewOrientation(){
  // Input correction and preview orientation are independent. Analysis stays canonical.
  video.style.transform=((source==='file'&&$('inputMirrored').checked)!==previewFlipped())?'scaleX(-1)':'';
}
$('previewFlip').onchange=()=>{
  applyPreviewOrientation();
  const sample=samples.at(-1);
  if(source==='camera' && sample && (!running || performance.now()-lastTrackingUpdate<=1500))drawOverlay(sample,sample.frameSize.width,sample.frameSize.height);
};
function drawOverlay(sample,width,height){
  overlay.width=width;overlay.height=height;const ctx=overlay.getContext('2d');
  if(source==='demo'){ctx.fillStyle='#091520';ctx.fillRect(0,0,width,height);ctx.fillStyle='#94b3c6';ctx.font='22px Segoe UI';ctx.fillText('SYNTHETIC GEOMETRY · detector bypassed',30,42);}
  drawEyeMarkers(ctx,sample,width,height,{flipX:previewFlipped()});
}
function drawTrace(){
  const canvas=$('trace'),width=canvas.clientWidth||800,height=190,dpr=devicePixelRatio||1;
  canvas.width=width*dpr;canvas.height=height*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const end=Math.max(10,samples.at(-1)?.t??0),start=Math.max(0,end-25),left=42,right=width-12,top=18,bottom=height-26;
  const x=t=>left+(t-start)/(end-start)*(right-left),y=v=>top+(1-v)/2*(bottom-top);
  ctx.font='11px Segoe UI';ctx.fillStyle='#88a2b6';
  for(const v of [-1,-.5,0,.5,1]){ctx.strokeStyle='#283c4c';ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(right,y(v));ctx.stroke();ctx.fillText(v.toFixed(1),5,y(v)+4);}
  for(let t=Math.ceil(start/5)*5;t<=end;t+=5)ctx.fillText(`${t}s`,x(t),height-5);
  const visible=samples.filter(s=>s.t>=start);
  for(const [side,color] of [['left','#61dcc3'],['right','#80baff']])for(const field of ['raw','corrected']){
    ctx.strokeStyle=color;ctx.lineWidth=field==='raw'?1:2;ctx.globalAlpha=field==='raw'?.45:1;ctx.setLineDash(field==='raw'?[4,4]:[]);ctx.beginPath();let previous=null;
    for(const s of visible){const v=s[side]?.[field];if(!eyeUsable(s,side)||!Number.isFinite(v)){previous=null;continue;}const px=x(s.t),py=y(v);if(previous && s.t-previous.t<=config.maxSampleGap)ctx.lineTo(px,py);else ctx.moveTo(px,py);previous=s;}ctx.stroke();
  }
  ctx.globalAlpha=1;ctx.setLineDash([]);
}
function flagText(flag){
  if(flag==='possible-resting-deviation')return 'Possible conjugate resting deviation; clinical review required';
  const [side,direction]=flag.split(':');
  if(flag.endsWith('asymmetric-excursion'))return `${side==='left'?'Looking left':'Looking right'}: asymmetric eye excursions`;
  return `${side==='left'?'Left eye':'Right eye'} toward ${direction==='left'?'Left':'Right'}: reduced excursion`;
}
function updateSummary(){
  summary=summarize(samples,config);
  $('coverageValue').textContent=`${summary.validCount} / ${summary.frameCount}`;
  const box=$('evidence');box.replaceChildren();
  const p=document.createElement('p');
  p.className=summary.adequate&&!summary.flags.length?'ok':'warning';
  p.textContent=!summary.adequate?'Insufficient evidence. Complete valid center, left and right phases, then review.':summary.flags.length?'Movement findings requiring review:':'Both eyes moved in both directions. No research thresholds were triggered; this does not establish NIHSS 0.';box.append(p);
  for(const flag of summary.flags){const line=document.createElement('div');line.textContent='• '+flagText(flag);box.append(line);}
  if(source==='demo'){const p=document.createElement('p');p.className='warning';p.textContent='Synthetic landmarks only. No real patient images were analyzed.';box.append(p);}
  $('phaseTable').replaceChildren();
  for(const [phase,row] of Object.entries(summary.phases)){
    const tr=document.createElement('tr');
    for(const v of [phaseNames[phase],fmt(row.validSeconds,2),`${(row.coverage*100).toFixed(0)}%${row.adequate?'':' · insufficient'}`,fmt(row.left.median),fmt(row.right.median)]){const td=document.createElement('td');td.textContent=v;tr.append(td);}
    $('phaseTable').append(tr);
  }
  $('exportJson').disabled=$('exportCsv').disabled=samples.length===0;
  renderDecision();
}
function renderDecision(){
  const decision=scoreNIHSS(observation(),summary);
  $('score').textContent=decision.score===null?'Needs review':`${decision.score} points`;
  const box=$('decisionText');box.replaceChildren();
  if(source==='demo'){const p=document.createElement('p');p.className='warning';p.textContent='Rule practice using synthetic data; not a patient score.';box.append(p);}
  for(const text of [...decision.basis,...decision.missing]){const p=document.createElement('p');p.textContent=text;box.append(p);}
}

$('cameraStart').onclick=async()=>{
  cleanupInput();source='camera';sourceInfo={type:'camera',startedAt:new Date().toISOString(),inputMirrored:false};clearMeasurements();
  $('fileControls').hidden=true;$('phase').value='unlabelled';$('sourceBadge').textContent='Live camera';setRunning(true);const token=generation;
  try{
    readConfig();if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access requires HTTPS on a phone, or localhost on this computer. Open the page in a current browser and allow camera access.');
    status('Requesting camera permission…');const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720},facingMode:{ideal:$('cameraFacing').value}}});
    if(token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;sourceInfo.settings={...stream.getVideoTracks()[0].getSettings()};sourceInfo.orientation=cameraOrientation($('cameraFacing').value,sourceInfo.settings);video.srcObject=stream;if(matchMedia('(max-width:760px)').matches)$('live').scrollIntoView({block:'start'});video.hidden=false;video.controls=false;$('empty').hidden=true;
    applyPreviewOrientation();
    await video.play();if(token!==generation)return;
    sourceInfo.settings={...sourceInfo.settings,width:video.videoWidth,height:video.videoHeight,frameRate:stream.getVideoTracks()[0].getSettings().frameRate};
    sourceInfo.runtime={build:'segment8',browser:navigator.userAgent,frameInput:'canvas-oriented-bitmap'};
    stream.getVideoTracks()[0].onended=()=>{stop();status('Camera disconnected. Collected data can still be exported.');};
    await initWorker(token);if(token!==generation)return;
    startTime=performance.now();phaseStart=0;cameraReady=true;refreshRecordingControls();
    lastTrackingUpdate=0;recentUpdates=[];trackingHealth();healthTimer=setInterval(trackingHealth,500);
    stopLiveLoop=startLiveLoop({video,onMode:mode=>{sourceInfo.runtime.frameScheduler=mode;},onError:e=>{if(token===generation){stop();status(e.message);}},onFrame:async(metadata,frameInfo)=>{
      if(token!==generation)return;
      const t=(performance.now()-startTime)/1000,phase=$('phase').value,start=phaseStart;
      const data=await detect(t,token);
      if(token!==generation){data.recordingImage?.close();return;}
      const sample=accept(data.result,t,phase,start,data.inferenceMs);
      sample.cameraMediaTimeSeconds=metadata?.mediaTime??video.currentTime;
      sample.cameraPresentedFrames=metadata?.presentedFrames??null;
      sample.cameraFrameScheduler=frameInfo.mode;
      recording.addFrame(data.recordingImage,sample,data.recordingId);
      if(t>=300){stop();status('Five-minute session limit reached. Export the collected data.');}
    }});
  }catch(e){if(token===generation){stop();status('Cannot start: '+e.message);}}
};
$('phase').onchange=()=>{if(running && source==='camera'){phaseStart=(performance.now()-startTime)/1000;recording.markPhase($('phase').value,phaseStart);}};
$('stop').onclick=()=>{stop();status('Stopped. Collected data remains available for review and export.');};
$('videoFile').onchange=async()=>{
  const file=$('videoFile').files?.[0];if(!file)return;
  cleanupInput();source='file';sourceInfo={type:'file',name:file.name,bytes:file.size};clearMeasurements();$('intervals').value='';intervals=[];
  $('sourceBadge').textContent='Local video';$('fileControls').hidden=false;const token=generation;setRunning(true);
  try{
    fileUrl=URL.createObjectURL(file);await waitFor(video,'loadedmetadata',()=>{video.src=fileUrl;});if(token!==generation)return;
    // MediaRecorder WebM files may omit duration metadata. Let the decoder find
    // the end before applying the same five-minute limit and seeking to zero.
    if(!Number.isFinite(video.duration)){
      await waitFor(video,'durationchange',()=>{video.currentTime=1e10;});if(token!==generation)return;
      await waitFor(video,'seeked',()=>{video.currentTime=0;});if(token!==generation)return;
    }
    if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>300)throw Error('Select a video with a valid duration of up to 5 minutes.');
    sourceInfo={...sourceInfo,duration:video.duration,width:video.videoWidth,height:video.videoHeight};
    video.hidden=false;video.controls=true;applyPreviewOrientation();$('empty').hidden=true;
    status(`Loaded ${video.duration.toFixed(2)} s video. Preview, label phases, then analyze.`);setRunning(false);
  }catch(e){if(token===generation){source='none';stop();status(e.message);}}
};
$('analyze').onclick=async()=>{
  if(source!=='file'||!fileUrl)return;
  try{readConfig();intervals=parseIntervals($('intervals').value,video.duration);}catch(e){status(e.message);return;}
  stop();clearMeasurements();video.pause();video.controls=false;setRunning(true);const token=generation;
  sourceInfo.inputMirrored=$('inputMirrored').checked;
  try{
    await initWorker(token);if(token!==generation)return;
    const count=Math.ceil(video.duration*15);
    for(let i=0;i<count;i++){
      const t=i/15;if(token!==generation)return;
      if(Math.abs(video.currentTime-t)>.0001 || video.readyState<2)await waitFor(video,'seeked',()=>{video.currentTime=t;});
      if(token!==generation)return;
      const stage=phaseAt(t,intervals),data=await detect(t,token);if(token!==generation)return;
      accept(data.result,t,stage.phase,stage.phaseStart,data.inferenceMs);$('progress').value=(i+1)/count;
    }
    stop();status(`Analysis complete: ${samples.length} samples; ${summary.validCount} samples with both eyes valid. No video was uploaded.`);
  }catch(e){if(token===generation){stop();status('Analysis stopped: '+e.message);}}
};

function runDemo(scenario=$('demoScenario').value){
  cleanupInput();source='demo';sourceInfo={type:'synthetic-landmarks',scenario,detectorBypassed:true,inputMirrored:false};config={...DEFAULTS};clearMeasurements();
  $('sourceBadge').textContent='Synthetic demo · Not a patient';$('fileControls').hidden=true;$('empty').hidden=true;setRunning(false);
  for(let i=0;i<195;i++){
    const t=i/15,d=demoInput(t,scenario);accept(d.result,t,d.phase,d.phaseStart,null,d.truth);
  }
  updateSummary();drawTrace();status('Demo complete. Compare head motion, one-eye limitation and occlusion. Synthetic landmarks bypass the real detector.');
}
$('demo').onclick=()=>runDemo();
for(const id of ['reviewer','examAdequate','finding','overcome','reflexAssessed','evidenceSource']) $(id).addEventListener('change',()=>{
  if(id==='finding'){$('overcome').value='unknown';$('reflexAssessed').value='unknown';}
  clinicalHistory.push({at:new Date().toISOString(),observation:observation()});renderDecision();
});
for(const id of ['fov','inputMirrored','intervals']) $(id).addEventListener('change',()=>{
  if(source==='file'){
    clearMeasurements();overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
    applyPreviewOrientation();
    status('Input parameters or phases changed. Analyze the video again.');
  }
});
function exportObject(){return {
  version:VERSION,sessionId,exportedAt:new Date().toISOString(),source:sourceInfo,
  coordinates:{positive:'subject-left in canonical unmirrored input',units:'iris offset / half eye-corner width',headUnits:'degrees; model estimated',inputUnmirrored:sourceInfo.inputMirrored??false,patientBaselineSubtracted:false},
  config,intervals:source==='file'?intervals:null,summary,observation:observation(),decision:scoreNIHSS(observation(),summary),clinicalHistory,samples,
  limitations:['Generic landmarks; not a validated pathological gaze estimator.','Planar head-pose rectification and assumed intrinsics; not calibrated ocular angles.','No clinical accuracy claim; missing video never implies NIHSS 0.'],
};}

function refreshRecordingControls(){
  $('recordStart').disabled=!recording.supported||!cameraReady||source!=='camera'||!running||recording.busy||recordedClips.length>=3||!!activeConversion;
  $('recordStop').disabled=!recording.active;
  $('recordFormat').disabled=recording.busy;
  if(!recording.supported)$('recordIndicator').textContent='Recording is unavailable in this browser. Try a browser with MediaRecorder and canvas capture support.';
}
$('recordStart').onclick=()=>{
  try{
    const {samples:ignoredSamples,summary:ignoredSummary,observation:ignoredObservation,decision:ignoredDecision,clinicalHistory:ignoredHistory,...metadata}=exportObject();
    if(activeConversion)throw Error('Finish or cancel the video conversion before recording.');
    recording.start({stream,video,sessionOriginPerf:startTime,metadata,phase:$('phase').value,format:$('recordFormat').value});
    refreshRecordingControls();
  }catch(error){$('recordIndicator').textContent='Cannot record: '+error.message;refreshRecordingControls();}
};
$('recordStop').onclick=()=>{stop();status('Clip finished. Segment analysis runs locally; open Clips to review.');};
function saveBlob(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function repairBusyMessage(){return recording.busy?'Stop recording before repairing or exporting a clip.':activeConversion?'Finish or cancel the current video export first.':null;}
async function encodeRepairedVideo(controller,task){
  const message=repairBusyMessage();if(message)throw Error(message);
  clearPreparedDownload();activeConversion=controller;
  document.querySelectorAll('.remove-recording,.repair-run,.repair-reset').forEach(b=>b.disabled=true);refreshRecordingControls();
  try{return await task();}finally{
    if(activeConversion===controller)activeConversion=null;
    document.querySelectorAll('.remove-recording,.repair-run,.repair-reset').forEach(b=>b.disabled=false);refreshRecordingControls();
  }
}
function renderRecordings(){
  clearPreparedDownload();
  for(const clip of recordedClips){clip.repairUi?.dispose();clip.checkUi?.dispose();}
  // Preserve existing object URLs, but detach old players to release decoders.
  const list=$('recordingList');list.querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});list.replaceChildren();
  $('recordingsEmpty').hidden=recordedClips.length>0;
  for(const [i,clip] of recordedClips.entries()){
    clip.analysisUrl??=URL.createObjectURL(clip.analysis);clip.rawUrl??=URL.createObjectURL(clip.raw);
    const {recording:r}=clip.data,details=document.createElement('details');details.className='recorded-clip';details.dataset.recordingId=r.id;details.open=i===recordedClips.length-1;
    const title=document.createElement('summary');title.textContent=`Clip ${i+1} · ${r.durationSeconds.toFixed(1)} s · ${clip.data.samples.length} analysis frames`;details.append(title);
    const player=document.createElement('video');player.controls=true;player.playsInline=true;player.preload='metadata';player.src=clip.analysisUrl;player.className='recording-preview';player.setAttribute('aria-label',`Clip ${i+1} Replay`);
    const playbackBox=document.createElement('details'),playbackTitle=document.createElement('summary');playbackTitle.textContent='Replay video';playbackBox.append(playbackTitle);
    const label=document.createElement('label');label.textContent='Playback version';const select=document.createElement('select');select.setAttribute('aria-label',`Clip ${i+1} Playback version`);
    for(const [value,text] of [['analysis','Analysis video · Same-frame eye markers'],['raw','Raw camera video']])select.add(new Option(text,value));
    const switchPlayback=()=>{player.pause();const url=select.value==='raw'?clip.rawUrl:clip.analysisUrl;if(player.src!==url){player.src=url;player.load();}};
    select.onchange=switchPlayback;
    const checkUi=createSelfCheckUI({clip,clipNumber:i+1,retry:enqueueSelfCheck,saveBlob,
      busyMessage:repairBusyMessage,encode:encodeRepairedVideo,
      prepareDownload:cleanup=>{clearPreparedDownload();preparedDownload=cleanup;}});clip.checkUi=checkUi;
    const buttons=document.createElement('div');buttons.className='buttons';const base=`gaze_recording_${r.id.slice(0,8)}`;
    const addButton=(text,action)=>{const b=document.createElement('button');b.textContent=text;b.onclick=action;buttons.append(b);};
    const exportLabel=document.createElement('label');exportLabel.textContent='Download format';exportLabel.htmlFor=`format-${r.id}`;
    const exportFormat=document.createElement('select');exportFormat.id=exportLabel.htmlFor;exportFormat.setAttribute('aria-label',`Clip ${i+1} Download format`);
    exportFormat.add(new Option(`Original · ${extensionFor(clip.analysis.type).toUpperCase()} (no conversion)`,'original'));
    for(const format of ['mp4','webm']){const option=new Option(format.toUpperCase(),format);option.disabled=!recordingMime(globalThis.MediaRecorder,format);if(option.disabled)option.textContent+=' · unavailable';exportFormat.add(option);}
    const exportStatus=document.createElement('p');exportStatus.className='hint';exportStatus.setAttribute('role','status');
    exportStatus.textContent='Original is the exact recording. Other formats are re-encoded locally at up to 30 fps; allow roughly the video duration and keep this tab visible.';
    const cancel=document.createElement('button');cancel.textContent='Cancel conversion';cancel.hidden=true;
    const readyDownload=document.createElement('button');readyDownload.hidden=true;
    const exportClip=async(version)=>{
      if(activeConversion){exportStatus.textContent='Another conversion is running. Finish or cancel it first.';return;}
      const blob=clip[version],format=exportFormat.value==='original'?extensionFor(blob.type):exportFormat.value;
      if(extensionFor(blob.type)===format){saveBlob(blob,`${base}_${version}.${format}`);return;}
      if(recording.busy){exportStatus.textContent='Stop recording before converting. The original can be downloaded immediately.';return;}
      clearPreparedDownload();
      const controller=new AbortController();activeConversion=controller;refreshRecordingControls();cancel.hidden=false;cancel.onclick=()=>controller.abort();exportFormat.disabled=true;
      buttons.querySelectorAll('button').forEach(button=>button.disabled=true);document.querySelectorAll('.remove-recording,.repair-run,.repair-reset').forEach(button=>button.disabled=true);
      try{
        const converted=await convertVideo(blob,format,{signal:controller.signal,onProgress:(t,duration)=>{exportStatus.textContent=`Converting to ${format.toUpperCase()} · ${t.toFixed(1)}${Number.isFinite(duration)?' / '+duration.toFixed(1):''} s. Keep this tab visible.`;}});
        // A fresh tap keeps the final download inside a user gesture on phones.
        readyDownload.textContent=`Save ${format.toUpperCase()} ${version} video`;readyDownload.hidden=false;
        readyDownload.onclick=()=>{saveBlob(converted,`${base}_${version}.${extensionFor(converted.type)}`);clearPreparedDownload();exportStatus.textContent='Download requested. The original recording and eye data are unchanged.';};
        preparedDownload=()=>{readyDownload.hidden=true;readyDownload.onclick=null;};
        exportStatus.textContent=`${format.toUpperCase()} ready. Tap Save below to download. The original recording and eye data are unchanged.`;
      }catch(error){exportStatus.textContent=error.message;}
      finally{activeConversion=null;cancel.hidden=true;exportFormat.disabled=false;buttons.querySelectorAll('button').forEach(button=>button.disabled=false);document.querySelectorAll('.remove-recording,.repair-run,.repair-reset').forEach(button=>button.disabled=false);refreshRecordingControls();}
    };
    addButton('Download analysis video',()=>exportClip('analysis'));
    addButton('Download raw video',()=>exportClip('raw'));
    addButton('Eye data JSON',()=>saveBlob(new Blob([JSON.stringify(clip.data,null,2)],{type:'application/json'}),`${base}_eyes.json`));
    addButton('Eye data CSV',()=>saveBlob(new Blob([recordingCsv(clip.data)],{type:'text/csv;charset=utf-8'}),`${base}_eyes.csv`));
    const hint=document.createElement('p');hint.className='hint';hint.textContent=`${new Date(r.startedAt).toLocaleString('en-US')} · No audio · Eye positions are normalized. Analysis updates at detection speed; raw video preserves continuous motion.`;
    if(clip.data.errors.length){const error=document.createElement('p');error.className='warning';error.textContent='Recording encountered errors: '+clip.data.errors.join('；');details.append(error);}
    const remove=document.createElement('button');remove.textContent='Remove clip';remove.className='remove-recording';remove.onclick=()=>{clip.checkController?.abort();clip.checkUi?.dispose();clip.repairUi?.dispose();player.pause();URL.revokeObjectURL(clip.analysisUrl);URL.revokeObjectURL(clip.rawUrl);recordedClips=recordedClips.filter(c=>c!==clip);renderRecordings();refreshRecordingControls();};
    const downloads=document.createElement('details'),downloadTitle=document.createElement('summary');downloadTitle.textContent='Downloads';downloads.append(downloadTitle,exportLabel,exportFormat,buttons,exportStatus,cancel,readyDownload,hint,remove);
    playbackTitle.textContent='Original recording files';
    playbackBox.append(label,select,player);details.append(checkUi.element,playbackBox,downloads);list.append(details);
  }
  $('recordingsLimit').hidden=recordedClips.length<3;
  refreshRecordingControls();
}
function download(contents,type,extension){const url=URL.createObjectURL(new Blob([contents],{type})),a=document.createElement('a');a.href=url;a.download=`gaze_${source}_${sessionId.slice(0,8)}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportJson').onclick=()=>download(JSON.stringify(exportObject(),null,2),'application/json','json');
$('exportCsv').onclick=()=>{
  const header=['time_s','phase','phase_start_s','valid','left_valid','right_valid','left_raw','left_corrected','right_raw','right_corrected','head_yaw_deg','head_pitch_deg','head_roll_deg','reasons','inference_ms'];
  const escape=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const rows=samples.map(s=>[s.t,s.phase,s.phaseStart,s.valid,s.left?.valid,s.right?.valid,s.left?.raw,s.left?.corrected,s.right?.raw,s.right?.corrected,s.head?.yaw,s.head?.pitch,s.head?.roll,[...s.reasons,...(s.left?.reasons??[]).map(r=>'left:'+r),...(s.right?.reasons??[]).map(r=>'right:'+r)].join('|'),s.inferenceMs]);
  download([header,...rows].map(row=>row.map(escape).join(',')).join('\r\n'),'text/csv;charset=utf-8','csv');
};
window.addEventListener('beforeunload',event=>{if(recording.busy||activeConversion){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{activeConversion?.abort();clearPreparedDownload();stop();if(fileUrl)URL.revokeObjectURL(fileUrl);for(const clip of recordedClips){clip.checkController?.abort();clip.checkUi?.dispose();clip.repairUi?.dispose();URL.revokeObjectURL(clip.analysisUrl);URL.revokeObjectURL(clip.rawUrl);}});
window.addEventListener('resize',drawTrace);
// Read-only research snapshots also make reproducible browser QA possible.
simplifyUI();
window.gazeLab={runDemo,getSnapshot:()=>JSON.parse(JSON.stringify(exportObject())),getRecordings:()=>recordedClips.map(c=>structuredClone(c.data))};
updateSummary();drawTrace();refreshRecordingControls();

let checkQueue=Promise.resolve();
function enqueueSelfCheck(clip){
  if(['queued','running'].includes(clip.checkState)||clip.checkReport)return;
  const controller=new AbortController();clip.checkController=controller;clip.checkState='queued';clip.checkError=null;
  const emit=()=>clip.checkEvents?.dispatchEvent(new Event('change'));emit();
  checkQueue=checkQueue.catch(()=>{}).then(async()=>{
    try{
      if(controller.signal.aborted)throw new DOMException('Self-check stopped.','AbortError');
      clip.checkState='running';emit();
      clip.checkReport=await runSelfCheck(clip,{signal:controller.signal,onProgress:(n,total)=>{clip.checkProgress=n+' / '+total;emit();}});
      clip.checkState='complete';
    }catch(e){clip.checkState='stopped';clip.checkError=e.name==='AbortError'?'Segment check stopped. Tap Check clip to retry.':e.message;}
    finally{clip.checkController=null;emit();}
  });
}
