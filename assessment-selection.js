// Attach method-specific selection quality without discarding usable evidence.
// Recorded directions and missing samples are never inferred from the score.
export function checkedForPositions(samples,checked,selection,anchors){
  if(!selection?.methodStatus)return checked;
  const ranges=['center','left','right'].flatMap(phase=>{
    const p=selection.provenance.phases[phase]?.recordedPhase,time=anchors[phase==='center'?'rest':phase];
    const chosen=selection.methodStatus.A?.phases?.[phase]?.selection;
    if(!p||!Number.isFinite(time))return [];
    if(chosen&&Math.abs(chosen.time-time)<1e-8&&Number.isFinite(chosen.start)&&Number.isFinite(chosen.end))
      return [{start:Math.max(p.start,chosen.start),end:Math.min(p.end,chosen.end)}];
    return [{start:Math.max(p.start,time-.25),end:Math.min(p.end,time+.25)}];
  });
  return new Set([...checked].filter(i=>ranges.some(r=>samples[i]?.rawVideoTimeSeconds>=r.start-1e-8&&samples[i]?.rawVideoTimeSeconds<=r.end+1e-8)));
}
export function applySelectionQuality(evidence,selection,method){
  const status=selection?.methodStatus?.[method];
  if(!status)return evidence;
  const phases=['center','left','right'],sides=['left','right'];
  const key=p=>method==='A'&&p==='center'?'rest':p;
  const label=p=>p==='center'?'Rest':`Look ${p}`;
  const data=method==='A'?evidence.positions:evidence.phases;
  const selectionIssues=[],cautions=[];
  let blocked=false;
  for(const phase of phases){
    const quality=status.phases?.[phase],part=data?.[key(phase)];
    if(!quality)continue;
    for(const issue of quality.issues??[])selectionIssues.push(`${label(phase)}: ${issue}`);
    for(const caution of quality.cautions??[])cautions.push(`${label(phase)}: ${caution}`);
    for(const side of sides){
      if(part?.[side]?.adequate&&quality.eyes?.[side]?.adequate===false){
        part[side].adequate=false;
        part[side].issues=[...new Set([...(part[side].issues??[]),...(quality.eyes[side].issues??['Endpoint evidence is incomplete.'])])];
      }
      const measured=part?.[side]?.median,representative=quality.eyes?.[side]?.median;
      if(part?.[side]?.adequate&&Number.isFinite(measured)&&Number.isFinite(representative)&&Math.abs(measured-representative)>.12+1e-8){
        blocked=true;
        selectionIssues.push(`${label(phase)}, ${side} eye: the selected interval does not represent the later observed position.`);
      }
    }
    if(method==='A'&&part)part.adequate=sides.every(side=>part[side]?.adequate);
    if(quality.scoreEligible===false||(evidence.candidateScore===0||evidence.candidates?.includes(0))&&quality.normalEligible===false)blocked=true;
  }
  evidence.availablePhases=phases.filter(p=>sides.every(side=>data?.[key(p)]?.[side]?.adequate)).map(key);
  evidence.availableEyes=phases.reduce((n,p)=>n+sides.filter(side=>data?.[key(p)]?.[side]?.adequate).length,0);
  evidence.selectionIssues=[...new Set(selectionIssues)];
  evidence.cautions=[...new Set(cautions)];
  evidence.issues=[...new Set([...evidence.selectionIssues,...evidence.issues])];
  if(blocked||evidence.availableEyes<6){
    evidence.adequate=false;evidence.candidateScore=null;evidence.candidates=[];
    if('legacyRuleScore'in evidence)evidence.legacyRuleScore=null;
    if(blocked&&!evidence.selectionIssues.length)evidence.issues.unshift('Observed changes need review before a complete score.');
  }
  evidence.partial=evidence.availableEyes>0&&!evidence.adequate;
  return evidence;
}
