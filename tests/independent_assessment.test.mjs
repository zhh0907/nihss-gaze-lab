import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticGazeAssessment} from '../automatic-assessment.js';
import {initializeSelectionReview,refreshAutomaticSelections} from '../selection-review.js';
import {clipGazeSuggestion,reviewedSamples} from '../eye-motion.js';

// Cross-module regressions: these exercise recorded instructions, raw/reviewed
// tracks, automatic selections and both assessment methods together.
const eye=x=>({valid:true,corrected:x,raw:x,reasons:[]});
const ramp=(t,start,end,a,b)=>t<start?a:t>=end?b:a+(b-a)*(t-start)/(end-start);
function fixture(fps=12){
  const intervals=[{phase:'center',start:0,holdStart:1.5,end:5.5,completed:true},
    {phase:'left',start:5.5,holdStart:7.5,end:15.5,completed:true},
    {phase:'right',start:15.5,holdStart:17.5,end:25.5,completed:true}];
  const samples=Array.from({length:Math.floor(25.5*fps)+1},(_,index)=>{
    const t=index/fps,phase=t<5.5?'center':t<15.5?'left':'right';
    const value=t<15.5?ramp(t,7.5,7.8,0,.5):ramp(t,17.5,17.8,.5,-.5);
    return {t,rawVideoTimeSeconds:t,recordingTimeSeconds:t,phase,phaseStart:phase==='center'?0:phase==='left'?5.5:15.5,
      valid:true,reasons:[],left:eye(value),right:eye(value),head:{yaw:0,pitch:0,roll:0,normal:[0,0,1]},reviewScope:'observation'};
  });
  const clip={gazeScoringMode:'temporal',data:{samples,recording:{id:'independent-qa',durationSeconds:25.5,
    guidedExam:{version:'guided-exam-v4',status:'complete',intervals}}}};
  const report={version:'independent-qa',frames:samples.map((sample,sourceIndex)=>({sample,sourceIndex,time:sample.t,
    left:{flagged:false,ignored:false},right:{flagged:false,ignored:false}})),segments:[]};
  return {clip,report};
}
const change=(f,start,end,fn)=>f.clip.data.samples.forEach((sample,index)=>{if(sample.t>=start&&sample.t<end)fn(sample,f.report.frames[index],index);});
const automatic=f=>automaticGazeAssessment(f.clip,f.report);
function assisted(f){initializeSelectionReview(f.clip,f.report);return clipGazeSuggestion(f.clip,f.report);}
function noFullScore(method){assert.equal(method.adequate,false);assert.equal(method.candidateScore,null);assert.deepEqual(method.candidates,[]);}

test('independent A and B both assess a complete 12 Hz instructed recording',()=>{
  const f=fixture(),result=automatic(f);
  for(const method of Object.values(result.methods)){
    assert.equal(method.adequate,true);assert.equal(method.candidateScore,0);
    assert.equal(method.partial,false);assert.equal(method.availableEyes,6);assert.equal(method.availablePhases.length,3);
  }
  const checked=assisted(f);
  assert.equal(checked.methods.threePosition.selected.candidateScore,0);
  assert.equal(checked.methods.temporal.selected.candidateScore,0);
  assert.equal(checked.score,null,'measured candidates do not become a final clinical score');
});

test('a brief blink or dropout does not erase clear post-response positions from both methods',()=>{
  for(const kind of ['blink','dropout']){
    const f=fixture();change(f,8.75,8.9,(sample,frame)=>{
      sample.left=null;if(kind==='blink')frame.left.ignored=true;
    });
    const r=automatic(f);
    assert.equal(r.methods.threePosition.positions.left.adequate,true,kind);
    assert.equal(r.methods.temporal.phases.left.left.adequate,true,kind);
    assert.equal(r.methods.threePosition.candidateScore,0,kind);assert.equal(r.methods.temporal.candidateScore,0,kind);
    const rows=reviewedSamples(f.clip,f.report);assert.ok(rows.some(s=>s.t>=8.75&&s.t<8.9&&s.left===null));
    assert.equal(f.clip.data.samples.find(s=>s.t===8.75).left,null,'no zero or interpolated eye is written to the source');
  }
});

test('missing pre-cue reference does not remove an observed directional position or the other phases',()=>{
  const f=fixture();change(f,5,5.5,s=>s.left=s.right=null);const r=automatic(f);
  assert.equal(r.methods.threePosition.positions.left.adequate,true);
  assert.equal(r.methods.threePosition.positions.right.adequate,true);
  assert.equal(r.methods.temporal.phases.left.left.adequate,true);
  assert.equal(r.methods.temporal.phases.left.right.adequate,true);
  assert.equal(r.methods.temporal.phases.right.left.adequate,true);
  assert.equal(r.methods.threePosition.positions.left.left.median,.5);
});

test('missing right-task data preserves center and left results without inventing a complete score',()=>{
  const f=fixture();change(f,15.5,26,s=>s.left=s.right=null);const r=automatic(f);
  const a=r.methods.threePosition,b=r.methods.temporal;
  noFullScore(a);noFullScore(b);assert.equal(a.partial,true);assert.equal(b.partial,true);
  assert.equal(a.positions.rest.adequate,true);assert.equal(a.positions.left.adequate,true);
  assert.equal(a.positions.right.adequate,false);assert.equal(a.availableEyes,4);
  assert.equal(b.phases.center.left.adequate,true);assert.equal(b.phases.left.right.adequate,true);
  assert.equal(b.availableEyes,4);assert.deepEqual(b.availablePhases,['center','left']);
});

test('one missing eye preserves the fellow eye and cannot be averaged into a normal examination',()=>{
  const f=fixture();change(f,15.5,26,s=>s.left=null);const r=automatic(f);
  for(const method of Object.values(r.methods)){noFullScore(method);assert.equal(method.partial,true);assert.equal(method.availableEyes,5);}
  assert.equal(r.methods.threePosition.positions.right.left.adequate,false);
  assert.equal(r.methods.threePosition.positions.right.right.adequate,true);
  assert.equal(r.methods.threePosition.positions.right.right.median,-.5);
  assert.equal(r.methods.temporal.phases.right.left.adequate,false);
  assert.equal(r.methods.temporal.phases.right.right.adequate,true);
});

test('independent selection preserves no movement, asymmetric limitation and resting deviation',()=>{
  for(const kind of ['no-movement','one-eye-limitation','rest-offset']){
    const f=fixture();
    if(kind==='no-movement')change(f,0,26,s=>s.left.corrected=s.right.corrected=0);
    if(kind==='one-eye-limitation'){
      change(f,5.5,15.5,s=>s.left.corrected=ramp(s.t,7.5,7.8,0,.15));
      change(f,15.5,26,s=>s.left.corrected=ramp(s.t,17.5,17.8,.15,-.5));
    }
    if(kind==='rest-offset')change(f,0,26,s=>{s.left.corrected+=.3;s.right.corrected+=.3;});
    const r=automatic(f);
    for(const method of Object.values(r.methods)){
      assert.equal(method.adequate,true,kind);assert.notDeepEqual(method.candidates,[0],kind);assert.notEqual(method.candidateScore,2,kind);
    }
    if(kind==='no-movement')for(const method of Object.values(r.methods))assert.deepEqual(method.candidates,[1,2]);
    if(kind==='one-eye-limitation')assert.equal(r.methods.temporal.candidateScore,1);
    if(kind==='rest-offset')assert.equal(r.methods.temporal.phases.center.left.median,.3);
  }
});

test('a later sustained regression cannot be hidden by selecting an earlier normal hold',()=>{
  const f=fixture();change(f,12,15.51,s=>s.left.corrected=.2);const r=automatic(f);
  for(const method of Object.values(r.methods))assert.notDeepEqual(method.candidates,[0]);
  assert.equal(r.methods.threePosition.positions.right.right.adequate,true,'the unrelated direction remains available');
  assert.equal(r.methods.temporal.phases.right.right.adequate,true);
});

test('accepted corrections improve assisted evidence without changing the original automatic baseline',()=>{
  const f=fixture(),indices=[];
  change(f,5.5,15.5,(sample,frame,index)=>{
    const proposal=structuredClone(sample.left);sample.left.corrected=0;sample.left.raw=0;
    Object.assign(frame.left,{flagged:true,proposal,decision:'deferred'});indices.push(index);
  });
  f.report.segments=[{id:'left-response',side:'left',sourceIndices:indices,flaggedIndices:indices,proposedCount:indices.length,decision:'deferred'}];
  const original=structuredClone(f.clip.data.samples),baseline=automatic(f);
  initializeSelectionReview(f.clip,f.report);const before=clipGazeSuggestion(f.clip,f.report);
  assert.equal(before.methods.threePosition.selected.partial,true);assert.equal(before.methods.temporal.selected.partial,true);
  for(const index of indices)f.report.frames[index].left.decision='suggestion';
  f.report.segments[0].decision='suggestion';refreshAutomaticSelections(f.clip,f.report);
  const after=clipGazeSuggestion(f.clip,f.report);
  assert.equal(after.methods.threePosition.selected.candidateScore,0);
  assert.equal(after.methods.temporal.selected.candidateScore,0);assert.ok(after.estimated>0);
  assert.deepEqual(automatic(f),baseline);assert.deepEqual(f.clip.data.samples,original);
});

test('a missing archive remains unobserved even when the live track has plausible eye positions',()=>{
  const f=fixture();f.report.frames=f.report.frames.filter(frame=>frame.time<15.5);const r=automatic(f);
  for(const method of Object.values(r.methods)){noFullScore(method);assert.equal(method.availableEyes,4);assert.equal(method.partial,true);}
  assert.ok(f.clip.data.samples.some(s=>s.t>20&&s.left?.corrected===-.5));
});

test('reviewed A and B retain independent availability when one method has an unusable selection',()=>{
  const f=fixture();initializeSelectionReview(f.clip,f.report);
  f.clip.threePositionSelection={rest:3,left:12,right:22};
  f.clip.temporalSelection={center:{start:2,end:4},left:{start:10,end:10.1},right:{start:20,end:24}};
  let r=clipGazeSuggestion(f.clip,f.report);
  assert.equal(r.methods.threePosition.selected.candidateScore,0);
  noFullScore(r.methods.temporal.selected);assert.equal(r.methods.temporal.selected.availableEyes,4);
  f.clip.threePositionSelection={rest:3,left:7.65,right:22};
  f.clip.temporalSelection.left={start:10,end:14};r=clipGazeSuggestion(f.clip,f.report);
  noFullScore(r.methods.threePosition.selected);assert.equal(r.methods.threePosition.selected.availableEyes,4);
  assert.equal(r.methods.temporal.selected.candidateScore,0);
});
