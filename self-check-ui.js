import {chooseSegment,segmentCsv,annotationQueue} from './segment-review.js?v=merge22';
import {createAnnotationPackage} from './annotation-package.js?v=usability20';
import {createSegmentPreview,createReviewedPlayer,makeReviewRenderer,reviewedVideoSize} from './segment-player.js?v=independent23';
import {createEyeMotionPlayer,makeEyeMotionRenderer,clipGazeSuggestion,reviewedSamples,EYE_VIDEO_SIZE} from './eye-motion.js?v=independent23';
import {parseIntervals,NIHSS_SOURCE} from './assessment.js';
import {recordingMime,extensionFor} from './recording.js';
import {convertVideo} from './video-export.js';
import {initializeSelectionReview,refreshAutomaticSelections,editSelection,clearSelections,confirmSelections,recordedPhasePreview} from './selection-review.js?v=independent23';
import {automaticGazeAssessment} from './automatic-assessment.js?v=independent23';

const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
const phaseEntries=[['center','Rest'],['left','Left'],['right','Right']];
function evidenceAvailability(evidence){
  const phases=evidence?.positions??evidence?.phases??{};
  const available=Array.isArray(evidence?.availablePhases)?evidence.availablePhases.length:
    Number.isFinite(evidence?.availablePhases)?evidence.availablePhases:
    Object.values(phases).filter(p=>p.adequate===true||['left','right'].every(side=>p[side]?.adequate===true)).length;
  const eyes=Number.isFinite(evidence?.availableEyes)?evidence.availableEyes:
    Object.values(phases).reduce((n,p)=>n+['left','right'].filter(side=>p[side]?.adequate===true||p.adequate===true&&p[side]).length,0);
  return {phases:available,eyes};
}
function evidenceLabel(evidence){
  if(evidence?.adequate)return evidence.candidateScore===null?'Review 1–2':`Possible ${evidence.candidateScore}`;
  const available=evidenceAvailability(evidence);
  return available.eyes||available.phases?`Partial · ${available.phases}/3 phases`:'No usable evidence';
}
function eyeEvidenceText(eye,phaseAdequate=false){
  const value=eye?.median??eye?.endpoint;
  if(!Number.isFinite(value))return '—';
  return `${value.toFixed(2)} · ${eye.adequate===true||phaseAdequate?'usable':'limited'}`;
}
function field(text,options,value){
  const label=el('label',text),input=el('select');input.setAttribute('aria-label',text);
  for(const [v,t]of options)input.add(new Option(t,v));input.value=value;label.append(input);return {label,input};
}
export function createSelfCheckUI({clip,clipNumber,retry,saveBlob,busyMessage=()=>null,encode=async(c,task)=>task(),prepareDownload=()=>{}}){
  const root=el('section',null,'self-check compact-review');root.setAttribute('aria-label','Clip '+clipNumber+' segment review');
  const status=el('p',null,'hint');status.setAttribute('role','status');
  const actions=el('div',null,'buttons'),retryButton=el('button','Check clip'),cancel=el('button','Cancel check');
  retryButton.onclick=()=>retry(clip);cancel.onclick=()=>clip.checkController?.abort();actions.append(retryButton,cancel);
  const body=el('div');body.hidden=true;root.append(status,actions,body);
  const downloads=el('section');downloads.append(el('p','Reviewed downloads appear after the local check.','hint'));
  let disposed=false,position=0,builtReport=null,preview=null,player=null,eyes=null,progress,jump,panels,controller=null,
    result,positionPanel,positionHint,positionButtons=[],temporalButtons=[],threePanel,temporalPanel,methodInput,phaseBox,selectionBar,selectionLabel,selectionError,confirmButton,adjustButton,restoreAuto,selectionPreviews=[],adjusting=false,examContext,exportHint,contextFields=[],tabs=[],views={},activeView=clip.reviewView??'review',invalidateVideo=()=>{},exportButtons=[];
  let queuePanel,queueTitle,queueItems,packageButton;
  function reviewCounts(){
    const segments=clip.checkReport.segments,count=decision=>segments.filter(s=>s.decision===decision).length;
    return {total:segments.length,decided:segments.length-count('unreviewed'),unreviewed:count('unreviewed'),
      deferredCount:count('deferred'),notVisibleCount:count('not-visible'),closedCount:count('closed')};
  }
  function summary(){
    const counts=reviewCounts(),queue=annotationQueue(clip.checkReport);
    progress.textContent=`${counts.decided} / ${counts.total} checked${queue.length?` · ${queue.length} for later annotation`:''}`;
    queuePanel.hidden=!queue.length;queueTitle.textContent=`Later annotation (${queue.length})`;queueItems.replaceChildren();
    for(const item of queue){
      const button=el('button',`${item.eye==='left'?'Left':'Right'} eye · ${item.start.toFixed(1)}–${item.end.toFixed(1)} s`);
      button.type='button';button.onclick=()=>{position=clip.checkReport.segments.findIndex(s=>s.id===item.id);draw();panels.scrollIntoView({block:'nearest'});};queueItems.append(button);
    }
    if(packageButton){packageButton.hidden=!queue.length;packageButton.disabled=!!controller;}
  }
  function showView(name){
    const previousView=activeView;
    preview?.pause();player?.pause();eyes?.pause();
    if(name==='eyes'&&previousView==='video')eyes?.seekTime(player.getTime());
    if(name==='video'&&previousView==='eyes')player?.seekTime(eyes.getTime());
    activeView=name;clip.reviewView=name;
    if(positionPanel&&['eyes','video'].includes(name)){
      if(name==='eyes'){views.eyes.insertBefore(positionPanel,examContext);views.eyes.insertBefore(result,examContext);}
      else views.video.append(positionPanel,result);
    }
    for(const [key,pane]of Object.entries(views))pane.hidden=key!==name;
    for(const tab of tabs)tab.setAttribute('aria-pressed',String(tab.dataset.view===name));
    if(['eyes','video'].includes(name))updateResult();
  }
  function changed(){invalidateVideo();player.refresh();eyes.refresh();updateResult();summary();}
  function choose(value){if(controller)return;chooseSegment(clip.checkReport,clip.checkReport.segments[position].id,value);changed();draw();}
  function draw(){
    preview?.dispose();preview=null;panels.replaceChildren();
    const r=clip.checkReport,segments=r.segments;position=Math.max(0,Math.min(position,segments.length-1));jump.replaceChildren();
    for(const [i,s]of segments.entries()){
      const phase=r.frames.find(f=>f.sourceIndex===s.sourceIndices[0])?.phase;
      const label=phase==='center'?'Rest':phase==='left'?'Look left':phase==='right'?'Look right':null;
      jump.add(new Option(`${i+1}/${segments.length} · ${label?label+' · ':''}${s.side==='left'?'L eye':'R eye'} · ${s.start.toFixed(1)}–${s.end.toFixed(1)} s${s.decision==='unreviewed'?'':' ✓'}`,String(i)));
    }
    jump.value=String(position);jump.disabled=!segments.length;const segment=segments[position];
    if(!segment){panels.append(el('p','No segments to review.','hint'));summary();return;}
    preview=createSegmentPreview({clip,report:r,segment,onChoose:choose,disabled:!!controller});panels.append(preview.element);
    const coverage=el('p',segment.proposedCount?`${segment.proposedCount} suggested${segment.unresolvedCount?` · ${segment.unresolvedCount} unresolved`:''}`:'No reliable suggestion. Keep original or choose Both need correction.','hint compact-coverage');
    const footer=el('div',null,'review-footer'),reset=el('button','Undo');
    for(const [decision,label]of [['deferred','Both need correction'],['closed','Eye closed']]){
      const button=el('button',label);button.type='button';button.disabled=!!controller;
      button.setAttribute('aria-pressed',String(segment.decision===decision));button.onclick=()=>choose(decision);footer.append(button);
    }
    reset.type='button';reset.disabled=segment.decision==='unreviewed'||!!controller;reset.onclick=()=>choose('unreviewed');footer.append(reset);
    const notes={deferred:'For later annotation', 'not-visible':'Marked not visible',closed:'Marked eye closed',uncertain:'Marked unresolved'};
    const evidence=el('details',null,'review-reasons');evidence.append(el('summary',notes[segment.decision]?notes[segment.decision]+' · Details':'Details'),el('p',[...segment.reasons,...(segment.unresolvedReasons??[])].join(' · '),'hint'),
      el('p','Tap a picture to keep or replace this eye track. Both need correction saves a task for later annotation. Eye closed leaves this eye blank throughout the segment. The suggested version uses purple markers. Blinks are skipped. Choices do not train the model.','hint'));
    panels.append(coverage,footer,evidence);summary();
  }
  function updateResult(){
    if(!result)return;
    const adaptive=clip.data.recording.guidedExam?.version==='guided-exam-v4';
    const fixedWindow=adaptive||clip.data.recording.guidedExam?.version==='guided-exam-v3';
    const selection=refreshAutomaticSelections(clip,clip.checkReport),r=clipGazeSuggestion(clip,clip.checkReport),automatic=automaticGazeAssessment(clip,clip.checkReport);result.replaceChildren();
    const displayReason=(reason,method)=>{
      if(!reason||!selection)return reason;
      const match=reason.match(/^Mark (?:the start and end of )?(rest|look left|look right|subject-left|subject-right)(?: in the clip)?\.$/i);
      if(!match)return reason.replace(/(?:Choose a steady position|Select a steadier moment)\./g,'Review the eye track or record a steadier hold.')
        .replace('select a checked frame with both eyes visible.','the selected position lacks enough checked eye evidence.');
      const phase=match[1].toLowerCase()==='rest'?'center':match[1].toLowerCase().includes('left')?'left':'right';
      const name=phase==='center'?'Rest':phase==='left'?'Left':'Right',recorded=recordedPhasePreview(clip,phase);
      if(!recorded?.completed)return `${name} was not completed. Record a new exam.`;
      return `${name} was recorded; ${method==='A'?'no usable position':'no usable observation'} was selected.`;
    };
    const activeEvidence=r.temporal??r.threePositions;
    const title=r.score!==null?`NIHSS · ${r.score}`:r.pending?'NIHSS · Review needed':r.clinical?'NIHSS · Incomplete':activeEvidence?(selection?evidenceLabel(activeEvidence):r.title):!r.evidence.adequate?'NIHSS · Not ready':r.candidates.length===1?'NIHSS · Possible 0':'NIHSS · Review 1–2';
    const short=r.pending?`Review ${r.pending} remaining segments.`:r.score!==null?'Based on examiner findings.':r.clinical?'Complete examiner findings.':
      activeEvidence?(!activeEvidence.adequate?displayReason(activeEvidence.issues[0],r.temporal?'B':'A')??'Usable measurements are retained below.':'Clinician confirmation needed.'):
      !r.evidence.adequate?'Check tracking quality in Details.':'Clinician confirmation needed.';
    if(automatic){
      result.append(el('h4','Automatic comparison'));
      const comparison=el('table');comparison.className='position-values';comparison.setAttribute('aria-label','Automatic algorithm comparison');
      const header=el('tr');for(const text of ['Method','Result'])header.append(el('th',text));comparison.append(header);
      for(const [key,name]of [['threePosition','A · Three positions'],['temporal',adaptive?'B · Observation':fixedWindow?'B · Analysis window':'B · Full holds']]){
        const evidence=automatic.methods[key],row=el('tr'),cell=el('td',evidenceLabel(evidence));
        if(!evidence.adequate&&evidence.issues?.length)cell.append(el('p',displayReason(evidence.issues[0],key==='threePosition'?'A':'B'),'hint'));
        row.append(el('th',name),cell);comparison.append(row);
      }
      result.append(comparison,el('p',r.pending?`Original tracks · ${r.pending} eye segments await review.`:'Original tracks · A and B assess evidence independently.','hint'));
      if(!r.pending)result.append(el('h4',r.clinical?'Examiner result':'Reviewed suggestion'),el('p',title+' · '+short,'hint'));
    }else result.append(el('h4',title),el('p',short,'hint'));
    threePanel.hidden=!!selection||clip.gazeScoringMode!=='three-position';temporalPanel.hidden=!!selection||clip.gazeScoringMode!=='temporal';
    phaseBox.hidden=!!selection||clip.gazeScoringMode!=='phases';methodInput.disabled=!!controller;methodInput.closest('label').hidden=!!selection;
    selectionBar.hidden=!selection;restoreAuto.hidden=true;
    if(selection){
      selectionLabel.textContent='Recorded phases';
      confirmButton.hidden=true;adjustButton.hidden=true;
      confirmButton.textContent=selection.status==='confirmed'?'Confirmed':'Confirm phases';
      confirmButton.disabled=!!controller||r.pending>0||selection.status==='confirmed';
      adjustButton.textContent=adjusting?'Done adjusting':'Adjust';adjustButton.disabled=!!controller||r.pending>0;
      restoreAuto.disabled=!!controller||r.pending>0;
      for(const {phase,label,button}of selectionPreviews){
        const range=recordedPhasePreview(clip,phase);
        const text=range?`${range.start.toFixed(1)}–${range.end.toFixed(1)} s${range.completed?'':' · Partial'}`:'Not recorded';
        button.replaceChildren(el('strong',label),el('small',text));button.disabled=!!controller||!range;
      }
    }
    for(const {key,button,label}of positionButtons){
      const t=clip.threePositionSelection?.[key],set=Number.isFinite(t);
      button.replaceChildren(el('strong',label),el('small',set?t.toFixed(2)+' s':'Set here'));
      button.setAttribute('aria-pressed',String(set));button.disabled=!!controller||r.pending>0;
    }
    for(const {key,boundary,button}of temporalButtons){
      const t=clip.temporalSelection?.[key]?.[boundary],set=Number.isFinite(t);
      button.replaceChildren(el('span',boundary==='start'?'Start':'End'),el('small',set?t.toFixed(2)+' s':'Set here'));
      button.setAttribute('aria-pressed',String(set));button.disabled=!!controller||r.pending>0;
    }
    if(r.clinical&&clip.clinicalObservation?.finding==='normal'&&(r.evidence.flags.length||(r.threePositions?.adequate&&r.threePositions.legacyRuleScore!==0)||(r.temporal?.adequate&&r.temporal.flags.length)))result.append(el('p','Video and clinical findings differ.','warning'));
    const more=el('details');more.append(el('summary','Details'));
    if(!automatic||r.clinical){
      const list=el('ul');for(const reason of r.reasons)list.append(el('li',displayReason(reason,r.temporal?'B':'A')));
      more.append(list,el('p',r.limitation,'hint'));
    }
    more.append(el('p','Head-relative positions, not angles. Missing positions stay blank. Left/right refer to the subject.','hint'));
    function methodDetails(label,evidence,proposal,method){
      const detail=el('details'),table=el('table');table.className='position-values';
      detail.append(el('summary',label+' · '+evidenceLabel(evidence)));table.setAttribute('aria-label',label);
      const head=el('tr');for(const text of ['Phase','Left eye','Right eye'])head.append(el('th',text));table.append(head);
      const notes=[];
      for(const [phase,name]of phaseEntries){
        const key=method==='A'&&phase==='center'?'rest':phase;
        const measured=(evidence?.positions??evidence?.phases??{})[key];
        const diagnostic=proposal?.provenance?.phases?.[phase]?.methods?.[method]??proposal?.methodStatus?.[method]?.phases?.[phase];
        const row=el('tr');row.append(el('th',name));
        for(const side of ['left','right'])row.append(el('td',eyeEvidenceText(measured?.[side]??diagnostic?.eyes?.[side],measured?.adequate)));
        table.append(row);
        const issues=[...new Set([...(diagnostic?.issues??[]),...(diagnostic?.cautions??[])])];
        if(issues.length)notes.push(name+': '+issues.join(' '));
      }
      detail.append(table,el('p','Normalized positions · Usable eye measurements remain visible when a full score is unavailable.','hint'));
      if(notes.length){const reasons=el('ul');for(const note of notes)reasons.append(el('li',note));detail.append(reasons);}
      else if(evidence?.issues?.length){const reasons=el('ul');for(const note of evidence.issues)reasons.append(el('li',displayReason(note,method)));detail.append(reasons);}
      return detail;
    }
    if(automatic){
      more.append(methodDetails('A · Original measurements',automatic.methods.threePosition,automatic.selection,'A'),
        methodDetails('B · Original measurements',automatic.methods.temporal,automatic.selection,'B'));
    }
    if(selection){
      more.append(el('p',adaptive?'Recorded prompts set direction. A selects representative positions; B assesses sustained movement independently. Timing uncertainty does not erase usable position evidence.':fixedWindow?'Only the displayed central windows are assessed. Directions follow recorded instructions.':'Recorded instructions provide phase labels.','hint'));
      if(adaptive){
        // Use the same original-track proposal as the automatic comparison.
        // Reviewed timing is a different result and must not be mixed into it.
        const proposal=automatic?.selection??selection.autoProposal;
        const windows=el('table');windows.className='position-values';windows.setAttribute('aria-label','Original assessment selections');
        const windowHead=el('tr');for(const text of ['Phase','A position','B interval'])windowHead.append(el('th',text));windows.append(windowHead);
        for(const [phase,label]of phaseEntries){
          const time=proposal?.threePositionSelection?.[phase==='center'?'rest':phase],range=proposal?.temporalSelection?.[phase],row=el('tr');
          row.append(el('th',label),el('td',Number.isFinite(time)?`${time.toFixed(1)} s`:'Unavailable'),
            el('td',range?`${range.start.toFixed(1)}–${range.end.toFixed(1)} s`:'Unavailable'));windows.append(row);
        }
        more.append(windows);
        const timingDetails=el('details');timingDetails.append(el('summary','Original-track timing'));
        const timing=el('table');timing.className='position-values';timing.setAttribute('aria-label','Original response timing');
        const header=el('tr');for(const text of ['Phase / eye','First movement','Stable from'])header.append(el('th',text));timing.append(header);
        for(const [phase,label]of phaseEntries){
          const response=proposal?.provenance?.phases?.[phase]?.response;
          for(const side of ['left','right']){
            const eye=response?.eyes?.[side],row=el('tr');
            const movement=eye?.status==='response-detected'&&Number.isFinite(eye.firstOnset)?eye.firstOnset.toFixed(1)+' s':
              eye?.status==='no-detected-response'?(response?.gate?.quality?.[side]?.coverage>=.85?'None detected':'Not detected · limited'):'Uncertain';
            const settled=Number.isFinite(eye?.settleStart)?eye.settleStart.toFixed(1)+' s'+(response?.adequate?'':' · observed'):'Not established';
            row.append(el('th',`${label} / ${side==='left'?'L':'R'}`),el('td',movement),el('td',settled));timing.append(row);
          }
        }
        timingDetails.append(timing,el('p','Times from video start. Observed stability is separate from A/B eligibility. Uncertain onset is not absent movement.','hint'));more.append(timingDetails);
      }
      if(!automatic&&selection.autoProposal.issues.length){const issues=el('ul');for(const issue of selection.autoProposal.issues)issues.append(el('li',displayReason(issue)));more.append(issues);}
    }
    if(automatic){
      const hasMethodDiagnostics=Object.values(automatic.selection.provenance?.phases??{}).some(phase=>phase.methods?.A||phase.methods?.B);
      if(!hasMethodDiagnostics&&automatic.selection.issues.length){
        const issues=el('ul');for(const issue of automatic.selection.issues)issues.append(el('li',displayReason(issue)));more.append(issues);
      }
    }
    const archive=clip.data.recording.selfCheckFrameCoverage;
    for(const [phase,stats]of Object.entries(archive?.byPhase??{}))if(stats.skipped){
      const name=phase==='center'?'Rest':phase==='left'?'Left':phase==='right'?'Right':'Recording';
      const reasons=Object.keys(stats.skippedReasons??{}).map(reason=>reason.includes('byte-limit')?'image memory limit':reason==='encoder-busy'?'image saving was busy':'image saving failed');
      more.append(el('p',`${name} review images: ${stats.saved} / ${stats.requested} saved (${[...new Set(reasons)].join(', ')}). Unsaved images are not evidence of an eye movement problem.`,'hint'));
    }
    if(r.methods){
      const table=el('table');table.className='position-values';table.setAttribute('aria-label','Algorithm comparison');
      const header=el('tr');for(const text of ['Method','Original tracks','Reviewed tracks'])header.append(el('th',text));table.append(header);
      for(const [key,name]of [['threePosition','A'],['temporal','B']]){
        const row=el('tr');row.append(el('th',name),el('td',evidenceLabel(automatic?.methods?.[key]??r.methods[key].original)),
          el('td',evidenceLabel(r.methods[key].selected)));table.append(row);
      }
      more.append(table,methodDetails('A · Reviewed measurements',r.methods.threePosition.selected,r.responseSelection??selection?.autoProposal,'A'),
        methodDetails('B · Reviewed measurements',r.methods.temporal.selected,r.responseSelection??selection?.autoProposal,'B'));
    }
    const rules=el('p','0: normal. 1: partial palsy or an overcome deviation. 2: forced deviation / total paresis not overcome by the oculocephalic reflex. A clinician must establish the applicable findings.','hint');
    const source=el('a','NIHSS instructions ↗');source.href=NIHSS_SOURCE;source.target='_blank';source.rel='noreferrer';more.append(rules,source);result.append(more);
    exportButtons.forEach(b=>b.disabled=!!controller||r.pending>0||!b.dataset.available);
    if(exportHint)exportHint.textContent=r.pending?'Finish review to export.':r.deferredCount?`${r.deferredCount} for later annotation. Unsupported positions stay blank.`:'';
    if(packageButton)packageButton.disabled=!!controller;
  }
  function buildPositions(){
    const box=el('div',null,'three-positions'),buttons=el('div',null,'position-buttons');positionButtons=[];
    positionHint=el('p','Pause, then mark rest, left and right. Directions refer to the subject.','hint');
    for(const [key,label]of [['rest','Rest'],['left','Left'],['right','Right']]){
      const button=el('button');button.type='button';button.setAttribute('aria-label','Set '+key+' gaze position');
      button.onclick=()=>{editSelection(clip,'three-position',key,null,activeView==='video'?player.getTime():eyes.getTime());selectionError.textContent='';player.pause();eyes.pause();changed();};
      positionButtons.push({key,button,label});buttons.append(button);
    }
    box.append(positionHint,buttons);return box;
  }
  function buildMethods(){
    const box=el('div',null,'gaze-methods');
    const method=field('Method',[['three-position','A · Three positions'],['temporal','B · Temporal assessment'],['phases','Legacy phase summary']],clip.gazeScoringMode);
    method.input.setAttribute('aria-label','Scoring method');methodInput=method.input;
    methodInput.onchange=()=>{clip.gazeScoringMode=methodInput.value;changed();};
    selectionBar=el('div',null,'selection-review');selectionLabel=el('p',null,'hint');selectionError=el('p',null,'hint warning');selectionError.setAttribute('role','status');
    const selectionButtons=el('div',null,'selection-actions'),previews=el('div',null,'position-buttons');selectionPreviews=[];
    confirmButton=el('button','Confirm phases','primary');confirmButton.type='button';
    confirmButton.onclick=()=>{try{confirmSelections(clip,clip.checkReport);selectionError.textContent='';adjusting=false;changed();}catch(e){selectionError.textContent=e.message;}};
    adjustButton=el('button','Adjust');adjustButton.type='button';adjustButton.onclick=()=>{adjusting=!adjusting;updateResult();};
    selectionButtons.append(confirmButton,adjustButton);
    for(const [phase,label]of [['center','Rest'],['left','Left'],['right','Right']]){
      const button=el('button');button.type='button';button.setAttribute('aria-label','Preview '+label.toLowerCase()+' selection');
      button.onclick=()=>{const range=recordedPhasePreview(clip,phase);
        if(range){player.pause();eyes.pause();for(const item of selectionPreviews)item.button.setAttribute('aria-pressed',String(item.phase===phase));
          if(activeView==='video')player.playRange(range.start,range.end);else eyes.playRange(range.start,range.end);}};
      selectionPreviews.push({phase,label,button});previews.append(button);
    }
    selectionBar.append(selectionLabel,previews,selectionButtons,selectionError);
    threePanel=buildPositions();temporalPanel=el('div',null,'temporal-holds');temporalButtons=[];
    temporalPanel.append(el('p','Mark each instructed hold from start to end. Use subject-left/right; include at least 1 second per hold.','hint'));
    for(const [key,label]of [['center','Rest'],['left','Left'],['right','Right']]){
      const row=el('div',null,'hold-row');row.append(el('strong',label));
      for(const boundary of ['start','end']){
        const button=el('button');button.type='button';button.setAttribute('aria-label',`Set ${label.toLowerCase()} hold ${boundary}`);
        button.onclick=()=>{editSelection(clip,'temporal',key,boundary,activeView==='video'?player.getTime():eyes.getTime());selectionError.textContent='';player.pause();eyes.pause();changed();};
        temporalButtons.push({key,boundary,button});row.append(button);
      }
      temporalPanel.append(row);
    }
    box.append(method.label,selectionBar,threePanel,temporalPanel);return box;
  }
  function buildContext(){
    const box=el('details',null,'exam-context');box.append(el('summary','Exam details'));
    const reset=el('button','Clear three positions');reset.type='button';reset.onclick=()=>{clearSelections(clip,'three-position');changed();};
    const resetHolds=el('button','Clear holds');resetHolds.type='button';resetHolds.onclick=()=>{clearSelections(clip,'temporal');changed();};
    restoreAuto=el('button','Restore automatic selections');restoreAuto.type='button';restoreAuto.onclick=()=>{refreshAutomaticSelections(clip,clip.checkReport,{force:true});selectionError.textContent='';adjusting=false;changed();};
    reset.hidden=resetHolds.hidden=!!clip.selectionReview;box.append(reset,resetHolds,restoreAuto);
    const phases=el('textarea');phases.rows=3;phases.spellcheck=false;phases.setAttribute('aria-label','Clip exam phase intervals');
    phases.placeholder='Seconds from clip start, for example:\n0 2 center\n2 5 left\n5 8 right';phases.value=(clip.reviewIntervals??[]).map(r=>`${r.start} ${r.end} ${r.phase}`).join('\n');
    const note=el('p','Clip times; subject-left/right. Leave blank to keep recorded labels.','hint'),apply=el('button','Apply'),error=el('p',null,'hint');apply.setAttribute('aria-label','Apply phase labels');error.setAttribute('role','status');
    apply.onclick=()=>{try{const text=phases.value.trim();clip.reviewIntervals=text?parseIntervals(text,clip.data.recording.durationSeconds):null;error.textContent='Phase labels saved for this clip.';changed();}catch(e){error.textContent=e.message;}};
    phaseBox=el('div');phaseBox.hidden=clip.gazeScoringMode!=='phases';phaseBox.append(note,phases,apply,error);box.append(phaseBox);
    const o=clip.clinicalObservation??={reviewer:'',examAdequate:'unknown',finding:'unknown',overcome:'unknown',reflexAssessed:'unknown'};
    const clinical=el('details');clinical.append(el('summary','Clinician findings'));
    const id=el('input');id.value=o.reviewer;id.maxLength=80;id.placeholder='Examiner ID (no patient name)';id.setAttribute('aria-label','Clip examiner ID');
    const adequate=field('Adequate horizontal exam',[['unknown','Not confirmed'],['yes','Confirmed by examiner'],['no','No / uncertain']],o.examAdequate);
    const finding=field('Examiner finding',[['unknown','Use video suggestion only'],['normal','Normal horizontal gaze'],['partial','Partial palsy; no forced deviation / total paresis'],['deviation','Conjugate deviation'],['total-paresis','Total gaze paresis'],['isolated-nerve','Isolated CN III / IV / VI palsy']],o.finding);
    const overcome=field('Deviation / limitation overcome?',[['unknown','Unknown'],['voluntary','By voluntary movement'],['reflex','By reflex movement'],['not-overcome','Not overcome']],o.overcome);
    const reflex=field('Applicable reflex examined by clinician?',[['unknown','Not confirmed'],['yes','Examined and recorded'],['no','Not examined / not appropriate']],o.reflexAssessed);
    const conditional=el('div');conditional.append(overcome.label,reflex.label);
    const sync=()=>{conditional.hidden=!['deviation','total-paresis'].includes(o.finding);};
    id.onchange=()=>{o.reviewer=id.value;changed();};
    for(const [key,f]of Object.entries({examAdequate:adequate,finding,overcome,reflexAssessed:reflex}))f.input.onchange=()=>{
      o[key]=f.input.value;if(key==='finding'){o.overcome=o.reflexAssessed='unknown';overcome.input.value=reflex.input.value='unknown';}sync();changed();
    };
    sync();clinical.append(el('p','These fields map the examiner’s own findings. The animation cannot establish a reflex result.','hint'),id,adequate.label,finding.label,conditional);box.append(clinical);
    contextFields=[methodInput,reset,resetHolds,restoreAuto,confirmButton,adjustButton,phases,apply,id,adequate.input,finding.input,overcome.input,reflex.input];return box;
  }
  function buildDownloads(){
    downloads.replaceChildren();exportButtons=[];
    const format=field('Format',['mp4','webm'].map(f=>[f,f.toUpperCase()]),'mp4');format.input.setAttribute('aria-label','Reviewed download format');
    for(const o of format.input.options)o.disabled=!recordingMime(globalThis.MediaRecorder,o.value);
    format.input.value=Array.from(format.input.options).find(o=>!o.disabled)?.value??'';
    const buttons=el('div',null,'buttons'),stop=el('button','Cancel export'),save=el('button');stop.hidden=save.hidden=true;
    const exportStatus=el('p',null,'hint');exportStatus.setAttribute('role','status');exportHint=el('p',null,'hint');
    invalidateVideo=()=>{if(!save.hidden){save.hidden=true;save.onclick=null;exportStatus.textContent='Choices or exam details changed. Prepare a new download.';}};
    const base='gaze_recording_'+clip.data.recording.id.slice(0,8);
    for(const [mode,label]of [['reviewed','Reviewed video'],['eyes','Eye-only video']]){
      const button=el('button',label);button.setAttribute('aria-label',mode==='eyes'?'Prepare eye-only video':'Prepare reviewed video');button.dataset.available=format.input.value?'yes':'';exportButtons.push(button);buttons.append(button);
      button.onclick=async()=>{
        const busy=busyMessage();if(busy){exportStatus.textContent=busy;return;}
        if(clip.checkReport.segments.some(s=>s.decision==='unreviewed'))return;
        preview?.pause();player.pause();eyes.pause();controller=new AbortController();stop.hidden=false;stop.onclick=()=>controller?.abort();
        format.input.disabled=true;save.hidden=true;contextFields.forEach(f=>f.disabled=true);draw();updateResult();
        const render=mode==='eyes'?makeEyeMotionRenderer(clip,clip.checkReport):makeReviewRenderer(clip,clip.checkReport,'selected'),type=format.input.value;
        try{
          const blob=await encode(controller,()=>convertVideo(clip.raw,type,{signal:controller.signal,size:mode==='eyes'?EYE_VIDEO_SIZE:reviewedVideoSize(clip.data),renderFrame:render,
            onProgress:(t,d)=>{exportStatus.textContent=`Preparing ${mode==='eyes'?'eye-only':'reviewed'} video · ${t.toFixed(1)}${Number.isFinite(d)?' / '+d.toFixed(1):''} s · Keep this tab visible`;}}));
          if(disposed)return;save.textContent='Save '+extensionFor(blob.type).toUpperCase();save.hidden=false;
          save.onclick=()=>saveBlob(blob,`${base}_${mode==='eyes'?'eyes_only':'reviewed'}.${extensionFor(blob.type)}`);
          prepareDownload(()=>{save.hidden=true;save.onclick=null;});exportStatus.textContent='Ready. Tap Save to download.';
        }catch(e){if(!disposed)exportStatus.textContent=e.message;}
        finally{controller=null;if(!disposed){stop.hidden=true;format.input.disabled=false;contextFields.forEach(f=>f.disabled=false);draw();updateResult();}}
      };
    }
    packageButton=el('button','Save annotation package');packageButton.type='button';
    packageButton.onclick=async()=>{
      const busy=busyMessage();if(busy){exportStatus.textContent=busy;return;}
      if(controller||!annotationQueue(clip.checkReport).length)return;
      preview?.pause();player.pause();eyes.pause();controller=new AbortController();const signal=controller.signal;
      stop.hidden=false;stop.onclick=()=>controller?.abort();format.input.disabled=true;save.hidden=true;
      contextFields.forEach(f=>f.disabled=true);draw();updateResult();
      try{
        const archive=await encode(controller,()=>createAnnotationPackage({clip,report:clip.checkReport,onProgress:()=>{
          if(disposed||signal.aborted)throw Error('Package export cancelled.');exportStatus.textContent='Preparing annotation package…';
        }}));
        if(disposed||signal.aborted)return;save.textContent='Save ZIP';save.hidden=false;
        save.onclick=()=>saveBlob(archive.blob,archive.filename);prepareDownload(()=>{save.hidden=true;save.onclick=null;});
        exportStatus.textContent='Ready. Tap Save ZIP before closing this page.';
      }catch(e){if(!disposed)exportStatus.textContent=e.message;}
      finally{controller=null;if(!disposed){stop.hidden=true;format.input.disabled=false;contextFields.forEach(f=>f.disabled=false);draw();updateResult();}}
    };
    const data=el('details');data.append(el('summary','Review data'));
    const json=el('button','Download review JSON'),csv=el('button','Download review CSV');
    json.onclick=()=>saveBlob(new Blob([JSON.stringify({schema:'gaze-reviewed-motion-9',original:clip.data,review:clip.checkReport,
      annotationQueue:annotationQueue(clip.checkReport),reviewCounts:reviewCounts(),modelUpdatedByReview:false,
      reviewedSamples:reviewedSamples(clip,clip.checkReport),phaseOverrides:clip.reviewIntervals??null,
      gazeScoringMode:clip.gazeScoringMode,threePositionSelection:clip.threePositionSelection??null,temporalSelection:clip.temporalSelection??null,
      selectionReview:clip.selectionReview??null,
      clinicalObservation:clip.clinicalObservation??null,automaticAssessment:automaticGazeAssessment(clip,clip.checkReport),
      suggestion:clipGazeSuggestion(clip,clip.checkReport)},null,2)],{type:'application/json'}),base+'_review.json');
    csv.onclick=()=>saveBlob(new Blob([segmentCsv(clip.checkReport)],{type:'text/csv;charset=utf-8'}),base+'_review.csv');
    data.append(json,csv);downloads.append(format.label,buttons,exportHint,packageButton,stop,save,exportStatus,data);
  }
  function build(){
    const r=clip.checkReport;body.replaceChildren();body.hidden=false;tabs=[];
    initializeSelectionReview(clip,r);
    clip.gazeScoringMode??=clip.selectionReview?'temporal':'three-position';
    if(clip.selectionReview&&!clip.reviewView)activeView='eyes';
    const nav=el('nav',null,'clip-tabs');nav.setAttribute('aria-label',`Clip ${clipNumber} views`);
    for(const [name,label]of [['review','Review'],['eyes','Eye motion'],['video','Video']]){
      const tab=el('button',label);tab.dataset.view=name;tab.onclick=()=>showView(name);tabs.push(tab);nav.append(tab);views[name]=el('div');
    }
    const strip=el('div',null,'segment-nav'),previous=el('button','‹'),next=el('button','›');
    previous.setAttribute('aria-label','Previous segment');next.setAttribute('aria-label','Next segment');
    jump=el('select');jump.setAttribute('aria-label','Suspicious segment');jump.onchange=()=>{position=Number(jump.value);draw();};
    previous.onclick=()=>{if(position>0){position--;draw();}};next.onclick=()=>{if(position<r.segments.length-1){position++;draw();}else showView('eyes');};
    strip.append(previous,jump,next);strip.hidden=!r.segments.length;panels=el('div');progress=el('p',null,'hint review-progress');
    queuePanel=el('details',null,'annotation-queue');queueTitle=el('summary');queueItems=el('div',null,'annotation-items');
    queuePanel.append(queueTitle,queueItems,el('p','Download → Save annotation package. Save before closing this page.','hint'));
    views.review.append(progress,strip,panels,queuePanel);
    player=createReviewedPlayer({clip,report:r,clipNumber});views.video.append(player.element);
    eyes=createEyeMotionPlayer({clip,report:r});result=el('div',null,'clip-score');positionPanel=buildMethods();examContext=buildContext();views.eyes.append(eyes.element,positionPanel,result,examContext);
    body.append(nav,...Object.values(views));builtReport=r;buildDownloads();draw();updateResult();showView(activeView);
  }
  function update(){
    if(disposed)return;const state=clip.checkState??'idle',busy=['queued','running'].includes(state),r=clip.checkReport;
    retryButton.hidden=busy||!!r;cancel.hidden=!busy;actions.hidden=retryButton.hidden&&cancel.hidden;status.hidden=!!r;
    status.textContent=state==='queued'?'Queued for analysis…':state==='running'?'Checking · '+(clip.checkProgress??'Loading model…'):
      r?`${r.segments.length} eye segments · ${r.ignoredBlinkEyes} blink samples skipped${(r.coverage.assessmentUnchecked??r.coverage.unchecked)?' · Some analysis frames unchecked':''}`:clip.checkError??'The clip is checked locally after recording.';
    if(r&&builtReport!==r)build();
  }
  clip.checkEvents??=new EventTarget();clip.checkEvents.addEventListener('change',update);update();
  return {element:root,downloadElement:downloads,pause(){preview?.pause();player?.pause();eyes?.pause();},
    dispose(){disposed=true;controller?.abort();preview?.dispose();player?.dispose();eyes?.dispose();clip.checkEvents.removeEventListener('change',update);}};
}
