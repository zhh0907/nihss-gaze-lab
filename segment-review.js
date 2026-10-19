import {eyeUsable} from './eye-quality.js';

export const SEGMENT_VERSION='adaptive19';
export const SIDES=['left','right'];
export const LIMITS=Object.freeze({maxGap:.25,mergeGap:.30,maxBridge:.25,maxPartialSpan:1.6,minSupport:.64,minMargin:.025});
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const headGood=s=>s?.head&&!(s.reasons??[]).length;
const transition=(a,b,dt)=>Math.min(1.2,dist(a,b)**2/Math.max(.008,dt*.55));
const observation=c=>(1-c.support)*3+(c.method==='Original'?0:.045);
const interrupted=(a,b,side)=>b.time-a.time>LIMITS.maxGap||b.sourceIndex!==a.sourceIndex+1||a.phase!==b.phase||a[side].ignored||b[side].ignored;
const blocked=(a,b,side)=>interrupted(a,b,side)||!headGood(a.sample)||!headGood(b.sample);

// Require closure evidence, not just the old "blink-or-occlusion" flag. Extreme
// gaze frequently narrows the lid aperture without a blink.
export function isBlinkEye(sample,side) {
  const e=sample?.[side];
  return Number.isFinite(e?.blink)&&e.blink>=.65&&Number.isFinite(e.lidRatio)&&e.lidRatio<.11;
}

function solveRun(frames,side){
  const states=frames.map(f=>f[side].evidence.candidates),n=states.length;
  const forward=[],backward=[],prev=[];
  for(let i=0;i<n;i++){
    forward[i]=[];prev[i]=[];
    for(let j=0;j<states[i].length;j++){
      let best=0,kBest=-1;
      if(i){best=Infinity;states[i-1].forEach((c,k)=>{const v=forward[i-1][k]+transition(c,states[i][j],frames[i].time-frames[i-1].time);if(v<best){best=v;kBest=k;}});}
      forward[i][j]=observation(states[i][j])+best;prev[i][j]=kBest;
    }
  }
  for(let i=n-1;i>=0;i--){backward[i]=states[i].map((c,j)=>{
    if(i===n-1)return 0;
    return Math.min(...states[i+1].map((next,k)=>observation(next)+backward[i+1][k]+transition(c,next,frames[i+1].time-frames[i].time)));
  });}
  let j=forward[n-1].indexOf(Math.min(...forward[n-1]));
  for(let i=n-1;i>=0;i--){
    const e=frames[i][side],chosen=states[i][j],cost=forward[i][j]+backward[i][j];
    const other=states[i].map((c,k)=>dist(c,chosen)>.075?forward[i][k]+backward[i][k]:Infinity);
    e.path={...chosen,margin:Math.min(...other)-cost,runLength:n};j=prev[i][j];
  }
}

function processEye(frames,side){
  let run=[];
  const finish=()=>{if(run.length)solveRun(run,side);run=[];};
  function partialAnchors(index,candidate){
    const find=direction=>{
      let previous=index;
      for(let i=index+direction;i>=0&&i<frames.length;i+=direction){
        const lo=Math.min(previous,i),hi=Math.max(previous,i);
        if(blocked(frames[lo],frames[hi],side)||Math.abs(frames[i].time-frames[index].time)>LIMITS.maxPartialSpan)return null;
        const f=frames[i],e=f[side],c=e.evidence.candidates.find(v=>v.method==='Original');
        if(eyeUsable(f.sample,side)&&c?.supported&&c.support>=.70&&c.centreVisible!==false&&e.path&&dist(e.path,c)<.075)return {f,c};
        previous=i;
      }return null;
    };
    const a=find(-1),b=find(1);if(!a||!b||b.f.time-a.f.time>LIMITS.maxPartialSpan)return null;
    // Allow a modest extension beyond observed positions ONLY with current
    // visible-iris evidence. Opposite-corner eyelash fits are rejected.
    if(candidate.x<Math.min(a.c.x,b.c.x)-.15||candidate.x>Math.max(a.c.x,b.c.x)+.15||
       candidate.y<Math.min(a.c.y,b.c.y)-.10||candidate.y>Math.max(a.c.y,b.c.y)+.10)return null;
    return [a.f.sourceIndex,b.f.sourceIndex];
  }
  for(const f of frames){
    const e=f[side];
    if(e.ignored||!headGood(f.sample)||!e.evidence.candidates.length){finish();continue;}
    if(run.length&&blocked(run.at(-1),f,side))finish();run.push(f);
  }finish();
  for(const [index,f] of frames.entries()){
    const e=f[side];if(e.ignored)continue;
    const original=e.evidence.candidates.find(c=>c.method==='Original'),path=e.path;
    const supported=e.evidence.candidates.filter(c=>c.supported);
    const oldGood=eyeUsable(f.sample,side);
    e.originalUsable=oldGood;e.flags=[];
    if(!oldGood)e.flags.push('Original position unavailable');
    if(e.evidence.usable&&original&&original.support<.55)e.flags.push('Original marker has weak iris support');
    if(original&&supported.some(c=>dist(c,original)>.12&&c.support>original.support+.10))e.flags.push('Image and original position disagree');
    if(!headGood(f.sample))e.flags.push('Head tracking unavailable');
    e.flagged=e.flags.length>0;e.proposal=null;
    // Temporal agreement alone cannot override a visible, well-supported eye.
    const anchors=path?.centreVisible===false&&path.supported?partialAnchors(index,path):null;
    if(e.flagged&&headGood(f.sample)&&path?.supported&&(path.centreVisible!==false||anchors)&&path.runLength>=2&&path.margin>=LIMITS.minMargin&&
       (!original||dist(path,original)>.035)&&(!oldGood||!original||path.support>original.support+.08)){
      e.proposal={...structuredClone(path.eye),method:anchors?'Partial iris + temporal anchors':path.method,kind:'estimated',
        evidence:{support:path.support,anchors,pathMargin:Number.isFinite(path.margin)?path.margin:null,method:'Whole-run bidirectional candidate fitting'}};
    }
  }
  // Only short, stable, bracketed failures get a temporal-only estimate. Do not
  // bridge blink, unarchived samples, head loss, phase changes or an excursion
  // whose peak may be hidden. Estimated points never become new anchors.
  const anchor=f=>{const e=f[side],c=e.path;return !e.ignored&&!e.flagged&&c?.supported&&eyeUsable(f.sample,side)&&c.margin>=LIMITS.minMargin?c:null;};
  for(let i=1;i<frames.length-1;i++){
    const e=frames[i][side];if(e.ignored||!e.flagged||e.proposal||!headGood(frames[i].sample))continue;
    let a=i-1,b=i+1;
    while(a>=0&&!anchor(frames[a])&&!frames[a][side].ignored&&headGood(frames[a].sample))a--;
    while(b<frames.length&&!anchor(frames[b])&&!frames[b][side].ignored&&headGood(frames[b].sample))b++;
    if(a<0||b>=frames.length)continue;
    const fa=frames[a],fb=frames[b],ca=anchor(fa),cb=anchor(fb),dt=fb.time-fa.time;
    if(!ca||!cb||dt>LIMITS.maxBridge||dist(ca,cb)>.06)continue;
    if(frames.slice(a+1,b+1).some((f,k)=>blocked(frames[a+k],f,side)||f.sourceIndex!==frames[a+k].sourceIndex+1))continue;
    // Require stable observed neighbours on both sides, not just two endpoints.
    const before=frames[a-1],after=frames[b+1];
    if(!before||!after||blocked(before,fa,side)||blocked(fb,after,side)||!anchor(before)||!anchor(after)||dist(anchor(before),ca)>.05||dist(anchor(after),cb)>.05)continue;
    const base=e.evidence.candidates.find(c=>c.method==='Original');
    if(!base||!finite(base.eye.points?.a)||!finite(base.eye.points?.b))continue;
    // If the frame has credible contrary image evidence, leave it unresolved.
    if(e.evidence.candidates.some(c=>c.supported&&Math.min(dist(c,ca),dist(c,cb))>.12))continue;
    const t=(frames[i].time-fa.time)/dt,q={x:ca.local.x+(cb.local.x-ca.local.x)*t,y:ca.local.y+(cb.local.y-ca.local.y)*t};
    const p=base.eye.points,{width:w,height:h}=frames[i].sample.frameSize;
    const dx=(p.b.x-p.a.x)*w,dy=(p.b.y-p.a.y)*h;
    const iris={x:p.a.x+(q.x*dx-q.y*dy)/w,y:p.a.y+(q.x*dy+q.y*dx)/h};
    e.proposal={...structuredClone(base.eye),corrected:2*(ca.x+(cb.x-ca.x)*t),raw:2*q.x-1,
      points:{...structuredClone(p),iris},valid:true,reasons:[],kind:'estimated',method:'Short stable temporal bridge',
      evidence:{anchors:[fa.sourceIndex,fb.sourceIndex],anchorSpan:dt,method:'Bracketed stable estimate; hidden motion cannot be excluded'}};
  }
}

export function buildSegmentReview(report){
  const frames=report.frames.sort((a,b)=>a.time-b.time);
  for(const f of frames)for(const side of SIDES){
    const e=f[side];e.ignored=false;e.flagged=false;e.proposal=null;e.flags=[];
    e.original=structuredClone(f.sample[side]);e.originalUsable=eyeUsable(f.sample,side);
    e.decision='unreviewed';e.decidedAt=null;
  }
  // A blink must close AND reopen in a short, continuous run. Sustained lid
  // occlusion, or closure at a clip boundary, is not silently discarded.
  for(const side of SIDES)for(let i=0;i<frames.length;i++){
    if(!isBlinkEye(frames[i].sample,side))continue;
    const start=i;while(i+1<frames.length&&isBlinkEye(frames[i+1].sample,side)&&frames[i+1].sourceIndex===frames[i].sourceIndex+1&&frames[i+1].time-frames[i].time<=LIMITS.maxGap)i++;
    const before=frames[start-1],after=frames[i+1],closed=frames.slice(start,i+1);
    const minimum=Math.min(...closed.map(f=>f.sample[side].lidRatio));
    const open=f=>f&&f.sample[side]?.blink<.6&&f.sample[side]?.lidRatio>minimum+.025;
    if(open(before)&&open(after)&&after.time-before.time<=.65&&before.sourceIndex+1===frames[start].sourceIndex&&after.sourceIndex===frames[i].sourceIndex+1&&before.phase===after.phase){
      for(const f of closed)f[side].ignored=true;
    }
  }
  for(const side of SIDES)processEye(frames,side);
  report.segments=[];
  for(const side of SIDES){
    const flagged=frames.map((f,i)=>f[side].flagged?i:-1).filter(i=>i>=0);
    let group=[];
    const finish=()=>{
      if(!group.length)return;
      const first=frames[group[0]],last=frames[group.at(-1)],members=frames.slice(group[0],group.at(-1)+1);
      const suspect=members.filter(f=>f[side].flagged),suggestions=suspect.filter(f=>f[side].proposal);
      report.segments.push({id:side+'-'+first.sourceIndex,side,start:first.time,end:last.time,
        sourceIndices:members.map(f=>f.sourceIndex),flaggedIndices:suspect.map(f=>f.sourceIndex),
        proposedCount:suggestions.length,unresolvedCount:suspect.length-suggestions.length,
        reasons:[...new Set(suspect.flatMap(f=>f[side].flags))],decision:'unreviewed',decidedAt:null,choiceHistory:[]});group=[];
    };
    for(const i of flagged){
      if(group.length){const last=group.at(-1),between=frames.slice(last+1,i+1);
        if(frames[i].time-frames[last].time>LIMITS.mergeGap||between.some((f,k)=>interrupted(frames[last+k],f,side)))finish();}
      group.push(i);
    }finish();
  }
  report.segments.sort((a,b)=>a.start-b.start||a.side.localeCompare(b.side));
  report.ignoredBlinkEyes=frames.reduce((n,f)=>n+SIDES.filter(s=>f[s].ignored).length,0);
  report.flaggedFrames=frames.filter(f=>SIDES.some(s=>f[s].flagged)).length;
  report.suggestions=report.segments.reduce((n,s)=>n+s.proposedCount,0);
  // Keep the provenance, not the large candidate bank, in the saved report.
  for(const f of frames)for(const side of SIDES){const e=f[side];e.path=undefined;e.evidence={contrast:e.evidence.contrast,usable:e.evidence.usable,reason:e.evidence.reason};}
  return report;
}

export function chooseSegment(report,id,decision,now=new Date().toISOString()){
  if(!['unreviewed','original','suggestion','uncertain','closed','deferred','not-visible'].includes(decision))throw Error('Invalid segment choice');
  const segment=report.segments.find(s=>s.id===id);if(!segment)throw Error('Segment not found');
  if(decision==='suggestion'&&!segment.proposedCount)throw Error('No supported replacement in this segment');
  // History belongs to this report. A fresh image check builds a new report;
  // this is not a cross-report or server audit log. Undo remains a recorded event.
  segment.choiceHistory??=[];
  segment.choiceHistory.push({at:now,decision,previousDecision:segment.decision??'unreviewed',previousDecidedAt:segment.decidedAt??null});
  segment.decision=decision;segment.decidedAt=decision==='unreviewed'?null:now;
  const indices=new Set(segment.sourceIndices??segment.flaggedIndices),flagged=new Set(segment.flaggedIndices);
  // Closure and visibility labels cover the whole displayed single-eye segment,
  // including valid-looking bridge samples. Deferred correction excludes only
  // suspect samples. Changing a choice resets any previous whole-segment mask.
  for(const f of report.frames)if(indices.has(f.sourceIndex)){
    const e=f[segment.side],apply=['closed','not-visible'].includes(decision)||flagged.has(f.sourceIndex);
    e.decision=apply?decision:'unreviewed';e.decidedAt=apply?segment.decidedAt:null;
  }
  return segment;
}

export function selectedFrame(sample,review,version='selected'){
  const out=structuredClone(sample);out.reviewKinds={};
  for(const side of SIDES){
    const e=review?.[side];out.reviewKinds[side]='original';
    if(version==='selected'&&sample.reviewScope==='buffer'){out[side]=null;out.reviewKinds[side]='buffer';continue;}
    if(e?.ignored){out[side]=null;out.reviewKinds[side]='blink';continue;}
    if(version==='selected'&&['closed','not-visible'].includes(e?.decision)){
      out[side]=null;out.reviewKinds[side]=e.decision;continue;
    }
    if(version==='original'||!e?.flagged)continue;
    if(version==='selected'&&e.decision==='deferred'){
      out[side]=null;out.reviewKinds[side]='deferred';continue;
    }
    const use=version==='proposal'||e.decision==='suggestion';
    if(use&&e.proposal){out[side]=structuredClone(e.proposal);out.reviewKinds[side]='estimated';}
    else if((use&&!e.proposal)||e.decision==='uncertain'){out[side]=null;out.reviewKinds[side]='unresolved';}
  }
  out.valid=eyeUsable(out,'left')&&eyeUsable(out,'right');return out;
}

export function sampleAtTime(samples,time,key='rawVideoTimeSeconds',maxAge=.25){
  let lo=0,hi=samples.length-1,index=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(samples[m][key]<=time){index=m;lo=m+1;}else hi=m-1;}
  return index>=0&&time-samples[index][key]<=maxAge?index:-1;
}

export function annotationQueue(report){
  return (report?.segments??[]).filter(segment=>segment.decision==='deferred').map(segment=>({
    id:segment.id,eye:segment.side,start:segment.start,end:segment.end,
    sourceIndices:[...(segment.sourceIndices??segment.flaggedIndices??[])],flaggedIndices:[...(segment.flaggedIndices??[])],
    decision:'deferred',decidedAt:segment.decidedAt??null,pendingAnnotation:true,
    reason:'Both candidates need correction; deferred for offline annotation.',reviewReasons:[...(segment.reasons??[])],
  }));
}

const decisionMeaning={
  unreviewed:'Not reviewed',original:'Original selected',suggestion:'Suggested correction selected',
  uncertain:'Legacy unresolved choice',closed:'Eye closed',deferred:'Both candidates need correction; awaiting offline annotation',
  'not-visible':'Eye position not visible; no position selected',
};
export function segmentCsv(report){
  const rows=[['sample_index','time_s','eye','ignored_blink','flagged','original','suggestion','decision','selected','kind','decided_at',
    'segment_id','decision_meaning','visibility','pending_annotation']];
  const membership=new Map();
  for(const segment of report.segments??[])for(const index of segment.sourceIndices??segment.flaggedIndices??[])membership.set(`${segment.side}:${index}`,segment);
  for(const f of report.frames){
    const s=selectedFrame(f.sample,f);
    for(const side of SIDES){
      const e=f[side],segment=membership.get(`${side}:${f.sourceIndex}`);
      const visibility=e.ignored?'blink':e.decision==='closed'?'eye-closed':e.decision==='not-visible'?'eye-position-not-visible':'not-labelled';
      rows.push([f.sourceIndex,f.time,side,e.ignored,e.flagged,e.originalUsable?e.original?.corrected:null,e.proposal?.corrected,e.decision,
        eyeUsable(s,side)?s[side].corrected:null,s.reviewKinds[side],e.decidedAt,segment?.id??null,
        decisionMeaning[e.decision]??'Not reviewed',visibility,e.decision==='deferred'&&e.flagged===true]);
    }
  }
  return rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
}
