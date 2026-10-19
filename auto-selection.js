import {eyeUsable} from './eye-quality.js';
import {percentile} from './geometry.js';
import {THREE_POSITION_RULES,threePositionEvidence} from './three-position.js';
import {TEMPORAL_RULES} from './temporal-gaze.js';

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

function selectAnchor(samples,checked,phase,quality){
  const radius=THREE_POSITION_RULES.radius,cfg=AUTO_SELECTION_RULES,key=keyFor(phase.phase);
  const start=phase.holdStart+radius,end=phase.end-radius-EPS;
  let last=-Infinity,best=null,evaluated=0;
  for(const sample of samples){
    const time=sample.rawVideoTimeSeconds;
    if(time<start-EPS||time>end+EPS||time-last<cfg.candidateSpacing-EPS)continue;
    last=time;evaluated++;
    const evidence=threePositionEvidence(samples,{[key]:time},checked).positions[key];
    if(!evidence?.adequate)continue;
    // Stable earlier positions cannot stand in for a different sustained endpoint.
    const tailDistance=Math.max(...SIDES.map(side=>Math.abs(evidence[side].median-quality.tailMedian[side])));
    if(tailDistance>cfg.representativeTolerance+EPS)continue;
    const spread=Math.max(...SIDES.map(side=>evidence[side].high-evidence[side].low));
    // Prefer observed, endpoint-representative, stable windows. Resolve ties late.
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
  if(!guidedExam||!['guided-exam-v1','guided-exam-v2'].includes(guidedExam.version)||!Array.isArray(guidedExam.intervals)){
    result.issues.push('This clip has no recorded guided-exam timings. Mark the task phases manually.');return result;
  }
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
    const interval=completed.find(r=>r.phase===phase),provenance=result.provenance.phases[phase]={completed:!!interval};
    if(!interval){result.issues.push(`${labelFor(phase)} was not completed. Record a new exam.`);continue;}
    // B keeps the full instructed hold, including any missing tail or blink.
    result.temporalSelection[phase]={start:interval.holdStart,end:interval.end};
    Object.assign(provenance,{promptStart:interval.start,holdStart:interval.holdStart,end:interval.end,
      temporalSelection:'Full recorded hold; missing samples do not shorten the interval.'});
    if(!validTimeline)continue;
    const quality=phaseQuality(samples,checkedIndices,interval.holdStart,interval.end);provenance.quality=quality;
    if(!quality.adequate){result.issues.push(...quality.issues.map(s=>`${labelFor(phase)}: ${s}`));continue;}
    const anchor=selectAnchor(samples,checkedIndices,interval,quality);provenance.candidateWindows=anchor.evaluated;
    if(!anchor.selected){result.issues.push(`${labelFor(phase)}: no stable, checked window represents the end of the hold. A cannot assess this phase.`);continue;}
    result.threePositionSelection[keyFor(phase)]=anchor.selected.time;
    provenance.selectedPosition=anchor.selected;
  }
  if(guidedExam.status!=='complete')result.issues.push('The guided recording was interrupted. Only completed phases were proposed.');
  result.complete=guidedExam.status==='complete'&&PHASES.every(p=>Number.isFinite(result.threePositionSelection[keyFor(p)])&&result.temporalSelection[p]);
  return result;
}
