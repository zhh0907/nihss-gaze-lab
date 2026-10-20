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

function ruleScore(c){
  const blockedLeft=Math.min(c.left.left,c.left.right)>=0,blockedRight=Math.max(c.right.left,c.right.right)<=0;
  if(blockedLeft||blockedRight)return 2;
  return c.rest.left===0&&c.rest.right===0&&c.left.left===-2&&c.left.right===-2&&c.right.left===2&&c.right.right===2?0:1;
}
function classificationOptions(positions){
  const cells=Object.keys(POSITION_NAMES).flatMap(phase=>['left','right'].map(side=>({phase,side,options:positions[phase][side].codeOptions})));
  const codes={rest:{},left:{},right:{}},legacy=new Set();
  function visit(index){
    if(index===cells.length){legacy.add(ruleScore(codes));return;}
    const {phase,side,options}=cells[index];
    for(const code of options){codes[phase][side]=code;visit(index+1);}
  }
  visit(0);
  return {legacy:[...legacy].sort(),candidates:[...new Set([...legacy].flatMap(score=>score===2?[1,2]:[score]))].sort()};
}

export function threePositionEvidence(samples,selection={},checkedIndices=new Set(samples.map((_,i)=>i))){
  const cfg=THREE_POSITION_RULES,positions={},issues=[];
  const result={adequate:false,partial:false,availablePhases:[],availableEyes:0,positions,issues,candidates:[],candidateScore:null,legacyRuleScore:null,
    codes:null,reasons:[],classificationUncertain:false,thresholdAmbiguousEyes:0,method:'three-position-interval-rules-v2',thresholds:{...cfg},
    coordinates:'Head-relative iris offset / half eye width; codes negative toward subject-left.',
    source:'Adapted from local NIHSS/index.html; median of a short reviewed window replaces a single frame.'};
  if(samples.some((s,i)=>!Number.isFinite(s.rawVideoTimeSeconds)||(i>0&&s.rawVideoTimeSeconds<=samples[i-1].rawVideoTimeSeconds))){
    issues.push('Clip timestamps are invalid or repeated.');return result;
  }
  for(const [key,label]of Object.entries(POSITION_NAMES)){
    const time=selection[key],p=positions[key]={time:Number.isFinite(time)?time:null,adequate:false};
    if(!Number.isFinite(time)||time<0){issues.push(`${label}: no reliable representative position is available.`);continue;}
    const candidates=samples.map((s,i)=>({s,i,t:s.rawVideoTimeSeconds})).filter(r=>Math.abs(r.t-time)<=cfg.radius+1e-8);
    const nearest=candidates.reduce((best,r)=>!best||Math.abs(r.t-time)<Math.abs(best.t-time)?r:best,null);
    const at=candidates.indexOf(nearest),indices=new Set();p.estimated=0;
    // Evaluate each eye independently. A missing fellow eye does not erase an
    // observed position, but both are still required for a complete score.
    for(const side of ['left','right']){
      const usable=r=>checkedIndices.has(r.i)&&eyeUsable(r.s,side)&&Math.abs(r.s[side].corrected)<=1.2&&
        !['blink','closed','unresolved','deferred','not-visible','unchecked','buffer'].includes(r.s.reviewKinds?.[side]);
      const e=p[side]={adequate:false,issues:[]};
      if(!nearest||Math.abs(nearest.t-time)>cfg.anchorTolerance||!usable(nearest)){
        e.issues.push('No checked position at the selected time.');
      }else{
        let a=at,b=at;
        while(a>0&&usable(candidates[a-1])&&candidates[a].t-candidates[a-1].t<=cfg.maxGap)a--;
        while(b<candidates.length-1&&usable(candidates[b+1])&&candidates[b+1].t-candidates[b].t<=cfg.maxGap)b++;
        const rows=candidates.slice(a,b+1);
        Object.assign(e,{sourceIndices:rows.map(r=>r.i),start:rows[0].t,end:rows.at(-1).t,count:rows.length,
          estimated:rows.filter(r=>r.s.reviewKinds?.[side]==='estimated').length});
        rows.forEach(r=>indices.add(r.i));p.estimated+=e.estimated;
        if(rows.length<cfg.minSamples||e.end-e.start<cfg.minSpan-1e-8)e.issues.push('Too few adjacent usable frames.');
        const values=rows.map(r=>r.s[side].corrected),median=percentile(values,.5),low=percentile(values,.1),high=percentile(values,.9);
        const codeOptions=[...new Set([low,median,high].map(value=>legacyEyeCode(-value)))].sort((a,b)=>a-b);
        Object.assign(e,{median,low,high,code:legacyEyeCode(-median),codeOptions,thresholdAmbiguous:codeOptions.length>1});
        // A rule boundary is classification uncertainty, not lost tracking.
        // Wide movement still fails quality; small cross-boundary variation
        // remains measured and is propagated to the possible rule outcomes.
        if(high-low>cfg.maxSpread)e.issues.push('Position varies too much within the selected window.');
      }
      e.adequate=!e.issues.length;
      for(const issue of e.issues)issues.push(`${label}, ${side} eye: ${issue}`);
    }
    p.sourceIndices=[...indices];p.count=indices.size;
    p.start=p.count?Math.min(...p.sourceIndices.map(i=>samples[i].rawVideoTimeSeconds)):null;
    p.end=p.count?Math.max(...p.sourceIndices.map(i=>samples[i].rawVideoTimeSeconds)):null;
    p.adequate=['left','right'].every(side=>p[side].adequate);
  }
  const selected=Object.entries(positions).filter(([,p])=>p.time!==null);
  for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++){
    if(Math.abs(selected[i][1].time-selected[j][1].time)<=cfg.radius*2)
      issues.push(`${POSITION_NAMES[selected[i][0]]} and ${POSITION_NAMES[selected[j][0]]}: choose separate moments.`);
  }
  result.availablePhases=Object.keys(positions).filter(key=>positions[key].adequate);
  result.availableEyes=Object.values(positions).reduce((n,p)=>n+['left','right'].filter(side=>p[side]?.adequate).length,0);
  result.thresholdAmbiguousEyes=Object.values(positions).reduce((n,p)=>n+['left','right'].filter(side=>p[side]?.adequate&&p[side].thresholdAmbiguous).length,0);
  result.partial=result.availableEyes>0&&issues.length>0;
  result.codes=Object.fromEntries(Object.entries(positions).map(([key,p])=>[key,Object.fromEntries(
    ['left','right'].filter(side=>p[side]?.adequate).map(side=>[side,p[side].code]))]));
  if(issues.length){
    result.reasons.push(`${result.availablePhases.length}/3 positions and ${result.availableEyes}/6 eye measurements available. No complete score.`);
    return result;
  }
  result.adequate=true;
  const c=result.codes=Object.fromEntries(Object.entries(positions).map(([k,p])=>[k,{left:p.left.code,right:p.right.code}]));
  const options=classificationOptions(positions);
  result.classificationUncertain=options.legacy.length>1;
  result.legacyRuleScore=options.legacy.length===1?options.legacy[0]:null;
  result.candidates=options.candidates;
  result.candidateScore=options.candidates.length===1?options.candidates[0]:null;
  const blockedLeft=Math.min(c.left.left,c.left.right)>=0,blockedRight=Math.max(c.right.left,c.right.right)<=0;
  if(result.classificationUncertain){
    result.reasons.push(`All three positions are measured. Small position variation crosses a rule boundary; possible scores: ${result.candidates.join('/')}.`,
      'The observed position range is retained. A boundary crossing is not evidence of missing tracking or a confirmed palsy.');
  }else{
  if(blockedLeft||blockedRight){
    result.reasons.push(`Neither eye crossed the coded midline toward ${[blockedLeft?'subject-left':null,blockedRight?'subject-right':null].filter(Boolean).join(' or ')} at the selected positions.`,
      'The old rule would output 2. Three positions cannot establish forced deviation or a reflex response; clinical examination is needed to distinguish 1 from 2.');
  }else if(c.rest.left===0&&c.rest.right===0&&c.left.left===-2&&c.left.right===-2&&c.right.left===2&&c.right.right===2){
    result.reasons.push('Both eyes were centered at rest and reached the old full-excursion threshold in both directions. Possible 0; subtle palsy is not excluded.');
  }else{
    result.reasons.push('The old rule flags resting offset, reduced excursion or unequal movement. Possible 1 only if the clinician confirms partial palsy or an overcome deviation; task performance and tracking error can also cause this pattern.');
  }
  }
  if(result.thresholdAmbiguousEyes&&!result.classificationUncertain)
    result.reasons.push(`${result.thresholdAmbiguousEyes} eye measurements cross a rule boundary without changing the possible score set.`);
  const estimated=Object.values(positions).reduce((n,p)=>n+p.estimated,0);
  if(estimated)result.reasons.push(`${estimated} accepted eye-position estimates contribute to the three positions.`);
  return result;
}
