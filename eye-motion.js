import {selectedFrame,sampleAtTime} from './segment-review.js?v=usability20';
import {summarize,scoreNIHSS,phaseAt,NIHSS_SOURCE} from './assessment.js';
import {eyeUsable} from './eye-quality.js';
import {threePositionEvidence} from './three-position.js?v=three13';
import {temporalGazeEvidence} from './temporal-gaze.js?v=usability20';
import {proposeAutoSelections} from './auto-selection.js?v=usability20';

export const EYE_VIDEO_SIZE=Object.freeze({width:960,height:300});

// Work on copies. Clip-level phase edits never overwrite the recorded exam.
export function reviewedSamples(clip,report,version='selected'){
  const reviews=new Map(report.frames.map(f=>[f.sourceIndex,f]));
  return clip.data.samples.map((s,i)=>{
    const review=reviews.get(i),out=selectedFrame(s,review,version);
    if(version==='selected'){
      for(const side of ['left','right']){
        const eyeReview=review?.[side];
        // A live point has not passed image review merely because the tracker
        // marked it valid. Do not present unchecked or unresolved points as
        // observed evidence in the default animation. Original comparison data
        // remains available, and explicit examiner choices keep their meaning.
        if(s.reviewScope==='buffer'){out[side]=null;out.reviewKinds[side]='buffer';}
        else if(!review){out[side]=null;out.reviewKinds[side]='unchecked';}
        else if(!eyeReview?.ignored&&eyeReview?.flagged&&(!eyeReview.decision||eyeReview.decision==='unreviewed')){
          out[side]=null;out.reviewKinds[side]='unresolved';
        }
      }
      out.valid=eyeUsable(out,'left')&&eyeUsable(out,'right');
    }
    if(clip.reviewIntervals){
      const phase=phaseAt(s.rawVideoTimeSeconds,clip.reviewIntervals);
      out.phase=phase.phase;out.phaseStart=s.t-(s.rawVideoTimeSeconds-phase.phaseStart);
    }
    return out;
  });
}

export function eyeDiagramState(sample){
  return Object.fromEntries(['right','left'].map(side=>{
    const kind=sample?.reviewKinds?.[side]??'original',usable=eyeUsable(sample,side);
    return [side,{position:usable?sample[side].corrected:null,kind,
      label:kind==='buffer'?'Outside analysis':kind==='closed'?'Eye closed':kind==='not-visible'?'Not visible':kind==='deferred'?'Needs annotation':kind==='blink'?'Blink':kind==='unresolved'?'Unresolved':kind==='unchecked'?'Not checked':!usable?'No measurement':kind==='estimated'?'Accepted estimate':'Observed'}];
  }));
}

function evidenceReasons(evidence){
  const reasons=[];
  for(const side of ['left','right'])for(const direction of ['left','right']){
    const value=evidence.excursions[side]?.[direction];
    if(Number.isFinite(value))reasons.push(`${side==='left'?'Left':'Right'} eye → subject-${direction}: ${value.toFixed(2)} normalized excursion.`);
  }
  for(const flag of evidence.flags){
    const parts=flag.split(':');
    if(parts[2]==='reduced-excursion')reasons.push(`Reduced measured movement: ${parts[0]} eye toward subject-${parts[1]}. This alone does not establish palsy.`);
    else if(parts[1]==='asymmetric-excursion')reasons.push(`The eyes moved by different amounts toward subject-${parts[0]}.`);
    else if(flag==='possible-resting-deviation')reasons.push('Both eyes have an offset at rest; clinical confirmation of conjugate deviation is needed.');
  }
  return reasons;
}

// Suggestions are unvalidated movement evidence, not a classifier trained on
// NIHSS labels. Exact rule mapping requires separately entered clinical facts.
export function clipGazeSuggestion(clip,report){
  const checked=new Set(report.frames.map(f=>f.sourceIndex));
  const adaptive=clip.data.recording.guidedExam?.version==='guided-exam-v4';
  const fixedWindow=adaptive||clip.data.recording.guidedExam?.version==='guided-exam-v3';
  const samples=reviewedSamples(clip,report),originalSamples=reviewedSamples(clip,report,'original');
  const gatedSelections=rows=>{
    if(!adaptive)return {three:clip.threePositionSelection??{},temporal:clip.temporalSelection??{},proposal:null};
    // Recheck from the current tracks, including callers without a UI review
    // state. Old/manual fields must not bypass a failed full-observation gate.
    const proposal=proposeAutoSelections(rows,checked,clip.data.recording.guidedExam,clip.data.recording.durationSeconds);
    const three={},temporal={};
    for(const phase of ['center','left','right']){
      const response=proposal.provenance.phases[phase]?.response,window=response?.selectedWindow;
      if(!response?.adequate||!window)continue;
      const key=phase==='center'?'rest':phase,anchor=clip.threePositionSelection?.[key],range=clip.temporalSelection?.[phase];
      if(Number.isFinite(anchor)&&anchor>=window.start&&anchor<=window.end)three[key]=anchor;
      if(Number.isFinite(range?.start)&&Number.isFinite(range?.end)&&range.start>=window.start&&range.end<=window.end&&range.end>range.start)temporal[phase]={...range};
    }
    return {three,temporal,proposal};
  };
  const selectedRanges=gatedSelections(samples),originalRanges=gatedSelections(originalSamples);
  // Archive gaps are not implicitly approved measurements for a new score.
  const assess=(rows,ranges)=>summarize(rows.map((s,i)=>{
    const out=checked.has(i)?{...s}:{...s,left:null,right:null,valid:false};
    if(fixedWindow){
      const entry=Object.entries(ranges.temporal).find(([,r])=>s.rawVideoTimeSeconds>=r.start&&s.rawVideoTimeSeconds<=r.end),range=entry?.[1];
      out.phase=entry?.[0]??'unlabelled';out.phaseStart=range?s.t-s.rawVideoTimeSeconds+range.start:0;
    }
    return out;
  }),fixedWindow?{...clip.data.config,settleSeconds:0}:clip.data.config);
  const evidence=assess(samples,selectedRanges),original=assess(originalSamples,originalRanges);
  const pending=report.segments.filter(s=>s.decision==='unreviewed').length;
  const estimated=samples.reduce((n,s)=>n+['left','right'].filter(side=>s.reviewKinds[side]==='estimated').length,0);
  const result={score:null,candidates:[],title:'Review required',reasons:[],evidence,originalEvidence:original,
    pending,estimated,deferredCount:report.segments.filter(s=>s.decision==='deferred').length,
    notVisibleCount:report.segments.filter(s=>s.decision==='not-visible').length,
    closedCount:report.segments.filter(s=>s.decision==='closed').length,
    source:NIHSS_SOURCE,mode:'experimental-movement-suggestion',
    selectionReview:clip.selectionReview?{status:clip.selectionReview.status,confirmedAt:clip.selectionReview.confirmedAt,scope:'Instruction labels and times only; not a clinical score.'}:null,
    limitation:'Normalized iris positions are not clinical gaze angles. Research thresholds are not NIHSS cutoffs.'};
  if(pending){result.reasons.push(`Choose a result for ${pending} remaining segment${pending===1?'':'s'} first.`);return result;}
  result.methods={
    threePosition:{selected:threePositionEvidence(samples,selectedRanges.three,checked),
      original:threePositionEvidence(originalSamples,originalRanges.three,checked)},
    temporal:{selected:temporalGazeEvidence(samples,selectedRanges.temporal,checked,clip.data.recording.durationSeconds,{fixedWindow}),
      original:temporalGazeEvidence(originalSamples,originalRanges.temporal,checked,clip.data.recording.durationSeconds,{fixedWindow})},
  };
  if(adaptive)result.responseSelection=selectedRanges.proposal;
  if(clip.gazeScoringMode==='three-position'){
    result.threePositions=result.methods.threePosition.selected;result.originalThreePositions=result.methods.threePosition.original;
  }else if(clip.gazeScoringMode==='temporal'){
    result.temporal=result.methods.temporal.selected;result.originalTemporal=result.methods.temporal.original;
  }
  const clinical=clip.clinicalObservation;
  if(clinical?.finding&&clinical.finding!=='unknown'){
    // This maps the examiner's independent examination, not an inference that
    // a missing/short video contains a complete examination or reflex test.
    const mapped=scoreNIHSS({...clinical,useVideoEvidence:false},evidence);
    result.clinical=mapped;result.mode='clinician-observation-rule-mapping';
    result.score=mapped.score;result.candidates=mapped.score===null?[]:[mapped.score];
    result.title=mapped.score===null?'Clinical details incomplete':`NIHSS Best Gaze: ${mapped.score} · examiner-based`;
    result.reasons=[...mapped.basis,...mapped.missing];
    if(!evidence.adequate)result.reasons.push('The video cannot independently support this score; it maps the entered examination findings.');
    if(clinical.finding==='normal'&&evidence.flags.length)result.reasons.push('Video movement flags conflict with the normal finding. Recheck the clip and examination.');
    if(clinical.finding==='normal'&&result.threePositions?.adequate&&result.threePositions.legacyRuleScore!==0)
      result.reasons.push('The three-position rule flags a different pattern from the normal examiner finding. Recheck the selected positions.');
    if(clinical.finding==='normal'&&result.temporal?.adequate&&result.temporal.flags.length)
      result.reasons.push('The temporal assessment flags a different pattern from the normal examiner finding. Recheck the labelled holds.');
    return result;
  }
  if(result.temporal){
    const p=result.temporal;result.mode=p.version;result.candidates=p.candidates;result.candidateScore=p.candidateScore;
    result.title=!p.adequate?'NIHSS · Insufficient evidence':p.candidateScore===null?'NIHSS · Review 1–2':`NIHSS · Possible ${p.candidateScore}`;
    result.reasons=[...p.issues,...p.reasons];
    if(p.adequate&&(result.originalTemporal.adequate!==p.adequate||JSON.stringify(result.originalTemporal.flags)!==JSON.stringify(p.flags)))
      result.reasons.push('Accepted replacements changed the temporal evidence. Compare the original tracking.');
    const estimatedSeconds=Object.values(p.phases).reduce((n,f)=>n+['left','right'].reduce((m,s)=>m+(f[s]?.estimatedSeconds??0),0),0);
    if(estimatedSeconds)result.reasons.push(`${estimatedSeconds.toFixed(2)} eye-seconds include accepted estimates; these are not independent observations.`);
    result.limitation=adaptive?'Experimental response-window assessment. Selection requires tracking across the full instructed observation and a sustained stable position. Resting offset and absent movement are preserved. Thresholds need clinical validation. No model update is involved.':fixedWindow?'Experimental assessment of fixed central windows. Preparation and recording buffers are excluded; missing tracking within the window remains missing. Thresholds need clinical validation. No model update is involved.':'Experimental time-weighted hold assessment. Position and duration thresholds need clinical validation. Resting offset is preserved. No learned model or RL update is involved.';
    return result;
  }
  if(result.threePositions){
    const p=result.threePositions;result.mode='three-position-legacy-rules-v1';
    result.candidates=p.candidates;result.candidateScore=p.candidateScore;
    result.title=!p.adequate?'NIHSS · Select three positions':p.candidateScore===null?'NIHSS · Review 1–2':`NIHSS · Possible ${p.candidateScore}`;
    result.reasons=[...p.issues,...p.reasons];
    if(p.adequate&&(result.originalThreePositions.adequate!==p.adequate||result.originalThreePositions.legacyRuleScore!==p.legacyRuleScore))
      result.reasons.push('Accepted replacements changed the three-position result. Compare with the original tracking.');
    result.limitation='Temporary rule from the earlier three-position tool. Thresholds 0.15 / 0.40 are not clinically validated. No patient-specific recentering is applied.';
    return result;
  }
  if(!evidence.adequate){
    result.title='No video score yet';
    result.reasons.push('Label and capture adequate center, subject-left and subject-right phases. Missing data is not a score of 0.');
    for(const [name,p]of Object.entries(evidence.phases))if(!p.adequate)
      result.reasons.push(`${name}: ${p.validSeconds.toFixed(1)} valid seconds, ${Math.round(p.coverage*100)}% usable coverage.`);
    return result;
  }
  result.reasons=evidenceReasons(evidence);
  if(!evidence.flags.length){
    result.candidates=[0];result.title='Possible 0 · confirm normal gaze';
    result.reasons.unshift('Both eyes show horizontal movement in both labelled directions, without a research-threshold flag. Subtle palsy is not excluded.');
  }else{
    result.candidates=[1,2];result.title='Abnormal pattern · assess 1 vs 2';
    result.reasons.unshift('The clip flags a movement limitation or deviation. Poor task performance or tracking error can also cause this pattern.');
    result.reasons.push('1 requires clinically abnormal gaze without forced deviation / total paresis, or deviation overcome by voluntary or reflex movement. 2 requires forced deviation / total paresis not overcome by the oculocephalic reflex.');
  }
  if(estimated){
    result.reasons.push(`${estimated} accepted eye-position estimates contribute to this summary.`);
    const changed=original.adequate!==evidence.adequate||JSON.stringify(original.flags)!==JSON.stringify(evidence.flags);
    if(changed)result.reasons.push('Accepting replacements changed the movement evidence. Compare the original video before confirming.');
  }
  if(checked.size<samples.length)result.reasons.push(`${samples.length-checked.size} unchecked samples were excluded from scoring evidence.`);
  return result;
}

export function drawEyeMotion(ctx,sample,time){
  const {width:w,height:h}=ctx.canvas,k=w/960;
  ctx.save();ctx.scale(k,h/300);ctx.fillStyle='#0b1520';ctx.fillRect(0,0,960,300);
  ctx.fillStyle='#97b2c4';ctx.font='25px system-ui';ctx.fillText(`${time.toFixed(2)} s`,820,34);
  const state=eyeDiagramState(sample);
  for(const [i,side]of ['right','left'].entries()){
    const x=48+i*480,y=120,width=384,e=state[side],color=side==='right'?'#80baff':'#61dcc3';
    ctx.fillStyle=color;ctx.font='34px system-ui';ctx.fillText(side==='right'?'Right eye':'Left eye',x,70);
    ctx.strokeStyle='#7592a6';ctx.lineWidth=4;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+width,y);ctx.stroke();
    for(const p of [x,x+width]){ctx.beginPath();ctx.moveTo(p,y-12);ctx.lineTo(p,y+12);ctx.stroke();}
    ctx.strokeStyle='#496071';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+width/2,y-7);ctx.lineTo(x+width/2,y+7);ctx.stroke();
    if(e.position!==null){
      const px=x+(1+e.position)*width/2;
      ctx.strokeStyle=ctx.fillStyle=e.kind==='estimated'?'#e4a0ff':color;
      ctx.beginPath();ctx.arc(px,y,11,0,Math.PI*2);
      if(e.kind==='estimated'){ctx.setLineDash([4,3]);ctx.lineWidth=4;ctx.stroke();ctx.setLineDash([]);}else ctx.fill();
    }
    ctx.fillStyle=e.kind==='estimated'?'#e4a0ff':'#c4d6e2';ctx.font='30px system-ui';
    ctx.fillText(e.position===null?e.label:(e.kind==='estimated'?'~ ':'')+e.position.toFixed(3),x,179,400);
  }
  ctx.fillStyle='#96acbd';ctx.font='28px system-ui';
  ctx.fillText('← Subject-right                   Subject-left →',28,235);
  ctx.font='25px system-ui';ctx.fillText('Purple = estimate · Normalized, not degrees',28,279);
  ctx.restore();
}

export function makeEyeMotionRenderer(clip,report){
  const samples=reviewedSamples(clip,report); // Freeze choices and phases for export.
  return (ctx,_video,time)=>{const i=sampleAtTime(samples,time);drawEyeMotion(ctx,i<0?null:samples[i],time);};
}

const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
export function createEyeMotionPlayer({clip,report}){
  const root=el('section'),canvas=el('canvas');root.className='eye-motion-player';Object.assign(canvas,EYE_VIDEO_SIZE);
  canvas.setAttribute('aria-label','Head-relative horizontal eye motion');
  const row=el('div'),play=el('button','Play'),timeLabel=el('span');play.setAttribute('aria-label','Play eye motion');row.className='motion-controls';row.append(play,timeLabel);
  const seek=el('input');seek.type='range';seek.min=0;seek.max=clip.data.recording.durationSeconds;seek.step=.01;seek.value=0;seek.setAttribute('aria-label','Eye motion time');
  root.append(canvas,row,seek);
  let time=0,start=0,raf=null,playing=false,range=null,render=makeEyeMotionRenderer(clip,report);
  function draw(){render(canvas.getContext('2d'),null,time);seek.value=time;timeLabel.textContent=`${time.toFixed(1)} / ${Number(seek.max).toFixed(1)} s`;}
  function pause(){playing=false;cancelAnimationFrame(raf);play.textContent='Play';play.setAttribute('aria-label','Play eye motion');}
  function loop(now){const end=range?.end??Number(seek.max);time=Math.min(end,(now-start)/1000);draw();if(time>=end){pause();return;}raf=requestAnimationFrame(loop);}
  function startPlayback(){if(time>=(range?.end??Number(seek.max)))time=range?.start??0;playing=true;start=performance.now()-time*1000;play.textContent='Pause';play.setAttribute('aria-label','Pause eye motion');raf=requestAnimationFrame(loop);}
  play.onclick=()=>{if(playing){pause();return;}startPlayback();};
  seek.oninput=()=>{pause();range=null;time=Number(seek.value);draw();};draw();
  return {element:root,pause,getTime:()=>time,seekTime(t){pause();range=null;time=Math.max(0,Math.min(Number(seek.max),t));draw();},
    playRange(a,b){pause();if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a||b>Number(seek.max))return;range={start:a,end:b};time=a;draw();startPlayback();},
    refresh(){render=makeEyeMotionRenderer(clip,report);draw();},dispose:pause};
}
