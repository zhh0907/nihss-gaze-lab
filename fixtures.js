import {Matrix4,Vector3,Euler} from './vendor/three.module.js';
import {EYES,intrinsics,DEFAULTS} from './geometry.js';

// Deterministic geometry fixtures. These bypass the detector and are NEVER
// patient examples or evidence of clinical accuracy.
export function syntheticFrame({yaw=0,pitch=0,roll=0,tx=0,ty=0,tz=-55,left=0,right=0,blink=false,irisDepth=0,width=1280,height=720,fov=63}={}) {
  const transform=new Matrix4().makeRotationFromEuler(new Euler(pitch*Math.PI/180,yaw*Math.PI/180,roll*Math.PI/180,'YXZ'));
  transform.setPosition(tx,ty,tz);
  const k=intrinsics(width,height,fov);
  const project=p=>{
    const v=new Vector3(...p).applyMatrix4(transform);
    return {x:(k.fx*v.x/(-v.z)+k.cx)/width,y:(k.cy-k.fy*v.y/(-v.z))/height,z:0};
  };
  const landmarks=Array.from({length:478},()=>project([0,0,0]));
  for(const [side,ids] of Object.entries(EYES)) {
    const c=side==='left'?3.2:-3.2,h=side==='left'?left:right;
    landmarks[ids.a]=project([c-1.5,2,0]);
    landmarks[ids.b]=project([c+1.5,2,0]);
    landmarks[ids.iris]=project([c+1.5*h,2,irisDepth]);
    landmarks[ids.top]=project([c,2+(blink?.04:.4),0]);
    landmarks[ids.bottom]=project([c,2-(blink?.04:.4),0]);
  }
  return {faceLandmarks:[landmarks],facialTransformationMatrixes:[{rows:4,columns:4,data:Array.from(transform.elements)}],faceBlendshapes:[]};
}

export function demoInput(t,scenario='normal') {
  const phase=t<2.5?'center':t<5.5?'left':t<8?'center':t<11?'right':'center';
  const phaseStart=t<2.5?0:t<5.5?2.5:t<8?5.5:t<11?8:11;
  const v=phase==='left'?.36:phase==='right'?-.36:0;
  let left=v,right=v;
  if(scenario==='partial' && phase==='right') left=-.035;
  if(scenario==='head-only') left=right=0;
  const options={yaw:27*Math.sin(t*1.7),pitch:9*Math.sin(t*.8),roll:14*Math.sin(t*.65),tx:6*Math.sin(t*.7),ty:2*Math.cos(t),left,right};
  if(scenario==='occluded' && phase==='left') options.blink=true;
  return {phase,phaseStart,result:syntheticFrame(options),truth:{left,right},config:DEFAULTS};
}
