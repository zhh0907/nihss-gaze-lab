import {eyeUsable,eyeQualityLabel} from './eye-quality.js';

// Experimental display-only interpolation. Never edits detection validity or clinical evidence.
export const REPAIR_DEFAULTS=Object.freeze({maxGapSeconds:.1,maxEyeChange:.12,maxHeadChange:3,maxContextSpeed:1.5,maxPointDrift:.04});
const sides=['left','right'],keys=['a','b','iris','top','bottom'];
const lerp=(a,b,u)=>a+(b-a)*u;
const goodPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const pointsOK=eye=>keys.every(k=>goodPoint(eye?.points?.[k]));
const headOK=s=>['yaw','pitch','roll'].every(k=>Number.isFinite(s.head?.[k]));
const samePhase=(a,b)=>a.phase===b.phase&&a.phaseStart===b.phaseStart;
export function repairEyeGaps(data,{maxGapSeconds=.1,eye='both',mode='missing',start=0,end=0}={}){
  const samples=data?.samples;
  if(!Array.isArray(samples)||!samples.length)throw Error('This clip has no eye data to repair.');
  if(![.1,.2].includes(maxGapSeconds))throw Error('Choose a 100 ms or 200 ms maximum anchor span.');
  if(!['both',...sides].includes(eye)||!['missing','range'].includes(mode))throw Error('Invalid repair settings.');
  if(mode==='range'&&(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start))throw Error('Set an end time later than the start time.');
  for(let i=0;i<samples.length;i++){
    const s=samples[i];
    if(!Number.isFinite(s.t)||!Number.isFinite(s.recordingTimeSeconds)||!Number.isFinite(s.rawVideoTimeSeconds)||!Number.isFinite(s.analysisVideoTimeSeconds)||
      (i&&(s.t<=samples[i-1].t||s.rawVideoTimeSeconds<=samples[i-1].rawVideoTimeSeconds)))throw Error('Eye data timestamps are missing or out of order.');
  }
  const options={...REPAIR_DEFAULTS,maxGapSeconds,eye,mode,start:mode==='range'?start:null,end:mode==='range'?end:null};
  const selected=s=>mode==='range'&&s.recordingTimeSeconds>=start&&s.recordingTimeSeconds<=end;
  if(mode==='range'&&!samples.some(selected))throw Error('There are no analysis samples in this interval.');
  const frames=samples.map((s,i)=>({sourceIndex:i,t:s.t,recordingTimeSeconds:s.recordingTimeSeconds,rawVideoTimeSeconds:s.rawVideoTimeSeconds,
    analysisVideoTimeSeconds:s.analysisVideoTimeSeconds,phase:s.phase,head:structuredClone(s.head),
    ...Object.fromEntries(sides.map(side=>{
      const excluded=selected(s)&&(eye==='both'||eye===side),usable=eyeUsable(s,side)&&!excluded;
      return [side,{kind:usable?'observed':'missing',corrected:usable?s[side].corrected:null,raw:usable?s[side].raw:null,
        points:structuredClone(s[side]?.points??null),reason:excluded?'Manually excluded':eyeQualityLabel(s,side)}];
    }))}));
  const gaps=[];
  for(const side of sides){
    if(eye!=='both'&&eye!==side)continue;
    for(let first=0;first<frames.length;first++){
      if(frames[first][side].kind!=='missing')continue;
      let last=first;while(last+1<frames.length&&frames[last+1][side].kind==='missing')last++;
      if(mode==='range'&&!samples.slice(first,last+1).some(selected)){first=last;continue;}
      const a=first-1,b=last+1,A=samples[a],B=samples[b];
      const gap={side,firstIndex:first,lastIndex:last,startSeconds:samples[first].recordingTimeSeconds,endSeconds:samples[last].recordingTimeSeconds,
        anchorSpanSeconds:A&&B?B.t-A.t:null,status:'skipped',reason:null};
      let reason=null;
      if(!A||!B)reason='No valid anchor on both sides';
      else if(mode==='range'&&samples.slice(first,last+1).some(s=>!selected(s)))reason='Missing data extends outside selected interval';
      else if(gap.anchorSpanSeconds>maxGapSeconds+1e-8)reason='Gap too long';
      else if(samples.slice(a,b+1).some(s=>!samePhase(A,s)))reason='Exam phase changes';
      else if(samples.slice(a,b+1).some(s=>s.reasons?.length||!headOK(s)))reason='Face or head tracking unavailable';
      else if(samples.slice(first,last+1).some(s=>s[side]?.reasons?.some(r=>['eye-out-of-frame','eye-too-small'].includes(r))))reason='Eye outside frame or too small';
      else if(!pointsOK(A[side])||!pointsOK(B[side]))reason='Anchor landmarks unavailable';
      else if(Math.abs(A[side].corrected-B[side].corrected)>options.maxEyeChange)reason='Eye movement too large';
      else if(['yaw','pitch','roll'].some(k=>{
        const v=samples.slice(a,b+1).map(s=>s.head[k]);return Math.max(...v)-Math.min(...v)>options.maxHeadChange;
      }))reason='Head motion too large';
      else if(keys.some(k=>Math.hypot(A[side].points[k].x-B[side].points[k].x,A[side].points[k].y-B[side].points[k].y)>options.maxPointDrift))reason='Face movement too large';
      else {
        // Require observed neighbors outside the gap: never use another estimate as an anchor.
        const before=samples[a-1],after=samples[b+1];
        if(!before||!after||frames[a-1][side].kind!=='observed'||frames[b+1][side].kind!=='observed'||!samePhase(A,before)||!samePhase(B,after))reason='Not enough stable context';
        else if(A.t-before.t>.25||after.t-B.t>.25||
          Math.abs(A[side].corrected-before[side].corrected)/(A.t-before.t)>options.maxContextSpeed||
          Math.abs(after[side].corrected-B[side].corrected)/(after.t-B.t)>options.maxContextSpeed)reason='Eye movement unstable near gap';
      }
      if(reason)gap.reason=reason;
      else {
        gap.status='filled';gap.reason='Short gap with stable anchors';
        for(let i=first;i<=last;i++){
          const u=(samples[i].t-A.t)/(B.t-A.t);
          frames[i][side]={kind:'estimated',corrected:lerp(A[side].corrected,B[side].corrected,u),raw:lerp(A[side].raw,B[side].raw,u),
            points:Object.fromEntries(keys.map(k=>[k,{x:lerp(A[side].points[k].x,B[side].points[k].x,u),y:lerp(A[side].points[k].y,B[side].points[k].y,u)}])),
            reason:'Linear estimate between observed anchors',anchorIndices:[a,b],anchorTimesSeconds:[A.recordingTimeSeconds,B.recordingTimeSeconds]};
        }
      }
      gaps.push(gap);first=last;
    }
  }
  const summary={filledGaps:gaps.filter(g=>g.status==='filled').length,estimatedEyeSamples:0,remainingMissingEyeSamples:0,skippedGaps:gaps.filter(g=>g.status==='skipped').length};
  for(const frame of frames)for(const side of sides){if(frame[side].kind==='estimated')summary.estimatedEyeSamples++;if(frame[side].kind==='missing')summary.remainingMissingEyeSamples++;}
  return {schema:'gaze-gap-repair-1',sourceRecordingId:data.recording.id,createdAt:new Date().toISOString(),method:'bounded-linear-interpolation',options,
    clinicalUse:false,originalDataModified:false,limitations:['Estimated positions are not measurements.','Stable endpoints cannot exclude hidden extreme gaze or fast movements.','Thresholds are experimental; no patient accuracy claim.','No new camera frames or detector results are generated.'],summary,gaps,frames};
}

export function repairFrameAtTime(report,time,maxAge=.25){
  if(!Number.isFinite(time))return null;
  const frames=report.frames;let lo=0,hi=frames.length;
  while(lo<hi){const m=(lo+hi)>>1;if(frames[m].rawVideoTimeSeconds<=time)lo=m+1;else hi=m;}
  const frame=frames[lo-1];return frame&&time-frame.rawVideoTimeSeconds<=maxAge?frame:null;
}
export function repairCsv(data,report){
  const rows=[['recording_time_s','raw_video_time_s','eye','status','original_valid','original_corrected','display_corrected','anchor_start_s','anchor_end_s','reason']];
  for(const f of report.frames)for(const side of sides){const e=f[side],old=data.samples[f.sourceIndex][side];rows.push([f.recordingTimeSeconds,f.rawVideoTimeSeconds,side,e.kind,old?.valid??false,old?.corrected??null,e.corrected,e.anchorTimesSeconds?.[0],e.anchorTimesSeconds?.[1],e.reason]);}
  return rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n');
}
