import {eyeUsable} from './eye-quality.js';

export const CHECK_VERSION = 'image-review-1';
export const SIDES = ['left', 'right'];
const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);

// Appearance is supporting evidence, not a pupil detector or a probability.
// Eyelashes, reflections and light irises can confound it. Never manufacture
// an iris centre from dark pixels.
export function eyeAppearance(image, eye) {
  const pts = eye?.points, {width:w,height:h,data} = image;
  if (!pts || !['a','b','iris','top','bottom'].every(k=>finitePoint(pts[k]))) return null;
  const a={x:pts.a.x*w,y:pts.a.y*h},b={x:pts.b.x*w,y:pts.b.y*h};
  const dx=b.x-a.x,dy=b.y-a.y,width=Math.hypot(dx,dy);
  if (width<20) return null;
  const ux=dx/width,uy=dy/width;
  const local=p=>({x:((p.x*w-a.x)*ux+(p.y*h-a.y)*uy)/width,
    y:((p.x*w-a.x)*-uy+(p.y*h-a.y)*ux)/width});
  const top=local(pts.top),bottom=local(pts.bottom),iris=local(pts.iris);
  const cy=(top.y+bottom.y)/2,ry=Math.abs(top.y-bottom.y)/2;
  if(ry<.035)return {usable:false,reason:'Eye opening too narrow for image check'};
  const values=[];
  const grey=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=w||y>=h)return null;const i=(y*w+x)*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];};
  const patch=(x,y)=>{
    let total=0,n=0;
    for(let v=-.045;v<=.046;v+=.0225)for(let u=-.07;u<=.071;u+=.035){
      const px=x+u,py=y+v;
      if(((px-.5)/.48)**2+((py-cy)/ry)**2>.8)continue;
      const g=grey(a.x+width*(px*ux-py*uy),a.y+width*(px*uy+py*ux));
      if(g!==null){total+=g;n++;}
    }
    return n>=5?total/n:null;
  };
  for(let x=.08;x<=.93;x+=.025){const v=patch(x,cy);if(v!==null)values.push(v);}
  if(values.length<8)return null;
  values.sort((a,b)=>a-b);
  const dark=values[0],bright=values[Math.floor(values.length*.8)],contrast=bright-dark;
  const atIris=patch(iris.x,iris.y);
  return {usable:contrast>=22,contrast,atIris,dark,
    penalty:atIris===null?null:atIris-dark,
    unsupported:contrast>=28&&(atIris===null||atIris-dark>Math.max(18,contrast*.5)),
    reason:contrast<22?'Low image contrast':null};
}

export function compareEye(original, alternatives, side, appearances) {
  const old=original[side], oldGood=eyeUsable(original,side), flags=[];
  const a=appearances.original;
  if(!oldGood)flags.push('Original tracking unavailable');
  if(a?.unsupported)flags.push('Original marker has weak iris-image support');
  const candidates=alternatives.map((sample,i)=>({sample,eye:sample?.[side],appearance:appearances.alternatives[i],method:i?'Mirrored image recheck':'Independent image recheck'}))
    .filter(c=>eyeUsable(c.sample,side)&&finitePoint(c.eye.points?.iris));
  const displacement=c=>{
    if(!finitePoint(old?.points?.iris))return Infinity;
    const aspect=original.frameSize?.width/original.frameSize?.height||1;
    const p=old.points, span=Math.hypot((p.a.x-p.b.x)*aspect,p.a.y-p.b.y);
    return Math.hypot((p.iris.x-c.eye.points.iris.x)*aspect,p.iris.y-c.eye.points.iris.y)/span;
  };
  if(candidates.some(c=>displacement(c)>.10))flags.push('Independent detections disagree');
  if(!candidates.length)flags.push('Image recheck could not confirm this eye');
  const supported=candidates.filter(c=>c.appearance?.usable&&!c.appearance.unsupported&&c.appearance.atIris!==null);
  supported.sort((a,b)=>a.appearance.penalty-b.appearance.penalty);
  let proposal=null;
  const best=supported[0];
  // Never correct a temporal jump or asymmetry simply because it is unusual.
  if(flags.length&&best&&displacement(best)>.045&&displacement(best)<.8&&
    (!oldGood||a?.unsupported||best.appearance.penalty+10<(a?.penalty??0))) {
    proposal={...structuredClone(best.eye),method:best.method};
  }
  return {flagged:flags.length>0,flags,original:structuredClone(old??null),originalUsable:oldGood,
    proposal,status:flags.length?(proposal?'Suggestion available':'Uncertain — inspect image'):'No issue flagged',
    evidence:{appearance:a,alternatives:candidates.map(c=>({method:c.method,displacement:displacement(c),appearance:c.appearance}))},
    decision:'unreviewed',decidedAt:null};
}

export function chooseReviewEye(eye, decision, now=new Date().toISOString()) {
  if(!['unreviewed','original','suggestion','uncertain'].includes(decision))throw Error('Invalid review choice');
  if(decision==='suggestion'&&!eye.proposal)throw Error('There is no supported suggestion for this eye');
  return {...eye,decision,decidedAt:decision==='unreviewed'?null:now};
}
export function selectedReviewEye(eye) {
  if(eye.decision==='uncertain')return null;
  if(eye.decision==='suggestion')return eye.proposal;
  return eye.originalUsable?eye.original:null;
}
export function reviewCsv(report) {
  const rows=[['sample_index','capture_time_s','eye','flagged','reason','original','suggestion','choice','selected','decided_at']];
  for(const f of report.frames)for(const side of SIDES){const e=f[side];rows.push([f.sourceIndex,f.time,side,e.flagged,e.flags.join('; '),e.originalUsable?e.original?.corrected:null,e.proposal?.corrected,e.decision,selectedReviewEye(e)?.corrected,e.decidedAt]);}
  return rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
}
