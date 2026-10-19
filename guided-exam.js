// Spoken horizontal eye-movement acquisition for NIHSS Best Gaze research.
// This is not a complete clinical examination or an autonomous NIHSS score.
export const GUIDED_VERSION='guided-exam-v2';
export const GUIDED_STEPS=Object.freeze([
  {phase:'unlabelled',kind:'prepare',seconds:3,title:'NIHSS · Best gaze',hint:'Keep your head still if comfortable.',speech:'NIH Stroke Scale eye movement test. Keep your head still if comfortable.'},
  {phase:'center',kind:'move',seconds:1,title:'Look straight ahead',hint:'Look toward the camera.',speech:'Look straight ahead.'},
  {phase:'center',kind:'hold',seconds:3,title:'Look straight ahead',hint:'Hold your gaze.'},
  {phase:'left',kind:'move',seconds:2,title:'Look all the way left',hint:'Your left · As far as comfortable.',speech:'Look as far as comfortable to your left.'},
  {phase:'left',kind:'hold',seconds:3,title:'Look all the way left',hint:'Hold your gaze.'},
  {phase:'right',kind:'move',seconds:2,title:'Look all the way right',hint:'Your right · As far as comfortable.',speech:'Look as far as comfortable to your right.'},
  {phase:'right',kind:'hold',seconds:3,title:'Look all the way right',hint:'Hold your gaze.'},
]);

// Keep the utterance alive until completion. Start the first cue in the same
// user-gesture stack as Start exam (no awaiting voiceschanged or a silent cue).
// Browser callbacks confirm engine events, not speaker volume or patient hearing.
export class GuideSpeech {
  constructor({synthesis=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance,now=()=>performance.now()}={}){
    this.synthesis=synthesis;this.Utterance=Utterance;this.now=now;this.active=null;
  }
  get supported(){return !!(this.synthesis?.speak&&this.Utterance);}
  speak(text,{onStart,onEnd,onError}){
    if(!this.supported){onError('unavailable',this.now());return;}
    this.cancel();
    const utterance=new this.Utterance(text),token={utterance,started:false};this.active=token;
    utterance.lang='en-US';utterance.rate=1;utterance.pitch=1;utterance.volume=1;
    const voices=this.synthesis.getVoices?.()??[],english=voices.filter(v=>/^en(?:-|_)/i.test(v.lang));
    const voice=english.find(v=>v.localService)??english[0];if(voice)utterance.voice=voice;
    utterance.onstart=()=>{if(this.active!==token||token.started)return;token.started=true;onStart(this.now());};
    utterance.onend=()=>{
      if(this.active!==token)return;this.active=null;
      if(!token.started)onError('missing-start-event',this.now());else onEnd(this.now());
    };
    utterance.onerror=event=>{if(this.active!==token)return;this.active=null;onError(event.error??'engine-error',this.now());};
    try{
      // Safari can leave a prior speech session paused after an interruption.
      if(this.synthesis.paused)this.synthesis.resume();
      this.synthesis.speak(utterance);
    }catch(error){if(this.active===token){this.active=null;onError(error?.name??'engine-error',this.now());}}
  }
  cancel(){
    const wasActive=!!this.active;this.active=null;
    // An old clip may be exported again while a new exam is speaking. Only
    // cancel speech owned by this adapter, never another finished session.
    if(wasActive)try{this.synthesis?.cancel();}catch{/* Cancellation must not block saving. */}
  }
}

export class GuidedExam {
  constructor({originPerf,onPrompt=()=>{},speaker=null,maxTickGapMs=1500,maxSpeechStartMs=7000,maxSpeechDurationMs=20000}){
    this.originPerf=originPerf;this.onPrompt=onPrompt;this.speaker=speaker;
    this.maxTickGapMs=maxTickGapMs;this.maxSpeechStartMs=maxSpeechStartMs;this.maxSpeechDurationMs=maxSpeechDurationMs;
    this.index=-1;this.status='running';this.intervals=[];this.events=[];this.lastTick=originPerf;this.cueToken=0;
    this.enter(0,originPerf);
  }
  time(now){return Math.max(0,(now-this.originPerf)/1000);}
  beginStep(now){
    const step=GUIDED_STEPS[this.index],time=this.time(now);this.stepStartedPerf=now;
    if(step.kind==='move')this.intervals.push({phase:step.phase,start:time,holdStart:null,end:null,completed:false});
    if(step.kind==='hold')this.intervals.at(-1).holdStart=time;
    this.events.push({type:'prompt',phase:step.phase,kind:step.kind,time,title:step.title});
    this.onPrompt({...this.view(now),announce:true,speech:step.speech??null});
  }
  enter(index,now){
    const next=GUIDED_STEPS[index],previous=GUIDED_STEPS[this.index],time=this.time(now);
    if(previous?.kind==='hold'){
      const active=this.intervals.at(-1);active.end=time;active.completed=true;
    }
    this.index=index;this.stepStartedPerf=null;this.speechEndedPerf=null;this.cueRequestedPerf=now;
    const token=++this.cueToken;
    if(!next){this.status='complete';this.endedAt=time;this.events.push({type:'complete',time});return;}
    if(this.speaker&&next.speech){
      this.audioStatus='waiting';
      this.events.push({type:'speech-requested',phase:next.phase,kind:next.kind,time,text:next.speech});
      this.onPrompt({...this.view(now),announce:false,speech:null});
      try{this.speaker.speak(next.speech,{
        onStart:at=>{
          if(this.status!=='running'||token!==this.cueToken||this.audioStatus!=='waiting')return;
          if(!Number.isFinite(at)||at<now){this.failSpeech('invalid-start-time',now);return;}
          this.audioStatus='speaking';this.events.push({type:'speech-start',phase:next.phase,time:this.time(at)});this.beginStep(at);
        },
        onEnd:at=>{
          if(this.status!=='running'||token!==this.cueToken)return;
          if(this.audioStatus!=='speaking'||!Number.isFinite(at)||at<this.stepStartedPerf){this.failSpeech('invalid-end-time',this.lastTick);return;}
          this.audioStatus='finished';this.speechEndedPerf=at;
          this.events.push({type:'speech-end',phase:next.phase,time:this.time(at)});
          this.onPrompt({...this.view(at),announce:false});
        },
        onError:(reason,at)=>{if(this.status==='running'&&token===this.cueToken)this.failSpeech(reason,Number.isFinite(at)?at:this.lastTick);},
      });}catch{this.failSpeech('engine-error',now);}
    }else{this.audioStatus='visual';this.beginStep(now);}
  }
  failSpeech(reason,now){
    this.failureReason=`speech-${reason}`;
    this.events.push({type:'speech-error',phase:GUIDED_STEPS[this.index]?.phase,time:this.time(now),reason});
    this.finish(now,this.failureReason);
    this.onPrompt({...this.view(now),announce:false});
  }
  view(now){
    const step=GUIDED_STEPS[this.index],waiting=this.audioStatus==='waiting',speaking=this.audioStatus==='speaking';
    const countdownOrigin=this.speechEndedPerf??this.stepStartedPerf;
    return {status:this.status,phase:waiting?'unlabelled':step?.phase??'unlabelled',kind:step?.kind??'done',
      title:step?.title??'Complete',hint:waiting?'Starting voice prompt…':step?.hint??'',audioStatus:this.audioStatus,
      remaining:waiting||speaking?null:step?Math.max(0,Math.ceil(step.seconds-(now-countdownOrigin)/1000)):0};
  }
  tick(now){
    if(this.status!=='running')return this.view(now);
    // A hidden or stalled page cannot retrospectively claim cues were delivered.
    if(!Number.isFinite(now)||now<this.lastTick||now-this.lastTick>this.maxTickGapMs){
      this.finish(Number.isFinite(now)?now:this.lastTick,'timing-interrupted');return this.view(now);
    }
    this.lastTick=now;
    if(this.audioStatus==='waiting'&&now-this.cueRequestedPerf>this.maxSpeechStartMs)this.failSpeech('start-timeout',now);
    else if(this.audioStatus==='speaking'&&now-this.stepStartedPerf>this.maxSpeechDurationMs)this.failSpeech('end-timeout',now);
    else if(this.audioStatus!=='waiting'&&this.audioStatus!=='speaking'){
      const step=GUIDED_STEPS[this.index],readyAt=this.speechEndedPerf??this.stepStartedPerf;
      if(now-readyAt>=step.seconds*1000)this.enter(this.index+1,now);
    }
    if(this.status==='running')this.onPrompt({...this.view(now),announce:false});
    return this.view(now);
  }
  phaseAt(rawTime){
    const interval=this.intervals.find(r=>rawTime>=r.start&&(r.end===null||rawTime<r.end));
    return interval?{phase:interval.phase,phaseStart:interval.start}:{phase:'unlabelled',phaseStart:0};
  }
  finish(now,reason='stopped'){
    if(this.status==='running'){
      const end=Math.max(this.time(this.lastTick),this.time(now)),active=this.intervals.at(-1);
      if(active&&active.end===null)active.end=end;
      this.status='interrupted';this.endedAt=end;this.events.push({type:'interrupted',time:end,reason});
    }
    this.speaker?.cancel();
    return structuredClone({version:GUIDED_VERSION,protocol:'NIHSS Best Gaze horizontal acquisition',status:this.status,intervals:this.intervals,events:this.events,
      endedAt:this.endedAt,directions:'Subject-left and subject-right; independent of camera mirroring.',
      speech:{requested:!!this.speaker,started:this.events.filter(e=>e.type==='speech-start').length,finished:this.events.filter(e=>e.type==='speech-end').length,
        confirmation:'Browser speech events only; audibility, patient hearing and task understanding are not verified.'},
      timing:this.speaker?'Actual browser speech-start events relative to raw recording start; movement allowance begins after speech-end; holdStart marks the displayed hold cue. Queued cues are unlabelled.':'Actual on-screen prompt times relative to raw recording start; holdStart marks the displayed hold cue. Visual-only acquisition.',
      note:'Prompt timing does not prove cooperation, full excursion, adequate examination or a clinical score.'});
  }
}
