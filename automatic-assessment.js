import {selectedFrame} from './segment-review.js?v=adaptive19';
import {proposeAutoSelections,checkedWithinAnalysisWindows} from './auto-selection.js?v=adaptive19';
import {threePositionEvidence} from './three-position.js';
import {temporalGazeEvidence} from './temporal-gaze.js?v=adaptive19';

// The automatic comparison never consumes clinical findings, clinician phase
// edits or accepted trajectory replacements. A later assisted result is separate.
export function automaticGazeAssessment(clip,report){
  const guide=clip?.data?.recording?.guidedExam;
  if(!['guided-exam-v1','guided-exam-v2','guided-exam-v3','guided-exam-v4'].includes(guide?.version)||!report)return null;
  const frames=new Map(report.frames.map(f=>[f.sourceIndex,f]));
  let withheldEyes=0;
  const samples=clip.data.samples.map((sample,index)=>{
    const frame=frames.get(index),out=selectedFrame(sample,frame,'original');
    for(const side of ['left','right'])if(frame?.[side]?.flagged){
      out[side]=null;out.reviewKinds[side]='unresolved';withheldEyes++;
    }
    return out;
  });
  const checked=new Set(frames.keys()),duration=clip.data.recording.durationSeconds;
  const selection=proposeAutoSelections(samples,checked,guide,duration);
  selection.provenance.selectionSource='Original checked tracks; automatically flagged eyes excluded; no clinician feedback';
  const fixedWindow=['guided-exam-v3','guided-exam-v4'].includes(guide.version);
  const evidenceChecked=fixedWindow?checkedWithinAnalysisWindows(samples,checked,selection.temporalSelection):checked;
  const methods={
    threePosition:threePositionEvidence(samples,selection.threePositionSelection,evidenceChecked),
    temporal:temporalGazeEvidence(samples,selection.temporalSelection,evidenceChecked,duration,{fixedWindow}),
  };
  return {version:'automatic-gaze-assessment-v1',source:'Original tracks with automatic quality exclusions',
    clinicalInputsUsed:false,manualSelectionsUsed:false,trajectoryReplacementsUsed:false,
    withheldEyes,guideStatus:guide.status,selection,methods,
    limitation:'Experimental movement evidence. Missing or suspicious measurements are not a normal score. Clinical scoring may require findings outside this recording.'};
}
