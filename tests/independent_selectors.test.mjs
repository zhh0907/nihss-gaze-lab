import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proposeAutoSelections} from '../auto-selection.js';
import {selectIndependentPhase} from '../method-selection.js';

const eye=x=>({valid:true,corrected:x,raw:x,reasons:[]});
const ramp=(t,start,end,a,b)=>t<start?a:t>=end?b:a+(b-a)*(t-start)/(end-start);
function fixture(){
  const intervals=[{phase:'center',start:0,holdStart:.5,end:3,completed:true},
    {phase:'left',start:3,holdStart:4,end:8,completed:true},
    {phase:'right',start:8,holdStart:9,end:13,completed:true}];
  const samples=Array.from({length:157},(_,i)=>{const t=i/12,x=t<8?ramp(t,3.5,3.8,0,.5):ramp(t,8.5,8.8,.5,-.5);return {
    t,rawVideoTimeSeconds:t,valid:true,reasons:[],left:eye(x),right:eye(x),reviewKinds:{left:'original',right:'original'},reviewScope:'observation'};});
  return {samples,checked:new Set(samples.map((_,i)=>i)),guide:{version:'guided-exam-v4',status:'complete',intervals},duration:13};
}
const propose=f=>proposeAutoSelections(f.samples,f.checked,f.guide,f.duration);
const modify=(f,start,end,fn)=>f.samples.forEach((s,i)=>{if(s.t>=start&&s.t<end)fn(s,i);});

test('A and B select their own representative windows instead of sharing a two-second response gate',()=>{
  const f=fixture(),r=propose(f);
  assert.equal(r.complete,true);
  for(const phase of ['center','left','right']){
    const a=r.methodStatus.A.phases[phase],b=r.methodStatus.B.phases[phase];
    assert.equal(a.scoreEligible,true);assert.equal(b.scoreEligible,true);
    assert.ok(a.selection.end-a.selection.start<=.5+1e-8);
    assert.ok(b.selection.end-b.selection.start>=.7);
    assert.notDeepEqual(a.selection,b.selection);
    assert.equal(r.provenance.phases[phase].response.latencyDiagnostic,true);
    assert.equal(r.threePositionSelection[phase==='center'?'rest':phase],a.selection.time);
  }
});

test('a short terminal hold completes A while B explicitly lacks sustained evidence',()=>{
  const f=fixture();modify(f,3,8,s=>s.left.corrected=s.right.corrected=s.t>=7.65?.3:0);
  const r=propose(f),a=r.methodStatus.A.phases.left,b=r.methodStatus.B.phases.left;
  assert.equal(a.scoreEligible,true);assert.equal(a.eyes.left.median,.3);
  assert.ok(a.selection.start>=7.65);assert.ok(a.selection.end<8);
  assert.equal(b.scoreEligible,false);assert.equal(b.selection,null);
  assert.ok(Number.isFinite(r.threePositionSelection.left));assert.equal(r.temporalSelection.left,undefined);
  assert.equal(r.methodStatus.A.complete,true);assert.equal(r.methodStatus.B.complete,false);
});

test('confirmed short blink does not invalidate a later visible endpoint or both methods',()=>{
  const f=fixture();modify(f,5,5.25,s=>{for(const side of ['left','right']){s[side]=null;s.reviewKinds[side]='blink';}});
  const r=propose(f);
  assert.equal(r.provenance.phases.left.response.adequate,false);
  for(const method of ['A','B']){
    const p=r.methodStatus[method].phases.left;
    assert.equal(p.scoreEligible,true);assert.equal(p.normalEligible,true);
    assert.ok(p.observationQuality.left.confirmedBlinkSeconds>0);
    assert.ok(p.cautions.some(c=>c.includes('brief blink')));
  }
});

test('uncertain onset and missing prior-phase baseline are timing diagnostics, not endpoint vetoes',()=>{
  for(const kind of ['onset','baseline']){
    const f=fixture();modify(f,kind==='onset'?3.5:2.5,kind==='onset'?3.666:3,s=>s.left=null);
    const r=propose(f),diagnostic=r.provenance.phases.left.response.eyes.left;
    assert.equal(diagnostic.status,kind==='onset'?'onset-uncertain':'baseline-unavailable');
    for(const method of ['A','B']){
      assert.equal(r.methodStatus[method].phases.left.scoreEligible,true);
      assert.equal(r.methodStatus[method].phases.left.normalEligible,true);
    }
  }
});

test('a long earlier unknown gap remains a caution without erasing a later clear stable endpoint',()=>{
  const f=fixture();modify(f,4.2,5.3,s=>s.left=null);
  const r=propose(f);
  for(const method of ['A','B']){
    const p=r.methodStatus[method].phases.left;
    assert.equal(p.scoreEligible,true);assert.equal(p.normalEligible,true);
    assert.ok(p.cautions.some(c=>c.includes('earlier missing tracking')));
    assert.ok(p.observationQuality.left.maxUnknownGap>1);
  }
});

test('B avoids an unsupported short-gap tail without discarding its verified later endpoint',()=>{
  const f=fixture();modify(f,7+7/12-1e-8,7+7/12+1e-8,s=>s.left=null);
  const r=propose(f),b=r.methodStatus.B.phases.left;
  assert.equal(b.scoreEligible,true);assert.equal(b.eyes.left.median,.5);
  assert.ok(b.eyes.left.windowQuality.tailCoverage>=.7-1e-8);
  assert.ok(b.eyes.left.windowQuality.longestVisibleRun>=.4-1e-8);
  assert.ok(b.selection.end<=7+7/12+1e-8);
  assert.ok(b.eyes.left.endpointReference.end>b.selection.end);
  assert.ok(b.observationQuality.left.gaps.some(g=>g.sourceIndices.length));
});

test('missing one eye preserves the other eye and completed phases as partial evidence',()=>{
  const f=fixture();modify(f,3,8,s=>s.left=null);
  const r=propose(f);
  for(const method of ['A','B']){
    const p=r.methodStatus[method].phases.left;
    assert.equal(p.status,'partial');assert.equal(p.scoreEligible,false);
    assert.deepEqual(p.availableEyes,['right']);assert.equal(p.eyes.right.adequate,true);assert.equal(p.eyes.left.adequate,false);
    assert.ok(p.selection);assert.ok(r.methodStatus[method].partialPhases.includes('left'));
    assert.equal(r.methodStatus[method].phases.right.scoreEligible,true);
  }
});

test('missing or explicitly unresolved endpoints cannot borrow an earlier normal hold',()=>{
  for(const kind of ['long-gap','explicit']){
    const f=fixture();modify(f,kind==='long-gap'?7.25:7.833,8,s=>{s.left=null;if(kind==='explicit')s.reviewKinds.left='unresolved';});
    const r=propose(f);
    for(const method of ['A','B']){
      const p=r.methodStatus[method].phases.left;
      assert.equal(p.scoreEligible,false);assert.equal(p.eyes.left.adequate,false);
      assert.ok(p.criticalGaps.some(g=>g.eye==='left'));
    }
  }
});

test('visible immobility, resting offset and opposite-direction positions remain unchanged',()=>{
  const f=fixture();f.samples.forEach(s=>{s.left.corrected=.3;s.right.corrected=.3;});
  const r=propose(f);
  for(const method of ['A','B'])for(const phase of ['center','left','right']){
    const p=r.methodStatus[method].phases[phase];
    assert.equal(p.scoreEligible,true);assert.equal(p.eyes.left.median,.3);assert.equal(p.eyes.right.median,.3);
    assert.equal(r.provenance.phases[phase].recordedPhase.phase,phase);
  }
});

test('later reduced endpoint is chosen instead of an earlier larger excursion',()=>{
  const f=fixture();modify(f,6,8,s=>s.left.corrected=s.right.corrected=.3);
  const r=propose(f);
  for(const method of ['A','B']){
    const p=r.methodStatus[method].phases.left;
    assert.equal(p.scoreEligible,true);assert.equal(p.eyes.left.median,.3);
    assert.ok(p.selection.start>=6);assert.ok(p.laterChanges.length>0);
  }
});

test('recovery after a visible reversal cannot erase the earlier change into a normal-only result',()=>{
  const f=fixture();modify(f,5,6,s=>s.left.corrected=s.right.corrected=.25);
  const r=propose(f);
  for(const method of ['A','B']){
    const p=r.methodStatus[method].phases.left;
    assert.equal(p.scoreEligible,true);assert.equal(p.eyes.left.median,.5);
    assert.equal(p.normalEligible,false);assert.ok(p.laterChanges.length>0);
  }
});

test('slow monotonic movement and delayed reaction are not reported as later reversals',()=>{
  for(const onset of [3.5,5,6]){
    const f=fixture();modify(f,3,8,s=>s.left.corrected=s.right.corrected=ramp(s.t,onset,onset+.3,0,.5));
    const r=propose(f);
    for(const method of ['A','B']){
      const p=r.methodStatus[method].phases.left;
      assert.equal(p.scoreEligible,true);assert.equal(p.normalEligible,true);assert.deepEqual(p.laterChanges,[]);
    }
  }
});

test('phase boundaries, source data and checked membership are preserved without interpolation',()=>{
  const f=fixture(),before=structuredClone(f.samples),checked=[...f.checked];
  f.samples.find(s=>s.t===8).left.corrected=-1.1;
  const expected=structuredClone(f.samples),r=propose(f);
  for(const method of ['A','B']){
    const p=r.methodStatus[method].phases.left;
    assert.equal(p.eyes.left.median,.5);assert.ok(p.selection.end<8);
  }
  assert.deepEqual(f.samples,expected);assert.deepEqual([...f.checked],checked);
  assert.notDeepEqual(f.samples,before);
});

test('invalid timelines produce explicit unavailable method phases',()=>{
  const f=fixture();f.samples[10].rawVideoTimeSeconds=f.samples[9].rawVideoTimeSeconds;
  const r=propose(f);
  for(const method of ['A','B'])for(const phase of ['center','left','right']){
    assert.equal(r.methodStatus[method].phases[phase].scoreEligible,false);
    assert.equal(r.methodStatus[method].phases[phase].selection,null);
  }
  assert.equal(r.complete,false);
});
