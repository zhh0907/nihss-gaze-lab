import {test} from 'node:test';
import assert from 'node:assert/strict';
import {threePositionEvidence,legacyEyeCode} from '../three-position.js';
import {clipGazeSuggestion} from '../eye-motion.js';

const eye=x=>({valid:true,corrected:x,raw:x,reasons:[],points:{a:{x:.2,y:.4},b:{x:.4,y:.4},iris:{x:.3,y:.4}}});
function fixture(){
  const samples=Array.from({length:120},(_,i)=>{
    const t=i*.05,x=t<2?0:t<4?.5:-.5;
    return {t:t+20,rawVideoTimeSeconds:t,phase:'unlabelled',valid:true,reasons:[],left:eye(x),right:eye(x)};
  });
  const selection={rest:1,left:3,right:5},frames=samples.map((s,i)=>({sourceIndex:i,sample:structuredClone(s),time:s.rawVideoTimeSeconds,left:{flagged:false},right:{flagged:false}}));
  return {samples,selection,clip:{data:{samples,recording:{durationSeconds:6}},gazeScoringMode:'three-position',threePositionSelection:selection},report:{frames,segments:[]}};
}
test('the legacy code uses half-eye-width units and rejects missing values',()=>{
  assert.deepEqual([null,NaN,0,.149,.15,.399,.4,-.4].map(legacyEyeCode),[null,null,0,0,1,1,2,-2]);
});
test('unlabelled reviewed clip supports three-position 0 with canonical left/right signs',()=>{
  const {clip,report}=fixture(),r=clipGazeSuggestion(clip,report);
  assert.equal(r.evidence.adequate,false);assert.equal(r.threePositions.adequate,true);
  assert.deepEqual(r.candidates,[0]);assert.equal(r.score,null);assert.equal(r.candidateScore,0);
  assert.deepEqual(r.threePositions.codes,{rest:{left:0,right:0},left:{left:-2,right:-2},right:{left:2,right:2}});
});
test('one-eye restriction is retained rather than averaged away',()=>{
  const {samples,selection}=fixture();samples.filter(s=>s.rawVideoTimeSeconds>=2&&s.rawVideoTimeSeconds<4).forEach(s=>s.left.corrected=0);
  const r=threePositionEvidence(samples,selection);assert.deepEqual(r.candidates,[1]);
  assert.equal(r.positions.left.left.code,0);assert.equal(r.positions.left.right.code,-2);
});
test('neither eye crossing midline never produces a definitive 2',()=>{
  const {clip,report}=fixture();clip.data.samples.forEach(s=>{s.left.corrected=.5;s.right.corrected=.5;});
  const r=clipGazeSuggestion(clip,report);assert.equal(r.threePositions.legacyRuleScore,2);assert.deepEqual(r.candidates,[1,2]);assert.equal(r.score,null);
  clip.clinicalObservation={reviewer:'QA',examAdequate:'yes',finding:'deviation',overcome:'not-overcome'};
  assert.equal(clipGazeSuggestion(clip,report).score,null);clip.clinicalObservation.reflexAssessed='yes';assert.equal(clipGazeSuggestion(clip,report).score,2);
});
test('rest deviation is retained; no patient recentering or mirror-dependent sign flip',()=>{
  const {clip,report}=fixture();clip.data.samples.filter(s=>s.rawVideoTimeSeconds<2).forEach(s=>{s.left.corrected=.2;s.right.corrected=.2;});
  const a=clipGazeSuggestion(clip,report);assert.deepEqual(a.candidates,[1]);
  clip.data.recording.rawInputMirrored=true;assert.deepEqual(clipGazeSuggestion(clip,report).threePositions,a.threePositions);
});
test('missing, overlapping and out-of-range selections abstain without treating null as zero',()=>{
  const {samples,selection}=fixture();
  for(const s of [{},{...selection,rest:null},{...selection,left:1.2},{...selection,right:20}]){
    const r=threePositionEvidence(samples,s);assert.equal(r.adequate,false);assert.deepEqual(r.candidates,[]);
  }
});
test('selected blink, manual closure or head rejection cannot borrow nearby valid positions',()=>{
  for(const kind of ['blink','closed','unresolved','head']){
    const {samples,selection}=fixture(),s=samples[60];
    if(kind==='head')s.reasons=['head-out-of-range'];else{s.left=null;s.reviewKinds={left:kind};}
    assert.equal(threePositionEvidence(samples,selection).adequate,false,kind);
  }
});
test('unchecked anchors and sparse or stale samples do not produce scores',()=>{
  const {samples,selection}=fixture(),checked=new Set(samples.map((_,i)=>i));checked.delete(60);
  assert.equal(threePositionEvidence(samples,selection,checked).adequate,false);
  assert.equal(threePositionEvidence(samples.filter((_,i)=>i%10===0),selection).adequate,false);
  assert.equal(threePositionEvidence(samples.filter(s=>Math.abs(s.rawVideoTimeSeconds-3)>.2),selection).adequate,false);
});
test('moving through an endpoint or a threshold boundary requires another selection',()=>{
  const {samples,selection}=fixture();samples.forEach(s=>{if(Math.abs(s.rawVideoTimeSeconds-3)<=.25)s.left.corrected=s.rawVideoTimeSeconds-2.7;});
  const r=threePositionEvidence(samples,selection);assert.equal(r.adequate,false);assert.ok(r.issues.some(s=>s.includes('varies')));
});
test('duplicate timestamps and swapped direction labels do not silently produce normal gaze',()=>{
  const {samples,selection}=fixture();assert.notDeepEqual(threePositionEvidence(samples,{...selection,left:5,right:3}).candidates,[0]);
  samples[60].rawVideoTimeSeconds=samples[59].rawVideoTimeSeconds;assert.equal(threePositionEvidence(samples,selection).adequate,false);
});
test('doctor decisions recompute results and keep raw recordings and selection times unchanged',()=>{
  const {clip,report}=fixture(),source=structuredClone(clip.data),selection=structuredClone(clip.threePositionSelection);
  for(const f of report.frames.filter(f=>Math.abs(f.time-3)<=.25))f.left={flagged:true,decision:'suggestion',proposal:eye(0)};
  const r=clipGazeSuggestion(clip,report);assert.deepEqual(r.candidates,[1]);assert.equal(r.originalThreePositions.legacyRuleScore,0);
  assert.ok(r.reasons.some(s=>s.includes('changed')));assert.deepEqual(clip.data,source);assert.deepEqual(clip.threePositionSelection,selection);
  report.frames.forEach(f=>{f.left.decision='original';});assert.deepEqual(clipGazeSuggestion(clip,report).candidates,[0]);
  report.segments=[{decision:'unreviewed'}];assert.deepEqual(clipGazeSuggestion(clip,report).candidates,[]);
});
