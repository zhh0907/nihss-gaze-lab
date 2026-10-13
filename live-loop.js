// Keep exactly one inference in flight. A camera can keep producing frames while
// its compositor callbacks or media timestamps stop advancing on a browser.
export function startLiveLoop({video,onFrame,onError,onMode=()=>{},maxFps=30,stallMs=250,
  now=()=>performance.now(),delay=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),
  visible=()=>!document.hidden}) {
  let active=true,busy=false,timer=null,watchdog=null,callback=null,lastStart=-Infinity;
  let mode=typeof video.requestVideoFrameCallback==='function'?'video-callback':'timer';
  const interval=1000/maxFps;
  function clearScheduled(){
    if(timer!==null)cancel(timer);if(watchdog!==null)cancel(watchdog);
    if(callback!==null)video.cancelVideoFrameCallback?.(callback);
    timer=watchdog=callback=null;
  }
  function stop(){active=false;clearScheduled();}
  function schedule(){
    if(!active)return;
    timer=delay(()=>{
      timer=null;if(!active)return;
      if(!visible()||video.paused||video.readyState<2){timer=delay(schedule,stallMs);return;}
      if(mode!=='video-callback'){dispatch(null);return;}
      try{
        callback=video.requestVideoFrameCallback((_time,metadata)=>dispatch(metadata));
        watchdog=delay(()=>{mode='timer-fallback';onMode(mode);dispatch(null);},stallMs);
      }catch{mode='timer-fallback';onMode(mode);dispatch(null);}
    },Math.max(0,interval-(now()-lastStart)));
  }
  async function dispatch(metadata){
    if(!active||busy)return;clearScheduled();
    if(!visible()||video.paused||video.readyState<2){schedule();return;}
    busy=true;lastStart=now();
    try{
      // mediaTime is recorded as metadata, never used as the only freshness gate.
      await onFrame(metadata,{mode});
    }catch(error){stop();onError(error);}
    finally{busy=false;schedule();}
  }
  onMode(mode);schedule();return stop;
}
