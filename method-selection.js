import {eyeUsable} from './eye-quality.js';
import {THREE_POSITION_RULES} from './three-position.js?v=independent23';
import {TEMPORAL_RULES} from './temporal-gaze.js?v=independent23';

// Engineering selection parameters. Selection never optimizes a clinical score
// or the magnitude/direction of movement. A and B need different evidence.
export const METHOD_SELECTION_RULES=Object.freeze({
  aDurations:Object.freeze([.5,.35,.25,.2]),aMinSpan:.15,aMinPoints:3,
  bDurations:Object.freeze([1.5,1.25,1,.8]),bMinVisibleSeconds:.7,bMinCoverage:.75,
  maxSampleGap:.25,maxUnknownGap:.3,maxConfirmedBlinkGap:.55,
  endpointLookback:.8,maxEndpointMissing:.35,endpointTolerance:.035,
  stableRange:.1,stableDrift:.035,earlierLongGap:.75,
});
const SIDES=['left','right'],EPS=1e-8;
const missingKinds=new Set(['blink','closed','not-visible','unresolved','deferred','unchecked','buffer']);
const boundaries=[THREE_POSITION_RULES.center,THREE_POSITION_RULES.full,TEMPORAL_RULES.restDeviation,TEMPORAL_RULES.fullPosition];
const median=values=>{const a=[...values].sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const category=x=>boundaries.map(c=>x<=-c?-1:x>=c?1:0).join(',');
const usable=(s,side)=>eyeUsable(s,side)&&Math.abs(s[side].corrected)<=1.2&&!missingKinds.has(s.reviewKinds?.[side])&&s.reviewScope!=='buffer';

function rowsFor(samples,checked,side,interval){
  return samples.flatMap((s,index)=>s.rawVideoTimeSeconds>=interval.start-EPS&&s.rawVideoTimeSeconds<interval.end-EPS?[{
    index,time:s.rawVideoTimeSeconds,value:checked.has(index)&&usable(s,side)?s[side].corrected:null,
    kind:s.reviewKinds?.[side]??'original',reasons:s[side]?.reasons??[],
  }]:[]);
}

function measure(rows,start,end){
  const cfg=METHOD_SELECTION_RULES,cells=[],gaps=[];let cursor=start;
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i],dt=b.time-a.time;
    if(a.value===null||b.value===null||b.index!==a.index+1||dt<=0||dt>cfg.maxSampleGap+EPS)continue;
    const lo=Math.max(start,a.time),hi=Math.min(end,b.time);if(hi<=lo)continue;
    if(lo>cursor+EPS)gaps.push({start:cursor,end:lo});
    cells.push({start:lo,end:hi});cursor=hi;
  }
  if(end>cursor+EPS)gaps.push({start:cursor,end});
  for(const gap of gaps){
    const missing=rows.filter(r=>r.time>gap.start-EPS&&r.time<gap.end+EPS&&r.value===null);
    const before=rows.some(r=>r.value!==null&&r.time<=gap.start+EPS),after=rows.some(r=>r.value!==null&&r.time>=gap.end-EPS);
    gap.seconds=gap.end-gap.start;
    gap.kind=missing.length&&missing.every(r=>r.kind==='blink')&&before&&after?'confirmed-blink':'unknown';
    gap.sourceIndices=missing.map(r=>r.index);
  }
  const visibleSeconds=cells.reduce((n,c)=>n+c.end-c.start,0),seconds=Math.max(0,end-start);
  let run=0,longestVisibleRun=0,previousEnd=-Infinity;
  for(const cell of cells){
    run=(cell.start<=previousEnd+EPS?run:0)+cell.end-cell.start;
    longestVisibleRun=Math.max(longestVisibleRun,run);previousEnd=cell.end;
  }
  return {seconds,visibleSeconds,coverage:seconds?visibleSeconds/seconds:0,longestVisibleRun,gaps,
    maxUnknownGap:Math.max(0,...gaps.filter(g=>g.kind==='unknown').map(g=>g.seconds)),
    confirmedBlinkSeconds:gaps.filter(g=>g.kind==='confirmed-blink').reduce((n,g)=>n+g.seconds,0),
    observedPoints:rows.filter(r=>r.value!==null).length};
}

function stable(rows,start,end){
  const points=rows.filter(r=>r.value!==null),values=points.map(r=>r.value),mid=(start+end)/2;
  const first=median(points.filter(r=>r.time<=mid+EPS).map(r=>r.value)),last=median(points.filter(r=>r.time>=mid-EPS).map(r=>r.value));
  const range=values.length?Math.max(...values)-Math.min(...values):Infinity;
  const drift=first===null||last===null?Infinity:Math.abs(last-first);
  const endpointDrift=values.length?Math.abs(values.at(-1)-values[0]):Infinity;
  return {stable:points.length>=3&&range<=METHOD_SELECTION_RULES.stableRange+EPS&&drift<=METHOD_SELECTION_RULES.stableDrift+EPS&&endpointDrift<=METHOD_SELECTION_RULES.stableDrift+EPS,
    median:median(values),range:Number.isFinite(range)?range:null,drift:Number.isFinite(drift)?drift:null,
    endpointDrift:Number.isFinite(endpointDrift)?endpointDrift:null,count:points.length,sourceIndices:points.map(r=>r.index)};
}

function endpointReference(rows,interval){
  const cfg=METHOD_SELECTION_RULES,visible=rows.filter(r=>r.value!==null),last=visible.at(-1),issues=[];
  if(!last)return {adequate:false,status:'unmeasured',issues:['No checked eye position is visible in this instructed phase.'],criticalGaps:[{start:interval.start,end:interval.end,kind:'unmeasured'}]};
  const tailGap=interval.end-last.time,tailRows=rows.filter(r=>r.time>last.time+EPS);
  const explicitlyUnresolved=tailRows.some(r=>['closed','not-visible','deferred','unresolved'].includes(r.kind)||r.reasons.some(reason=>['iris-outside-eye','eye-out-of-frame'].includes(reason)));
  if(tailGap>cfg.maxEndpointMissing+EPS||explicitlyUnresolved){
    return {adequate:false,status:'endpoint-unobserved',issues:[explicitlyUnresolved?'The final eye position is explicitly unresolved or not visible.':'The final eye position is hidden by a long tracking gap.'],
      tailMissingSeconds:tailGap,criticalGaps:[{start:last.time,end:interval.end,kind:explicitlyUnresolved?'unresolved-endpoint':'unknown-endpoint'}]};
  }
  // Find a stable observed suffix, not a maximum excursion. Its position can
  // be central, limited or opposite to the instruction and is kept unchanged.
  let best=null;
  const starts=visible.filter(r=>r.time>=last.time-cfg.endpointLookback-EPS);
  for(const first of starts){
    const within=rows.filter(r=>r.time>=first.time-EPS&&r.time<=last.time+EPS),quality=measure(within,first.time,last.time),evidence=stable(within,first.time,last.time);
    if(last.time-first.time+EPS<cfg.aMinSpan||quality.visibleSeconds+EPS<cfg.aMinSpan||!evidence.stable||
      quality.gaps.some(g=>g.seconds>(g.kind==='confirmed-blink'?cfg.maxConfirmedBlinkGap:cfg.maxUnknownGap)+EPS))continue;
    best={adequate:true,status:'visible',start:first.time,end:last.time,median:evidence.median,tailMissingSeconds:tailGap,
      evidence,quality,issues,criticalGaps:[]};break;
  }
  return best??{adequate:false,status:'endpoint-unstable',issues:['No short stable observed position represents the phase ending.'],tailMissingSeconds:tailGap,
    criticalGaps:[{start:Math.max(interval.start,last.time-cfg.endpointLookback),end:interval.end,kind:'unstable-endpoint'}]};
}

function evaluateWindow(rows,start,end,method,reference){
  const within=rows.filter(r=>r.time>=start-EPS&&r.time<=end+EPS),quality=measure(within,start,end),evidence=stable(within,start,end);
  const cfg=METHOD_SELECTION_RULES,issues=[];
  if(!reference.adequate)issues.push(...reference.issues);
  if(!evidence.stable)issues.push('The observed eye position is not stable in this window.');
  if(method==='A'){
    if(within.some(r=>r.value===null)||quality.maxUnknownGap>cfg.maxSampleGap+EPS||
      evidence.count<cfg.aMinPoints||quality.visibleSeconds+EPS<cfg.aMinSpan)issues.push('A needs a short adjacent visible run.');
  }else{
    if(quality.visibleSeconds+EPS<cfg.bMinVisibleSeconds||quality.coverage+EPS<cfg.bMinCoverage)issues.push('B needs enough visible time in a sustained interval.');
    if(quality.gaps.some(g=>g.seconds>(g.kind==='confirmed-blink'?cfg.maxConfirmedBlinkGap:cfg.maxUnknownGap)+EPS))issues.push('An unresolved gap is too long inside the sustained interval.');
    // Use B's own evidence requirements when choosing its interval, so a
    // recent brief dropout cannot select an unusable tail over a supported
    // interval that still agrees with the independently observed endpoint.
    const tailStart=Math.max(start,end-TEMPORAL_RULES.tailSeconds);
    const tail=measure(within,tailStart,end);
    quality.tailCoverage=tail.coverage;
    if(tail.coverage+EPS<TEMPORAL_RULES.minTailCoverage)issues.push('The end of B’s interval is not sufficiently visible.');
    if(quality.longestVisibleRun+EPS<TEMPORAL_RULES.minHoldSeconds)issues.push('B needs a sustained adjacent visible hold.');
  }
  if(reference.adequate&&evidence.median!==null&&(Math.abs(evidence.median-reference.median)>cfg.endpointTolerance+EPS||category(evidence.median)!==category(reference.median)))
    issues.push('The window does not represent the later observed endpoint.');
  return {adequate:issues.length===0,status:issues.length?'insufficient':'available',median:evidence.median,
    windowQuality:quality,evidence,endpointReference:reference,issues};
}

function visibleReversals(rows,interval,diagnostic){
  const cfg=METHOD_SELECTION_RULES,plateaus=[];
  for(const last of rows){
    if(last.value===null||last.time<interval.holdStart)continue;
    const within=rows.filter(r=>r.time>=Math.max(interval.holdStart,last.time-.35)-EPS&&r.time<=last.time+EPS);
    if(within.length<3||within.some(r=>r.value===null)||last.time-within[0].time<.15-EPS)continue;
    const evidence=stable(within,within[0].time,last.time);if(!evidence.stable)continue;
    const prior=plateaus.at(-1);
    if(prior&&Math.abs(prior.median-evidence.median)<=cfg.stableDrift+EPS&&category(prior.median)===category(evidence.median))prior.end=last.time;
    else plateaus.push({start:within[0].time,end:last.time,median:evidence.median});
  }
  let baseline=diagnostic?.baseline?.adequate?diagnostic.baseline.median:null;
  if(baseline===null){
    const initial=rows.filter(r=>r.time<=interval.start+.35+EPS),e=stable(initial,interval.start,interval.start+.35);
    if(initial.length>=3&&initial.every(r=>r.value!==null)&&e.stable)baseline=e.median;
  }
  const reversals=[];let direction=0,previous=baseline;
  for(const plateau of plateaus){
    if(previous!==null){
      const delta=plateau.median-previous,sign=Math.abs(delta)>cfg.stableDrift+EPS?Math.sign(delta):0;
      if(sign&&direction&&sign!==direction)reversals.push({start:plateau.start,end:plateau.end,from:previous,to:plateau.median,kind:'visible-position-reversal'});
      if(sign)direction=sign;
    }
    previous=plateau.median;
  }
  return {plateaus,reversals};
}

export function unavailableMethodPhase(reason){
  return {status:'insufficient',adequate:false,scoreEligible:false,normalEligible:false,availableEyes:[],partial:false,
    selection:null,eyes:Object.fromEntries(SIDES.map(side=>[side,{adequate:false,status:'insufficient',issues:[reason]}])),
    issues:[reason],cautions:[],observationQuality:{},criticalGaps:[],laterChanges:[]};
}

export function selectIndependentPhase(samples,checked,interval,latencyDiagnostic=null){
  const cfg=METHOD_SELECTION_RULES;
  if(!interval?.completed||![interval.start,interval.holdStart,interval.end].every(Number.isFinite)||interval.start<0||interval.holdStart<interval.start||interval.end<=interval.holdStart||
    samples.some((s,i)=>!Number.isFinite(s.rawVideoTimeSeconds)||(i&&s.rawVideoTimeSeconds<=samples[i-1].rawVideoTimeSeconds))){
    const reason='This phase has no valid completed instruction interval and timestamp sequence.';
    return {A:unavailableMethodPhase(reason),B:unavailableMethodPhase(reason)};
  }
  const eyeRows=Object.fromEntries(SIDES.map(side=>[side,rowsFor(samples,checked,side,interval)]));
  const references=Object.fromEntries(SIDES.map(side=>[side,endpointReference(eyeRows[side],interval)]));
  const quality=Object.fromEntries(SIDES.map(side=>[side,measure(eyeRows[side],interval.start,interval.end)]));
  const changes=Object.fromEntries(SIDES.map(side=>[side,visibleReversals(eyeRows[side],interval,latencyDiagnostic?.eyes?.[side])]));
  const times=eyeRows.left.map(r=>r.time).reverse(),result={};
  for(const method of ['A','B']){
    let best=null;
    for(const end of times)for(const duration of method==='A'?cfg.aDurations:cfg.bDurations){
      const available=eyeRows.left.filter(r=>r.time>=Math.max(interval.start,end-duration)-EPS&&r.time<=end+EPS);
      if(!available.length)continue;
      const start=available[0].time,eyes=Object.fromEntries(SIDES.map(side=>[side,evaluateWindow(eyeRows[side],start,end,method,references[side])]));
      const good=SIDES.filter(side=>eyes[side].adequate);
      if(!good.length)continue;
      // Latest representative evidence wins; longer same-end windows win only
      // after available-eye count. No position magnitude enters this ranking.
      const rank=[good.length,end,end-start];
      const better=!best||rank.some((value,i)=>value>best.rank[i]+EPS&&rank.slice(0,i).every((v,j)=>Math.abs(v-best.rank[j])<=EPS));
      if(better)best={rank,start,end,eyes,good};
    }
    const criticalGaps=SIDES.flatMap(side=>references[side].criticalGaps.map(g=>({...g,eye:side})));
    const laterChanges=SIDES.flatMap(side=>changes[side].reversals.map(c=>({...c,eye:side})));
    const cautions=[];
    for(const side of SIDES){
      const earlier=quality[side].gaps.filter(g=>g.kind==='unknown'&&g.seconds>cfg.earlierLongGap&&g.end<(references[side].start??interval.end)-EPS);
      if(earlier.length)cautions.push(`${side}: earlier missing tracking limits response timing; the later visible endpoint is assessed separately.`);
      const brief=quality[side].gaps.filter(g=>g.sourceIndices.length&&g.seconds<=(g.kind==='confirmed-blink'?cfg.maxConfirmedBlinkGap:cfg.maxUnknownGap)+EPS);
      if(brief.length)cautions.push(`${side}: brief blink or tracking gaps were excluded; no positions were interpolated.`);
      if(references[side].adequate&&references[side].tailMissingSeconds>cfg.maxSampleGap+EPS)cautions.push(`${side}: a short final tracking gap remains outside the observed endpoint.`);
      if(latencyDiagnostic?.eyes?.[side]&&['baseline-unavailable','onset-uncertain'].includes(latencyDiagnostic.eyes[side].status))
        cautions.push(`${side}: response latency is unavailable; this does not invalidate a visible stable endpoint.`);
    }
    if(laterChanges.length)cautions.push('Visible position reversals are retained; a final stable position does not erase earlier changes.');
    if(!best){
      const reason=method==='A'?'No short stable observed run represents this phase ending.':'No sustained visible interval represents this phase ending.';
      result[method]={...unavailableMethodPhase(reason),observationQuality:quality,criticalGaps,laterChanges,cautions,
        eyes:Object.fromEntries(SIDES.map(side=>[side,{adequate:false,status:references[side].status,endpointReference:references[side],issues:references[side].adequate?[reason]:references[side].issues}]))};
      continue;
    }
    const partial=best.good.length<2,eligible=!partial;
    result[method]={status:partial?'partial':cautions.length?'caution':'available',adequate:eligible,scoreEligible:eligible,
      normalEligible:eligible&&!laterChanges.length,availableEyes:best.good,partial,
      selection:method==='A'?{time:(best.start+best.end)/2,start:best.start,end:best.end}:{start:best.start,end:best.end},
      eyes:best.eyes,issues:SIDES.filter(side=>!best.eyes[side].adequate).flatMap(side=>best.eyes[side].issues.map(issue=>`${side}: ${issue}`)),
      cautions,observationQuality:quality,criticalGaps,laterChanges,
      observedPlateaus:changes,selectionPolicy:'Most available eyes, then latest endpoint-representative stable evidence; no score or movement-amplitude ranking.'};
  }
  return result;
}
