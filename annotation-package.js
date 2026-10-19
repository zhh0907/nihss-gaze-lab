import {annotationQueue,selectedFrame} from './segment-review.js?v=adaptive19';

// ZIP STORE: original blobs are retained, never re-encoded or converted to base64.
// ZIP64, compression and encryption are intentionally not implemented.
const ZIP32_MAX=0xffffffff,ZIP_COUNT_MAX=0xffff,CHUNK_BYTES=1024*1024;
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;
  return n>>>0;
});
const finite=n=>Number.isFinite(n)?n:null;
const strings=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'):[];
const scalar=(value,keys)=>Object.fromEntries(keys.filter(key=>['number','string','boolean'].includes(typeof value?.[key])||value?.[key]===null).map(key=>[key,value[key]]));
const vectors=(value,keys)=>Object.fromEntries(keys.filter(key=>Array.isArray(value?.[key])&&value[key].every(Number.isFinite)).map(key=>[key,[...value[key]]]));

function safeId(value){
  const id=String(value??'clip').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,96);
  return id||'clip';
}
function safePath(path){
  if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.includes(':')||/[\u0000-\u001f\u007f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')){
    throw Error('Unsafe file path in annotation package.');
  }
  const name=encoder.encode(path);
  if(name.byteLength>=ZIP_COUNT_MAX)throw Error('Annotation package file name exceeds ZIP32 limits.');
  return name;
}
function extension(blob,kind){
  const mime=blob.type.toLowerCase().split(';')[0].trim();
  if(kind==='video')return ({'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov','video/ogg':'ogv'})[mime]??'bin';
  return ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[mime]??'bin';
}
function point(value){return value?Object.fromEntries(['x','y','z'].filter(k=>Number.isFinite(value[k])).map(k=>[k,value[k]])):null;}
function eyeData(eye){
  if(!eye)return null;
  const result=scalar(eye,['valid','raw','corrected','widthPixels','lidRatio','blink','kind','method']);
  result.reasons=strings(eye.reasons);
  if(eye.points)result.points=Object.fromEntries(['a','b','iris','top','bottom'].filter(k=>eye.points[k]).map(k=>[k,point(eye.points[k])]));
  if(eye.qualityChecks)result.qualityChecks=scalar(eye.qualityChecks,['lidTooNarrow','blinkScoreHigh']);
  if(eye.evidence)result.evidence={...scalar(eye.evidence,['support','pathMargin','anchorSpan','method']),
    ...(Array.isArray(eye.evidence.anchors)?{anchors:eye.evidence.anchors.filter(Number.isSafeInteger)}:{})};
  return result;
}
function historyData(history){
  return (Array.isArray(history)?history:[]).map(h=>scalar(h,['at','decision','previousDecision','previousDecidedAt']));
}
function sourceArchive(clip){
  if(Array.isArray(clip.reviewFrames))return clip.reviewFrames;
  if(Array.isArray(clip.archive))return clip.archive;
  return Array.isArray(clip.archive?.frames)?clip.archive.frames:[];
}
function validIndex(index){
  if(!Number.isSafeInteger(index)||index<0)throw Error('Invalid source frame index in annotation queue.');
  return index;
}
function assertZipSize(size){
  if(!Number.isSafeInteger(size)||size<0||size>=ZIP32_MAX)throw Error('Annotation package exceeds ZIP32 limits (less than 4 GiB per file and archive).');
}
function zipHeaders(name,size,crc,offset){
  const local=new Uint8Array(30),l=new DataView(local.buffer);
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);
  l.setUint16(8,0,true);l.setUint16(12,33,true); // STORE, 1980-01-01, UTF-8 names.
  l.setUint32(14,crc,true);l.setUint32(18,size,true);l.setUint32(22,size,true);l.setUint16(26,name.length,true);
  const central=new Uint8Array(46),c=new DataView(central.buffer);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);
  c.setUint16(10,0,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,size,true);c.setUint32(24,size,true);
  c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
  return {local,central};
}
async function zipStore(files,onProgress){
  if(files.length>=ZIP_COUNT_MAX)throw Error('Annotation package exceeds ZIP32 entry limits (fewer than 65,535 files).');
  let localBytes=0,centralBytes=0,totalBytes=0;
  const seen=new Set(),entries=files.map(file=>{
    if(!(file.blob instanceof Blob))throw Error('An annotation package file is not a Blob.');
    assertZipSize(file.blob.size);const name=safePath(file.path);
    if(seen.has(file.path))throw Error('Duplicate annotation package file path.');seen.add(file.path);
    const offset=localBytes;localBytes+=30+name.length+file.blob.size;centralBytes+=46+name.length;totalBytes+=file.blob.size;
    assertZipSize(localBytes);return {...file,name,offset};
  });
  assertZipSize(centralBytes);assertZipSize(localBytes+centralBytes+22);
  let processedBytes=0;const parts=[],directory=[];
  for(const [index,file]of entries.entries()){
    let crc=0xffffffff;
    for(let start=0;start<file.blob.size;start+=CHUNK_BYTES){
      const bytes=new Uint8Array(await file.blob.slice(start,start+CHUNK_BYTES).arrayBuffer());
      for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
      processedBytes+=bytes.length;
      onProgress({stage:'packing',completedFiles:index,totalFiles:entries.length,processedBytes,totalBytes,file:file.path,
        percent:totalBytes?processedBytes/totalBytes*100:0});
      // Yield between chunks so a phone can update progress while hashing video.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    const headers=zipHeaders(file.name,file.blob.size,(crc^0xffffffff)>>>0,file.offset);
    parts.push(headers.local,file.name,file.blob);directory.push(headers.central,file.name);
    onProgress({stage:'packing',completedFiles:index+1,totalFiles:entries.length,processedBytes,totalBytes,file:file.path,
      percent:totalBytes?processedBytes/totalBytes*100:100});
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
  e.setUint32(12,centralBytes,true);e.setUint32(16,localBytes,true);
  const blob=new Blob([...parts,...directory,end],{type:'application/zip'});
  onProgress({stage:'ready',completedFiles:entries.length,totalFiles:entries.length,processedBytes,totalBytes,file:null,percent:100});
  return blob;
}

/** Export only deferred eye-position tasks, with untouched source media.
 * Current clips use raw, reviewFrames and data.recording.id. Legacy aliases are
 * accepted, but clinical observations and algorithm scores are never serialized.
 */
export async function createAnnotationPackage({clip,report,onProgress=()=>{}}){
  const queue=annotationQueue(report);
  if(!queue.length)throw Error('No deferred segments to export. Choose Both need correction first.');
  const raw=clip?.raw instanceof Blob?clip.raw:clip?.rawBlob;
  if(!(raw instanceof Blob)||!raw.size)throw Error('The original raw video is unavailable. Keep this clip open and try again.');
  assertZipSize(raw.size);
  const recording=clip?.data?.recording??{},id=safeId(recording.id??clip?.id??report?.sourceRecordingId);
  const required=[...new Set(queue.flatMap(task=>(task.sourceIndices??[]).map(validIndex)))].sort((a,b)=>a-b);
  if(!required.length)throw Error('Deferred segments contain no source frame indices.');
  const archive=new Map(),frames=new Map((report.frames??[]).map(f=>[f.sourceIndex,f])),segments=new Map((report.segments??[]).map(s=>[s.id,s]));
  const requiredSet=new Set(required);
  for(const entry of sourceArchive(clip))if(requiredSet.has(entry.sourceIndex)){
    if(archive.has(entry.sourceIndex))throw Error(`Duplicate archived source frame ${entry.sourceIndex}.`);
    archive.set(entry.sourceIndex,entry.blob);
  }
  const rawPath=`video/raw.${extension(raw,'video')}`,files=[{path:rawPath,blob:raw}],imageFiles=new Map();
  for(const index of required){
    const blob=archive.get(index);
    if(!(blob instanceof Blob)||!blob.size)throw Error(`Source frame ${index} is unavailable. The annotation package was not created.`);
    const path=`frames/source_${String(index).padStart(6,'0')}.${extension(blob,'image')}`;
    imageFiles.set(index,path);files.push({path,blob});
  }
  // Capture all decisions before the first await. Later bedside choices cannot
  // change a package halfway through its CRC scan.
  const tasks=queue.map(task=>{
    if(!['left','right'].includes(task.eye))throw Error('Invalid eye in annotation queue.');
    return {...task,choiceHistory:historyData(segments.get(task.id)?.choiceHistory),frames:task.sourceIndices.map(index=>{
      const frame=frames.get(index),sample=clip?.data?.samples?.[index]??frame?.sample,review=frame?.[task.eye];
      if(!frame||!sample||!review)throw Error(`Eye tracking data for source frame ${index} is unavailable.`);
      const original=selectedFrame(sample,frame,'original')[task.eye],suggested=selectedFrame(sample,frame,'proposal')[task.eye];
      return {sourceIndex:index,imageFile:imageFiles.get(index),timeSeconds:finite(frame.time),rawVideoTimeSeconds:finite(sample.rawVideoTimeSeconds),
        phase:typeof sample.phase==='string'?sample.phase:null,
        frameSize:scalar(sample.frameSize,['width','height']),head:sample.head?{
          ...scalar(sample.head,['yaw','pitch','roll']),...vectors(sample.head,['normal','translation'])}:null,
        frameReasons:strings(sample.reasons),original:eyeData(sample[task.eye]),proposal:eyeData(review.proposal),
        shown:{original:eyeData(original),suggested:eyeData(suggested)},review:{
          ...scalar(review,['ignored','flagged','originalUsable','decision','decidedAt']),flags:strings(review.flags),
          evidence:scalar(review.evidence,['contrast','usable','reason'])}};
    })};
  });
  const manifest={schema:'gaze-deferred-annotation-1',createdAt:new Date().toISOString(),recordingId:id,
    purpose:'Deferred eye-position annotation',includesClinicalScores:false,automaticLearning:false,
    report:{schema:report.schema??null,version:report.version??null,createdAt:report.createdAt??null},
    rawVideo:{path:rawPath,bytes:raw.size,mimeType:raw.type,durationSeconds:finite(recording.durationSeconds),
      rawStartsAfterAnalysisSeconds:finite(recording.rawStartsAfterAnalysisSeconds),rawInputMirrored:recording.rawInputMirrored===true},
    coordinateConvention:'Source frames are full archived detector inputs, before overlays; eye points are normalized image coordinates. Eye corrected values are head-relative offsets, not degrees.',
    timeConvention:'Segment times use the recording clock. Per-frame rawVideoTimeSeconds provides approximate alignment to the untouched raw video; these are not hardware frame timestamps.',
    archiveFormat:'ZIP32 STORE; no compression or encryption; less than 4 GiB and fewer than 65,535 entries.',
    queue:tasks,
    binaryFiles:files.map(file=>({path:file.path,bytes:file.blob.size,mimeType:file.blob.type})),
    limitations:['This is an offline annotation package, not a manual annotation editor.',
      'Deferred choices reject both candidates but do not supply corrected coordinates or automatically train a model.',
      'History covers choices within this report only; a new image check may create a new report.',
      'The full source video contains identifiable face images. This ZIP is not encrypted. Use an institution-approved protected channel.']};
  const readme=`GAZE LAB - DEFERRED ANNOTATION PACKAGE\n\nRecording: ${id}\nDeferred eye segments: ${tasks.length}\n\n`+
    'annotation_queue.json contains only deferred tasks, the selected eye\'s original and proposed positions, source-image mappings, and current-report choice history. Clinical findings and NIHSS/algorithm scores are deliberately omitted.\n\n'+
    'video/ contains the full original raw recording, byte-for-byte. frames/ contains only archived detector-input images referenced by the deferred segments, also byte-for-byte. These images are full source frames, not new eye crops; use the eye corner coordinates in the JSON to locate the target eye. A source image may be shared by two eye tasks.\n\n'+
    'The queue preserves Both need correction choices for later offline annotation. It does not invent an accurate position, launch training, change the deployed model, or provide a manual annotation editor. Do not treat either rejected candidate as a correct label.\n\n'+
    'The original video and tracking remain unchanged. Unrelated review tasks and the other eye\'s tracking are not included. Full-video context remains available. Segment and raw-video times can differ slightly; use each frame\'s rawVideoTimeSeconds and the timing notes.\n\n'+
    'ZIP32 STORE format: no compression, no encryption, no ZIP64. Files and total archive must be smaller than 4 GiB, with fewer than 65,535 entries. The package is created locally. It contains identifiable face video and must be stored/shared only through an institution-approved protected channel.\n';
  files.unshift({path:'annotation_queue.json',blob:new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'})},
    {path:'README.txt',blob:new Blob([readme],{type:'text/plain;charset=utf-8'})});
  const blob=await zipStore(files,onProgress);
  return {blob,filename:`gaze_${id}_annotation.zip`,manifest};
}
