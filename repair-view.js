import {drawEyeMarkers} from './recording.js?v=quality5';
import {repairFrameAtTime} from './gap-repair.js';

export function repairVideoSize(data){
  const r=data.recording;
  if(!Number.isInteger(r.analysisWidth)||r.analysisWidth<2||r.analysisWidth>1280||!Number.isInteger(r.analysisFrameHeight)||r.analysisFrameHeight<2||r.analysisFrameHeight>1280)throw Error('This clip has unsupported recording dimensions.');
  return {width:r.analysisWidth,height:r.analysisFrameHeight+144};
}
export function drawRepairVideo(ctx,video,time,data,report){
  const {width,height}=ctx.canvas,frameHeight=height-144,frame=repairFrameAtTime(report,time),scale=Math.max(1,width/900);
  ctx.fillStyle='#0b1520';ctx.fillRect(0,0,width,height);
  ctx.save();if(data.recording.rawInputMirrored){ctx.translate(width,0);ctx.scale(-1,1);}
  if(video.readyState>=2)ctx.drawImage(video,0,144,width,frameHeight);ctx.restore();
  if(frame){
    const observed={reasons:[]};
    for(const side of ['left','right']){const e=frame[side];observed[side]=e.kind==='estimated'?null:{...e,valid:e.kind==='observed'};}
    ctx.save();ctx.translate(0,144);drawEyeMarkers(ctx,observed,width,frameHeight);
    for(const [side,label] of [['left','L'],['right','R']]){
      const e=frame[side];if(e.kind!=='estimated')continue;
      const {a,b,iris,top}=e.points;ctx.strokeStyle='#e4a0ff';ctx.fillStyle='#e4a0ff';ctx.lineWidth=2*scale;ctx.setLineDash([4*scale,3*scale]);
      ctx.beginPath();ctx.moveTo(a.x*width,a.y*frameHeight);ctx.lineTo(b.x*width,b.y*frameHeight);ctx.stroke();
      ctx.beginPath();ctx.arc(iris.x*width,iris.y*frameHeight,6*scale,0,2*Math.PI);ctx.stroke();
      ctx.font=`${13*scale}px Segoe UI`;ctx.fillText(`${label} ~`,iris.x*width,top.y*frameHeight-10*scale);
    }
    ctx.restore();
  }
  const font=Math.max(13,Math.min(20,width/46));ctx.font=`${font}px Segoe UI`;ctx.fillStyle='#cee6ec';
  ctx.fillText(`REPAIRED REVIEW · ${time.toFixed(2)}s`,16,27,width-32);
  ctx.fillStyle='#e4a0ff';ctx.fillText(frame?`L: ${frame.left.kind} · R: ${frame.right.kind}`:'No synchronized eye sample',16,52,width-32);
  const value=e=>!e||e.kind==='missing'?'—':`${e.kind==='estimated'?'~ ':''}${e.corrected.toFixed(3)}`;
  ctx.fillStyle='#61dcc3';ctx.fillText(`Left L: ${value(frame?.left)}`,16,78);
  ctx.fillStyle='#80baff';ctx.fillText(`Right R: ${value(frame?.right)}`,Math.max(175,width*.38),78);
  ctx.fillStyle='#a5bacc';ctx.fillText('Purple ~ = estimate · Not used for NIHSS scoring',16,104,width-32);
  ctx.fillText('Original data preserved · Video alignment is approximate',16,130,width-32);
}

export function createRepairPreview({clip,report,clipNumber}){
  const root=document.createElement('div');root.className='repair-preview';
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.className='repair-decoder';video.setAttribute('aria-hidden','true');video.tabIndex=-1;
  const canvas=document.createElement('canvas'),size=repairVideoSize(clip.data);Object.assign(canvas,size);canvas.setAttribute('aria-label',`Clip ${clipNumber} repaired preview`);
  const controls=document.createElement('div');controls.className='repair-playback';
  const play=document.createElement('button');play.textContent='Play repaired preview';
  const seek=document.createElement('input');seek.type='range';seek.min=0;seek.max=clip.data.recording.durationSeconds;seek.step=.01;seek.value=0;seek.setAttribute('aria-label',`Clip ${clipNumber} repaired time`);
  const time=document.createElement('span');time.className='hint';time.textContent='0.00 s';
  const error=document.createElement('p');error.className='hint';error.setAttribute('role','status');
  controls.append(play,seek,time);root.append(canvas,video,controls,error);
  let raf=null,disposed=false;
  function draw(){if(disposed)return;drawRepairVideo(canvas.getContext('2d'),video,video.currentTime,clip.data,report);seek.value=video.currentTime;time.textContent=`${video.currentTime.toFixed(2)} s`;}
  function loop(){draw();if(!video.paused&&!video.ended&&!disposed)raf=requestAnimationFrame(loop);}
  function pause(){video.pause();cancelAnimationFrame(raf);play.textContent='Play repaired preview';}
  play.onclick=async()=>{
    if(!video.paused){pause();return;}
    try{if(video.ended)video.currentTime=0;await video.play();if(disposed)return;play.textContent='Pause repaired preview';loop();}
    catch(e){error.textContent='Cannot play this preview: '+e.message;}
  };
  seek.oninput=()=>{pause();video.currentTime=Number(seek.value);};
  video.onloadedmetadata=()=>{if(Number.isFinite(video.duration))seek.max=video.duration;};
  video.onloadeddata=draw;video.onseeked=draw;video.onended=()=>{pause();draw();};
  video.onerror=()=>{error.textContent='This browser could not decode the raw recording.';};
  video.src=clip.rawUrl;draw();
  return {element:root,pause,dispose(){disposed=true;pause();video.removeAttribute('src');video.load();}};
}
