import {selectedFrame} from './segment-review.js';
import {proposeAutoSelections} from './auto-selection.js?v=spoken16';
import {threePositionEvidence} from './three-position.js';
import {temporalGazeEvidence} from './temporal-gaze.js';

// The automatic comparison never consumes clinical findings, clinician phase
// edits or accepted trajectory replacements. A later assisted result is separate.
export function automaticGazeAssessment(clip,report){
  const guide=clip?.data?.recording?.guidedExam;
  if(!['guided-exam-v1','guided-exam-v2'].includes(guide?.version)||!report)return null;
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
  const methods={
    threePosition:threePositionEvidence(samples,selection.threePositionSelection,checked),
    temporal:temporalGazeEvidence(samples,selection.temporalSelection,checked,duration),
  };
  return {version:'automatic-gaze-assessment-v1',source:'Original tracks with automatic quality exclusions',
    clinicalInputsUsed:false,manualSelectionsUsed:false,trajectoryReplacementsUsed:false,
    withheldEyes,guideStatus:guide.status,selection,methods,
    limitation:'Experimental movement evidence. Missing or suspicious measurements are not a normal score. Clinical scoring may require findings outside this recording.'};
}
