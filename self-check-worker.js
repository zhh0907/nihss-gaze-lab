let detector,measureFrame,EYES;
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){
      ({measureFrame,EYES}=await import('./geometry.js?v=review7'));
      const {FilesetResolver,FaceLandmarker}=await import('./vendor/mediapipe/vision_bundle.js');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm',self.location.href).href);
      detector=await FaceLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:new URL('./vendor/mediapipe/face_landmarker.task',self.location.href).href,delegate:'CPU'},
        runningMode:'IMAGE',numFaces:2,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,
        outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true,
      });
      self.postMessage({id:data.id,ready:true});return;
    }
    const image=data.image,w=image.width,h=image.height;
    try{
      const result=detector.detect(image), direct=measureFrame(result,w,h,data.config);
      // Full lid contours avoid treating dark skin/lashes outside the true eye
      // opening as a visible iris at extreme gaze.
      const outlines={left:[362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382],right:[33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7]};
      if(result.faceLandmarks?.length===1)for(const side of ['left','right'])if(direct[side])direct[side].outline=outlines[side].map(i=>result.faceLandmarks[0][i]);
      const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d');
      ctx.translate(w,0);ctx.scale(-1,1);ctx.drawImage(image,0,0);
      const mirrored=detector.detect(canvas), clone=structuredClone(result);
      // Unreflect and swap iris indices; preserve canonical corners and pose.
      if(result.faceLandmarks?.length===1&&mirrored.faceLandmarks?.length===1){
        for(const [side,other] of [['left','right'],['right','left']]){
          const p=mirrored.faceLandmarks[0][EYES[other].iris];
          clone.faceLandmarks[0][EYES[side].iris]={...p,x:1-p.x};
        }
      }else clone.faceLandmarks=[];
      const reflected=measureFrame(clone,w,h,data.config);
      self.postMessage({id:data.id,alternatives:[direct,reflected]});
    }finally{image.close();}
  }catch(e){self.postMessage({id:data.id,error:String(e)});}
};
