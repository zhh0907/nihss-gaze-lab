import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clipGazeSuggestion} from '../eye-motion.js';
import {initializeSelectionReview} from '../selection-review.js';

function fixture(){
  const intervals=[{phase:'center',start:0,holdStart:1.5,end:5.5,completed:true},{phase:'left',start:5.5,holdStart:7.5,end:15.5,completed:true},{phase:'right',start:15.5,holdStart:17.5,end:25.5,completed:true}];
  const ramp=(t,a,b,x,y)=>t<a?x:t>=b?y:x+(y-x)*(t-a)/(b-a),eye=x=>({valid:true,corrected:x,raw:x,reasons:[]});
  const samples=Array.from({length:307},(_,i)=>{const t=i/12,phase=intervals.find(p=>t>=p.start&&t<p.end)??intervals[2],x=t<15.5?ramp(t,11,11.4,0,.5):ramp(t,17.5,17.9,.5,-.5);return {t,rawVideoTimeSeconds:t,phase:phase.phase,phaseStart:phase.start,reviewScope:'observation',valid:true,reasons:[],left:eye(x),right:eye(x)};});
  const report={version:'adaptive19',frames:samples.map((s,i)=>({sourceIndex:i,time:s.t,left:{ignored:false,flagged:false},right:{ignored:false,flagged:false}})),segments:[]};
  const clip={data:{samples,recording:{durationSeconds:25.5,guidedExam:{version:'guided-exam-v4',status:'complete',intervals}}},gazeScoringMode:'temporal'};
  initializeSelectionReview(clip,report);return {clip,report};
}
test('reviewed response selection follows a delayed response and evaluates only the selected stable window',()=>{
  const {clip,report}=fixture(),r=clipGazeSuggestion(clip,report);
  assert.ok(clip.temporalSelection.left.start>11);assert.equal(r.temporal.adequate,true);assert.equal(r.temporal.candidateScore,0);
  assert.equal(r.methods.threePosition.selected.candidateScore,0);assert.equal(r.responseSelection.provenance.phases.left.response.adequate,true);
});
test('stale or manually entered clean windows cannot hide missing endpoint evidence',()=>{
  const {clip,report}=fixture();for(const s of clip.data.samples)if(s.t>=14.8&&s.t<=15.5)s.left=null;
  // Do not refresh UI selections: an export or older caller could retain these.
  const r=clipGazeSuggestion(clip,report);
  assert.equal(r.temporal.adequate,false);assert.equal(r.methods.threePosition.selected.adequate,false);
  assert.equal(r.methods.temporal.original.adequate,false);assert.equal(r.originalEvidence.adequate,false);
  assert.deepEqual(r.candidates,[]);assert.equal(r.score,null);
});

test('a pre-movement tracking gap does not erase the later observed endpoint from A and B',()=>{
  const {clip,report}=fixture();for(const s of clip.data.samples)if(s.t>=6.4&&s.t<6.8)s.left=null;
  const r=clipGazeSuggestion(clip,report);
  assert.equal(r.methods.threePosition.selected.candidateScore,0);
  assert.equal(r.methods.temporal.selected.candidateScore,0);
  assert.equal(r.methods.threePosition.selected.positions.left.left.median,.5);
  assert.equal(r.methods.temporal.selected.phases.left.left.endpoint,.5);
  assert.ok(clip.data.samples.some(s=>s.t>=6.4&&s.t<6.8&&s.left===null),'the missing interval is not filled');
});
test('an earlier manual window cannot replace the selected delayed response',()=>{
  const {clip,report}=fixture();clip.temporalSelection.left={start:6,end:8};clip.threePositionSelection.left=7;
  const r=clipGazeSuggestion(clip,report);assert.equal(r.temporal.adequate,false);assert.equal(r.methods.threePosition.selected.adequate,false);
});
test('independent examiner findings remain separately labelled when video response evidence is insufficient',()=>{
  const {clip,report}=fixture();for(const s of clip.data.samples)if(s.t>=14.8&&s.t<=15.5)s.left=null;
  clip.clinicalObservation={examAdequate:'yes',reviewer:'QA',finding:'partial',overcome:'unknown'};
  const r=clipGazeSuggestion(clip,report);assert.equal(r.score,1);assert.equal(r.mode,'clinician-observation-rule-mapping');assert.equal(r.evidence.adequate,false);
});
