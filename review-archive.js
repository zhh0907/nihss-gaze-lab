// Clean copies of the exact detector input, captured before markers are drawn.
// Bounded separately from video memory; missing copies are reported as unchecked.
export class ReviewArchive {
  constructor(limit=48*1024*1024,{phaseQuotas=null}={}) {
    if(!Number.isFinite(limit)||limit<0)throw Error('Invalid review archive limit.');
    if(phaseQuotas&&(Object.values(phaseQuotas).some(n=>!Number.isFinite(n)||n<0)||
      Object.values(phaseQuotas).reduce((sum,n)=>sum+n,0)>limit))throw Error('Invalid review archive phase budgets.');
    this.limit=limit;this.bytes=0;this.frames=[];this.pending=new Set();this.skipped=0;
    this.phaseQuotas=phaseQuotas?{...phaseQuotas}:null;this.requested=0;this.skippedReasons={};
    this.byPhase=Object.create(null);
    for(const phase of Object.keys(this.phaseQuotas??{}))this.phaseStats(phase);
    this.canvas=document.createElement('canvas');
  }
  phaseStats(phase){
    return this.byPhase[phase]??= {requested:0,saved:0,skipped:0,bytes:0,
      limitBytes:this.phaseQuotas?(Object.hasOwn(this.phaseQuotas,phase)?this.phaseQuotas[phase]:0):null,skippedReasons:{}};
  }
  skip(stats,reason){
    this.skipped++;stats.skipped++;
    this.skippedReasons[reason]=(this.skippedReasons[reason]??0)+1;
    stats.skippedReasons[reason]=(stats.skippedReasons[reason]??0)+1;
  }
  add(image,sourceIndex,phase='unlabelled') {
    const stats=this.phaseStats(phase);this.requested++;stats.requested++;
    if(this.phaseQuotas&&!Object.hasOwn(this.phaseQuotas,phase)){this.skip(stats,'phase-not-configured');return;}
    if(this.bytes>=this.limit){this.skip(stats,'total-byte-limit');return;}
    if(stats.limitBytes!==null&&stats.bytes>=stats.limitBytes){this.skip(stats,'phase-byte-limit');return;}
    if(this.pending.size>=3){this.skip(stats,'encoder-busy');return;}
    try {
    const c=this.canvas,scale=Math.min(1,1280/image.width,1280/image.height);
    c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);
    let job;
    job=new Promise(resolve=>c.toBlob(blob=>{
      // Encoding is asynchronous: recheck both budgets after all earlier
      // callbacks. A busy first phase must never spend a later phase's reserve.
      if(!blob||!blob.size)this.skip(stats,'encode-empty');
      else if(this.bytes+blob.size>this.limit)this.skip(stats,'total-byte-limit');
      else if(stats.limitBytes!==null&&stats.bytes+blob.size>stats.limitBytes)this.skip(stats,'phase-byte-limit');
      else {this.frames.push({sourceIndex,blob,phase});this.bytes+=blob.size;stats.bytes+=blob.size;stats.saved++;}
      resolve();
    },'image/jpeg',.94)).catch(()=>{this.skip(stats,'encode-error');}).finally(()=>this.pending.delete(job));
    this.pending.add(job);
    } catch { this.skip(stats,'encode-error'); }
  }
  summary(){
    return {requested:this.requested,saved:this.frames.length,skipped:this.skipped,bytes:this.bytes,limitBytes:this.limit,
      skippedReasons:{...this.skippedReasons},byPhase:structuredClone(this.byPhase)};
  }
  async finish() {
    await Promise.all(this.pending);
    this.frames.sort((a,b)=>a.sourceIndex-b.sourceIndex);
    return this.frames;
  }
}
