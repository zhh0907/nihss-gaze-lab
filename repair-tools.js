import {repairEyeGaps,repairCsv} from './gap-repair.js';
import {createRepairPreview,drawRepairVideo,repairVideoSize} from './repair-view.js';
import {convertVideo} from './video-export.js?v=repair6';
import {recordingMime,extensionFor} from './recording.js?v=quality5';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
export function createRepairTools({clip,clipNumber,player,getPlaybackVersion,onVersionChange,saveBlob,busyMessage,encode,prepareDownload}){
  const root=el('section',null,'repair-tools'),base=`gaze_recording_${clip.data.recording.id.slice(0,8)}`;
  root.append(el('h3','Repair eye tracking'));
  root.append(el('p','Fill short gaps from nearby observed eye positions. Purple markers are estimates. Everything runs on this device.','hint'));
  const settings=el('details'),summary=el('summary','Repair options');settings.append(summary);
  function select(label,options){const node=el('select');node.setAttribute('aria-label',`Clip ${clipNumber} ${label}`);for(const [v,t] of options)node.add(new Option(t,v));const l=el('label',label);l.append(node);settings.append(l);return node;}
  const mode=select('Repair scope',[['missing','Missing eye positions'],['range','Selected interval (mark unreliable)']]);
  const side=select('Eye to repair',[['both','Both eyes independently'],['left','Subject left eye'],['right','Subject right eye']]);
  const gap=select('Maximum time between valid anchors',[['0.1','100 ms · Strict'],['0.2','200 ms · Wider']]);
  settings.append(el('p','Only stable, short gaps are eligible. Long gaps, fast movement, head tracking loss and phase changes remain missing. These are experimental limits.','hint'));
  const range=el('div',null,'repair-range');range.hidden=true;
  const start=el('input'),end=el('input');
  for(const [node,name] of [[start,'Start'],[end,'End']]){node.type='number';node.min=0;node.max=clip.data.recording.durationSeconds;node.step=.001;node.value=0;node.setAttribute('aria-label',`Clip ${clipNumber} repair ${name.toLowerCase()} seconds`);const label=el('label',`${name} · clip seconds`);label.append(node);range.append(label);}
  function currentCaptureTime(){
    const key=getPlaybackVersion()==='raw'?'rawVideoTimeSeconds':'analysisVideoTimeSeconds';
    return clip.data.samples.reduce((nearest,s)=>Math.abs(s[key]-player.currentTime)<Math.abs(nearest[key]-player.currentTime)?s:nearest,clip.data.samples[0])?.recordingTimeSeconds??0;
  }
  const rangeButtons=el('div',null,'buttons');
  for(const [name,node] of [['Set start here',start],['Set end here',end]]){
    const b=el('button',name);b.onclick=()=>{if(getPlaybackVersion()==='repaired'){status.textContent='Choose the original analysis or raw video above, pause at the desired frame, then set the interval.';return;}player.pause();node.value=currentCaptureTime().toFixed(3);};rangeButtons.append(b);
  }
  range.append(rangeButtons,el('p','Pause the original video and set both ends, or type clip times. Only the selected eye samples are excluded; original measurements are preserved. The interval must fit between nearby valid anchors.','hint'));
  settings.append(range);mode.onchange=()=>{range.hidden=mode.value!=='range';};
  const run=el('button','Repair short gaps','primary repair-run');
  const status=el('p','No repair applied. Original recordings and NIHSS evidence are preserved.','hint');status.setAttribute('role','status');
  const gapDetails=el('details'),gapSummary=el('summary','Repair report'),gapList=el('div');gapDetails.hidden=true;gapDetails.append(gapSummary,gapList);
  const result=el('div');result.hidden=true;
  const previewHost=el('div'),actions=el('div',null,'buttons'),format=el('select');format.setAttribute('aria-label',`Clip ${clipNumber} repaired video format`);
  for(const f of ['mp4','webm']){const o=new Option(f.toUpperCase(),f);o.disabled=!recordingMime(globalThis.MediaRecorder,f);format.add(o);}
  format.value=Array.from(format.options).find(o=>!o.disabled)?.value??'';
  const formatLabel=el('label','Repaired video format');formatLabel.append(format);
  const exportVideo=el('button','Prepare repaired video'),exportJson=el('button','Repaired data JSON'),exportCsv=el('button','Repaired data CSV'),reset=el('button','Reset to original','repair-reset');
  const cancel=el('button','Cancel video export'),save=el('button');cancel.hidden=save.hidden=true;
  let preview=null,disposed=false,controller=null;
  function show(value){previewHost.hidden=!value;if(!value)preview?.pause();}
  function present(report,activate=true){
    save.hidden=true;save.onclick=null;
    preview?.dispose();previewHost.replaceChildren();
    if(!report){result.hidden=gapDetails.hidden=true;status.textContent='Repair removed. Original data is unchanged.';onVersionChange(false);return;}
    const s=report.summary;
    const quantity=(n,word)=>`${n} ${word}${n===1?'':'s'}`;
    status.textContent=`Estimated: ${quantity(s.estimatedEyeSamples,'eye sample')} in ${quantity(s.filledGaps,'gap')}. Skipped: ${quantity(s.skippedGaps,'gap')}. Still missing: ${quantity(s.remainingMissingEyeSamples,'eye sample')}. Estimates are excluded from NIHSS scoring.`;
    gapList.replaceChildren();const counts={};for(const g of report.gaps)if(g.status==='skipped')counts[g.reason]=(counts[g.reason]??0)+1;
    for(const [why,n] of Object.entries(counts))gapList.append(el('p',`${n} skipped: ${why}`,'hint'));
    for(const g of report.gaps.filter(g=>g.status==='filled').slice(0,20))gapList.append(el('p',`${g.side==='left'?'L':'R'} · ${g.startSeconds.toFixed(3)}–${g.endSeconds.toFixed(3)} s · estimated`,'hint'));
    if(!report.gaps.length)gapList.append(el('p','No missing eye positions were found for these settings. To exclude an incorrect detected position, choose a selected interval.','hint'));
    gapDetails.hidden=false;result.hidden=false;preview=createRepairPreview({clip,report,clipNumber});previewHost.append(preview.element);
    show(activate);onVersionChange(true,activate);
  }
  run.onclick=()=>{
    const busy=busyMessage();if(busy){status.textContent=busy;return;}
    try{
      const report=repairEyeGaps(clip.data,{maxGapSeconds:Number(gap.value),eye:side.value,mode:mode.value,start:Number(start.value),end:Number(end.value)});
      clip.repair=report;present(report);status.scrollIntoView({block:'nearest'});
    }catch(error){status.textContent=error.message;}
  };
  const packageData=()=>({schema:'gaze-repair-package-1',original:clip.data,repair:clip.repair});
  exportJson.onclick=()=>saveBlob(new Blob([JSON.stringify(packageData(),null,2)],{type:'application/json'}),`${base}_repaired.json`);
  exportCsv.onclick=()=>saveBlob(new Blob([repairCsv(clip.data,clip.repair)],{type:'text/csv;charset=utf-8'}),`${base}_repaired.csv`);
  reset.onclick=()=>{const busy=busyMessage();if(busy){status.textContent=busy;return;}clip.repair=null;present(null);};
  exportVideo.disabled=!format.value;
  exportVideo.onclick=async()=>{
    const busy=busyMessage();if(busy){status.textContent=busy;return;}
    const report=clip.repair;if(!report)return;
    preview?.pause();player.pause();controller=new AbortController();cancel.hidden=false;cancel.onclick=()=>controller.abort();
    exportVideo.disabled=true;format.disabled=true;save.hidden=true;
    try{
      const output=await encode(controller,()=>convertVideo(clip.raw,format.value,{signal:controller.signal,size:repairVideoSize(clip.data),
        renderFrame:(ctx,v,t)=>drawRepairVideo(ctx,v,t,clip.data,report),
        onProgress:(t,d)=>{status.textContent=`Preparing repaired video · ${t.toFixed(1)} / ${(Number.isFinite(d)?d:clip.data.recording.durationSeconds).toFixed(1)} s. Keep this tab visible.`;}}));
      if(disposed)return;
      prepareDownload(()=>{save.hidden=true;save.onclick=null;});
      save.textContent=`Save repaired ${extensionFor(output.type).toUpperCase()}`;save.hidden=false;
      save.onclick=()=>{saveBlob(output,`${base}_repaired.${extensionFor(output.type)}`);status.textContent='Download requested. Purple markers are estimates; originals and NIHSS evidence are unchanged.';};
      status.textContent='Repaired video ready. Tap Save to download. Re-encoding and video alignment can change timing; use the original data for measurement analysis.';
    }catch(error){status.textContent=error.message;}
    finally{controller=null;cancel.hidden=true;exportVideo.disabled=!format.value;format.disabled=false;}
  };
  actions.append(exportVideo,exportJson,exportCsv,reset);result.append(previewHost,el('p','Purple ~: estimated · Green/blue: observed · ? / —: missing. Raw-video alignment uses estimated timestamps.','hint'),formatLabel,actions,cancel,save);
  root.append(settings,run,status,gapDetails,result);
  if(clip.repair){const o=clip.repair.options;mode.value=o.mode;side.value=o.eye;gap.value=o.maxGapSeconds;start.value=o.start??0;end.value=o.end??0;range.hidden=o.mode!=='range';present(clip.repair,false);}
  return {element:root,show,dispose(){disposed=true;controller?.abort();preview?.dispose();save.onclick=null;}};
}
