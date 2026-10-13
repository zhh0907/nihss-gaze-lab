// Head-relative iris position, not an estimate of visual-axis angle.
// MediaPipe uses a column-major face transform in a camera frame with +Y up,
// looking along -Z. See README.md for the planar-eye approximation.
export const VERSION = 'gaze-prototype-0.2.0';
export const DEFAULTS = Object.freeze({
  verticalFov: 63, maxYaw: 35, maxPitch: 25, maxRoll: 35,
  minEyePixels: 24, minLidRatio: 0.12, maxBlink: 0.6,
  minPhaseSeconds: 0.8, minPhaseFrames: 8, minCoverage: 0.6,
  maxSampleGap: 0.25, settleSeconds: 0.35,
  minExcursion: 0.12, maxAsymmetry: 0.18, restDeviation: 0.22,
});
export const EYES = Object.freeze({
  left: {a: 362, b: 263, iris: 473, top: 386, bottom: 374, blink: 'eyeBlinkLeft'},
  right: {a: 33, b: 133, iris: 468, top: 159, bottom: 145, blink: 'eyeBlinkRight'},
});
const dot = (a,b) => a.reduce((v,x,i) => v+x*b[i],0);
const sub = (a,b) => a.map((x,i) => x-b[i]);
const norm = a => Math.hypot(...a);
const unit = a => a.map(x => x/norm(a));
const finite = a => a.every(Number.isFinite);
const deg = r => r*180/Math.PI;

export function intrinsics(width,height,verticalFov=DEFAULTS.verticalFov) {
  if (!(width>0 && height>0 && verticalFov>10 && verticalFov<150)) throw Error('Invalid camera parameters');
  const f=height/(2*Math.tan(verticalFov*Math.PI/360));
  return {fx:f,fy:f,cx:width/2,cy:height/2,width,height,source:'assumed-fov'};
}

export function headPose(matrix) {
  const m=matrix?.data ?? matrix;
  if (!m || m.length!==16 || !finite(Array.from(m))) return null;
  const columns=[[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]];
  if (columns.some(c=>norm(c)<0.1)) return null;
  const [x,y,z]=columns.map(unit);
  const cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  if (Math.abs(dot(x,y))>.08 || Math.abs(dot(x,z))>.08 || Math.abs(dot(y,z))>.08 || dot(cross,z)<.9) return null;
  return {yaw:deg(Math.atan2(z[0],z[2])),pitch:deg(Math.atan2(-z[1],Math.hypot(z[0],z[2]))),roll:deg(Math.atan2(x[1],x[0])),normal:z,translation:[m[12],m[13],m[14]]};
}

// Intersect camera rays with a plane parallel to the head's XY plane.
// Its distance is arbitrary: it cancels when dividing by eye-corner width.
export function rectifyPoint(p,normal,k) {
  const ray=[(p.x*k.width-k.cx)/k.fx,(k.cy-p.y*k.height)/k.fy,-1];
  const denominator=-dot(normal,ray);
  if (!finite(ray) || denominator<.15) return null;
  return ray.map(x=>x/denominator);
}

export function eyePosition(points,normal,k) {
  const {a,b,iris}=points;
  if (![a,b,iris].every(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const pixels=p=>[p.x*k.width,p.y*k.height];
  const pa=pixels(a),pb=pixels(b),pi=pixels(iris),d=sub(pb,pa),w2=dot(d,d);
  if (w2<1) return null;
  const raw=2*dot(sub(pi,pa),d)/w2-1;
  const projected=[a,b,iris].map(p=>rectifyPoint(p,normal,k));
  if (projected.some(p=>!p)) return null;
  const [ra,rb,ri]=projected,rd=sub(rb,ra),len2=dot(rd,rd);
  if (len2<1e-12) return null;
  const corrected=2*dot(sub(ri,ra),rd)/len2-1;
  return finite([raw,corrected])?{raw,corrected,widthPixels:Math.sqrt(w2)}:null;
}

export function measureFrame(result,width,height,config=DEFAULTS) {
  const cfg={...DEFAULTS,...config};
  const count=result.faceLandmarks?.length ?? 0;
  const out={valid:false,faceCount:count,reasons:[],head:null,left:null,right:null};
  if (count!==1) { out.reasons.push(count?'multiple-faces':'no-face'); return out; }
  const lm=result.faceLandmarks[0],head=headPose(result.facialTransformationMatrixes?.[0]);
  out.head=head;
  if (!head) {out.reasons.push('pose-unavailable');return out;}
  if (Math.abs(head.yaw)>cfg.maxYaw || Math.abs(head.pitch)>cfg.maxPitch || Math.abs(head.roll)>cfg.maxRoll) out.reasons.push('head-out-of-range');
  const k=intrinsics(width,height,cfg.verticalFov);
  const blends=Object.fromEntries((result.faceBlendshapes?.[0]?.categories ?? []).map(b=>[b.categoryName,b.score]));
  for (const [side,ids] of Object.entries(EYES)) {
    const pts=Object.fromEntries(['a','b','iris','top','bottom'].map(key=>[key,lm[ids[key]]]));
    const eye=eyePosition(pts,head.normal,k),reasons=[];
    if (!eye || !pts.top || !pts.bottom) {out[side]={valid:false,reasons:['eye-unavailable']};continue;}
    const lid=Math.hypot((pts.top.x-pts.bottom.x)*width,(pts.top.y-pts.bottom.y)*height)/eye.widthPixels;
    if (Object.values(pts).some(p=>!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x<0 || p.x>1 || p.y<0 || p.y>1)) reasons.push('eye-out-of-frame');
    if (eye.widthPixels<cfg.minEyePixels) reasons.push('eye-too-small');
    if (lid<cfg.minLidRatio || blends[ids.blink]>cfg.maxBlink) reasons.push('blink-or-occlusion');
    if (Math.abs(eye.corrected)>1.2) reasons.push('iris-outside-eye');
    out[side]={...eye,lidRatio:lid,blink:blends[ids.blink]??null,valid:reasons.length===0 && out.reasons.length===0,reasons,points:pts};
  }
  out.valid=out.reasons.length===0 && out.left?.valid===true && out.right?.valid===true;
  return out;
}

export function percentile(values,q) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if (!a.length) return null;
  const p=(a.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);
  return a[lo]+(a[hi]-a[lo])*(p-lo);
}

// No interpolation across invalid frames. Keep unsmoothed values for research.
export class DisplayFilter {
  constructor(tau=.065) {this.tau=tau;this.reset();}
  reset(){this.last=null;}
  step(frame,t){
    if (!frame.valid) {this.reset();return null;}
    const values=[frame.left.corrected,frame.right.corrected];
    const dt=this.last?t-this.last.t:Infinity;
    const alpha=dt>0 && dt<.25?1-Math.exp(-dt/this.tau):1;
    const value=values.map((v,i)=>this.last?this.last.value[i]+alpha*(v-this.last.value[i]):v);
    this.last={t,value};return value;
  }
}
