import {eyeUsable} from './eye-quality.js';

// Experimental normalized-position thresholds, not clinical NIHSS cutoffs.
// All durations use clip timestamps; no assumption of a fixed camera FPS.
export const TEMPORAL_RULES=Object.freeze({
  settleSeconds:.25,minValidSeconds:.7,minCoverage:.75,maxSampleGap:.25,
  maxMissingSeconds:.3,tailSeconds:.5,minTailCoverage:.7,
  minHoldSeconds:.4,holdTolerance:.12,centerSpread:.2,
  fullPosition:.4,minExcursion:.12,restDeviation:.22,maxAsymmetry:.18,
});
const SIDES=['left','right'],PHASES=['center','left','right'];
const label=p=>p==='center'?'Rest':`Look ${p}`;
const EPS=1e-8;
function quantile(cells,q,value=c=>c.value){
  if(!cells.length)return null;
  const sorted=cells.map(c=>({value:value(c),weight:c.end-c.start})).sort((a,b)=>a.value-b.value);
  const target=sorted.reduce((n,c)=>n+c.weight,0)*q;let sum=0;
  for(const c of sorted){sum+=c.weight;if(sum+EPS>=target)return c.value;}
  return sorted.at(-1).value;
}
function longestRun(cells,test){
  let run=0,best=0,end=-Infinity;
  for(const c of cells){
    run=test(c)?(c.start<=end+EPS?run:0)+c.end-c.start:0;
    best=Math.max(best,run);end=c.end;
  }
  return best;
}
function eyeEvidence(samples,checked,side,start,end,direction,cfg){
  const cells=[],indices=new Set();let blinkCount=0,estimatedCount=0;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i],ta=a.rawVideoTimeSeconds,tb=b.rawVideoTimeSeconds;
    const lo=Math.max(start,ta),hi=Math.min(end,tb);
    if(hi<=lo)continue;
    if(['blink','closed'].includes(b.reviewKinds?.[side]))blinkCount++;
    if(tb-ta>cfg.maxSampleGap+EPS||!checked.has(i-1)||!checked.has(i)||
      !eyeUsable(a,side)||!eyeUsable(b,side)||
      [a,b].some(s=>['blink','closed','unresolved'].includes(s.reviewKinds?.[side])))continue;
    const x=a[side].corrected,y=b[side].corrected;
    // Reject impossible/out-of-range values even if a caller marks them valid.
    if(Math.max(Math.abs(x),Math.abs(y))>1.2)continue;
    const estimated=[a,b].some(s=>s.reviewKinds?.[side]==='estimated');
    cells.push({start:lo,end:hi,value:(x+y)/2,x,y,estimated});indices.add(i-1);indices.add(i);
    if(estimated)estimatedCount++;
  }
  const seconds=end-start,validSeconds=cells.reduce((n,c)=>n+c.end-c.start,0);
  const tailStart=Math.max(start,end-cfg.tailSeconds);
  const tailValidSeconds=cells.reduce((n,c)=>n+Math.max(0,c.end-Math.max(c.start,tailStart)),0);
  let cursor=start,maxMissingSeconds=0;
  for(const c of cells){maxMissingSeconds=Math.max(maxMissingSeconds,c.start-cursor);cursor=c.end;}
  maxMissingSeconds=Math.max(maxMissingSeconds,end-cursor);
  const median=quantile(cells,.5),p10=quantile(cells,.1),p90=quantile(cells,.9);
  const endpoint=direction?quantile(cells,.9,c=>direction*c.value):median;
  const holdSeconds=endpoint===null?0:longestRun(cells,c=>[c.x,c.y].every(x=>Math.abs((direction||1)*x-endpoint)<=cfg.holdTolerance+EPS));
  const fullHoldSeconds=direction?longestRun(cells,c=>Math.min(direction*c.x,direction*c.y)+EPS>=cfg.fullPosition):0;
  const coverage=seconds>0?validSeconds/seconds:0,tailCoverage=end>tailStart?tailValidSeconds/(end-tailStart):0;
  const issues=[];
  if(validSeconds+EPS<cfg.minValidSeconds||coverage+EPS<cfg.minCoverage)issues.push('too little usable tracking');
  if(maxMissingSeconds>cfg.maxMissingSeconds+EPS)issues.push('a tracking gap is too long');
  if(tailCoverage+EPS<cfg.minTailCoverage)issues.push('the end of the hold is not sufficiently visible');
  if(holdSeconds+EPS<cfg.minHoldSeconds)issues.push('no sustained, stable position');
  if(!direction&&p90!==null&&p90-p10>cfg.centerSpread+EPS)issues.push('rest position is unstable');
  // A brief threshold crossing is inconclusive, not proof of full excursion.
  if(direction&&endpoint+EPS>=cfg.fullPosition&&fullHoldSeconds+EPS<cfg.minHoldSeconds)issues.push('full excursion is only brief');
  return {adequate:!issues.length,issues,seconds,validSeconds,coverage,tailCoverage,maxMissingSeconds,
    median,p10,p90,endpoint,holdSeconds,fullHoldSeconds,sourceIndices:[...indices],
    estimatedCells:estimatedCount,estimatedSeconds:cells.filter(c=>c.estimated).reduce((n,c)=>n+c.end-c.start,0),blinkOrClosedSamples:blinkCount};
}

export function temporalGazeEvidence(samples,selection={},checkedIndices=new Set(samples.map((_,i)=>i)),duration){
  const cfg=TEMPORAL_RULES,result={version:'temporal-holds-v1',adequate:false,candidateScore:null,candidates:[],
    issues:[],reasons:[],flags:[],phases:{},excursions:{},thresholds:{...cfg},intervals:[],
    note:'Experimental movement evidence. Directions must be labelled from the instructed task, not inferred from the measured movement.'};
  if(samples.some((s,i)=>!Number.isFinite(s.rawVideoTimeSeconds)||s.rawVideoTimeSeconds<0||
    (i>0&&s.rawVideoTimeSeconds<=samples[i-1].rawVideoTimeSeconds))){
    result.issues.push('Clip timestamps are missing or not strictly increasing.');return result;
  }
  for(const phase of PHASES){
    const r=selection[phase];
    if(!Number.isFinite(r?.start)||!Number.isFinite(r?.end))result.issues.push(`Mark the start and end of ${label(phase).toLowerCase()}.`);
    else if(r.start<0||r.end<=r.start||Number.isFinite(duration)&&r.end>duration+EPS)result.issues.push(`${label(phase)}: choose an ordered interval within this clip.`);
    else if(r.end-r.start<cfg.settleSeconds+cfg.minValidSeconds-EPS)result.issues.push(`${label(phase)}: select a hold of at least ${(cfg.settleSeconds+cfg.minValidSeconds).toFixed(2)} s.`);
    else result.intervals.push({phase,start:r.start,end:r.end});
  }
  result.intervals.sort((a,b)=>a.start-b.start);
  if(result.intervals.some((r,i)=>i&&r.start<result.intervals[i-1].end-EPS))result.issues.push('The three hold intervals must not overlap.');
  if(result.issues.length)return result;
  for(const r of result.intervals){
    const phase=result.phases[r.phase]={start:r.start,end:r.end,analysisStart:r.start+cfg.settleSeconds};
    for(const side of SIDES){
      phase[side]=eyeEvidence(samples,checkedIndices,side,phase.analysisStart,r.end,r.phase==='center'?0:r.phase==='left'?1:-1,cfg);
      for(const issue of phase[side].issues)result.issues.push(`${label(r.phase)}, ${side} eye: ${issue}.`);
    }
  }
  if(result.issues.length)return result;
  result.adequate=true;
  for(const side of SIDES){
    const rest=result.phases.center[side].median;
    result.excursions[side]={};
    if(Math.abs(rest)>cfg.restDeviation)result.flags.push(`${side}:rest-offset`);
    for(const direction of ['left','right']){
      const e=result.phases[direction][side],sign=direction==='left'?1:-1,excursion=e.endpoint-sign*rest;
      result.excursions[side][direction]=excursion;
      if(e.endpoint<cfg.fullPosition-EPS||excursion<cfg.minExcursion-EPS)result.flags.push(`${side}:${direction}:limited-movement`);
      result.reasons.push(`${side==='left'?'Left':'Right'} eye toward subject-${direction}: excursion ${excursion.toFixed(2)}, stable hold ${e.holdSeconds.toFixed(2)} s.`);
    }
  }
  for(const direction of ['left','right']){
    if(Math.abs(result.excursions.left[direction]-result.excursions.right[direction])>cfg.maxAsymmetry)result.flags.push(`${direction}:asymmetry`);
  }
  const restL=result.phases.center.left.median,restR=result.phases.center.right.median;
  const conjugateOffset=Math.sign(restL)===Math.sign(restR)&&Math.min(Math.abs(restL),Math.abs(restR))>cfg.restDeviation;
  // Failure to cross midline cannot distinguish poor effort, paresis, or forced deviation.
  const bilateralNonCrossing=['left','right'].some(d=>SIDES.every(s=>result.phases[d][s].endpoint<=0));
  if(!result.flags.length){result.candidateScore=0;result.candidates=[0];result.reasons.unshift('Both eyes sustained movement in both directions without a research-threshold flag.');}
  else if(conjugateOffset||bilateralNonCrossing){result.candidates=[1,2];result.reasons.unshift('Bilateral limitation or a conjugate resting offset needs examination to distinguish 1 from 2.');}
  else{result.candidateScore=1;result.candidates=[1];result.reasons.unshift('A sustained limitation, resting offset or asymmetry suggests review for partial gaze palsy. Tracking error or task performance may also explain it.');}
  if(result.flags.length)result.reasons.push('Flags: '+result.flags.join('; ')+'.');
  result.reasons.push('Adequate measured movement does not exclude subtle palsy. Score 2 requires independent clinical findings; no reflex result is inferred.');
  return result;
}
