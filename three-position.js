import {percentile} from './geometry.js';
import {eyeUsable} from './eye-quality.js';

// Ported from Honghao's local NIHSS/index.html: code() and scoreGaze().
// The legacy offsets and current corrected offsets both use half eye width.
// Current coordinates are positive toward subject-left; legacy codes are negative.
// These are engineering thresholds, NOT calibrated NIHSS diagnostic cutoffs.
export const THREE_POSITION_RULES=Object.freeze({center:.15,full:.40,radius:.25,minSamples:3,minSpan:.1,maxGap:.25,maxSpread:.25,anchorTolerance:.12});
export const POSITION_NAMES=Object.freeze({rest:'Rest',left:'Subject-left',right:'Subject-right'});

export function legacyEyeCode(value){
  if(!Number.isFinite(value))return null;
  const magnitude=Math.abs(value),sign=Math.sign(value)||1;
  return magnitude<THREE_POSITION_RULES.center?0:magnitude<THREE_POSITION_RULES.full?sign:sign*2;
}

export function threePositionEvidence(samples,selection={},checkedIndices=new Set(samples.map((_,i)=>i))){
  const cfg=THREE_POSITION_RULES,positions={},issues=[];
  const result={adequate:false,positions,issues,candidates:[],candidateScore:null,legacyRuleScore:null,
    codes:null,reasons:[],method:'three-position-legacy-rules-v1',thresholds:{...cfg},
    coordinates:'Head-relative iris offset / half eye width; codes negative toward subject-left.',
    source:'Adapted from local NIHSS/index.html; median of a short reviewed window replaces a single frame.'};
  if(samples.some((s,i)=>!Number.isFinite(s.rawVideoTimeSeconds)||(i>0&&s.rawVideoTimeSeconds<=samples[i-1].rawVideoTimeSeconds))){
    issues.push('Clip timestamps are invalid or repeated.');return result;
  }
  for(const [key,label]of Object.entries(POSITION_NAMES)){
    const time=selection[key],p=positions[key]={time:Number.isFinite(time)?time:null,adequate:false};
    if(!Number.isFinite(time)||time<0){issues.push(`Mark ${label.toLowerCase()} in the clip.`);continue;}
    const candidates=samples.map((s,i)=>({s,i,t:s.rawVideoTimeSeconds})).filter(r=>Math.abs(r.t-time)<=cfg.radius+1e-8);
    const nearest=candidates.reduce((best,r)=>!best||Math.abs(r.t-time)<Math.abs(best.t-time)?r:best,null);
    const usable=r=>checkedIndices.has(r.i)&&['left','right'].every(side=>eyeUsable(r.s,side)&&!['blink','closed','unresolved'].includes(r.s.reviewKinds?.[side]));
    // Do not fill a closed/missing selected instant with nearby open-eye samples.
    if(!nearest||Math.abs(nearest.t-time)>cfg.anchorTolerance||!usable(nearest)){
      issues.push(`${label}: select a checked frame with both eyes visible.`);continue;
    }
    const at=candidates.indexOf(nearest);let a=at,b=at;
    while(a>0&&usable(candidates[a-1])&&candidates[a].t-candidates[a-1].t<=cfg.maxGap)a--;
    while(b<candidates.length-1&&usable(candidates[b+1])&&candidates[b+1].t-candidates[b].t<=cfg.maxGap)b++;
    const rows=candidates.slice(a,b+1);
    Object.assign(p,{sourceIndices:rows.map(r=>r.i),start:rows[0].t,end:rows.at(-1).t,count:rows.length,
      estimated:rows.reduce((n,r)=>n+['left','right'].filter(side=>r.s.reviewKinds?.[side]==='estimated').length,0)});
    if(rows.length<cfg.minSamples||p.end-p.start<cfg.minSpan-1e-8){issues.push(`${label}: not enough adjacent usable frames. Choose a steady position.`);continue;}
    for(const side of ['left','right']){
      const values=rows.map(r=>r.s[side].corrected),median=percentile(values,.5),low=percentile(values,.1),high=percentile(values,.9);
      p[side]={median,low,high,code:legacyEyeCode(-median)};
    }
    if(['left','right'].some(side=>p[side].high-p[side].low>cfg.maxSpread||legacyEyeCode(-p[side].low)!==legacyEyeCode(-p[side].high))){
      issues.push(`${label}: eye position varies or crosses a rule threshold. Select a steadier moment.`);continue;
    }
    p.adequate=true;
  }
  const selected=Object.entries(positions).filter(([,p])=>p.time!==null);
  for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++){
    if(Math.abs(selected[i][1].time-selected[j][1].time)<=cfg.radius*2)
      issues.push(`${POSITION_NAMES[selected[i][0]]} and ${POSITION_NAMES[selected[j][0]]}: choose separate moments.`);
  }
  if(issues.length)return result;
  result.adequate=true;
  const c=result.codes=Object.fromEntries(Object.entries(positions).map(([k,p])=>[k,{left:p.left.code,right:p.right.code}]));
  const blockedLeft=Math.min(c.left.left,c.left.right)>=0,blockedRight=Math.max(c.right.left,c.right.right)<=0;
  if(blockedLeft||blockedRight){
    result.legacyRuleScore=2;result.candidates=[1,2];
    result.reasons.push(`Neither eye crossed the coded midline toward ${[blockedLeft?'subject-left':null,blockedRight?'subject-right':null].filter(Boolean).join(' or ')} at the selected positions.`,
      'The old rule would output 2. Three positions cannot establish forced deviation or a reflex response; clinical examination is needed to distinguish 1 from 2.');
  }else if(c.rest.left===0&&c.rest.right===0&&c.left.left===-2&&c.left.right===-2&&c.right.left===2&&c.right.right===2){
    result.legacyRuleScore=result.candidateScore=0;result.candidates=[0];
    result.reasons.push('Both eyes were centered at rest and reached the old full-excursion threshold in both directions. Possible 0; subtle palsy is not excluded.');
  }else{
    result.legacyRuleScore=result.candidateScore=1;result.candidates=[1];
    result.reasons.push('The old rule flags resting offset, reduced excursion or unequal movement. Possible 1 only if the clinician confirms partial palsy or an overcome deviation; task performance and tracking error can also cause this pattern.');
  }
  const estimated=Object.values(positions).reduce((n,p)=>n+p.estimated,0);
  if(estimated)result.reasons.push(`${estimated} accepted eye-position estimates contribute to the three positions.`);
  return result;
}
