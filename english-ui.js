// Use explicit English labels instead of OS-localized native file-input text.
function decorateFiles(){
 for(const input of document.querySelectorAll('input[type=file]:not([data-picker])')){
  input.dataset.picker='true';input.classList.add('native-file-input');input.tabIndex=-1;
  const box=document.createElement('div');box.className='file-picker';
  const button=document.createElement('button');button.type='button';button.textContent=input.accept.includes('video')?'Choose video':'Choose JSON file';
  const label=document.querySelector(`label[for="${input.id}"]`);button.setAttribute('aria-label',label?.textContent||button.textContent);
  const filename=document.createElement('span');filename.textContent='No file selected';filename.setAttribute('aria-live','polite');
  button.onclick=()=>input.click();input.addEventListener('change',()=>{filename.textContent=input.files?.[0]?.name||'No file selected';});
  const sync=()=>button.disabled=input.disabled;new MutationObserver(sync).observe(input,{attributes:true,attributeFilter:['disabled']});sync();
  box.append(button,filename);input.after(box);
 }
}
decorateFiles();new MutationObserver(decorateFiles).observe(document.body,{childList:true,subtree:true});
