import {selectedFrame,sampleAtTime} from './segment-review.js?v=clean10';
import {drawEyeMarkers} from './recording.js';

const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
const value=e=>e?.valid&&Number.isFinite(e.corrected)?e.corrected.toFixed(3):'—';

export function drawEyeCrop(canvas,image,eye,reference,estimated=false){
  const ctx=canvas.getContext('2d'),p=reference?.points??eye?.points;
  ctx.fillStyle='#0b1520';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(!p?.a||!p?.b)return;
  const w=image.width,h=image.height,span=Math.hypot((p.a.x-p.b.x)*w,(p.a.y-p.b.y)*h);
  const sw=Math.max(32,span*1.55),sh=sw*canvas.height/canvas.width;
  const sx=(p.a.x+p.b.x)*w/2-sw/2,sy=(p.a.y+p.b.y)*h/2-sh/2;
  ctx.drawImage(image,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  if(eye?.valid&&eye.points?.iris){
    const x=(eye.points.iris.x*w-sx)/sw*canvas.width,y=(eye.points.iris.y*h-sy)/sh*canvas.height;
    ctx.strokeStyle='#10232b';ctx.lineWidth=8;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle=estimated?'#e4a0ff':'#80d8ff';ctx.lineWidth=4;ctx.stroke();
    ctx.beginPath();ctx.moveTo(x-13,y);ctx.lineTo(x+13,y);ctx.moveTo(x,y-13);ctx.lineTo(x,y+13);ctx.stroke();
  }
}

// Matched source images, not two independently seeking video elements. This
// preview shows every archived frame in the segment, with no timestamp drift.
export function createSegmentPreview({clip,report,segment,onChoose=()=>{},disabled=false}){
  const root=el('div',null,'segment-preview'),pair=el('div',null,'check-pair');
  const frames=segment.sourceIndices.map(i=>report.frames.find(f=>f.sourceIndex===i));
  const cards=['Original','Suggested'].map((label,i)=>{
    const choice=i?'suggestion':'original',card=el('button',null,'check-version track-choice'),canvas=el('canvas'),caption=el('span');canvas.width=480;canvas.height=260;
    card.type='button';card.disabled=disabled||(i===1&&!segment.proposedCount);
    card.setAttribute('aria-label',`Choose ${i?'suggested':'original'} track for ${segment.side} eye`);
    card.setAttribute('aria-pressed',String(segment.decision===choice));card.onclick=()=>onChoose(choice);
    canvas.setAttribute('aria-label',label+' · '+segment.side+' eye');
    card.append(el('strong',label+(segment.decision===choice?' ✓':'')),canvas,caption);
    pair.append(card);return {canvas,caption};
  });
  const controls=el('div',null,'buttons'),play=el('button','Play'),speed=el('select');play.setAttribute('aria-label','Play segment');speed.setAttribute('aria-label','Segment playback speed');
  for(const [v,t]of [['1','1×'],['0.5','0.5×']])speed.add(new Option(t,v));
  controls.append(play,speed);
  const seek=el('input');seek.type='range';seek.min=0;seek.max=Math.max(0,frames.length-1);seek.step=1;seek.value=0;seek.setAttribute('aria-label','Segment position');
  const status=el('p',null,'hint');status.setAttribute('role','status');root.append(pair,controls,seek,status);
  let index=0,disposed=false,playing=false,timer=null,token=0;
  function pause(){playing=false;clearTimeout(timer);play.textContent='Play';play.setAttribute('aria-label','Play segment');}
  async function draw(){
    const t=++token,f=frames[index],entry=clip.reviewFrames.find(e=>e.sourceIndex===f.sourceIndex);
    let image;if(!entry){status.textContent='Saved frame unavailable.';pause();return;}
    try{image=await createImageBitmap(entry.blob);}catch{status.textContent='Saved frame could not be read.';pause();return;}
    if(disposed||t!==token){image.close();return;}
    const e=f[segment.side],original=selectedFrame(f.sample,f,'original')[segment.side],proposal=selectedFrame(f.sample,f,'proposal')[segment.side];
    drawEyeCrop(cards[0].canvas,image,original,e.original);drawEyeCrop(cards[1].canvas,image,proposal,e.original,!!e.proposal);
    cards[0].caption.textContent=original?.valid?'':'Unmeasured';cards[1].caption.textContent=proposal?(e.proposal?'Estimate':'Unchanged'):'Unresolved';
    seek.value=index;status.textContent=f.time.toFixed(2)+' s';
    image.close();
    if(playing){if(index===frames.length-1){pause();return;}
      const delay=Math.max(20,(frames[index+1].time-f.time)*1000/Number(speed.value));timer=setTimeout(()=>{index++;draw();},delay);}
  }
  play.onclick=()=>{if(playing){pause();return;}if(index===frames.length-1)index=0;playing=true;play.textContent='Pause';play.setAttribute('aria-label','Pause segment');draw();};
  seek.oninput=()=>{pause();index=Number(seek.value);draw();};speed.onchange=()=>{if(playing){clearTimeout(timer);draw();}};
  draw();return {element:root,pause,dispose(){disposed=true;token++;pause();}};
}

export function reviewedVideoSize(data){return {width:data.recording.analysisWidth,height:data.recording.analysisFrameHeight+144};}

export function makeReviewRenderer(clip,report,version='selected'){
  const review=new Map(report.frames.map(f=>[f.sourceIndex,f]));
  // Snapshot choices for a video export; a later doctor choice cannot change
  // the second half of a file which is already being encoded.
  const samples=clip.data.samples.map((s,i)=>selectedFrame(s,review.get(i),version));
  return (ctx,video,time)=>{
    const {width:w,height:h}=ctx.canvas,fh=h-144,i=sampleAtTime(samples,time),s=i<0?null:samples[i];
    ctx.fillStyle='#0b1520';ctx.fillRect(0,0,w,h);
    ctx.save();if(clip.data.recording.rawInputMirrored){ctx.translate(w,0);ctx.scale(-1,1);}
    if(video.readyState>=2)ctx.drawImage(video,0,144,w,fh);ctx.restore();
    if(s){ctx.save();ctx.translate(0,144);const observed={...s};
      for(const side of ['left','right'])if(s.reviewKinds[side]==='estimated')observed[side]=null;
      drawEyeMarkers(ctx,observed,w,fh);
      for(const side of ['left','right'])if(s.reviewKinds[side]==='estimated'){
        const p=s[side].points;ctx.strokeStyle=ctx.fillStyle='#e4a0ff';ctx.lineWidth=2;ctx.setLineDash([4,3]);
        ctx.beginPath();ctx.arc(p.iris.x*w,p.iris.y*fh,6,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        ctx.font='16px Segoe UI';ctx.fillText((side==='left'?'L':'R')+' ~',p.iris.x*w,p.iris.y*fh-12);
      }ctx.restore();}
    ctx.fillStyle='#dcebf4';ctx.font=Math.max(14,Math.min(20,w/40))+'px Segoe UI';
    ctx.fillText((version==='original'?'ORIGINAL TRACKING':'REVIEWED TRACKING')+' · '+time.toFixed(2)+' s',16,27,w-32);
    for(const [j,side]of ['left','right'].entries()){
      const kind=s?.reviewKinds[side],label=kind==='blink'?'Blink · skipped':kind==='unresolved'?'Unresolved':value(s?.[side]);
      ctx.fillStyle=kind==='estimated'?'#e4a0ff':'#cee6ec';ctx.fillText((side==='left'?'Left':'Right')+': '+(kind==='estimated'?'~ ':'')+label,16,53+j*25,w-32);
    }
    ctx.fillStyle='#a5bacc';ctx.fillText('Purple = accepted estimate · NIHSS unchanged',16,104,w-32);
    ctx.fillText('Raw-video alignment is approximate',16,130,w-32);
  };
}

export function createReviewedPlayer({clip,report,clipNumber}){
  const root=el('section',null,'reviewed-playback'),title=el('h3','Full video comparison');
  const select=el('select');select.setAttribute('aria-label','Full video version');
  select.add(new Option('Original','original'));select.add(new Option('Reviewed','selected'));
  const video=el('video');video.muted=true;video.playsInline=true;video.preload='metadata';video.className='repair-decoder';video.tabIndex=-1;video.setAttribute('aria-hidden','true');
  const canvas=el('canvas');Object.assign(canvas,reviewedVideoSize(clip.data));canvas.setAttribute('aria-label','Clip '+clipNumber+' full review video');
  const controls=el('div',null,'buttons'),play=el('button','Play');play.setAttribute('aria-label','Play full video');controls.append(play);
  const seek=el('input');seek.type='range';seek.min=0;seek.max=clip.data.recording.durationSeconds;seek.step=.01;seek.value=0;seek.setAttribute('aria-label','Full video time');
  const status=el('p',null,'hint');status.setAttribute('role','status');
  root.append(select,canvas,video,controls,seek,status);
  let render=makeReviewRenderer(clip,report,'original'),raf=null,disposed=false;
  const draw=()=>{if(disposed)return;render(canvas.getContext('2d'),video,video.currentTime);seek.value=video.currentTime;};
  function loop(){draw();if(!video.paused&&!video.ended&&!disposed)raf=requestAnimationFrame(loop);}
  function pause(){video.pause();cancelAnimationFrame(raf);play.textContent='Play';play.setAttribute('aria-label','Play full video');}
  play.onclick=async()=>{if(!video.paused){pause();return;}try{if(video.ended)video.currentTime=0;await video.play();if(disposed)return;play.textContent='Pause';play.setAttribute('aria-label','Pause full video');loop();}catch(e){status.textContent='Cannot play video: '+e.message;}};
  select.onchange=()=>{render=makeReviewRenderer(clip,report,select.value);draw();};
  seek.oninput=()=>{pause();video.currentTime=Number(seek.value);};
  video.onloadeddata=draw;video.onseeked=draw;video.onended=()=>{pause();draw();};
  video.onloadedmetadata=()=>{if(Number.isFinite(video.duration))seek.max=video.duration;};
  video.onerror=()=>{status.textContent='This browser could not decode the recording.';};video.src=clip.rawUrl;
  draw();return {element:root,pause,refresh(){select.value='selected';render=makeReviewRenderer(clip,report,'selected');draw();},
    dispose(){disposed=true;pause();video.removeAttribute('src');video.load();}};
}
