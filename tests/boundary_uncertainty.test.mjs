import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticGazeAssessment} from '../automatic-assessment.js';
import {initializeSelectionReview,confirmSelections} from '../selection-review.js';
import {clipGazeSuggestion} from '../eye-motion.js';
import {selectIndependentPhase} from '../method-selection.js';
import {threePositionEvidence} from '../three-position.js';

const eye=x=>({valid:true,corrected:x,raw:x,reasons:[]});
const ramp=(t,start,end,a,b)=>t<start?a:t>=end?b:a+(b-a)*(t-start)/(end-start);
function fixture(){
  const intervals=[{phase:'center',start:0,holdStart:1.5,end:5.5,completed:true},
    {phase:'left',start:5.5,holdStart:7.5,end:15.5,completed:true},
    {phase:'right',start:15.5,holdStart:17.5,end:25.5,completed:true}];
  const samples=Array.from({length:307},(_,index)=>{
    const t=index/12,phase=t<5.5?'center':t<15.5?'left':'right';
    const value=t<15.5?ramp(t,7.5,7.8,0,.5):ramp(t,17.5,17.8,.5,-.5);
    return {t,rawVideoTimeSeconds:t,recordingTimeSeconds:t,phase,valid:true,reasons:[],
      left:eye(value),right:eye(value),reviewScope:'observation'};
  });
  const report={version:'boundary-qa',frames:samples.map((sample,sourceIndex)=>({sample,sourceIndex,time:sample.t,
    left:{flagged:false,ignored:false},right:{flagged:false,ignored:false}})),segments:[]};
  const clip={gazeScoringMode:'three-position',checkReport:report,data:{samples,recording:{id:'boundary-qa',durationSeconds:25.5,
    guidedExam:{version:'guided-exam-v4',status:'complete',intervals}}}};
  return {clip,report};
}
function setRightEye(f,valueAt){
  for(const [index,sample] of f.clip.data.samples.entries())if(sample.t>=17.8){
    const value=valueAt(sample.t,index);sample.left.corrected=sample.left.raw=value;
  }
  return f;
}
const boundaryFixture=()=>setRightEye(fixture(),(_t,index)=>index%2?-.39:-.41);
const auto=f=>automaticGazeAssessment(f.clip,f.report);

function assertBoundaryMeasurement(a){
  assert.equal(a.method,'three-position-interval-rules-v2');
  assert.equal(a.adequate,true,'a score boundary does not invalidate measured eye positions');
  assert.equal(a.partial,false);assert.equal(a.availableEyes,6);
  assert.deepEqual(a.availablePhases,['rest','left','right']);
  assert.equal(a.positions.right.left.adequate,true);
  assert.equal(a.positions.right.left.thresholdAmbiguous,true);
  assert.deepEqual([...a.positions.right.left.codeOptions].sort((x,y)=>x-y),[1,2]);
  assert.equal(a.classificationUncertain,true);
  assert.deepEqual(a.candidates,[0,1]);assert.equal(a.candidateScore,null);
  assert.ok(!a.issues.some(issue=>issue.includes('crosses a rule threshold')));
}

test('stable .39/.41 boundary noise retains complete automatic and confirmed A measurements',()=>{
  const f=boundaryFixture(),original=structuredClone(f.clip.data.samples),baseline=auto(f);
  assertBoundaryMeasurement(baseline.methods.threePosition);
  const phase=baseline.selection.methodStatus.A.phases.right;
  assert.equal(phase.eyes.left.adequate,true);assert.deepEqual(phase.laterChanges,[]);
  initializeSelectionReview(f.clip,f.report);confirmSelections(f.clip,f.report);
  const assisted=clipGazeSuggestion(f.clip,f.report);
  assertBoundaryMeasurement(assisted.methods.threePosition.selected);
  assert.equal(assisted.score,null,'confirming phase times does not finalize a clinical score');
  assert.deepEqual(auto(f),baseline,'phase confirmation cannot change the automatic original baseline');
  assert.deepEqual(f.clip.data.samples,original);
});

test('continuous near-boundary agreement does not truncate a sustained selection to match a category',()=>{
  const f=setRightEye(fixture(),t=>t<25.0?-.39:-.41);
  const interval=f.clip.data.recording.guidedExam.intervals[2],samples=f.clip.data.samples;
  const result=selectIndependentPhase(samples,new Set(samples.map((_,i)=>i)),interval);
  for(const method of ['A','B']){
    assert.equal(result[method].eyes.left.adequate,true,method);
    assert.equal(result[method].normalEligible,true,method);
    assert.deepEqual(result[method].laterChanges,[],method);
  }
  assert.ok(result.B.selection.end-result.B.selection.start>=1.49,
    'a .02 difference across .40 must not force B to select a shorter same-category window');
  assert.notEqual(result.B.eyes.left.median,result.B.eyes.left.endpointReference.median,
    'fixture exercises different window and endpoint medians, not identical samples');
});

test('true wide variation remains invalid rather than becoming score uncertainty',()=>{
  const f=setRightEye(fixture(),(_t,index)=>index%2?-.1:-.7),a=auto(f).methods.threePosition;
  assert.equal(a.adequate,false);assert.equal(a.partial,true);
  assert.equal(a.positions.right.left.adequate,false);
  assert.equal(a.positions.right.right.adequate,true);
  assert.equal(a.availableEyes,5);assert.deepEqual(a.candidates,[]);
  assert.equal(a.candidateScore,null);
});

test('a sustained regression remains visible even when its final position crosses a score boundary',()=>{
  for(const finalValue of [(_t,index)=>index%2?-.39:-.41,()=>-.2]){
    const f=setRightEye(fixture(),(t,index)=>t<22?-.5:finalValue(t,index)),result=auto(f);
    const phase=result.selection.methodStatus.A.phases.right;
    assert.ok(phase.laterChanges.some(change=>change.eye==='left'));
    assert.equal(phase.normalEligible,false);
    assert.equal(result.methods.threePosition.candidates.includes(0),false,
      'neither a single normal score nor 0 among ambiguous candidates may hide the regression');
    assert.equal(result.methods.threePosition.positions.left.adequate,true);
    initializeSelectionReview(f.clip,f.report);
    assert.equal(clipGazeSuggestion(f.clip,f.report).methods.threePosition.selected.candidates.includes(0),false);
  }
});

test('clear normal and clear limited positions retain their existing conclusions',()=>{
  assert.equal(auto(fixture()).methods.threePosition.candidateScore,0);
  const limited=setRightEye(fixture(),()=>-.3),result=auto(limited).methods.threePosition;
  assert.equal(result.adequate,true);assert.equal(result.classificationUncertain,false);
  assert.equal(result.candidateScore,1);assert.deepEqual(result.candidates,[1]);
});

test('A retains measured resting positions across the .15 center threshold',()=>{
  const f=fixture();
  for(const [index,sample] of f.clip.data.samples.entries())if(sample.phase==='center'){
    sample.left.corrected=sample.left.raw=index%2?.14:.16;
  }
  const a=threePositionEvidence(f.clip.data.samples,{rest:3,left:12,right:22});
  assert.equal(a.adequate,true);assert.equal(a.partial,false);assert.equal(a.availableEyes,6);
  assert.equal(a.positions.rest.left.adequate,true);assert.equal(a.positions.rest.left.thresholdAmbiguous,true);
  assert.deepEqual([...a.positions.rest.left.codeOptions].sort((x,y)=>x-y),[-1,0]);
  assert.equal(a.classificationUncertain,true);assert.deepEqual(a.candidates,[0,1]);
  assert.equal(a.candidateScore,null);
});

test('A handles full-excursion threshold uncertainty symmetrically in either or both directions',()=>{
  for(const uncertainPhases of [['left'],['right'],['left','right']]){
    const f=fixture();
    for(const [index,sample] of f.clip.data.samples.entries())if(uncertainPhases.includes(sample.phase)){
      const sign=sample.phase==='left'?1:-1;
      sample.left.corrected=sample.left.raw=sign*(index%2?.39:.41);
    }
    const a=threePositionEvidence(f.clip.data.samples,{rest:3,left:12,right:22});
    assert.equal(a.adequate,true,uncertainPhases.join('/'));assert.equal(a.partial,false);
    assert.equal(a.availableEyes,6);assert.equal(a.classificationUncertain,true);
    assert.deepEqual(a.candidates,[0,1]);assert.equal(a.candidateScore,null);
    for(const phase of uncertainPhases){
      assert.equal(a.positions[phase].left.thresholdAmbiguous,true);
      assert.deepEqual([...a.positions[phase].left.codeOptions].sort((x,y)=>x-y),phase==='left'?[-2,-1]:[1,2]);
    }
  }
});
