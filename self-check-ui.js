import {chooseSegment,segmentCsv} from './segment-review.js?v=segment8';
import {createSegmentPreview,createReviewedPlayer,makeReviewRenderer,reviewedVideoSize} from './segment-player.js?v=segment8';
import {recordingMime,extensionFor} from './recording.js';
import {convertVideo} from './video-export.js';

const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
export function createSelfCheckUI({clip,clipNumber,retry,saveBlob,busyMessage=()=>null,encode=async(c,task)=>task(),prepareDownload=()=>{}}){
  const root=el('section',null,'self-check');root.setAttribute('aria-label','Clip '+clipNumber+' segment review');
  const heading=el('h3','Review suspicious segments'),status=el('p',null,'hint');status.setAttribute('role','status');
  const actions=el('div',null,'buttons'),retryButton=el('button','Check clip'),cancel=el('button','Cancel check');
  retryButton.onclick=()=>retry(clip);cancel.onclick=()=>clip.checkController?.abort();actions.append(retryButton,cancel);
  const body=el('div');body.hidden=true;root.append(heading,status,actions,body);
  let disposed=false,position=0,builtReport=null,preview=null,player=null,progress,jump,panels,controller=null,choiceButtons=[],invalidateVideo=()=>{};
  function summary(){
    const r=clip.checkReport,chosen=r.segments.filter(s=>s.decision!=='unreviewed').length;
    progress.textContent=chosen+' / '+r.segments.length+' segments reviewed · Choices can be changed';
  }
  function draw(){
    preview?.dispose();preview=null;panels.replaceChildren();
    const r=clip.checkReport,segments=r.segments;position=Math.max(0,Math.min(position,segments.length-1));
    const segment=segments[position];jump.replaceChildren();
    for(const [i,s]of segments.entries())jump.add(new Option((i+1)+'. '+(s.side==='left'?'Left':'Right')+' · '+s.start.toFixed(2)+'–'+s.end.toFixed(2)+' s'+(s.decision==='unreviewed'?'':' · reviewed'),String(i)));
    jump.value=String(position);
    if(!segment){panels.append(el('p','No suspicious segments found in the checked frames.','hint'));summary();return;}
    const nav=el('div',null,'buttons'),back=el('button','Previous segment'),next=el('button','Next segment');
    back.disabled=position===0;next.disabled=position===segments.length-1;
    back.onclick=()=>{position--;draw();};next.onclick=()=>{position++;draw();};nav.append(back,next);panels.append(nav);
    panels.append(el('h4','Subject '+segment.side+' eye · '+segment.start.toFixed(2)+'–'+segment.end.toFixed(2)+' s'));
    preview=createSegmentPreview({clip,report:r,segment});panels.append(preview.element);
    const coverage=el('p',segment.proposedCount+' / '+segment.flaggedIndices.length+' suspicious samples have a replacement'+
      (segment.unresolvedCount?' · '+segment.unresolvedCount+' remain unresolved':''),'hint');
    const note=el('p','Use suggested track applies this segment only. Unresolved samples stay unmeasured; the other eye is unchanged.','hint');
    const choices=el('div',null,'buttons segment-choices');choiceButtons=[];
    for(const [value,label]of [['original','Keep original'],['suggestion','Use suggested track'],['uncertain','Mark unresolved']]){
      const b=el('button',label,value==='suggestion'?'primary':'');b.disabled=(value==='suggestion'&&!segment.proposedCount)||!!controller;
      b.setAttribute('aria-pressed',String(segment.decision===value));b.onclick=()=>{if(controller)return;chooseSegment(r,segment.id,value);invalidateVideo();player.refresh();summary();draw();};choices.append(b);choiceButtons.push(b);
    }
    const reset=el('button','Undo choice');reset.disabled=segment.decision==='unreviewed'||!!controller;
    reset.onclick=()=>{if(controller)return;chooseSegment(r,segment.id,'unreviewed');invalidateVideo();player.refresh();draw();};choices.append(reset);choiceButtons.push(reset);
    const decision=el('p','Choice: '+({unreviewed:'Not reviewed',original:'Original retained',suggestion:'Suggested track selected',uncertain:'Marked unresolved'}[segment.decision]),'check-nav');
    const evidence=el('details'),evidenceTitle=el('summary','Why this segment?');evidence.append(evidenceTitle,el('p',segment.reasons.join(' · '),'hint'));
    panels.append(coverage,note,choices,decision,evidence);summary();
  }
  function build(){
    const r=clip.checkReport;body.replaceChildren();body.hidden=false;
    const note=el('p','One decision per eye segment. Blink samples are skipped. Purple marks are estimates.','hint');
    const label=el('label','Suspicious segment');jump=el('select');jump.setAttribute('aria-label','Suspicious segment');
    jump.onchange=()=>{position=Number(jump.value);draw();};label.append(jump);label.hidden=!r.segments.length;
    panels=el('div');progress=el('p',null,'hint');
    player=createReviewedPlayer({clip,report:r,clipNumber});
    const exports=el('details'),title=el('summary','Save reviewed video & data'),format=el('select');format.setAttribute('aria-label','Reviewed video format');
    for(const f of ['mp4','webm']){const o=new Option(f.toUpperCase(),f);o.disabled=!recordingMime(globalThis.MediaRecorder,f);format.add(o);}
    format.value=Array.from(format.options).find(o=>!o.disabled)?.value??'';
    const formatLabel=el('label','Video format');formatLabel.append(format);
    const videoButton=el('button','Prepare reviewed video'),stop=el('button','Cancel video export'),save=el('button');stop.hidden=save.hidden=true;videoButton.disabled=!format.value;
    const exportStatus=el('p','Includes your accepted replacements. Unreviewed segments retain the original. NIHSS scoring is unchanged.','hint');exportStatus.setAttribute('role','status');
    invalidateVideo=()=>{if(!save.hidden){save.hidden=true;save.onclick=null;exportStatus.textContent='Choices changed. Prepare a new reviewed video to include them.';}};
    const base='gaze_recording_'+r.sourceRecordingId.slice(0,8);
    videoButton.onclick=async()=>{
      const busy=busyMessage();if(busy){exportStatus.textContent=busy;return;}
      preview?.pause();player.pause();controller=new AbortController();stop.hidden=false;stop.onclick=()=>controller.abort();
      videoButton.disabled=format.disabled=true;save.hidden=true;choiceButtons.forEach(b=>b.disabled=true);
      const render=makeReviewRenderer(clip,r,'selected'),type=format.value;
      try{
        const blob=await encode(controller,()=>convertVideo(clip.raw,type,{signal:controller.signal,size:reviewedVideoSize(clip.data),renderFrame:render,
          onProgress:(t,d)=>{exportStatus.textContent='Preparing reviewed video · '+t.toFixed(1)+(Number.isFinite(d)?' / '+d.toFixed(1):'')+' s · Keep this tab visible';}}));
        if(disposed)return;save.textContent='Save '+extensionFor(blob.type).toUpperCase()+' reviewed video';save.hidden=false;
        save.onclick=()=>saveBlob(blob,base+'_reviewed.'+extensionFor(blob.type));
        prepareDownload(()=>{save.hidden=true;save.onclick=null;});exportStatus.textContent='Video ready. Tap Save to download this snapshot of your choices.';
      }catch(e){if(!disposed)exportStatus.textContent=e.message;}
      finally{controller=null;if(!disposed){stop.hidden=true;videoButton.disabled=!format.value;format.disabled=false;draw();}}
    };
    const json=el('button','Review data JSON'),csv=el('button','Review data CSV');
    json.onclick=()=>saveBlob(new Blob([JSON.stringify({schema:'gaze-segment-review-package-2',original:clip.data,review:r},null,2)],{type:'application/json'}),base+'_review.json');
    csv.onclick=()=>saveBlob(new Blob([segmentCsv(r)],{type:'text/csv;charset=utf-8'}),base+'_review.csv');
    const buttons=el('div',null,'buttons');buttons.append(videoButton,stop,save,json,csv);exports.append(title,formatLabel,buttons,exportStatus);
    body.append(note,label,panels,progress,player.element,exports);builtReport=r;draw();
  }
  function update(){
    if(disposed)return;
    const state=clip.checkState??'idle',busy=['queued','running'].includes(state),r=clip.checkReport;
    retryButton.hidden=busy||!!r;cancel.hidden=!busy;
    status.textContent=state==='queued'?'Queued for segment analysis…':state==='running'?'Analysing clip · '+(clip.checkProgress??'Loading model…'):
      r?r.segments.length+' suspicious eye segments · '+r.ignoredBlinkEyes+' blink samples skipped · '+r.coverage.checked+' / '+r.coverage.total+' frames checked'+(r.coverage.unchecked?' · Unchecked intervals remain':''):
      clip.checkError??'A local segment check runs after recording.';
    if(r&&builtReport!==r)build();
  }
  clip.checkEvents??=new EventTarget();clip.checkEvents.addEventListener('change',update);update();
  return {element:root,dispose(){disposed=true;controller?.abort();preview?.dispose();player?.dispose();clip.checkEvents.removeEventListener('change',update);}};
}
