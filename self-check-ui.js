import {chooseSegment,segmentCsv} from './segment-review.js?v=closed12';
import {createSegmentPreview,createReviewedPlayer,makeReviewRenderer,reviewedVideoSize} from './segment-player.js?v=three13';
import {createEyeMotionPlayer,makeEyeMotionRenderer,clipGazeSuggestion,reviewedSamples,EYE_VIDEO_SIZE} from './eye-motion.js?v=three13';
import {parseIntervals,NIHSS_SOURCE} from './assessment.js';
import {recordingMime,extensionFor} from './recording.js';
import {convertVideo} from './video-export.js';

const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
function field(text,options,value){
  const label=el('label',text),input=el('select');input.setAttribute('aria-label',text);
  for(const [v,t]of options)input.add(new Option(t,v));input.value=value;label.append(input);return {label,input};
}
export function createSelfCheckUI({clip,clipNumber,retry,saveBlob,busyMessage=()=>null,encode=async(c,task)=>task(),prepareDownload=()=>{}}){
  const root=el('section',null,'self-check compact-review');root.setAttribute('aria-label','Clip '+clipNumber+' segment review');
  const status=el('p',null,'hint');status.setAttribute('role','status');
  const actions=el('div',null,'buttons'),retryButton=el('button','Check clip'),cancel=el('button','Cancel check');
  retryButton.onclick=()=>retry(clip);cancel.onclick=()=>clip.checkController?.abort();actions.append(retryButton,cancel);
  const body=el('div');body.hidden=true;root.append(status,actions,body);
  const downloads=el('section');downloads.append(el('p','Reviewed downloads appear after the local check.','hint'));
  let disposed=false,position=0,builtReport=null,preview=null,player=null,eyes=null,progress,jump,panels,controller=null,
    result,positionPanel,positionHint,positionButtons=[],examContext,exportHint,contextFields=[],tabs=[],views={},activeView=clip.reviewView??'review',invalidateVideo=()=>{},exportButtons=[];
  function summary(){const r=clip.checkReport;progress.textContent=`${r.segments.filter(s=>s.decision!=='unreviewed').length} / ${r.segments.length} reviewed`;}
  function showView(name){
    const previousView=activeView;
    preview?.pause();player?.pause();eyes?.pause();
    if(name==='eyes'&&previousView==='video')eyes?.seekTime(player.getTime());
    if(name==='video'&&previousView==='eyes')player?.seekTime(eyes.getTime());
    activeView=name;clip.reviewView=name;
    if(positionPanel&&['eyes','video'].includes(name)){
      if(name==='eyes'){views.eyes.insertBefore(positionPanel,examContext);views.eyes.insertBefore(result,examContext);}
      else views.video.append(positionPanel,result);
    }
    for(const [key,pane]of Object.entries(views))pane.hidden=key!==name;
    for(const tab of tabs)tab.setAttribute('aria-pressed',String(tab.dataset.view===name));
    if(['eyes','video'].includes(name))updateResult();
  }
  function changed(){invalidateVideo();player.refresh();eyes.refresh();updateResult();summary();}
  function choose(value){if(controller)return;chooseSegment(clip.checkReport,clip.checkReport.segments[position].id,value);changed();draw();}
  function draw(){
    preview?.dispose();preview=null;panels.replaceChildren();
    const r=clip.checkReport,segments=r.segments;position=Math.max(0,Math.min(position,segments.length-1));jump.replaceChildren();
    for(const [i,s]of segments.entries())jump.add(new Option(`${i+1}/${segments.length} · ${s.side==='left'?'Left':'Right'} · ${s.start.toFixed(1)}–${s.end.toFixed(1)} s${s.decision==='unreviewed'?'':' ✓'}`,String(i)));
    jump.value=String(position);jump.disabled=!segments.length;const segment=segments[position];
    if(!segment){panels.append(el('p','No segments to review.','hint'));summary();return;}
    preview=createSegmentPreview({clip,report:r,segment,onChoose:choose,disabled:!!controller});panels.append(preview.element);
    const coverage=el('p',`${segment.proposedCount} suggested${segment.unresolvedCount?` · ${segment.unresolvedCount} unresolved`:''}`,'hint compact-coverage');
    const footer=el('div',null,'review-footer'),closed=el('button','Eye closed'),uncertain=el('button','Unresolved'),reset=el('button','Undo');
    closed.type='button';closed.disabled=!!controller;closed.setAttribute('aria-label',`Mark ${segment.side} eye closed for this segment`);
    closed.setAttribute('aria-pressed',String(segment.decision==='closed'));closed.onclick=()=>choose('closed');
    uncertain.disabled=!!controller;uncertain.setAttribute('aria-pressed',String(segment.decision==='uncertain'));uncertain.onclick=()=>choose('uncertain');
    reset.disabled=segment.decision==='unreviewed'||!!controller;reset.onclick=()=>choose('unreviewed');footer.append(closed,uncertain,reset);
    const evidence=el('details',null,'review-reasons');evidence.append(el('summary',segment.decision==='closed'?'Marked eye closed · Details':segment.decision==='uncertain'?'Marked unresolved · Details':'Details'),el('p',segment.reasons.join(' · '),'hint'),
      el('p','Tap a picture to choose for this eye segment. Eye closed excludes this eye throughout the displayed interval. Purple = estimate. Unsupported positions remain empty. Blinks are skipped.','hint'));
    panels.append(coverage,footer,evidence);summary();
  }
  function updateResult(){
    if(!result)return;const r=clipGazeSuggestion(clip,clip.checkReport);result.replaceChildren();
    const title=r.score!==null?`NIHSS · ${r.score}`:r.pending?'NIHSS · Review needed':r.clinical?'NIHSS · Incomplete':r.threePositions?r.title:!r.evidence.adequate?'NIHSS · Not ready':r.candidates.length===1?'NIHSS · Possible 0':'NIHSS · Review 1–2';
    const short=r.pending?`Review ${r.pending} remaining segments.`:r.score!==null?'Based on examiner findings.':r.clinical?'Complete examiner findings.':r.threePositions?(!r.threePositions.adequate?r.threePositions.issues[0]:'Three-position rule · clinician confirmation needed.'):!r.evidence.adequate?'Check exam phases and coverage.':'Clinician confirmation needed.';
    result.append(el('h4',title),el('p',short,'hint'));
    positionPanel.hidden=clip.gazeScoringMode!=='three-position';
    for(const {key,button,label}of positionButtons){
      const t=clip.threePositionSelection?.[key],set=Number.isFinite(t);
      button.replaceChildren(el('strong',label),el('small',set?t.toFixed(2)+' s':'Set here'));
      button.setAttribute('aria-pressed',String(set));button.disabled=!!controller||r.pending>0;
    }
    if(r.clinical&&clip.clinicalObservation?.finding==='normal'&&(r.evidence.flags.length||(r.threePositions?.adequate&&r.threePositions.legacyRuleScore!==0)))result.append(el('p','Video and clinical findings differ.','warning'));
    const more=el('details');more.append(el('summary','Details'));
    const list=el('ul');for(const reason of r.reasons)list.append(el('li',reason));more.append(list,el('p',r.limitation,'hint'),
      el('p','The diagram fixes eye width and removes the head image. Pose compensation is approximate; missing positions stay blank. Left/right refer to the subject.','hint'));
    if(r.threePositions?.codes){
      const table=el('table');table.className='position-values';table.setAttribute('aria-label','Three-position eye codes');
      const header=el('tr');for(const text of ['Position','L eye','R eye'])header.append(el('th',text));table.append(header);
      for(const [key,label]of [['rest','Rest'],['left','Look left'],['right','Look right']]){
        const row=el('tr');row.append(el('th',label));for(const side of ['left','right'])row.append(el('td',String(r.threePositions.codes[key][side])));table.append(row);
      }
      more.append(table,el('p','Codes: −2 / −1 toward subject-left, 0 centered, +1 / +2 toward subject-right.','hint'));
    }
    const rules=el('p','0: normal. 1: partial palsy or an overcome deviation. 2: forced deviation / total paresis not overcome by the oculocephalic reflex. A clinician must establish the applicable findings.','hint');
    const source=el('a','NIHSS instructions ↗');source.href=NIHSS_SOURCE;source.target='_blank';source.rel='noreferrer';more.append(rules,source);result.append(more);
    exportButtons.forEach(b=>b.disabled=!!controller||r.pending>0||!b.dataset.available);
    if(exportHint)exportHint.textContent=r.pending?'Finish review to export.':'';
  }
  function buildPositions(){
    const box=el('div',null,'three-positions'),buttons=el('div',null,'position-buttons');positionButtons=[];
    positionHint=el('p','Pause, then mark rest, left and right. Directions refer to the subject.','hint');
    for(const [key,label]of [['rest','Rest'],['left','Left'],['right','Right']]){
      const button=el('button');button.type='button';button.setAttribute('aria-label','Set '+key+' gaze position');
      button.onclick=()=>{(clip.threePositionSelection??={})[key]=activeView==='video'?player.getTime():eyes.getTime();player.pause();eyes.pause();changed();};
      positionButtons.push({key,button,label});buttons.append(button);
    }
    box.append(positionHint,buttons);return box;
  }
  function buildContext(){
    const box=el('details',null,'exam-context');box.append(el('summary','Exam details'));
    const method=field('Scoring method',[['three-position','Three positions (temporary)'],['phases','Labelled exam phases']],clip.gazeScoringMode);
    const reset=el('button','Clear three positions');reset.type='button';reset.onclick=()=>{clip.threePositionSelection={};changed();};
    box.append(method.label,reset);
    const phases=el('textarea');phases.rows=3;phases.spellcheck=false;phases.setAttribute('aria-label','Clip exam phase intervals');
    phases.placeholder='Seconds from clip start, for example:\n0 2 center\n2 5 left\n5 8 right';phases.value=(clip.reviewIntervals??[]).map(r=>`${r.start} ${r.end} ${r.phase}`).join('\n');
    const note=el('p','Clip times; subject-left/right. Leave blank to keep recorded labels.','hint'),apply=el('button','Apply'),error=el('p',null,'hint');apply.setAttribute('aria-label','Apply phase labels');error.setAttribute('role','status');
    apply.onclick=()=>{try{const text=phases.value.trim();clip.reviewIntervals=text?parseIntervals(text,clip.data.recording.durationSeconds):null;error.textContent='Phase labels saved for this clip.';changed();}catch(e){error.textContent=e.message;}};
    const phaseBox=el('div');phaseBox.hidden=clip.gazeScoringMode==='three-position';phaseBox.append(note,phases,apply,error);box.append(phaseBox);
    method.input.onchange=()=>{clip.gazeScoringMode=method.input.value;phaseBox.hidden=clip.gazeScoringMode==='three-position';changed();};
    const o=clip.clinicalObservation??={reviewer:'',examAdequate:'unknown',finding:'unknown',overcome:'unknown',reflexAssessed:'unknown'};
    const clinical=el('details');clinical.append(el('summary','Clinician findings'));
    const id=el('input');id.value=o.reviewer;id.maxLength=80;id.placeholder='Examiner ID (no patient name)';id.setAttribute('aria-label','Clip examiner ID');
    const adequate=field('Adequate horizontal exam',[['unknown','Not confirmed'],['yes','Confirmed by examiner'],['no','No / uncertain']],o.examAdequate);
    const finding=field('Examiner finding',[['unknown','Use video suggestion only'],['normal','Normal horizontal gaze'],['partial','Partial palsy; no forced deviation / total paresis'],['deviation','Conjugate deviation'],['total-paresis','Total gaze paresis'],['isolated-nerve','Isolated CN III / IV / VI palsy']],o.finding);
    const overcome=field('Deviation / limitation overcome?',[['unknown','Unknown'],['voluntary','By voluntary movement'],['reflex','By reflex movement'],['not-overcome','Not overcome']],o.overcome);
    const reflex=field('Applicable reflex examined by clinician?',[['unknown','Not confirmed'],['yes','Examined and recorded'],['no','Not examined / not appropriate']],o.reflexAssessed);
    const conditional=el('div');conditional.append(overcome.label,reflex.label);
    const sync=()=>{conditional.hidden=!['deviation','total-paresis'].includes(o.finding);};
    id.onchange=()=>{o.reviewer=id.value;changed();};
    for(const [key,f]of Object.entries({examAdequate:adequate,finding,overcome,reflexAssessed:reflex}))f.input.onchange=()=>{
      o[key]=f.input.value;if(key==='finding'){o.overcome=o.reflexAssessed='unknown';overcome.input.value=reflex.input.value='unknown';}sync();changed();
    };
    sync();clinical.append(el('p','These fields map the examiner’s own findings. The animation cannot establish a reflex result.','hint'),id,adequate.label,finding.label,conditional);box.append(clinical);
    contextFields=[method.input,reset,phases,apply,id,adequate.input,finding.input,overcome.input,reflex.input];return box;
  }
  function buildDownloads(){
    downloads.replaceChildren();exportButtons=[];
    const format=field('Format',['mp4','webm'].map(f=>[f,f.toUpperCase()]),'mp4');format.input.setAttribute('aria-label','Reviewed download format');
    for(const o of format.input.options)o.disabled=!recordingMime(globalThis.MediaRecorder,o.value);
    format.input.value=Array.from(format.input.options).find(o=>!o.disabled)?.value??'';
    const buttons=el('div',null,'buttons'),stop=el('button','Cancel export'),save=el('button');stop.hidden=save.hidden=true;
    const exportStatus=el('p',null,'hint');exportStatus.setAttribute('role','status');exportHint=el('p',null,'hint');
    invalidateVideo=()=>{if(!save.hidden){save.hidden=true;save.onclick=null;exportStatus.textContent='Choices or exam details changed. Prepare a new download.';}};
    const base='gaze_recording_'+clip.data.recording.id.slice(0,8);
    for(const [mode,label]of [['reviewed','Reviewed video'],['eyes','Eye-only video']]){
      const button=el('button',label);button.setAttribute('aria-label',mode==='eyes'?'Prepare eye-only video':'Prepare reviewed video');button.dataset.available=format.input.value?'yes':'';exportButtons.push(button);buttons.append(button);
      button.onclick=async()=>{
        const busy=busyMessage();if(busy){exportStatus.textContent=busy;return;}
        if(clip.checkReport.segments.some(s=>s.decision==='unreviewed'))return;
        preview?.pause();player.pause();eyes.pause();controller=new AbortController();stop.hidden=false;stop.onclick=()=>controller?.abort();
        format.input.disabled=true;save.hidden=true;contextFields.forEach(f=>f.disabled=true);draw();updateResult();
        const render=mode==='eyes'?makeEyeMotionRenderer(clip,clip.checkReport):makeReviewRenderer(clip,clip.checkReport,'selected'),type=format.input.value;
        try{
          const blob=await encode(controller,()=>convertVideo(clip.raw,type,{signal:controller.signal,size:mode==='eyes'?EYE_VIDEO_SIZE:reviewedVideoSize(clip.data),renderFrame:render,
            onProgress:(t,d)=>{exportStatus.textContent=`Preparing ${mode==='eyes'?'eye-only':'reviewed'} video · ${t.toFixed(1)}${Number.isFinite(d)?' / '+d.toFixed(1):''} s · Keep this tab visible`;}}));
          if(disposed)return;save.textContent='Save '+extensionFor(blob.type).toUpperCase();save.hidden=false;
          save.onclick=()=>saveBlob(blob,`${base}_${mode==='eyes'?'eyes_only':'reviewed'}.${extensionFor(blob.type)}`);
          prepareDownload(()=>{save.hidden=true;save.onclick=null;});exportStatus.textContent='Ready. Tap Save to download.';
        }catch(e){if(!disposed)exportStatus.textContent=e.message;}
        finally{controller=null;if(!disposed){stop.hidden=true;format.input.disabled=false;contextFields.forEach(f=>f.disabled=false);draw();updateResult();}}
      };
    }
    const data=el('details');data.append(el('summary','Review data'));
    const json=el('button','Download review JSON'),csv=el('button','Download review CSV');
    json.onclick=()=>saveBlob(new Blob([JSON.stringify({schema:'gaze-reviewed-motion-5',original:clip.data,review:clip.checkReport,
      reviewedSamples:reviewedSamples(clip,clip.checkReport),phaseOverrides:clip.reviewIntervals??null,
      gazeScoringMode:clip.gazeScoringMode,threePositionSelection:clip.threePositionSelection??null,
      clinicalObservation:clip.clinicalObservation??null,suggestion:clipGazeSuggestion(clip,clip.checkReport)},null,2)],{type:'application/json'}),base+'_review.json');
    csv.onclick=()=>saveBlob(new Blob([segmentCsv(clip.checkReport)],{type:'text/csv;charset=utf-8'}),base+'_review.csv');
    data.append(json,csv);downloads.append(format.label,buttons,exportHint,stop,save,exportStatus,data);
  }
  function build(){
    const r=clip.checkReport;body.replaceChildren();body.hidden=false;tabs=[];
    clip.gazeScoringMode??='three-position';
    const nav=el('nav',null,'clip-tabs');nav.setAttribute('aria-label',`Clip ${clipNumber} views`);
    for(const [name,label]of [['review','Review'],['eyes','Eye motion'],['video','Video']]){
      const tab=el('button',label);tab.dataset.view=name;tab.onclick=()=>showView(name);tabs.push(tab);nav.append(tab);views[name]=el('div');
    }
    const strip=el('div',null,'segment-nav'),previous=el('button','‹'),next=el('button','›');
    previous.setAttribute('aria-label','Previous segment');next.setAttribute('aria-label','Next segment');
    jump=el('select');jump.setAttribute('aria-label','Suspicious segment');jump.onchange=()=>{position=Number(jump.value);draw();};
    previous.onclick=()=>{if(position>0){position--;draw();}};next.onclick=()=>{if(position<r.segments.length-1){position++;draw();}else showView('eyes');};
    strip.append(previous,jump,next);strip.hidden=!r.segments.length;panels=el('div');progress=el('p',null,'hint review-progress');views.review.append(progress,strip,panels);
    player=createReviewedPlayer({clip,report:r,clipNumber});views.video.append(player.element);
    eyes=createEyeMotionPlayer({clip,report:r});result=el('div',null,'clip-score');positionPanel=buildPositions();examContext=buildContext();views.eyes.append(eyes.element,positionPanel,result,examContext);
    body.append(nav,...Object.values(views));builtReport=r;buildDownloads();draw();updateResult();showView(activeView);
  }
  function update(){
    if(disposed)return;const state=clip.checkState??'idle',busy=['queued','running'].includes(state),r=clip.checkReport;
    retryButton.hidden=busy||!!r;cancel.hidden=!busy;actions.hidden=retryButton.hidden&&cancel.hidden;status.hidden=!!r;
    status.textContent=state==='queued'?'Queued for analysis…':state==='running'?'Checking · '+(clip.checkProgress??'Loading model…'):
      r?`${r.segments.length} eye segments · ${r.ignoredBlinkEyes} blink samples skipped${r.coverage.unchecked?' · Some frames unchecked':''}`:clip.checkError??'The clip is checked locally after recording.';
    if(r&&builtReport!==r)build();
  }
  clip.checkEvents??=new EventTarget();clip.checkEvents.addEventListener('change',update);update();
  return {element:root,downloadElement:downloads,pause(){preview?.pause();player?.pause();eyes?.pause();},
    dispose(){disposed=true;controller?.abort();preview?.dispose();player?.dispose();eyes?.dispose();clip.checkEvents.removeEventListener('change',update);}};
}
