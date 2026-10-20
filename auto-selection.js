import {eyeUsable} from './eye-quality.js';
import {percentile} from './geometry.js';
import {THREE_POSITION_RULES,threePositionEvidence} from './three-position.js?v=boundary24';
import {TEMPORAL_RULES} from './temporal-gaze.js?v=independent23';
import {selectResponseWindow,RESPONSE_RULES} from './response-selection.js?v=boundary24';
import {selectIndependentPhase,unavailableMethodPhase,METHOD_SELECTION_RULES} from './method-selection.js?v=boundary24';

// Selection uses recorded instructions, never a direction inferred from eye motion.
// These conservative engineering checks do not establish normal eye movement.
export const AUTO_SELECTION_RULES=Object.freeze({
  tailSeconds:TEMPORAL_RULES.tailSeconds,minTailCoverage:TEMPORAL_RULES.minTailCoverage,
  minCoverage:TEMPORAL_RULES.minCoverage,maxMissingSeconds:TEMPORAL_RULES.maxMissingSeconds,
  maxSampleGap:TEMPORAL_RULES.maxSampleGap,minValidSeconds:TEMPORAL_RULES.minValidSeconds,
  representativeTolerance:.12,candidateSpacing:.1,
});
const PHASES=['center','left','right'],SIDES=['left','right'],EPS=1e-8;
const keyFor=p=>p==='center'?'rest':p;
const labelFor=p=>p==='center'?'Rest':`Subject-${p}`;
const usable=(sample,side)=>eyeUsable(sample,side)&&Math.abs(sample[side].corrected)<=1.2&&
  !['blink','closed','unresolved'].includes(sample.reviewKinds?.[side]);

function phaseQuality(samples,checked,start,end){
  const cfg=AUTO_SELECTION_RULES,cells=[];let cursor=start,maxMissingSeconds=0;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i],ta=a.rawVideoTimeSeconds,tb=b.rawVideoTimeSeconds;
    const lo=Math.max(start,ta),hi=Math.min(end,tb);
    if(hi<=lo||tb-ta>cfg.maxSampleGap+EPS||!checked.has(i-1)||!checked.has(i)||
      !SIDES.every(side=>usable(a,side)&&usable(b,side)))continue;
    maxMissingSeconds=Math.max(maxMissingSeconds,lo-cursor);cursor=hi;
    cells.push({start:lo,end:hi,sourceIndices:[i-1,i],
      estimated:SIDES.some(side=>[a,b].some(s=>s.reviewKinds?.[side]==='estimated'))});
  }
  maxMissingSeconds=Math.max(maxMissingSeconds,end-cursor);
  const seconds=end-start,validSeconds=cells.reduce((n,c)=>n+c.end-c.start,0);
  const tailStart=Math.max(start,end-cfg.tailSeconds),tailValidSeconds=cells.reduce((n,c)=>n+Math.max(0,c.end-Math.max(tailStart,c.start)),0);
  const tailCoverage=tailValidSeconds/(end-tailStart),coverage=validSeconds/seconds;
  const tailRows=samples.map((s,i)=>({s,i})).filter(({s,i})=>s.rawVideoTimeSeconds>=tailStart&&s.rawVideoTimeSeconds<end&&
    checked.has(i)&&SIDES.every(side=>usable(s,side)));
  const tailMedian=Object.fromEntries(SIDES.map(side=>[side,tailRows.length?percentile(tailRows.map(({s})=>s[side].corrected),.5):null]));
  const issues=[];
  if(validSeconds+EPS<cfg.minValidSeconds||coverage+EPS<cfg.minCoverage)issues.push('Not enough checked tracking throughout this hold.');
  if(maxMissingSeconds>cfg.maxMissingSeconds+EPS)issues.push('A tracking gap is too long.');
  if(tailCoverage+EPS<cfg.minTailCoverage||!tailRows.length)issues.push('The end of the hold is not sufficiently visible; an earlier position cannot replace it.');
  return {adequate:!issues.length,issues,seconds,validSeconds,coverage,tailCoverage,maxMissingSeconds,tailMedian,
    estimatedSeconds:cells.filter(c=>c.estimated).reduce((n,c)=>n+c.end-c.start,0),
    sourceIndices:[...new Set(cells.flatMap(c=>c.sourceIndices))]};
}

// Mask indices rather than deleting rows, preserving the original source indices
// and timestamp gaps. Adjacent buffer samples cannot supply boundary evidence.
export function checkedWithinAnalysisWindows(samples,checked,windows){
  const ranges=Object.values(windows??{}).filter(r=>Number.isFinite(r?.start)&&Number.isFinite(r?.end)&&r.end>r.start);
  return new Set([...checked].filter(index=>Number.isFinite(samples[index]?.rawVideoTimeSeconds)&&
    ranges.some(r=>samples[index].rawVideoTimeSeconds>=r.start-EPS&&samples[index].rawVideoTimeSeconds<=r.end+EPS)));
}

function selectAnchor(samples,checked,phase,quality,analysisStart,analysisEnd,fixedWindow=false){
  const radius=THREE_POSITION_RULES.radius,cfg=AUTO_SELECTION_RULES,key=keyFor(phase.phase);
  const start=analysisStart+radius,end=analysisEnd-radius-EPS;
  let last=-Infinity,best=null,evaluated=0;
  const candidates=fixedWindow?[(analysisStart+analysisEnd)/2]:samples.map(sample=>sample.rawVideoTimeSeconds);
  for(const time of candidates){
    if(time<start-EPS||time>end+EPS||time-last<cfg.candidateSpacing-EPS)continue;
    last=time;evaluated++;
    const evidence=threePositionEvidence(samples,{[key]:time},checked).positions[key];
    if(!evidence?.adequate)continue;
    // Stable earlier positions cannot stand in for a different sustained endpoint.
    const tailDistance=Math.max(...SIDES.map(side=>Math.abs(evidence[side].median-quality.tailMedian[side])));
    if(tailDistance>cfg.representativeTolerance+EPS)continue;
    const spread=Math.max(...SIDES.map(side=>evidence[side].high-evidence[side].low));
    // Legacy clips choose an endpoint-representative stable window. V3 evaluates
    // exactly one predetermined midpoint, so quality can reject but never move it.
    const rank=[evidence.estimated/Math.max(1,evidence.count*2),tailDistance,spread,-time];
    const preferable=!best||rank.some((value,i)=>value<best.rank[i]-EPS&&rank.slice(0,i).every((v,j)=>Math.abs(v-best.rank[j])<=EPS));
    if(preferable)best={time,evidence,rank};
  }
  return {selected:best?{time:best.time,...best.evidence}:null,evaluated};
}

export function proposeAutoSelections(samples=[],checkedIndices=new Set(samples.map((_,i)=>i)),guidedExam,duration){
  const result={version:'guided-auto-selection-v1',threePositionSelection:{},temporalSelection:{},issues:[],complete:false,
    provenance:{instructionSource:'Recorded prompt presentation times',selectionSource:'Reviewed, checked eye tracks',
      guidedVersion:guidedExam?.version??null,guidedStatus:guidedExam?.status??null,
      thresholds:{...AUTO_SELECTION_RULES},phases:{},requiresConfirmation:false,
      note:'Recorded instruction labels are retained even when the eyes do not move. No amplitude normalization or reflex inference is performed.'}};
  if(!guidedExam||!['guided-exam-v1','guided-exam-v2','guided-exam-v3','guided-exam-v4'].includes(guidedExam.version)||!Array.isArray(guidedExam.intervals)){
    result.issues.push('This clip has no recorded guided-exam timings. Mark the task phases manually.');return result;
  }
  const adaptive=guidedExam.version==='guided-exam-v4',fixedWindow=guidedExam.version==='guided-exam-v3'||adaptive;
  if(adaptive){
    result.version='guided-independent-method-selection-v2';
    result.provenance.responseThresholds={...RESPONSE_RULES};
    result.provenance.methodThresholds={...METHOD_SELECTION_RULES};
    result.methodStatus=Object.fromEntries(['A','B'].map(method=>[method,{complete:false,availablePhases:[],partialPhases:[],
      phases:Object.fromEntries(PHASES.map(phase=>[phase,unavailableMethodPhase('No valid automatic selection has been established for this phase.')]))}]));
  }
  result.provenance.analysisWindowStrategy=adaptive?'A and B independently select endpoint-representative short and sustained evidence. Response latency is a separate diagnostic.':fixedWindow?'Fixed recorded analysis window; never shifted or shortened by tracking quality or eye movement.':'Legacy full recorded hold.';
  const phases=guidedExam.intervals.filter(r=>PHASES.includes(r?.phase));
  if(PHASES.some(p=>phases.filter(r=>r.phase===p).length>1)){
    result.issues.push('The recorded phase labels are repeated. Review the intervals manually.');return result;
  }
  const validTimeline=samples.every((s,i)=>Number.isFinite(s.rawVideoTimeSeconds)&&s.rawVideoTimeSeconds>=0&&
    (!i||s.rawVideoTimeSeconds>samples[i-1].rawVideoTimeSeconds));
  if(!validTimeline)result.issues.push('Clip timestamps are missing or not strictly increasing; automatic positions were not selected.');
  const completed=phases.filter(r=>r.completed===true);
  if(completed.some(r=>![r.start,r.end,r.holdStart].every(Number.isFinite)||r.start<0||r.holdStart<r.start||r.end<=r.holdStart||
    Number.isFinite(duration)&&r.end>duration+EPS)){
    result.issues.push('The recorded prompt intervals are invalid or outside this clip. Review the intervals manually.');return result;
  }
  const ordered=[...completed].sort((a,b)=>a.start-b.start);
  if(ordered.some((r,i)=>i&&r.start<ordered[i-1].end-EPS)){
    result.issues.push('The recorded prompt intervals overlap. Review the intervals manually.');return result;
  }
  for(const phase of PHASES){
    const recorded=phases.find(r=>r.phase===phase),interval=completed.find(r=>r.phase===phase);
    const provenance=result.provenance.phases[phase]={completed:!!interval,recordedPhase:recorded?structuredClone(recorded):null};
    if(!interval){
      if(adaptive){
        provenance.response={...selectResponseWindow(samples,checkedIndices,recorded??null,null),latencyDiagnostic:true};
        provenance.methods=Object.fromEntries(['A','B'].map(method=>[method,unavailableMethodPhase('This instructed phase was not completed.')]));
        for(const method of ['A','B'])result.methodStatus[method].phases[phase]=provenance.methods[method];
      }
      result.issues.push(`${labelFor(phase)} was not completed. Record a new exam.`);continue;
    }
    Object.assign(provenance,{promptStart:interval.start,holdStart:interval.holdStart,end:interval.end,
      recordedHold:{start:interval.holdStart,end:interval.end},recordedObservation:{start:interval.start,end:interval.end},
      strategy:adaptive?'first-response-stability-with-full-observation-gate':fixedWindow?'fixed-recorded-analysis-window':'legacy-full-recorded-hold'});
    let responseWindow=null;
    if(adaptive){
      const previous=ordered[ordered.indexOf(interval)-1]??null;
      const response={...selectResponseWindow(samples,checkedIndices,interval,previous),latencyDiagnostic:true};
      const methods=selectIndependentPhase(samples,checkedIndices,interval,response);
      Object.assign(provenance,{response,methods,strategy:'independent-endpoint-evidence',
        analysisWindow:methods.B.selection,validAnalysisWindow:methods.B.scoreEligible,
        endpointReference:'Latest visible stable phase endpoint; no maximum-excursion search',
        anchorStrategy:'A selects its own short stable observed run independently of B.',
        temporalSelection:'B selects its own sustained representative interval independently of onset certainty.',
        selectedPosition:methods.A.selection?{...methods.A.selection,...methods.A.eyes}:null});
      for(const method of ['A','B']){
        result.methodStatus[method].phases[phase]=methods[method];
        result.issues.push(...methods[method].issues.map(issue=>`${labelFor(phase)}, ${method}: ${issue}`));
      }
      if(methods.A.selection)result.threePositionSelection[keyFor(phase)]=methods.A.selection.time;
      if(methods.B.selection)result.temporalSelection[phase]={...methods.B.selection};
      continue;
    }
    if(fixedWindow&&!adaptive&&(![interval.analysisStart,interval.analysisEnd].every(Number.isFinite)||
      interval.analysisStart<interval.holdStart||interval.analysisEnd<=interval.analysisStart||interval.analysisEnd>interval.end)){
      provenance.analysisWindow=null;provenance.validAnalysisWindow=false;
      result.issues.push(`${labelFor(phase)}: the recorded analysis window is missing or invalid. No full-hold fallback was used.`);continue;
    }
    const analysisStart=adaptive?responseWindow.start:fixedWindow?interval.analysisStart:interval.holdStart;
    const analysisEnd=adaptive?responseWindow.end:fixedWindow?interval.analysisEnd:interval.end;
    // Fixed v3 windows include every missing sample inside them. Their external
    // buffers are excluded by recorded timing, never by the observed eye motion.
    result.temporalSelection[phase]={start:analysisStart,end:analysisEnd};
    Object.assign(provenance,{analysisWindow:{start:analysisStart,end:analysisEnd},validAnalysisWindow:true,
      excludedBufferSeconds:adaptive?null:{before:analysisStart-interval.holdStart,after:interval.end-analysisEnd,
        total:analysisStart-interval.holdStart+interval.end-analysisEnd},
      outsideStableWindowSeconds:adaptive?{before:analysisStart-interval.start,after:interval.end-analysisEnd,
        note:'These intervals remain mandatory response-gate evidence; they are not discarded.'}:null,
      endpointReference:adaptive?'Stable-window endpoint, with the full observation tail independently checked':fixedWindow?'End of the fixed analysis window':'End of the recorded hold',
      anchorStrategy:adaptive?'Midpoint of the first verified stable window; never searched for a more normal result.':fixedWindow?'Fixed analysis-window midpoint; no search or relocation.':'Legacy stable, endpoint-representative window search.',
      requestedAnchor:fixedWindow?(analysisStart+analysisEnd)/2:null,
      temporalSelection:adaptive?'First joint stable window, valid only with the complete response gate.':fixedWindow?'Full fixed analysis window; missing samples do not shorten or move it.':'Full recorded hold; missing samples do not shorten the interval.'});
    if(!validTimeline)continue;
    const checked=fixedWindow?checkedWithinAnalysisWindows(samples,checkedIndices,{[phase]:result.temporalSelection[phase]}):checkedIndices;
    const quality=phaseQuality(samples,checked,analysisStart,analysisEnd);provenance.quality=quality;
    if(!quality.adequate){result.issues.push(...quality.issues.map(s=>`${labelFor(phase)}: ${s}`));continue;}
    const anchor=selectAnchor(samples,checked,interval,quality,analysisStart,analysisEnd,fixedWindow);provenance.candidateWindows=anchor.evaluated;
    if(!anchor.selected){result.issues.push(fixedWindow?
      `${labelFor(phase)}: the fixed midpoint is not stable, checked and representative of the analysis-window endpoint. A cannot assess this phase; the anchor was not moved.`:
      `${labelFor(phase)}: no stable, checked window represents the end of the hold. A cannot assess this phase.`);continue;}
    result.threePositionSelection[keyFor(phase)]=anchor.selected.time;
    provenance.selectedPosition=anchor.selected;
  }
  if(guidedExam.status!=='complete')result.issues.push('The guided recording was interrupted. Only completed phases were proposed.');
  if(adaptive){
    for(const method of ['A','B']){
      const status=result.methodStatus[method];
      status.availablePhases=PHASES.filter(phase=>!!status.phases[phase]?.selection);
      status.partialPhases=PHASES.filter(phase=>status.phases[phase]?.partial);
      status.complete=PHASES.every(phase=>status.phases[phase]?.scoreEligible);
    }
    result.complete=guidedExam.status==='complete'&&result.methodStatus.A.complete&&result.methodStatus.B.complete;
  }else result.complete=guidedExam.status==='complete'&&PHASES.every(p=>Number.isFinite(result.threePositionSelection[keyFor(p)])&&result.temporalSelection[p]);
  return result;
}
