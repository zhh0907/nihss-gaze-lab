import {eyePosition,intrinsics} from './geometry.js';

const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);

// All searches use the current image. Temporal inference chooses between these
// hypotheses; it never paints an iris or assumes a normal excursion amplitude.
export function eyeEvidence(image, sample, alternatives, side, config={}) {
  const original=sample[side], base=original?.points?original:alternatives.find(s=>s[side]?.points)?.[side];
  const p=base?.points,w=image.width,h=image.height;
  if(!p||!['a','b','top','bottom'].every(k=>point(p[k])))return {candidates:[],reason:'Eye outline unavailable'};
  if(['a','b'].some(k=>p[k].x<0||p[k].x>1||p[k].y<0||p[k].y>1))return {candidates:[],reason:'Eye outside the frame'};
  const ax=p.a.x*w,ay=p.a.y*h,dx=(p.b.x-p.a.x)*w,dy=(p.b.y-p.a.y)*h,span=Math.hypot(dx,dy);
  if(span<24)return {candidates:[],reason:'Eye image too small'};
  const ux=dx/span,uy=dy/span;
  const local=q=>({x:((q.x*w-ax)*ux+(q.y*h-ay)*uy)/span,y:((q.x*w-ax)*-uy+(q.y*h-ay)*ux)/span});
  const global=q=>({x:(ax+span*(q.x*ux-q.y*uy))/w,y:(ay+span*(q.x*uy+q.y*ux))/h});
  const top=local(p.top),bottom=local(p.bottom),cy=(top.y+bottom.y)/2,opening=Math.abs(top.y-bottom.y);
  if(opening<.045)return {candidates:[],reason:'Closed or heavily occluded eye'};
  const outline=alternatives[0]?.[side]?.outline?.filter(point).map(local);
  const inside=q=>{
    if(!outline||outline.length<8)return true;
    let result=false;
    for(let i=0,j=outline.length-1;i<outline.length;j=i++){
      const a=outline[i],b=outline[j];
      if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)result=!result;
    }return result;
  };
  const pixels=[];
  // Exclude the lid boundary to reduce dark eyelash contamination. Keep the
  // corners: extreme-gaze evidence is often a small visible iris crescent.
  for(let x=.025;x<.98;x+=.025){
    const arch=Math.sqrt(Math.max(0,1-((x-.5)/.5)**2));
    const lo=cy-opening*.5*arch+.012,hi=cy+opening*.5*arch-.012;
    for(let y=lo;y<=hi;y+=.018){
      if(!inside({x,y})||!inside({x,y:y-.012})||!inside({x,y:y+.012}))continue;
      const q=global({x,y}),xx=Math.round(q.x*w),yy=Math.round(q.y*h);
      if(xx<0||xx>=w||yy<0||yy>=h)continue;
      const i=(yy*w+xx)*4,g=.2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2];
      pixels.push({x,y,g});
    }
  }
  if(pixels.length<24)return {candidates:[],reason:'Insufficient visible eye area'};
  const values=pixels.map(v=>v.g).sort((a,b)=>a-b),dark=values[Math.floor(values.length*.10)],light=values[Math.floor(values.length*.85)],contrast=light-dark;
  const threshold=dark+contrast*.43;
  let darkCount=0;for(const q of pixels){q.dark=q.g<threshold;darkCount+=Number(q.dark);}
  const usable=contrast>=28&&darkCount>=5&&darkCount/pixels.length<.72;
  // A clipped dark patch alone does not locate the hidden iris centre. Keep
  // explicit, current-image boundary evidence for the stricter same-eye
  // temporal route; it must see dark-inside/light-outside iris edges.
  function edgeWitness(q,rx,ry){
    const visible=z=>{
      const arch=Math.sqrt(Math.max(0,1-((z.x-.5)/.5)**2));
      return z.x>.025&&z.x<.98&&z.y>cy-opening*.5*arch+.012&&z.y<cy+opening*.5*arch-.012&&inside(z);
    };
    const grey=z=>{const p=global(z),x=Math.round(p.x*w),y=Math.round(p.y*h);if(x<0||x>=w||y<0||y>=h)return null;
      const i=(y*w+x)*4;return .2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2];};
    let hits=0,trials=0;const quadrants=new Set();
    for(let i=0;i<32;i++){
      const angle=i*Math.PI/16,c=Math.cos(angle),s=Math.sin(angle);
      const a={x:q.x+rx*c*.8,y:q.y+ry*s*.8},b={x:q.x+rx*c*1.2,y:q.y+ry*s*1.2};
      if(!visible(a)||!visible(b))continue;
      const inner=grey(a),outer=grey(b);if(inner===null||outer===null)continue;trials++;
      if(inner<threshold&&outer>threshold&&outer-inner>=contrast*.25){hits++;quadrants.add(Math.floor(i/8));}
    }
    return {hits,trials,quadrants:quadrants.size,hasLidContour:!!outline&&outline.length>=8};
  }
  function support(q){
    let best={score:0,visible:0,rx:0,ry:0};
    for(const rx of [.09,.14,.19,.24])for(const ry of [.14,.20,.26]){
      let inside=0,hit=0;
      for(const z of pixels)if(((z.x-q.x)/rx)**2+((z.y-q.y)/ry)**2<=1){inside++;if(z.dark)hit++;}
      const score=inside>=5?2*hit/(inside+darkCount):0;
      if(score>best.score)best={score,visible:inside/pixels.length,rx,ry};
    }
    return best;
  }
  const referenceHead=sample.head??alternatives[0]?.head;
  const k=intrinsics(w,h,config.verticalFov??63),candidates=[];
  function candidate(q,method,eye=base){
    if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<-.15||q.x>1.15||Math.abs(q.y-cy)>.36)return;
    const evidence=support(q),iris=global(q),points={...structuredClone(p),iris};
    if(iris.x<0||iris.x>1||iris.y<0||iris.y>1)return;
    const position=referenceHead?.normal?eyePosition(points,referenceHead.normal,k):null;
    if(!position||Math.abs(position.corrected)>1.3)return;
    candidates.push({eye:{...structuredClone(eye),...position,points,valid:true,reasons:[]},
      x:position.corrected/2,y:q.y,local:q,method,support:evidence.score,
      supported:usable&&evidence.score>=.64,ellipse:evidence,centreVisible:inside(q),imageWitness:edgeWitness(q,evidence.rx,evidence.ry)});
  }
  if(point(original?.points?.iris))candidate(local(original.points.iris),'Original',original);
  alternatives.forEach((s,i)=>{if(point(s[side]?.points?.iris))candidate(local(s[side].points.iris),i?'Reflected image detection':'Image detection',s[side]);});
  if(usable){
    const search=[];
    for(let x=-.05;x<=1.051;x+=.05)for(let y=cy-.12;y<=cy+.121;y+=.04){
      const q={x,y},s=support(q);if(s.score>=.64)search.push({q,score:s.score});
    }
    search.sort((a,b)=>b.score-a.score);
    const chosen=[];
    for(const c of search){if(chosen.some(v=>Math.hypot(v.x-c.q.x,v.y-c.q.y)<.075))continue;
      chosen.push(c.q);candidate(c.q,'Visible iris + temporal fit');if(chosen.length>=4)break;}
  }
  return {candidates,usable,contrast,opening,reason:usable?null:'Weak iris image evidence'};
}
