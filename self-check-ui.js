import {SIDES,chooseReviewEye,reviewCsv} from './self-check-core.js';

const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
const fmt=n=>Number.isFinite(n)?n.toFixed(3):'Unavailable';
export function createSelfCheckUI({clip,clipNumber,retry,saveBlob,watch}) {
  const root=el('section',null,'self-check');root.setAttribute('aria-label','Clip '+clipNumber+' image self-check');
  const heading=el('h3','Image self-check'),status=el('p',null,'hint');status.setAttribute('role','status');
  const actions=el('div',null,'buttons'),retryButton=el('button','Check images'),cancel=el('button','Cancel check');
  retryButton.onclick=()=>retry(clip);cancel.onclick=()=>clip.checkController?.abort();actions.append(retryButton,cancel);
  const body=el('div');body.hidden=true;root.append(heading,status,actions,body);
  let disposed=false,position=0,all=false,drawToken=0,builtReport=null,nav,panels,progress,reviewer,jump;
  const frames=()=>all?clip.checkReport.frames:clip.checkReport.frames.filter(f=>f.flagged);
  function summary(){
    const r=clip.checkReport;
    const chosen=r.frames.reduce((n,f)=>n+SIDES.filter(s=>f[s].decision!=='unreviewed').length,0);
    progress.textContent=chosen+' eye choices saved locally · Original data preserved';
  }
  async function draw(){
    const token=++drawToken,rows=frames();position=Math.max(0,Math.min(position,rows.length-1));
    panels.replaceChildren();const f=rows[position];
    jump.replaceChildren();for(const [i,frame]of rows.entries())jump.add(new Option(frame.time.toFixed(3)+' s',String(i)));jump.value=String(position);
    nav.textContent=f?(position+1)+' / '+rows.length+' · '+f.time.toFixed(3)+' s':'No moments in this view';
    if(!f)return;
    const controls=el('div',null,'buttons'),back=el('button','Previous'),next=el('button','Next'),context=el('button','Show in video');
    back.disabled=position===0;next.disabled=position===rows.length-1;
    back.onclick=()=>{position--;draw();};next.onclick=()=>{position++;draw();};context.onclick=()=>watch(f.sourceIndex);
    controls.append(back,next,context);panels.append(controls);
    const entry=clip.reviewFrames.find(e=>e.sourceIndex===f.sourceIndex);
    let image;
    try{image=await createImageBitmap(entry.blob);}catch(e){panels.append(el('p','Cannot load this saved frame.','warning'));return;}
    if(disposed||token!==drawToken){image.close();return;}
    for(const side of SIDES){
      const e=f[side],section=el('div',null,'check-eye');
      section.append(el('h4',(side==='left'?'Subject left eye':'Subject right eye')+' · '+e.status));
      const pair=el('div',null,'check-pair');
      const points=e.original?.points??e.proposal?.points;
      for(const version of ['original','proposal']){
        const isOriginal=version==='original',unchanged=!isOriginal&&!e.flagged;
        const candidate=unchanged?e.original:e[version],card=el('div',null,'check-version');
        const usable=(isOriginal||unchanged)?e.originalUsable:!!e.proposal;
        card.append(el('strong',isOriginal?'Before check':unchanged?'After check · unchanged':'After check · suggestion'));
        const canvas=el('canvas');canvas.width=480;canvas.height=260;canvas.setAttribute('aria-label',(isOriginal?'Original':'Suggested')+' '+side+' eye at '+f.time.toFixed(3)+' seconds');
        const ctx=canvas.getContext('2d');
        if(points){
          const w=image.width,h=image.height,span=Math.hypot((points.a.x-points.b.x)*w,(points.a.y-points.b.y)*h);
          const cx=(points.a.x+points.b.x)*w/2,cy=(points.a.y+points.b.y)*h/2;
          const sw=Math.max(32,span*1.6),sh=sw*canvas.height/canvas.width,sx=cx-sw/2,sy=cy-sh/2;
          ctx.drawImage(image,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
          if(usable&&candidate?.points?.iris){
            const p=candidate.points.iris,x=(p.x*w-sx)/sw*canvas.width,y=(p.y*h-sy)/sh*canvas.height;
            const color=isOriginal?'#80d8ff':'#f0b2ff';ctx.lineWidth=6;ctx.strokeStyle=color;
            ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.strokeStyle='#14212c';ctx.lineWidth=10;ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=6;ctx.stroke();
            ctx.beginPath();ctx.moveTo(x-15,y);ctx.lineTo(x+15,y);ctx.moveTo(x,y-15);ctx.lineTo(x,y+15);ctx.stroke();
          }
        }else{ctx.drawImage(image,0,0,480,260);}
        card.append(canvas,el('span',usable?fmt(candidate.corrected):isOriginal?'Unavailable':'Uncertain — no replacement'));
        pair.append(card);
      }
      section.append(pair,el('p',e.flags.length?e.flags.join(' · '):'No issue flagged. This does not confirm accuracy.','hint'));
      const label=el('label','Examiner choice'),select=el('select');select.setAttribute('aria-label',(side==='left'?'Left':'Right')+' eye review choice');
      for(const [value,text]of [['unreviewed','Not reviewed'],['original','Keep original'],['suggestion','Use suggestion'],['uncertain','Cannot determine']]){
        const o=new Option(text,value);o.disabled=value==='suggestion'&&!e.proposal;select.add(o);
      }
      select.value=e.decision;select.onchange=()=>{f[side]=chooseReviewEye(f[side],select.value);summary();};
      label.append(select);section.append(label);panels.append(section);
    }
    image.close();summary();
  }
  function build(){
    const r=clip.checkReport;body.replaceChildren();body.hidden=false;
    const note=el('p','Same saved image on both sides. Suggestions need examiner review; they do not change the NIHSS score.','hint');
    const filterLabel=el('label','Moments'),filter=el('select');filter.setAttribute('aria-label','Self-check moments');
    filter.add(new Option('Flagged frames ('+r.flaggedFrames+')','flagged'));filter.add(new Option('All checked frames ('+r.frames.length+')','all'));
    all=!r.flaggedFrames;filter.value=all?'all':'flagged';filter.onchange=()=>{all=filter.value==='all';position=0;draw();};
    filterLabel.append(filter);const jumpLabel=el('label','Jump to time');jump=el('select');jump.setAttribute('aria-label','Review frame time');jump.onchange=()=>{position=Number(jump.value);draw();};jumpLabel.append(jump);nav=el('p',null,'check-nav');panels=el('div');progress=el('p',null,'hint');
    const exports=el('details'),title=el('summary','Save review'),label=el('label','Examiner ID (optional)');
    reviewer=el('input');reviewer.maxLength=80;reviewer.placeholder='No patient identifiers';reviewer.value=r.reviewer;reviewer.oninput=()=>{r.reviewer=reviewer.value;};label.append(reviewer);
    const json=el('button','Download review JSON'),csv=el('button','Download review CSV');
    json.onclick=()=>saveBlob(new Blob([JSON.stringify({schema:'gaze-image-review-package-1',original:clip.data,review:r},null,2)],{type:'application/json'}),'gaze_'+r.sourceRecordingId.slice(0,8)+'_review.json');
    csv.onclick=()=>saveBlob(new Blob([reviewCsv(r)],{type:'text/csv;charset=utf-8'}),'gaze_'+r.sourceRecordingId.slice(0,8)+'_review.csv');
    const buttons=el('div',null,'buttons');buttons.append(json,csv);exports.append(title,label,buttons);
    body.append(note,filterLabel,jumpLabel,nav,panels,progress,exports);builtReport=r;draw();
  }
  function update(){
    if(disposed)return;
    const state=clip.checkState??'idle',busy=['queued','running'].includes(state);
    retryButton.hidden=busy||!!clip.checkReport;cancel.hidden=!busy;
    status.textContent=state==='queued'?'Queued for automatic image check…':state==='running'?'Checking images · '+(clip.checkProgress??'Loading model…'):
      clip.checkReport?clip.checkReport.flaggedFrames+' flagged frames · '+clip.checkReport.suggestions+' eye suggestions · '+clip.checkReport.coverage.checked+' / '+clip.checkReport.coverage.total+' frames checked'+(clip.checkReport.coverage.unchecked?' · Unchecked frames remain':''):
      clip.checkError??'A local image check runs after recording.';
    if(clip.checkReport&&builtReport!==clip.checkReport)build();
  }
  clip.checkEvents??=new EventTarget();clip.checkEvents.addEventListener('change',update);update();
  return {element:root,dispose(){disposed=true;drawToken++;clip.checkEvents.removeEventListener('change',update);}};
}
