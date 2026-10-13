// Clean copies of the exact detector input, captured before markers are drawn.
// Bounded separately from video memory; missing copies are reported as unchecked.
export class ReviewArchive {
  constructor(limit=48*1024*1024) {
    this.limit=limit;this.bytes=0;this.frames=[];this.pending=new Set();this.skipped=0;
    this.canvas=document.createElement('canvas');
  }
  add(image,sourceIndex) {
    if(this.bytes>=this.limit||this.pending.size>=3){this.skipped++;return;}
    try {
    const c=this.canvas,scale=Math.min(1,1280/image.width,1280/image.height);
    c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);
    let job;
    job=new Promise(resolve=>c.toBlob(blob=>{
      if(blob&&this.bytes+blob.size<=this.limit){this.frames.push({sourceIndex,blob});this.bytes+=blob.size;}
      else this.skipped++;
      resolve();
    },'image/jpeg',.94)).catch(()=>{this.skipped++;}).finally(()=>this.pending.delete(job));
    this.pending.add(job);
    } catch { this.skipped++; }
  }
  async finish() {
    await Promise.all(this.pending);
    this.frames.sort((a,b)=>a.sourceIndex-b.sourceIndex);
    return this.frames;
  }
}
