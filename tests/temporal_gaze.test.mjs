import {test} from 'node:test';
import assert from 'node:assert/strict';
import {temporalGazeEvidence,TEMPORAL_RULES} from '../temporal-gaze.js';
import {clipGazeSuggestion} from '../eye-motion.js';

const selection={center:{start:0,end:2},left:{start:2,end:4},right:{start:4,end:6}};
const eye=x=>({valid:true,corrected:x,raw:x});
function fixture(fps=20){return Array.from({length:6*fps+1},(_,i)=>{
  const t=i/fps,x=t<2?0:t<4?.5:-.5;
  return {t,rawVideoTimeSeconds:t,reasons:[],valid:true,left:eye(x),right:eye(x),reviewKinds:{left:'original',right:'original'}};
});}
const assess=(s,sel=selection,checked)=>temporalGazeEvidence(s,sel,checked,6);
const change=(samples,start,end,fn)=>samples.forEach(s=>{if(s.t>=start&&s.t<end)fn(s);});
function clipFixture(){
  const samples=fixture(),frames=samples.map((s,i)=>({sourceIndex:i,time:s.t,left:{flagged:false},right:{flagged:false}}));
  return {clip:{gazeScoringMode:'temporal',temporalSelection:structuredClone(selection),threePositionSelection:{rest:1,left:3,right:5},data:{samples,recording:{durationSeconds:6}}},
    report:{frames,segments:[]}};
}
test('normal sustained bilateral motion gives possible 0 with independent eye evidence',()=>{
  const r=assess(fixture());assert.equal(r.adequate,true);assert.deepEqual(r.candidates,[0]);assert.equal(r.version,'temporal-holds-v2');
  assert.ok(r.phases.left.left.fullHoldSeconds>1.5);assert.equal(r.phases.center.left.median,0);assert.deepEqual(r.thresholds,TEMPORAL_RULES);
});
test('10, 20 and 60 Hz use seconds, with the same classification and similar durations',()=>{
  const results=[10,20,60].map(fps=>assess(fixture(fps)));
  results.forEach(r=>{assert.equal(r.adequate,true);assert.equal(r.candidateScore,0);});
  assert.ok(Math.max(...results.map(r=>r.phases.left.left.fullHoldSeconds))-Math.min(...results.map(r=>r.phases.left.left.fullHoldSeconds))<.11);
});
test('uneven camera cadence is duration weighted, not dominated by a dense burst',()=>{
  const s=fixture(10).filter(s=>s.t<2.5||s.t>=2.8);
  for(let i=0;i<60;i++){const t=2.5+i*.005;s.push({t,rawVideoTimeSeconds:t,valid:true,left:eye(.6),right:eye(.6)});}
  s.sort((a,b)=>a.t-b.t);const r=assess(s);
  assert.equal(r.phases.left.left.median,.5);assert.equal(r.candidateScore,0);
});
test('one erroneous sample cannot make a limited eye look normal',()=>{
  const s=fixture();change(s,2,4,s=>s.left.corrected=.15);s[60].left.corrected=.9;
  const r=assess(s);assert.equal(r.adequate,true);assert.equal(r.candidateScore,1);assert.ok(r.flags.includes('left:left:limited-movement'));
});
test('a full excursion that is only brief abstains instead of proving normal or palsy',()=>{
  const s=fixture();change(s,2,4,s=>s.left.corrected=.1);change(s,2.7,3.05,s=>s.left.corrected=.5);
  const r=assess(s);assert.equal(r.adequate,false);assert.deepEqual(r.candidates,[]);assert.ok(r.issues.some(s=>s.includes('only brief')));
});
test('one-eye limitation is not averaged away by the other eye',()=>{
  const s=fixture();change(s,2,4,s=>s.left.corrected=.15);
  const r=assess(s);assert.equal(r.candidateScore,1);assert.equal(r.phases.left.right.endpoint,.5);assert.equal(r.phases.left.left.endpoint,.15);
});
test('bilateral non-crossing asks for 1 vs 2 and never assigns 2',()=>{
  const s=fixture();change(s,2,4,s=>{s.left.corrected=0;s.right.corrected=0;});
  const r=assess(s);assert.equal(r.adequate,true);assert.equal(r.candidateScore,null);assert.deepEqual(r.candidates,[1,2]);
});
test('abnormal resting offset is preserved, not normalized to zero',()=>{
  const s=fixture();change(s,0,2,s=>{s.left.corrected=.3;s.right.corrected=.3;});
  const r=assess(s);assert.equal(r.phases.center.left.median,.3);assert.deepEqual(r.candidates,[1,2]);assert.ok(r.flags.includes('left:rest-offset'));
});
test('missing extreme-position tail abstains despite sufficient overall coverage',()=>{
  const s=fixture();change(s,3.8,4,s=>s.left=null);
  const r=assess(s);assert.ok(r.phases.left.left.coverage>.75);assert.equal(r.adequate,false);assert.ok(r.issues.some(s=>s.includes('end of the hold')));
});
test('a long interior gap cannot be hidden by otherwise adequate phase coverage',()=>{
  const s=fixture();change(s,2.7,3.25,s=>s.left=null);
  const r=assess(s);assert.equal(r.adequate,false);assert.ok(r.issues.some(s=>s.includes('gap is too long')));
});
test('short blink is skipped, never centered or classified as abnormal movement',()=>{
  const s=fixture();s[59].left=null;s[59].reviewKinds.left='blink';
  const r=assess(s);assert.equal(r.candidateScore,0);assert.equal(r.phases.left.left.endpoint,.5);assert.ok(r.phases.left.left.coverage<1);
});
test('closed/unresolved eyes cannot supply evidence even if residual coordinates remain',()=>{
  for(const kind of ['closed','unresolved','blink']){
    const s=fixture();change(s,2,4,s=>s.reviewKinds.left=kind);const r=assess(s);
    assert.equal(r.adequate,false);assert.deepEqual(r.candidates,[]);assert.equal(r.phases.left.left.endpoint,null);
  }
});
test('unchecked and head-rejected measurements are excluded',()=>{
  const s=fixture(),checked=new Set(s.flatMap((x,i)=>x.t<2||x.t>=4?[i]:[]));
  assert.equal(assess(s,selection,checked).adequate,false);
  change(s,2,4,s=>s.reasons=['head-out-of-range']);assert.equal(assess(s).adequate,false);
});
test('long sample intervals are not extrapolated as valid holds',()=>{
  const s=fixture().filter(s=>s.t<=2.7||s.t>=3.3);const r=assess(s);
  assert.equal(r.adequate,false);assert.ok(r.phases.left.left.maxMissingSeconds>=.59);
});
test('overlap, too-short holds and out-of-range intervals return no candidate',()=>{
  for(const left of [{start:1.5,end:4},{start:2,end:2.7},{start:2,end:7},{start:3,end:2}]){
    const r=assess(fixture(),{...selection,left});assert.equal(r.adequate,false);assert.deepEqual(r.candidates,[]);
  }
});
test('timestamps and instruction labels are required; motion does not supply labels',()=>{
  assert.equal(assess(fixture(),{}).adequate,false);
  for(const value of [null,NaN,0]){const s=fixture();s[60].rawVideoTimeSeconds=value;assert.equal(assess(s).adequate,false);}
});
test('B includes original/selected comparisons and never mutates source measurements',()=>{
  const {clip,report}=clipFixture(),before=structuredClone(clip.data);
  const r=clipGazeSuggestion(clip,report);assert.equal(r.mode,'temporal-holds-v2');assert.equal(r.score,null);assert.equal(r.temporal.candidateScore,0);
  assert.equal(r.methods.threePosition.selected.candidateScore,0);assert.equal(r.originalTemporal.candidateScore,0);assert.deepEqual(clip.data,before);
});
test('accepted estimates preserve original evidence and document changed B outcome',()=>{
  const {clip,report}=clipFixture();change(clip.data.samples,2,4,s=>s.left.corrected=.1);
  for(const f of report.frames)if(f.time>=2&&f.time<4)f.left={flagged:true,proposal:eye(.5),decision:'suggestion'};
  const r=clipGazeSuggestion(clip,report);assert.equal(r.temporal.candidateScore,0);assert.equal(r.originalTemporal.candidateScore,1);
  assert.ok(r.reasons.some(s=>s.includes('changed the temporal')));assert.ok(r.reasons.some(s=>s.includes('not independent')));
});
test('pending review blocks B and examiner-entered scores',()=>{
  const {clip,report}=clipFixture();report.segments=[{decision:'unreviewed'}];clip.clinicalObservation={finding:'normal',examAdequate:'yes',reviewer:'QA'};
  const r=clipGazeSuggestion(clip,report);assert.equal(r.score,null);assert.deepEqual(r.candidates,[]);
});
test('clinical 2 still requires independent applicable reflex findings in B mode',()=>{
  const {clip,report}=clipFixture();clip.clinicalObservation={finding:'deviation',examAdequate:'yes',reviewer:'QA',overcome:'not-overcome'};
  assert.equal(clipGazeSuggestion(clip,report).score,null);clip.clinicalObservation.reflexAssessed='yes';assert.equal(clipGazeSuggestion(clip,report).score,2);
});

const fixedSelection={center:{start:.4,end:1.6},left:{start:2.4,end:3.6},right:{start:4.4,end:5.6}};
const fixedAssess=(samples,sel=fixedSelection)=>temporalGazeEvidence(samples,sel,undefined,6,{fixedWindow:true});
test('fixed windows use the entire prescribed interval without a second settling trim',()=>{
  const r=fixedAssess(fixture());assert.equal(r.candidateScore,0);assert.equal(r.fixedWindow,true);assert.equal(r.appliedSettleSeconds,0);assert.equal(r.thresholds.settleSeconds,0);
  for(const [phase,range] of Object.entries(fixedSelection)){
    const e=r.phases[phase];assert.equal(e.analysisStart,range.start);assert.equal(e.analysisEnd,range.end);
    assert.ok(Math.abs(e.left.seconds-(range.end-range.start))<1e-8);assert.ok(e.left.coverage>.999);
  }
});
test('fixed windows need the valid-duration minimum but do not charge settling time twice',()=>{
  const selection={center:{start:.6,end:1.4},left:{start:2.6,end:3.4},right:{start:4.6,end:5.4}},samples=fixture();
  assert.equal(fixedAssess(samples,selection).candidateScore,0);assert.equal(assess(samples,selection).adequate,false);
});
test('missing samples before and after every fixed window cannot affect its temporal result',()=>{
  const samples=fixture(),before=fixedAssess(samples);
  for(const sample of samples)if(!Object.values(fixedSelection).some(r=>sample.t>=r.start-1e-8&&sample.t<=r.end+1e-8)){
    sample.left=null;sample.right=null;sample.reviewKinds={left:'unresolved',right:'closed'};
  }
  assert.deepEqual(fixedAssess(samples),before);
});
test('missing samples inside the fixed window stay missing instead of being discarded as extra settling',()=>{
  const samples=fixture();change(samples,2.4,2.75,s=>s.left=null);const fixed=fixedAssess(samples),legacy=assess(samples,fixedSelection);
  assert.equal(fixed.phases.left.analysisStart,2.4);assert.equal(fixed.adequate,true);assert.ok(fixed.phases.left.left.maxMissingSeconds>.3);
  assert.ok(fixed.phases.left.left.coverage<.75);assert.ok(fixed.phases.left.left.validSeconds<fixed.phases.left.left.seconds);
  assert.ok(fixed.phases.left.left.sourceIndices.every(index=>samples[index].left!==null));
  assert.equal(legacy.phases.left.analysisStart,2.65);assert.equal(legacy.adequate,true);
});
test('cells crossing a non-frame-aligned fixed boundary cannot borrow buffer measurements',()=>{
  const sel={center:{start:.425,end:1.575},left:{start:2.425,end:3.575},right:{start:4.425,end:5.575}},samples=fixture();
  const before=fixedAssess(samples,sel);assert.equal(before.candidateScore,0);
  for(const sample of samples)if(!Object.values(sel).some(r=>sample.t>=r.start&&sample.t<=r.end)){
    sample.left.corrected=1.2;sample.right.corrected=-1.2;
  }
  const after=fixedAssess(samples,sel);assert.deepEqual(after,before);
  for(const [phase,range] of Object.entries(sel))for(const side of ['left','right']){
    assert.ok(after.phases[phase][side].sourceIndices.every(index=>samples[index].t>=range.start&&samples[index].t<=range.end));
  }
});
test('fixed-window endpoint missingness cannot be repaired by a clear later buffer',()=>{
  const samples=fixture();change(samples,3.4,3.61,s=>s.left=null);const r=fixedAssess(samples);
  assert.equal(r.adequate,false);assert.equal(r.phases.left.end,3.6);assert.ok(r.phases.left.left.tailCoverage<.7);
});
test('explicit legacy options preserve prior evidence and fixed mode does not mutate inputs',()=>{
  const samples=fixture(),original=structuredClone(samples);
  assert.deepEqual(temporalGazeEvidence(samples,selection,undefined,6,{fixedWindow:false}),assess(samples));
  fixedAssess(samples);assert.deepEqual(samples,original);
});
