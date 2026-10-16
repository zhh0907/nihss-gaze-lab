// A local acquisition guide, not an NIHSS diagnostic protocol or calibration.
// Times are actual prompt presentation times on the raw recording clock.
export const GUIDED_VERSION='guided-exam-v1';
export const GUIDED_STEPS=Object.freeze([
  {phase:'unlabelled',kind:'prepare',seconds:3,title:'Get ready',hint:'Follow the examiner’s target.',speech:'Get ready. Follow the target.'},
  {phase:'center',kind:'move',seconds:1,title:'Rest',hint:'Look ahead comfortably.',speech:'Look ahead.'},
  {phase:'center',kind:'hold',seconds:3,title:'Rest',hint:'Hold your gaze.'},
  {phase:'left',kind:'move',seconds:2,title:'Look left',hint:'Subject’s left · Follow the target.',speech:'Look to your left.'},
  {phase:'left',kind:'hold',seconds:3,title:'Look left',hint:'Hold your gaze.'},
  {phase:'right',kind:'move',seconds:2,title:'Look right',hint:'Subject’s right · Follow the target.',speech:'Look to your right.'},
  {phase:'right',kind:'hold',seconds:3,title:'Look right',hint:'Hold your gaze.'},
]);

export class GuidedExam {
  constructor({originPerf,onPrompt=()=>{},maxTickGapMs=1500}){
    this.originPerf=originPerf;this.onPrompt=onPrompt;this.maxTickGapMs=maxTickGapMs;
    this.index=-1;this.status='running';this.intervals=[];this.events=[];this.lastTick=originPerf;
    this.enter(0,originPerf);
  }
  time(now){return Math.max(0,(now-this.originPerf)/1000);}
  enter(index,now){
    const next=GUIDED_STEPS[index],previous=GUIDED_STEPS[this.index],time=this.time(now);
    if(previous?.kind==='hold'){
      const active=this.intervals.at(-1);active.end=time;active.completed=true;
    }
    this.index=index;this.stepStartedPerf=now;
    if(!next){this.status='complete';this.endedAt=time;this.events.push({type:'complete',time});return;}
    if(next.kind==='move')this.intervals.push({phase:next.phase,start:time,holdStart:null,end:null,completed:false});
    if(next.kind==='hold')this.intervals.at(-1).holdStart=time;
    this.events.push({type:'prompt',phase:next.phase,kind:next.kind,time,title:next.title});
    this.onPrompt({...this.view(now),announce:true,speech:next.speech??null});
  }
  view(now){
    const step=GUIDED_STEPS[this.index];
    return {status:this.status,phase:step?.phase??'unlabelled',kind:step?.kind??'done',
      title:step?.title??'Complete',hint:step?.hint??'',
      remaining:step?Math.max(0,Math.ceil(step.seconds-(now-this.stepStartedPerf)/1000)):0};
  }
  tick(now){
    if(this.status!=='running')return this.view(now);
    // A hidden or stalled page cannot retrospectively claim prompts were shown.
    if(!Number.isFinite(now)||now<this.lastTick||now-this.lastTick>this.maxTickGapMs){
      this.finish(Number.isFinite(now)?now:this.lastTick,'timing-interrupted');return this.view(now);
    }
    this.lastTick=now;
    const step=GUIDED_STEPS[this.index];
    if(now-this.stepStartedPerf>=step.seconds*1000)this.enter(this.index+1,now);
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
    return structuredClone({version:GUIDED_VERSION,status:this.status,intervals:this.intervals,events:this.events,
      endedAt:this.endedAt,directions:'Subject-left and subject-right; independent of camera mirroring.',
      timing:'Actual on-screen prompt times relative to raw recording start; holdStart marks the displayed hold cue. Audio is supplementary.',
      note:'Prompt timing does not prove cooperation, full excursion, adequate examination or a clinical score.'});
  }
}
