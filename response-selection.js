import {eyeUsable} from './eye-quality.js';
import {THREE_POSITION_RULES} from './three-position.js?v=adaptive19';
import {TEMPORAL_RULES} from './temporal-gaze.js?v=adaptive19';

// Experimental timing/position parameters, not clinical gaze cutoffs. Instruction
// labels and absolute eye positions are never changed by response detection.
export const RESPONSE_RULES=Object.freeze({
  baselineSeconds:.5,centerBaselineSeconds:.5,minBaselinePoints:3,minBaselineSpan:.25,maxBaselineQueueGap:1,
  minCoverage:.85,maxMissingSeconds:.25,maxSampleGap:.25,tailSeconds:1,minTailCoverage:.8,
  onsetDisplacement:.1,onsetPersistence:.15,stableRange:.1,stableDrift:.035,
  centerStableSeconds:1.5,directionalStableSeconds:2,
  lateChangeDisplacement:.035,lateChangePersistence:.2,
  lateChangeBoundaries:Object.freeze([...new Set([THREE_POSITION_RULES.center,THREE_POSITION_RULES.full,
    TEMPORAL_RULES.restDeviation,TEMPORAL_RULES.fullPosition])].sort((a,b)=>a-b)),
});
const SIDES=['left','right'],EPS=1e-8;
const usable=(s,side)=>eyeUsable(s,side)&&Math.abs(s[side].corrected)<=1.2&&
  !['blink','closed','not-visible','unresolved','deferred','unchecked','buffer'].includes(s.reviewKinds?.[side]);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null;};
function rowsFor(samples,checked,side,start,end){
  return samples.flatMap((s,index)=>s.rawVideoTimeSeconds>=start-EPS&&s.rawVideoTimeSeconds<=end+EPS?
    [{index,time:s.rawVideoTimeSeconds,value:usable(s,side)&&checked.has(index)?s[side].corrected:null,
      kind:s.reviewKinds?.[side]??'original'}]:[]);
}
function measure(rows,start,end){
  let validSeconds=0,cursor=start,maxMissingSeconds=0,tailSeconds=0;
  const tailStart=Math.max(start,end-RESPONSE_RULES.tailSeconds),indices=new Set(),gaps=[];
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i],dt=b.time-a.time;
    if(a.value===null||b.value===null||b.index!==a.index+1||dt>RESPONSE_RULES.maxSampleGap+EPS||dt<=0)continue;
    if(a.time>cursor+EPS)gaps.push({start:cursor,end:a.time});
    maxMissingSeconds=Math.max(maxMissingSeconds,a.time-cursor);cursor=b.time;
    validSeconds+=dt;tailSeconds+=Math.max(0,b.time-Math.max(a.time,tailStart));indices.add(a.index);indices.add(b.index);
  }
  if(end>cursor+EPS)gaps.push({start:cursor,end});
  maxMissingSeconds=Math.max(maxMissingSeconds,end-cursor);
  return {seconds:end-start,validSeconds,coverage:validSeconds/(end-start),maxMissingSeconds,
    tailCoverage:tailSeconds/(end-tailStart),gaps,sourceIndices:[...indices]};
}
function stable(rows,start,end,minimumCoverage=RESPONSE_RULES.minCoverage){
  const within=rows.filter(r=>r.time>=start-EPS&&r.time<=end+EPS),quality=measure(within,start,end);
  const points=within.filter(r=>r.value!==null),values=points.map(r=>r.value),mid=(start+end)/2;
  const first=median(points.filter(r=>r.time<=mid).map(r=>r.value)),last=median(points.filter(r=>r.time>=mid).map(r=>r.value));
  const range=values.length?Math.max(...values)-Math.min(...values):Infinity;
  const drift=first===null||last===null?Infinity:Math.abs(last-first);
  const endpointDrift=values.length?Math.abs(values.at(-1)-values[0]):Infinity;
  return {adequate:points.length>=3&&quality.coverage+EPS>=minimumCoverage&&quality.maxMissingSeconds<=RESPONSE_RULES.maxMissingSeconds+EPS&&
    range<=RESPONSE_RULES.stableRange+EPS&&drift<=RESPONSE_RULES.stableDrift+EPS&&endpointDrift<=RESPONSE_RULES.stableDrift+EPS,
    median:median(values),range:Number.isFinite(range)?range:null,drift:Number.isFinite(drift)?drift:null,
    endpointDrift:Number.isFinite(endpointDrift)?endpointDrift:null,quality};
}
function firstStable(eyeRows,start,end,seconds){
  const times=[start,...eyeRows.left.map(r=>r.time)].filter((t,i,a)=>t>=start-EPS&&t+seconds<=end+EPS&&(!i||t!==a[i-1]));
  for(const time of times){
    const eyes=Object.fromEntries(SIDES.map(side=>[side,stable(eyeRows[side],time,time+seconds)]));
    if(SIDES.every(side=>eyes[side].adequate))return {start:time,end:time+seconds,eyes};
  }
  return null;
}
function baselineEvidence(rows,start,end){
  const points=rows.filter(r=>r.value!==null),first=points[0],last=points.at(-1);
  if(!first||!last)return null;
  // A nominal half-second can contain only 0.375 s of samples at 8 Hz. Judge
  // the observed continuous span, while keeping both boundary gaps explicit.
  const evidence=stable(rows,first.time,last.time,.8),leadingGap=first.time-start,trailingGap=end-last.time;
  const continuous=points.every((row,i)=>!i||(row.index===points[i-1].index+1&&row.time-points[i-1].time<=RESPONSE_RULES.maxSampleGap+EPS));
  return {...evidence,adequate:evidence.adequate&&continuous&&points.length>=RESPONSE_RULES.minBaselinePoints&&
    last.time-first.time+EPS>=RESPONSE_RULES.minBaselineSpan&&leadingGap<=RESPONSE_RULES.maxSampleGap+EPS&&trailingGap<=RESPONSE_RULES.maxSampleGap+EPS,
    nominalWindow:{start,end},observedWindow:{start:first.time,end:last.time},pointCount:points.length,continuous,leadingGap,trailingGap};
}
function firstChange(rows,baseline,reference,phaseStart){
  const cfg=RESPONSE_RULES;let run=null,lastValid=reference;
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(row.value===null){run=null;continue;}
    const delta=row.value-baseline,sign=Math.sign(delta),away=Math.abs(delta)>=cfg.onsetDisplacement-EPS;
    if(away){
      const previous=rows[i-1];
      if(!run||run.sign!==sign||!previous||previous.value===null||row.index!==previous.index+1||row.time-previous.time>cfg.maxSampleGap+EPS){
        // The first changed sample may follow the last pre-cue sample directly.
        // A missing in-phase image or a long reference gap makes its timing
        // uncertain; such a gap must not become an apparent response delay.
        const inPhaseMissing=lastValid&&lastValid.time>=phaseStart-EPS&&row.index!==lastValid.index+1;
        const missingLead=lastValid?.time<phaseStart-EPS&&rows.slice(0,i).some(r=>r.value===null);
        const uncertain=!lastValid||inPhaseMissing||missingLead||row.time-lastValid.time>cfg.maxSampleGap+EPS;
        run={start:row.time,sign,uncertain,bracket:lastValid?{start:lastValid.time,end:row.time}:null};
      }
      if(row.time-run.start+EPS>=cfg.onsetPersistence)return {status:run.uncertain?'onset-uncertain':'response-detected',
        firstOnset:run.start,verifiedAt:row.time,onsetBracket:run.bracket,direction:sign>0?'positive':'negative'};
    }else run=null;
    lastValid=row;
  }
  return {status:'no-detected-response',firstOnset:null,verifiedAt:null,onsetBracket:null,direction:null};
}
function lateChange(rows,start,end,reference){
  let run=null,pending=null,previous=null;
  for(const row of rows){
    if(row.time<start-EPS||row.time>end+EPS)continue;
    if(row.value===null){if(pending)pending.missingEvidence=true;run=null;previous=row;continue;}
    // Preserve the existing A/B category boundaries as well as the stability
    // tolerance: a small sustained change across a scoring boundary cannot be
    // hidden merely because an earlier stable interval looked more normal.
    const crossesBoundary=RESPONSE_RULES.lateChangeBoundaries.some(boundary=>[boundary,-boundary].some(b=>(reference<b)!==(row.value<b)));
    const changed=Math.abs(row.value-reference)>=RESPONSE_RULES.lateChangeDisplacement-EPS||crossesBoundary;
    if(!changed){
      if(pending?.missingEvidence&&row.time-pending.start+EPS>=RESPONSE_RULES.lateChangePersistence)
        return {start:pending.start,verifiedAt:null,status:'unresolved-change-across-missing-evidence'};
      run=null;pending=null;previous=row;continue;
    }
    const sign=Math.sign(row.value-reference);
    if(!pending)pending={start:row.time,missingEvidence:false};
    if(!run||run.sign!==sign||!previous||previous.value===null||row.index!==previous.index+1||row.time-previous.time>RESPONSE_RULES.maxSampleGap+EPS)run={start:row.time,sign};
    if(row.time-run.start+EPS>=RESPONSE_RULES.lateChangePersistence)return {start:run.start,verifiedAt:row.time};
    previous=row;
  }
  // A changed position at the end cannot be dismissed simply because recording
  // ended before the persistence timer elapsed. There is no observed recovery.
  return pending?{start:pending.start,verifiedAt:null,status:'unresolved-change-at-observation-end',missingEvidence:pending.missingEvidence}:null;
}

export function selectResponseWindow(samples,checked,interval,previousInterval=null){
  const cfg=RESPONSE_RULES,phase=interval?.phase;
  const response={version:'response-selection-v1',status:'insufficient-evidence',adequate:false,
    observation:interval?structuredClone(interval):null,eyes:{},baseline:null,
    gate:{adequate:false,issues:[],quality:{}},selectedWindow:null,proposedWindow:null,
    responseStart:null,waitingDuration:null,jointSettleStart:null,lateChangeDetected:false,thresholds:{...cfg},
    strategy:'First verified response and first joint stable window, gated by the complete instructed observation; no maximum-excursion search.'};
  const reject=message=>response.gate.issues.push(message);
  if(!interval?.completed||![interval.start,interval.holdStart,interval.end].every(Number.isFinite)||
    interval.start<0||interval.holdStart<interval.start||interval.end<=interval.holdStart){reject('The instructed observation was not completed.');return response;}
  if(!['center','left','right'].includes(phase)){reject('The instruction label is invalid.');return response;}
  if(samples.some((s,i)=>!Number.isFinite(s.rawVideoTimeSeconds)||(i&&s.rawVideoTimeSeconds<=samples[i-1].rawVideoTimeSeconds))){
    reject('Observation timestamps are missing or not strictly increasing.');return response;
  }
  const eyeRows=Object.fromEntries(SIDES.map(side=>[side,rowsFor(samples,checked,side,interval.start,interval.end)]));
  for(const side of SIDES){
    const quality=measure(eyeRows[side],interval.start,interval.end);response.gate.quality[side]=quality;
    if(quality.coverage+EPS<cfg.minCoverage)reject(`${side}: too little tracking across the full response observation.`);
    if(quality.maxMissingSeconds>cfg.maxMissingSeconds+EPS)reject(`${side}: a full-observation tracking gap could hide the response.`);
    if(quality.tailCoverage+EPS<cfg.minTailCoverage)reject(`${side}: the observation tail is not sufficiently visible.`);
  }
  let baselineStart,baselineEnd;
  if(phase==='center'){
    baselineStart=interval.start;baselineEnd=interval.start+cfg.centerBaselineSeconds;
    response.baseline={source:'Initial visible center-phase position; no recentering',start:baselineStart,end:baselineEnd,gapSeconds:0};
  }else{
    const validPrevious=previousInterval?.completed&&Number.isFinite(previousInterval.end)&&previousInterval.end<=interval.start+EPS;
    baselineEnd=validPrevious?previousInterval.end:null;baselineStart=validPrevious?Math.max(previousInterval.start,baselineEnd-cfg.baselineSeconds):null;
    const gap=validPrevious?interval.start-baselineEnd:null;
    response.baseline={source:'Previous instructed phase tail; event reference only, not normalization',start:baselineStart,end:baselineEnd,
      gapSeconds:gap,allowedQueueGapSeconds:cfg.maxBaselineQueueGap};
    if(!validPrevious||gap>cfg.maxBaselineQueueGap+EPS)reject('The pre-cue reference is missing or separated by too long an unobserved interval.');
  }
  for(const side of SIDES){
    const rows=Number.isFinite(baselineStart)?rowsFor(samples,checked,side,baselineStart,baselineEnd):[];
    const evidence=rows.length?baselineEvidence(rows,baselineStart,baselineEnd):null;
    const e=response.eyes[side]={status:'baseline-unavailable',baseline:evidence,firstOnset:null,settleStart:null,lateChange:null};
    if(!evidence?.adequate){reject(`${side}: no stable visible reference for response detection.`);continue;}
    const reference=rows.filter(r=>r.value!==null).at(-1);
    const search=phase==='center'?eyeRows[side].filter(r=>r.time>=baselineEnd-EPS):eyeRows[side];
    Object.assign(e,firstChange(search,evidence.median,reference,interval.start));
    if(e.status==='onset-uncertain')reject(`${side}: the first change crosses missing evidence; it is not a verified delayed response.`);
  }
  const onsetTimes=SIDES.map(side=>response.eyes[side].firstOnset).filter(Number.isFinite);
  response.responseStart=onsetTimes.length?Math.min(...onsetTimes):null;
  response.waitingDuration=response.responseStart===null?interval.end-interval.start:response.responseStart-interval.start;
  const searchStart=Math.max(interval.start,...onsetTimes),hold=phase==='center'?cfg.centerStableSeconds:cfg.directionalStableSeconds;
  for(const side of SIDES){
    const rows=eyeRows[side],e=response.eyes[side],individual=firstStable({left:rows,right:rows},e.firstOnset??interval.start,interval.end,hold);
    if(individual){
      e.settleStart=individual.start;e.stableWindow={start:individual.start,end:individual.end};e.stableEvidence=individual.eyes.left;
      const later=lateChange(rows,individual.end,interval.end,individual.eyes.left.median);e.lateChange=later;
      if(later){response.lateChangeDetected=true;reject(`${side}: movement changed after its first stable window; a later joint hold cannot hide it.`);}
    }
  }
  // Full-phase scanning first establishes each eye's first onset or no response.
  // An eye that never moves is still required to be visible and stable here.
  const candidate=firstStable(eyeRows,searchStart,interval.end,hold);
  if(candidate){
    response.proposedWindow={start:candidate.start,end:candidate.end};response.jointSettleStart=candidate.start;
    for(const side of SIDES){
      response.eyes[side].jointStableEvidence=candidate.eyes[side];
      const later=lateChange(eyeRows[side],candidate.end,interval.end,candidate.eyes[side].median);
      if(later&&!response.eyes[side].lateChange){response.eyes[side].lateChange=later;response.lateChangeDetected=true;
        reject(`${side}: movement changed after the first joint stable window; an earlier clean hold cannot hide it.`);}
    }
  }else reject('No first joint stable window was sustained for the required duration.');
  if(SIDES.some(side=>response.eyes[side].status==='baseline-unavailable'))response.gate.adequate=false;
  response.gate.adequate=response.gate.issues.length===0;
  response.adequate=response.gate.adequate&&!!candidate;
  if(response.adequate){
    response.selectedWindow={...response.proposedWindow};
    response.status=SIDES.every(side=>response.eyes[side].status==='no-detected-response')?'no-detected-response':'response-observed';
  }
  return response;
}
