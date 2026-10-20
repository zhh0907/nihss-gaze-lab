import {selectedFrame} from './segment-review.js?v=usability20';
import {proposeAutoSelections} from './auto-selection.js?v=boundary24';

export const SELECTION_REVIEW_VERSION='guided-selection-review-v1';
const POSITION_KEYS=['rest','left','right'],PHASE_KEYS=['center','left','right'],BOUNDARIES=['start','end'];
const runtimeReports=new WeakMap(),EPS=1e-8;
const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const guidedFor=clip=>clip?.data?.recording?.guidedExam;
const isGuided=clip=>['guided-exam-v1','guided-exam-v2','guided-exam-v3','guided-exam-v4'].includes(guidedFor(clip)?.version);
const selections=clip=>({threePositionSelection:copy(clip.threePositionSelection??{}),temporalSelection:copy(clip.temporalSelection??{})});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Recorded instructions exist independently of whether tracking can support a
// score. This range is for playback only; never copy it into scoring selections.
export function recordedPhasePreview(clip,phase){
  if(!PHASE_KEYS.includes(phase))return null;
  const matches=guidedFor(clip)?.intervals?.filter(r=>r.phase===phase)??[],duration=clip?.data?.recording?.durationSeconds;
  if(matches.length!==1)return null;
  const interval=matches[0];
  if(!Number.isFinite(interval.start)||!Number.isFinite(interval.end)||!Number.isFinite(duration)||interval.start<0||interval.end<=interval.start||interval.end>duration+EPS)return null;
  return {phase,start:interval.start,end:Math.min(duration,interval.end),completed:interval.completed===true};
}
function fingerprint(value){
  const text=JSON.stringify(value);let a=2166136261,b=5381;
  for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b,33)^n;}
  return `${(a>>>0).toString(16)}-${(b>>>0).toString(16)}-${text.length}`;
}
function reportFingerprint(report){
  return fingerprint([report?.schema,report?.version,report?.createdAt,report?.sourceRecordingId,report?.coverage,
    (report?.frames??[]).map(f=>[f.sourceIndex,f.time,...['left','right'].map(side=>{
      const e=f[side];return [e?.flagged,e?.ignored,e?.decision,e?.decidedAt,e?.proposal??null];
    })]),
    (report?.segments??[]).map(s=>[s.id,s.side,s.start,s.end,s.decision,s.decidedAt,s.sourceIndices,s.flaggedIndices])]);
}
function pushHistory(state,event){state.history.push(freeze(copy({at:now(),...event})));}
function addManual(state,method,key){if(!state.manual[method].includes(key))state.manual[method].push(key);}
function remember(clip,state){state.lastSelections=selections(clip);state.selectionFingerprint=fingerprint(state.lastSelections);}
function stateFor(clip){
  if(!isGuided(clip))return null;
  if(!clip.selectionReview){
    const existing=selections(clip);
    clip.selectionReview={version:SELECTION_REVIEW_VERSION,source:'guided',status:'unconfirmed',
      manual:{threePosition:POSITION_KEYS.filter(key=>existing.threePositionSelection[key]!==undefined),
        temporal:PHASE_KEYS.flatMap(key=>BOUNDARIES.filter(boundary=>existing.temporalSelection[key]?.[boundary]!==undefined).map(boundary=>`${key}.${boundary}`))},
      history:[],autoProposal:null,confirmedAt:null,confirmation:null,reportVersion:null,fingerprint:null,
      decisionFingerprint:null,lastSelections:existing,selectionFingerprint:fingerprint(existing)};
  }
  return clip.selectionReview;
}

// Confirmation concerns instruction labels/times only. It is never a clinical
// endorsement of a trajectory, tracking adequacy, or an NIHSS score.
export function invalidateSelectionConfirmation(clip,reason='Selections changed.'){
  const state=clip?.selectionReview;if(!state)return null;
  if(state.status==='confirmed')pushHistory(state,{type:'confirmation-invalidated',reason,previousConfirmation:state.confirmation});
  state.status='unconfirmed';state.confirmedAt=null;state.confirmation=null;state.reason=reason;return state;
}

export function initializeSelectionReview(clip,report){
  if(!isGuided(clip)||!report)return null;
  stateFor(clip);return refreshAutomaticSelections(clip,report);
}

export function refreshAutomaticSelections(clip,report,{force=false}={}){
  if(!isGuided(clip)||!report)return null;
  const state=stateFor(clip),current=selections(clip),previous=state.lastSelections;
  // Preserve edits made by older clients too, rather than silently overwriting
  // them on the next report refresh.
  if(previous&&!same(current,previous)){
    for(const key of POSITION_KEYS)if(current.threePositionSelection[key]!==previous.threePositionSelection[key])addManual(state,'threePosition',key);
    for(const key of PHASE_KEYS)for(const boundary of BOUNDARIES){
      if(current.temporalSelection[key]?.[boundary]!==previous.temporalSelection[key]?.[boundary])addManual(state,'temporal',`${key}.${boundary}`);
    }
    invalidateSelectionConfirmation(clip,'Selections were edited.');
    pushHistory(state,{type:'external-edit',selections:current});
  }
  const decisionFingerprint=reportFingerprint(report);
  const sourceFingerprint=fingerprint(['boundary24',decisionFingerprint,guidedFor(clip),clip.data.recording.durationSeconds]);
  const replaced=runtimeReports.has(clip)&&runtimeReports.get(clip)!==report;
  runtimeReports.set(clip,report);
  if(!force&&!replaced&&state.autoProposal&&state.fingerprint===sourceFingerprint){remember(clip,state);return state;}
  invalidateSelectionConfirmation(clip,force?'Automatic selections restored.':replaced?'The video check was rerun.':'Reviewed eye tracks or recorded phases changed.');
  if(force)state.manual={threePosition:[],temporal:[]};
  const reviews=new Map((report.frames??[]).map(f=>[f.sourceIndex,f]));
  const samples=(clip.data.samples??[]).map((sample,index)=>selectedFrame(sample,reviews.get(index)));
  const checked=new Set((report.frames??[]).map(f=>f.sourceIndex));
  const proposal=proposeAutoSelections(samples,checked,guidedFor(clip),clip.data.recording.durationSeconds);
  clip.threePositionSelection??={};clip.temporalSelection??={};
  for(const key of POSITION_KEYS)if(!state.manual.threePosition.includes(key)){
    if(Number.isFinite(proposal.threePositionSelection[key]))clip.threePositionSelection[key]=proposal.threePositionSelection[key];
    else delete clip.threePositionSelection[key];
  }
  for(const key of PHASE_KEYS)for(const boundary of BOUNDARIES)if(!state.manual.temporal.includes(`${key}.${boundary}`)){
    const value=proposal.temporalSelection[key]?.[boundary];
    if(Number.isFinite(value))(clip.temporalSelection[key]??={})[boundary]=value;
    else if(clip.temporalSelection[key])delete clip.temporalSelection[key][boundary];
  }
  for(const key of PHASE_KEYS)if(clip.temporalSelection[key]&&!Object.keys(clip.temporalSelection[key]).length)delete clip.temporalSelection[key];
  state.autoProposal=copy(proposal);state.reportVersion=[report.schema,report.version,report.createdAt].filter(Boolean).join('/');
  state.requiresManualPhaseLabels=false;
  state.phaseSource='Recorded instruction times';
  state.fingerprint=sourceFingerprint;state.decisionFingerprint=decisionFingerprint;
  pushHistory(state,{type:force?'restore-automatic':'automatic-selection',reportReplaced:replaced,
    fingerprint:sourceFingerprint,selections:selections(clip),issues:proposal.issues});
  remember(clip,state);return state;
}

export function editSelection(clip,method,key,boundary,time){
  if(!['three-position','temporal'].includes(method))throw Error('Unknown selection method.');
  if(method==='three-position'&&(!POSITION_KEYS.includes(key)||boundary!==null&&boundary!==undefined)||
     method==='temporal'&&(!PHASE_KEYS.includes(key)||!BOUNDARIES.includes(boundary)))throw Error('Unknown selection field.');
  const duration=clip?.data?.recording?.durationSeconds;
  if(!Number.isFinite(time)||time<0||Number.isFinite(duration)&&time>duration+EPS)throw Error('Select a time within this clip.');
  const state=stateFor(clip);
  if(method==='three-position'){
    (clip.threePositionSelection??={})[key]=time;if(state)addManual(state,'threePosition',key);
  }else{
    ((clip.temporalSelection??={})[key]??={})[boundary]=time;if(state)addManual(state,'temporal',`${key}.${boundary}`);
  }
  if(state){invalidateSelectionConfirmation(clip,'Selections were edited.');pushHistory(state,{type:'manual-edit',method,key,boundary:boundary??null,time});remember(clip,state);}
  return state;
}

export function clearSelections(clip,method){
  if(!['three-position','temporal'].includes(method))throw Error('Unknown selection method.');
  const state=stateFor(clip);
  if(method==='three-position'){clip.threePositionSelection={};if(state)state.manual.threePosition=[...POSITION_KEYS];}
  else{clip.temporalSelection={};if(state)state.manual.temporal=PHASE_KEYS.flatMap(key=>BOUNDARIES.map(boundary=>`${key}.${boundary}`));}
  if(state){invalidateSelectionConfirmation(clip,'Selections were cleared.');pushHistory(state,{type:'clear',method});remember(clip,state);}
  return state;
}

export function confirmSelections(clip,report){
  const state=refreshAutomaticSelections(clip,report);if(!state)return null;
  if((report.segments??[]).some(s=>!s.decision||s.decision==='unreviewed'))throw Error('Review the flagged eye segments before confirming phases.');
  const duration=clip.data.recording.durationSeconds;
  const ranges=PHASE_KEYS.map(phase=>({phase,...clip.temporalSelection?.[phase]}));
  if(ranges.some(r=>![r.start,r.end].every(Number.isFinite)||r.start<0||r.end<=r.start||Number.isFinite(duration)&&r.end>duration+EPS)){
    throw Error('Mark a valid Start and End for Rest, Left, and Right before confirming phases.');
  }
  ranges.sort((a,b)=>a.start-b.start);
  if(ranges.some((r,i)=>i&&r.start<ranges[i-1].end-EPS))throw Error('Phase intervals must not overlap.');
  // A is allowed to abstain when no trustworthy anchor exists. Do not force an
  // examiner to fabricate positions merely to confirm the task timing.
  if(POSITION_KEYS.some(key=>clip.threePositionSelection?.[key]!==undefined&&
    (!Number.isFinite(clip.threePositionSelection[key])||clip.threePositionSelection[key]<0||Number.isFinite(duration)&&clip.threePositionSelection[key]>duration+EPS))){
    throw Error('Selected positions must be within this clip.');
  }
  const at=now(),snapshot=freeze(copy({version:SELECTION_REVIEW_VERSION,confirmedAt:at,
    scope:'Instruction labels and selected times only; not tracking accuracy or a clinical score.',
    ...selections(clip),manual:state.manual,decisionFingerprint:state.decisionFingerprint,
    sourceFingerprint:state.fingerprint,reportVersion:state.reportVersion}));
  state.status='confirmed';state.confirmedAt=at;state.confirmation=snapshot;state.reason=null;
  pushHistory(state,{type:'confirmed',confirmation:snapshot});remember(clip,state);return state;
}
