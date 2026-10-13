import {DEFAULTS,percentile} from './geometry.js';
export const PHASES=['center','left','right','unlabelled','reflex'];
export const NIHSS_SOURCE='https://www.ninds.nih.gov/sites/default/files/documents/NIH-Stroke-Scale_updatedFeb2024_508.pdf';

export function parseIntervals(text,duration) {
  const rows=[];
  for (const [i,line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const [start,end,phase,...extra]=line.trim().split(/[ ,\t]+/);
    const a=Number(start),b=Number(end);
    if (extra.length || !Number.isFinite(a) || !Number.isFinite(b) || a<0 || b<=a || b>duration+.001 || !PHASES.includes(phase)) throw Error(`Line  ${i+1} : use start_seconds end_seconds center/left/right/reflex/unlabelled, within the video duration.`);
    rows.push({start:a,end:b,phase});
  }
  rows.sort((a,b)=>a.start-b.start);
  if (rows.some((r,i)=>i>0 && r.start<rows[i-1].end)) throw Error('Exam phases must not overlap.');
  return rows;
}

export function phaseAt(t,intervals) {
  const r=intervals.find(r=>t>=r.start && t<r.end);
  return r?{phase:r.phase,phaseStart:r.start}:{phase:'unlabelled',phaseStart:0};
}

export function summarize(samples,config=DEFAULTS) {
  const cfg={...DEFAULTS,...config},issues=[],flags=[];
  const phases={};
  // Duration weighting prevents faster detection periods or repeated frames
  // from dominating the quality denominator. Long gaps contribute no coverage.
  for (const phase of ['center','left','right']) {
    const rows=samples.filter(s=>s.phase===phase && s.t-s.phaseStart>=cfg.settleSeconds);
    const valid=rows.filter(s=>s.valid && s.left?.valid && s.right?.valid);
    let seconds=0,validSeconds=0,maxGap=0;
    for (let i=1;i<samples.length;i++) {
      const p=samples[i-1],s=samples[i],dt=s.t-p.t;
      if (s.phase!==phase || p.phase!==phase || s.phaseStart!==p.phaseStart || p.t-p.phaseStart<cfg.settleSeconds || dt<=0) continue;
      seconds+=dt;maxGap=Math.max(maxGap,dt);
      if (dt<=cfg.maxSampleGap && s.valid && p.valid) validSeconds+=dt;
    }
    const coverage=seconds>0?validSeconds/seconds:0;
    const sides={};
    for(const side of ['left','right']) sides[side]={
      median:percentile(valid.map(s=>s[side].corrected),.5),
      rawMedian:percentile(valid.map(s=>s[side].raw),.5),
      p10:percentile(valid.map(s=>s[side].corrected),.1),
      p90:percentile(valid.map(s=>s[side].corrected),.9),
    };
    const adequate=valid.length>=cfg.minPhaseFrames && validSeconds>=cfg.minPhaseSeconds && coverage>=cfg.minCoverage;
    phases[phase]={count:rows.length,validCount:valid.length,seconds,validSeconds,coverage,maxGap,adequate,...sides};
    if(!adequate) issues.push(`${phase}:insufficient-coverage`);
  }
  if(samples.some((s,i)=>!Number.isFinite(s.t) || (i>0 && s.t<=samples[i-1].t))) issues.push('non-monotonic-timestamps');
  const adequate=issues.length===0,excursions={};
  if (adequate) {
    for(const side of ['left','right']) {
      const center=phases.center[side].median;
      // Positive is subject-left in an unmirrored input. No patient-specific
      // zeroing is applied to absolute values: resting deviation is retained.
      excursions[side]={left:phases.left[side].median-center,right:center-phases.right[side].median};
      for(const direction of ['left','right']) if(excursions[side][direction]<cfg.minExcursion) flags.push(`${side}:${direction}:reduced-excursion`);
    }
    for(const direction of ['left','right']) if(Math.abs(excursions.left[direction]-excursions.right[direction])>cfg.maxAsymmetry) flags.push(`${direction}:asymmetric-excursion`);
    const a=phases.center.left.median,b=phases.center.right.median;
    if (Math.sign(a)===Math.sign(b) && Math.min(Math.abs(a),Math.abs(b))>cfg.restDeviation) flags.push('possible-resting-deviation');
  }
  const heads=samples.filter(s=>s.head).map(s=>s.head);
  return {adequate,issues,phases,excursions,flags,
    pattern:!adequate?'insufficient-data':flags.length?'abnormal-pattern-review':'bilateral-movement-observed',
    frameCount:samples.length,validCount:samples.filter(s=>s.valid).length,
    headRange:Object.fromEntries(['yaw','pitch','roll'].map(key=>[key,{min:percentile(heads.map(h=>h[key]),0),max:percentile(heads.map(h=>h[key]),1)}])),
    note:'Research thresholds describe movement evidence; they are not NIHSS diagnostic cutoffs.'};
}

// A structured NIHSS mapping of examiner observations, intentionally distinct
// from unvalidated video heuristics. Missing or conflicting evidence abstains.
export function scoreNIHSS(observation={},evidence=null) {
  const o=observation;
  const result={score:null,status:'needs-review',basis:[],missing:[],source:NIHSS_SOURCE,
    mode:'clinician-observation-rule-mapping',videoAdequate:evidence?.adequate??false};
  const missing=s=>{result.missing.push(s);return result;};
  if(o.examAdequate!=='yes') return missing('The examiner must confirm an adequate horizontal gaze exam. Lack of response or tracking loss alone does not establish an abnormality.');
  if(!o.reviewer?.trim()) return missing('Enter an examiner ID to distinguish clinical observations from video inference.');
  const finding=o.finding??'unknown',overcome=o.overcome??'unknown';
  if(finding==='unknown') return missing('Record the clinical horizontal gaze finding.');
  if(['normal','partial','isolated-nerve'].includes(finding) && overcome!=='unknown') {
    result.status='conflicting-input';return missing('The overcome field applies only to deviation or total gaze paresis. Check the inputs.');
  }
  if(o.useVideoEvidence===true && !evidence?.adequate) return missing('Video evidence is insufficient to support scoring. Complete the examination or enter independent clinical observations.');
  if(finding==='normal' && o.useVideoEvidence===true && evidence.flags.length) {
    result.status='conflicting-input';return missing('Video flags conflict with the normal observation. Review before scoring.');
  }
  if(finding==='normal') {result.score=0;result.basis.push('Examiner confirms normal horizontal gaze.');}
  else if(finding==='partial') {result.score=1;result.basis.push('Examiner confirms partial gaze palsy in one or both eyes, without forced deviation or total gaze paresis.');}
  else if(finding==='isolated-nerve') {result.score=1;result.basis.push('Examiner confirms isolated peripheral CN III, IV or VI palsy. Etiology is not inferred from the video.');}
  else if(['deviation','total-paresis'].includes(finding)) {
    if(overcome==='reflex' && o.reflexAssessed!=='yes') return missing('A clinician must confirm and record the reflex examination before selecting overcome by reflex movement.');
    if(finding==='total-paresis' && ['voluntary','reflex'].includes(overcome)) {
      result.status='conflicting-input';return missing('If movement can be restored, initial immobility alone does not imply score 1. Review whether gaze is normal, partially paretic, or conjugately deviated.');
    }
    if(['voluntary','reflex'].includes(overcome)) {result.score=1;result.basis.push('Examiner records that the gaze deviation can be overcome by voluntary or reflex movement.');}
    else if(overcome==='not-overcome' && o.reflexAssessed==='yes') {result.score=2;result.basis.push('Examiner records forced deviation or total gaze paresis that cannot be overcome by the oculocephalic reflex.');}
    else return missing('Cannot distinguish 1 from 2 yet. Record whether the deviation or limitation can be overcome, and the applicable reflex findings.');
  } else return missing('Unrecognized clinical finding; no score assigned.');
  result.status='provisional';
  result.basis.push(o.useVideoEvidence?'Supported by current video measurements; clinical confirmation is still required.':'Maps independent examiner observations only. This is not an automated video score.');
  return result;
}
