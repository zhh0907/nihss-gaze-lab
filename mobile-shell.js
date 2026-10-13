// Reparent the existing controls and media; never duplicate a stream or a recorder.
const $ = id => document.getElementById(id);
const simulator = !!$('eyeFocus');
const ready = () => simulator ? window.lab : window.gazeLab;
for (let i = 0; i < 600 && !ready(); i++) await new Promise(r => setTimeout(r, 50));
if (ready()) initialize();

function initialize() {
  const breakpoint = matchMedia('(max-width: 900px), (max-width: 1100px) and (pointer: coarse)');
  const original = [...document.body.children].filter(e => ['HEADER', 'NAV', 'MAIN'].includes(e.tagName));
  const homes = new Map();
  const el = (tag, className, text) => {const n=document.createElement(tag);n.className=className;if(text)n.textContent=text;return n;};
  const shell = el('div','mobile-app');shell.id='mobileApp';shell.hidden=true;shell.dataset.app=simulator?'simulator':'gaze';
  const top = el('div','app-topbar');
  const brand = el('div','app-brand');brand.append(el('strong','',simulator?'Motion Lab':'Gaze Lab'),el('span','',simulator?'Hand → eyes':'Eye tracking · Research'));
  const menu = el('button','app-menu','☰ Tools');menu.type='button';menu.setAttribute('aria-haspopup','dialog');menu.setAttribute('aria-controls','appDrawer');
  top.append(brand,menu);
  const workspace=el('div','app-workspace');workspace.setAttribute('aria-label','Live workspace');
  const visuals=el('div','app-visuals');const details=el('div','app-details');
  const status=el('div','app-status');const actions=el('div','app-actions');
  const foot=el('div','app-footnote',simulator?'On-device tracking · No video upload':'Research use · Examiner review required');
  workspace.append(visuals,details);shell.append(top,workspace,status,actions,foot);
  const drawer=document.createElement('dialog');drawer.id='appDrawer';drawer.className='app-drawer';drawer.setAttribute('aria-labelledby','drawerTitle');
  const drawerHead=el('div','drawer-head');const title=el('h2','','Tools');title.id='drawerTitle';
  const close=el('button','drawer-close','✕ Close');close.type='button';close.setAttribute('aria-label','Close tools');drawerHead.append(title,close);
  const tabs=el('nav','drawer-tabs');tabs.setAttribute('aria-label','Tool sections');
  const content=el('div','drawer-content');const panes={};
  const names=simulator?['Setup','Scene','Results','Help']:['Setup','Clips','Review','Help'];
  for(const name of names){
    const button=el('button','',name);button.type='button';button.setAttribute('aria-controls','drawer'+name);
    const pane=el('section','drawer-pane');pane.id='drawer'+name;pane.setAttribute('aria-label',name);pane.hidden=true;
    button.onclick=()=>select(name);tabs.append(button);content.append(pane);panes[name]=pane;
  }
  drawer.append(drawerHead,tabs,content);document.body.append(shell,drawer);
  function select(name){for(const [key,pane]of Object.entries(panes))pane.hidden=key!==name;for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.textContent===name));content.scrollTop=0;window.dispatchEvent(new Event('resize'));}
  function open(name='Setup'){select(name);if(!drawer.open)drawer.showModal();menu.setAttribute('aria-expanded','true');close.focus();}
  function dismiss(){drawer.close();menu.setAttribute('aria-expanded','false');menu.focus({preventScroll:true});}
  menu.onclick=()=>open();close.onclick=dismiss;
  drawer.addEventListener('click',event=>{if(event.target===drawer){const r=drawer.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right)dismiss();}});
  drawer.addEventListener('close',()=>menu.setAttribute('aria-expanded','false'));
  function move(node,host){if(!node)return;if(!homes.has(node)){const marker=document.createComment('desktop position');node.before(marker);homes.set(node,marker);}host.append(node);}
  const help=el('div','app-help');
  help.innerHTML=simulator?'<h2>Use the live view</h2><p>Keep your hand in the camera frame. The eye preview stays above the hand video in portrait, and beside it in landscape.</p><p>Setup contains the camera, model, replay, and calibration controls. Scene contains the optional 3D view. Results contains charts and training comparisons.</p>':'<h2>Record an exam</h2><p>Start the camera, wait for tracking, and select the current exam phase. Record starts both the original video and a video with eye measurements.</p><p>Use Setup to choose MP4 or WebM before recording. Open Clips to replay or download. Review contains movement evidence and the examiner form.</p><p>Eye positions are normalized, not angles. A tracking result alone does not establish an NIHSS score.</p>';
  const guide=el('a','button','Full guide ↗');guide.href='./guide.html';guide.target='_blank';guide.rel='noopener';help.append(guide);panes.Help.append(help);
  let active=false, timer=null, secondary=null;
  const blank=el('div','camera-empty','Start camera, then show your index finger');
  const extra=el('div','app-source-summary');
  const recordGroup=el('div','action-pair');const cameraGroup=el('div','action-pair');
  const clipShortcut=el('button','clip-shortcut','Clips');clipShortcut.type='button';clipShortcut.onclick=()=>open('Clips');
  function mount(){
    if(active)return;active=true;shell.hidden=false;document.body.classList.add('app-mode');
    move($('settings'),panes.Setup);
    if(simulator){
      const section=document.querySelector('main > section');
      move($('eyeFocus'),visuals);move($('cameraPanel'),visuals);move($('view'),panes.Scene);
      move($('cameraStatus'),status);move($('cameraStart'),cameraGroup);move($('cameraStop'),cameraGroup);
      move($('pause'),actions);actions.prepend(cameraGroup);move($('scrub'),details);details.append(extra);
      // Includes asynchronously inserted comparison panels without copying them.
      move(section,panes.Results);
      $('cameraPreview').append(blank);
    }else{
      move(document.querySelector('#live .stage'),visuals);
      move($('sourceBadge'),top);top.insertBefore($('sourceBadge'),menu);
      move(document.querySelector('#live .metrics'),details);
      const phase=el('div','app-phase');move(document.querySelector('label[for="phase"]'),phase);move($('phase'),phase);details.append(phase);
      move($('status'),status);move($('recordIndicator'),details);
      move($('cameraStart'),cameraGroup);move($('stop'),cameraGroup);move($('recordStart'),recordGroup);move($('recordStop'),recordGroup);actions.append(cameraGroup,recordGroup,clipShortcut);
      move($('recordings'),panes.Clips);move($('assessment'),panes.Review);move(document.querySelector('.exports'),panes.Clips);
      // The remaining camera instructions, trace and evidence remain available.
      move(document.querySelector('.measurements'),panes.Review);move(document.querySelector('.notice'),panes.Help);
    }
    for(const node of original)node.classList.add('desktop-content');
    select('Setup');sync();timer=setInterval(sync,200);window.dispatchEvent(new Event('resize'));
  }
  function unmount(){
    if(!active)return;active=false;clearInterval(timer);if(drawer.open)drawer.close();
    // Reverse order restores children before restoring their original parents.
    for(const [node,marker] of [...homes].reverse()){marker.replaceWith(node);}homes.clear();
    blank.remove();if(simulator)$('cameraStatus').hidden=false;for(const node of original)node.classList.remove('desktop-content');
    for(const id of ['cameraStart','cameraStop','stop','recordStart','recordStop'])if($(id))$(id).classList.remove('app-superseded');
    shell.hidden=true;document.body.classList.remove('app-mode');details.querySelector('.app-phase')?.remove();window.dispatchEvent(new Event('resize'));
    for(const v of document.querySelectorAll('video'))if(v.srcObject&&v.paused)v.play().catch(()=>{});
  }
  function pair(start,stop){const playing=$(start).disabled;$(start).classList.toggle('app-superseded',playing);$(stop).classList.toggle('app-superseded',!playing);}
  function text(node,value){if(node.textContent!==value)node.textContent=value;}
  function sync(){
    if(!active)return;
    pair('cameraStart',simulator?'cameraStop':'stop');
    if(simulator){
      const source=$('source').value,camera=source==='camera';shell.dataset.source=source;
      const host=camera?panes.Scene:visuals;if($('view').parentElement!==host)host.append($('view'));
      cameraGroup.hidden=!camera;blank.hidden=!!$('cameraVideo').srcObject;
      $('cameraStatus').hidden=!camera;
      text(extra,camera?'Mirror preview · Yellow marker = fingertip':source==='data'?'Human gaze replay · Change recording in Tools':'Virtual target · Change motion in Tools');
    }else{
      const recording=!$('recordStop').disabled;
      $('recordStart').classList.toggle('app-superseded',recording);$('recordStop').classList.toggle('app-superseded',!recording);
      shell.classList.toggle('is-recording',recording);
      const count=$('recordingList').children.length;text(clipShortcut,count?`Clips (${count})`:'Clips');
    }
  }
  // Closing tools after starting a demo or analysis returns to the live workspace.
  for(const id of simulator?[]:['demo','analyze'])$(id)?.addEventListener('click',()=>{if(active&&drawer.open)dismiss();});
  if(simulator)$('cal-full')?.addEventListener('click',()=>{if(active&&drawer.open)drawer.close();},{capture:true});
  const apply=()=>breakpoint.matches?mount():unmount();breakpoint.addEventListener('change',apply);apply();
}
