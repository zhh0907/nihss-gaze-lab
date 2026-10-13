let detector;
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init') {
      const {FilesetResolver,FaceLandmarker}=await import('./vendor/mediapipe/vision_bundle.js');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm',self.location.href).href);
      detector=await FaceLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:new URL('./vendor/mediapipe/face_landmarker.task',self.location.href).href,delegate:'CPU'},
        runningMode:'VIDEO',numFaces:2,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6,
        outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true,
      });
      self.postMessage({type:'ready'});
    } else if(data.type==='frame') {
      try {
        const start=performance.now();
        const result=detector.detectForVideo(data.image,data.timestamp);
        result.frameSize={width:data.image.width,height:data.image.height};
        self.postMessage({type:'result',id:data.id,result,inferenceMs:performance.now()-start});
      } finally {data.image.close();}
    }
  } catch(error) {self.postMessage({type:'error',id:data.id,message:String(error)});}
};
