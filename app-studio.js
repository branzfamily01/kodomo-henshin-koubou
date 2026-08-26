/* =========================================================
   [5] ビートメーカー ロジック
   ========================================================= */
function resetMaker(){
  pattern=makeEmptyPattern(); bpm=DEFAULT_BPM; pageIndex=0; currentWorkId=null; dirty=false; playStep=0; lastVisualStep=-1;
  if(el('workTitle')) el('workTitle').value='';
}
function renderMaker(){
  el('bpmRange').value=bpm; el('bpmValue').textContent=`${bpm} BPM`; el('editBadge').textContent=currentWorkId?'つづきから へんしん':'あたらしいきょく';
  document.querySelectorAll('.page-btn').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.page)===pageIndex)));
  renderSequence();
}
function renderSequence(){
  const start=pageIndex*8;
  el('stepHead').innerHTML='<div></div>'+Array.from({length:8},(_,i)=>`<div class="step-num ${start+i===lastVisualStep?'current':''}" data-head-step="${start+i}">${start+i+1}</div>`).join('');
  el('sequenceGrid').innerHTML=TRACKS.map((track,t)=>{
    const cells=Array.from({length:8},(_,i)=>{
      const s=start+i; const val=pattern[t][s]; const on=val>0; const tone=t===3; const note=tone&&on?`<span class="note">${TONE_LABELS[val]}</span>`:'';
      return `<button class="step-cell ${tone?'tone':''} ${on?'on':''} ${s===lastVisualStep?'current':''}" type="button" data-track="${t}" data-step="${s}" aria-label="${track.label} ${s+1}ステップ ${on?'オン':'オフ'}">${note}</button>`;
    }).join('');
    return `<div class="track-row"><div class="track-label">${track.icon}<br>${track.label}</div>${cells}</div>`;
  }).join('');
  el('overview').innerHTML=Array.from({length:16},(_,s)=>{
    const active=pattern.some(row=>row[s]>0); return `<span class="${active?'active':''} ${s===lastVisualStep?'playing':''}"></span>`;
  }).join('');
}
el('sequenceGrid').addEventListener('click',async e=>{
  const cell=e.target.closest('.step-cell'); if(!cell)return; await ensureAudio();
  const t=Number(cell.dataset.track),s=Number(cell.dataset.step);
  if(t===3) pattern[t][s]=(pattern[t][s]+1)%5; else pattern[t][s]=pattern[t][s]?0:1;
  dirty=true; previewSound(t,pattern[t][s]||1); renderSequence();
});
document.querySelectorAll('.page-btn').forEach(b=>b.addEventListener('click',()=>{pageIndex=Number(b.dataset.page);renderMaker()}));
el('bpmRange').addEventListener('input',()=>{bpm=Number(el('bpmRange').value);dirty=true;el('bpmValue').textContent=`${bpm} BPM`});
el('bpmMinus').addEventListener('click',()=>changeBpm(-2)); el('bpmPlus').addEventListener('click',()=>changeBpm(2));
function changeBpm(delta){bpm=Math.max(80,Math.min(160,bpm+delta));el('bpmRange').value=bpm;el('bpmValue').textContent=`${bpm} BPM`;dirty=true}
el('playButton').addEventListener('click',async()=>{await ensureAudio();schedulerId?stopPlayback():startPlayback()});
el('makerBack').addEventListener('click',()=>setScreen('home'));
el('saveSeed').addEventListener('click',()=>saveCurrentWork(false)); el('saveDone').addEventListener('click',()=>saveCurrentWork(true));

function nextWorkNo(){return db.works.reduce((m,w)=>Math.max(m,Number(w.no)||0),0)+1}
function saveCurrentWork(doneFlag,{auto=false}={}){
  if(activeProfile==null||!db)return;
  const titleInput=el('workTitle').value.trim();
  if(auto){
    const work={id:crypto.randomUUID?.()||`w_${Date.now()}_${Math.random()}`,no:nextWorkNo(),profile:activeProfile,title:'とちゅうのきょく',bpm,pattern:clonePattern(pattern),doneFlag:false,createdAt:nowIso(),updatedAt:nowIso(),autoSaved:true};
    db.works.push(work); saveDb(); dirty=false; return work;
  }
  let work=currentWorkId?db.works.find(w=>w.id===currentWorkId):null;
  const defaultTitle=work?.title||`きょくNo.${work?.no||nextWorkNo()}`;
  if(work){
    work.title=titleInput||defaultTitle; work.bpm=bpm; work.pattern=clonePattern(pattern); work.doneFlag=!!doneFlag; work.updatedAt=nowIso(); work.autoSaved=false;
  }else{
    const no=nextWorkNo(); work={id:crypto.randomUUID?.()||`w_${Date.now()}_${Math.random()}`,no,profile:activeProfile,title:titleInput||`きょくNo.${no}`,bpm,pattern:clonePattern(pattern),doneFlag:!!doneFlag,createdAt:nowIso(),updatedAt:nowIso(),autoSaved:false}; db.works.push(work); currentWorkId=work.id;
  }
  dirty=false; saveDb(); showToast(STRINGS.saved); setScreen('gallery');
}
function loadWork(work){
  currentWorkId=work.id; pattern=clonePattern(work.pattern); bpm=Math.max(80,Math.min(160,Number(work.bpm)||DEFAULT_BPM)); el('workTitle').value=work.title||''; pageIndex=0; dirty=false; setScreen('maker');
}

async function ensureAudio(){
  if(!audioCtx){audioCtx=new (window.AudioContext||window.webkitAudioContext)(); noiseBuffer=createNoiseBuffer(audioCtx)}
  if(audioCtx.state==='suspended') await audioCtx.resume();
}
function createNoiseBuffer(ctx){
  const buffer=ctx.createBuffer(1,ctx.sampleRate*.2,ctx.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  return buffer;
}
function previewSound(track,val){if(!audioCtx)return;const t=audioCtx.currentTime+.01;triggerTrack(track,t,val)}
function triggerTrack(track,time,val){
  if(!audioCtx)return;
  if(track===0)kick(time); else if(track===1)snare(time); else if(track===2)hat(time); else tone(time,val);
}
function kick(time){
  const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type='sine'; o.frequency.setValueAtTime(150,time);o.frequency.exponentialRampToValueAtTime(46,time+.12);g.gain.setValueAtTime(.8,time);g.gain.exponentialRampToValueAtTime(.001,time+.18);o.connect(g).connect(audioCtx.destination);o.start(time);o.stop(time+.2);
}
function snare(time){
  const src=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();src.buffer=noiseBuffer;f.type='bandpass';f.frequency.value=1800;f.Q.value=.7;g.gain.setValueAtTime(.38,time);g.gain.exponentialRampToValueAtTime(.001,time+.12);src.connect(f).connect(g).connect(audioCtx.destination);src.start(time);src.stop(time+.14);
}
function hat(time){
  const src=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain();src.buffer=noiseBuffer;f.type='highpass';f.frequency.value=6500;g.gain.setValueAtTime(.18,time);g.gain.exponentialRampToValueAtTime(.001,time+.045);src.connect(f).connect(g).connect(audioCtx.destination);src.start(time);src.stop(time+.06);
}
function tone(time,val=1){
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='triangle';o.frequency.value=TONE_FREQ[val]||TONE_FREQ[1];g.gain.setValueAtTime(.22,time);g.gain.exponentialRampToValueAtTime(.001,time+.16);o.connect(g).connect(audioCtx.destination);o.start(time);o.stop(time+.18);
}
function warningBeep(){
  ensureAudio().then(()=>{const t=audioCtx.currentTime+.02; tone(t,4);tone(t+.16,3)}).catch(()=>{});
}
function startPlayback(){
  if(!audioCtx)return; stopPlayback(); el('playButton').textContent='■';el('playButton').setAttribute('aria-label','停止'); nextNoteTime=audioCtx.currentTime+.05; playStep=0; schedulerId=setInterval(scheduleAhead,25); scheduleAhead();
}
function stopPlayback(){
  if(schedulerId){clearInterval(schedulerId);schedulerId=null} lastVisualStep=-1;
  if(el('playButton')){el('playButton').textContent='▶';el('playButton').setAttribute('aria-label','再生')}
  if(screen==='maker')renderSequence();
}
function scheduleAhead(){
  if(!audioCtx||!schedulerId)return;
  while(nextNoteTime<audioCtx.currentTime+.1){
    const step=playStep, t=nextNoteTime;
    for(let tr=0;tr<4;tr++){const val=pattern[tr][step];if(val>0)triggerTrack(tr,t,val)}
    const delay=Math.max(0,(t-audioCtx.currentTime)*1000); setTimeout(()=>visualizeStep(step),delay);
    nextNoteTime+=60/bpm/4; playStep=(playStep+1)%16;
  }
}
function visualizeStep(step){
  if(!schedulerId)return; lastVisualStep=step;
  if(screen==='maker')renderSequence();
}

/* =========================================================
   [6] ギャラリー ロジック
   ========================================================= */
function renderGallery(){
  const works=db.works.filter(w=>Number(w.profile)===Number(activeProfile)).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
  const host=el('galleryList');
  if(!works.length){host.innerHTML='<div class="empty">まだ さくひんが ないよ。<br>さいしょのビートを つくってみよう。</div>';return}
  host.innerHTML=works.map(w=>`<button class="work-card" type="button" data-work-id="${escapeHtml(w.id)}"><span class="work-no">No.${Number(w.no)||'?'}</span><span><div class="work-title">${escapeHtml(w.title||'なまえのないきょく')}${w.doneFlag?'': '<span class="seed-badge">タネ</span>'}</div><div class="work-meta">${formatWorkDate(w.createdAt)} ・ ${Number(w.bpm)||DEFAULT_BPM} BPM</div></span><span aria-hidden="true">→</span></button>`).join('');
}
function formatWorkDate(iso){
  try{const d=new Date(iso);return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}catch{return ''}
}
el('galleryList').addEventListener('click',e=>{const c=e.target.closest('[data-work-id]');if(!c)return;const w=db.works.find(x=>x.id===c.dataset.workId);if(w)loadWork(w)});
el('galleryBack').addEventListener('click',()=>setScreen('home'));

/* =========================================================
   [7] 閉店・延長 ロジック
   ========================================================= */
function handleClosing(){
  closingHandled=true; stopPlayback();
  if(screen==='maker'&&dirty) saveCurrentWork(false,{auto:true});
  saveDb(); renderClosingWorks(); el('closingOverlay').hidden=false; updateTimerUI();
}
function renderClosingWorks(){
  const works=todaysWorks(); el('closingWorks').innerHTML=works.length?works.map(w=>`<span class="today-chip">No.${w.no} ${escapeHtml(w.title)}</span>`).join(''):'<span class="muted">きょうの保存作品はまだありません。</span>';
}
el('showExtend').addEventListener('click',()=>{el('extendBox').hidden=!el('extendBox').hidden;el('extendPassword').focus()});
document.querySelectorAll('[data-extend]').forEach(b=>b.addEventListener('click',async()=>{
  el('extendError').textContent=''; const ok=await verifyPassword(el('extendPassword').value); if(!ok){el('extendError').textContent=STRINGS.badPassword;return}
  const min=Number(b.dataset.extend); db.usage.bonusSec=(Number(db.usage.bonusSec)||0)+min*60; saveDb(); closingHandled=false; threeMinuteWarned=remainingSec()<=180; el('extendPassword').value=''; el('extendBox').hidden=true; el('closingOverlay').hidden=true; showToast(`${min}ぷん のばしました`); lastUsageAt=performance.now(); updateTimerUI();
}));

/* =========================================================
   [8] 親パネル ロジック
   ========================================================= */
function openParentAuth(origin='lock'){
  parentAuthOrigin=origin; stopUsageEngine(); el('parentAuthPassword').value='';el('parentAuthError').textContent='';el('parentAuthModal').hidden=false;setTimeout(()=>el('parentAuthPassword').focus(),30);
}
function closeParentAuth(){el('parentAuthModal').hidden=true;if(usageAllowedScreen())startUsageEngine()}
el('parentAuthClose').addEventListener('click',closeParentAuth);
el('parentAuthSubmit').addEventListener('click',async()=>{
  const ok=await verifyPassword(el('parentAuthPassword').value); if(!ok){el('parentAuthError').textContent=STRINGS.badPassword;return}
  el('parentAuthModal').hidden=true; openParentPanel();
});
el('parentAuthPassword').addEventListener('keydown',e=>{if(e.key==='Enter')el('parentAuthSubmit').click()});
function openParentPanel(){
  stopUsageEngine(); ensureToday(); el('parentPanel').hidden=false; el('parentDailyMin').value=db.settings.dailyMin; el('parentName0').value=db.settings.names[0]; el('parentName1').value=db.settings.names[1]; el('newPassword').value=''; el('parentError').textContent=''; renderParentWorks(); renderUsageSummary();
}
function closeParentPanel(){el('parentPanel').hidden=true;saveDb();renderProfiles();renderStudioHeaders();if(screen==='lock')renderLock();else if(usageAllowedScreen())startUsageEngine()}
el('parentPanelClose').addEventListener('click',closeParentPanel);
function renderUsageSummary(){
  const used=Math.floor(Number(db.usage.usedSec)||0),bonus=Math.floor(Number(db.usage.bonusSec)||0); el('usageSummary').textContent=`きょう使った時間：約 ${Math.floor(used/60)}分 / 追加 ${Math.floor(bonus/60)}分 / のこり ${formatTime(remainingSec())}`;
}
el('saveDailyMin').addEventListener('click',()=>{
  const v=Number(el('parentDailyMin').value);if(!Number.isFinite(v)||v<1||v>240){showToast('1〜240分で入力してください');return}db.settings.dailyMin=v;saveDb();renderUsageSummary();updateTimerUI();showToast('営業時間を保存しました');
});
el('addFiveNow').addEventListener('click',()=>{db.usage.bonusSec=(Number(db.usage.bonusSec)||0)+300;closingHandled=false;saveDb();renderUsageSummary();updateTimerUI();showToast('きょう +5分しました')});
el('saveNames').addEventListener('click',()=>{db.settings.names=[el('parentName0').value.trim()||'おねえちゃん',el('parentName1').value.trim()||'おとうと'];saveDb();renderProfiles();renderStudioHeaders();showToast('名前を保存しました')});
el('savePassword').addEventListener('click',async()=>{
  const p=el('newPassword').value;el('parentError').textContent='';if(p.length<4){el('parentError').textContent='4文字以上にしてください。';return}
  try{db.settings.passHash=await sha256(p);saveDb();el('newPassword').value='';showToast('パスワードを変更しました')}catch{el('parentError').textContent=STRINGS.webCryptoError}
});
function renderParentWorks(){
  const host=el('parentWorks'); const works=[...db.works].sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
  host.innerHTML=works.length?works.map(w=>`<div class="parent-work"><div><strong>No.${w.no} ${escapeHtml(w.title)}</strong><div class="hint">${escapeHtml(db.settings.names[Number(w.profile)]||'')} ・ ${w.doneFlag?'完成':'タネ'}</div></div><button class="btn danger small" type="button" data-delete-work="${escapeHtml(w.id)}">削除</button></div>`).join(''):'<div class="hint">作品はまだありません。</div>';
}
el('parentWorks').addEventListener('click',e=>{
  const b=e.target.closest('[data-delete-work]');if(!b)return;const w=db.works.find(x=>x.id===b.dataset.deleteWork);if(!w)return;
  if(!confirm(`「${w.title}」を削除しますか？\nこの操作は元に戻せません。`))return;db.works=db.works.filter(x=>x.id!==w.id);saveDb();renderParentWorks();showToast('作品を削除しました');
});
el('exportBackup').addEventListener('click',()=>{saveDb();el('backupArea').value=JSON.stringify(db,null,2);el('backupArea').select();showToast('バックアップJSONを表示しました')});
el('restoreBackup').addEventListener('click',()=>{
  const raw=el('backupArea').value.trim();if(!raw){showToast('JSONを貼り付けてください');return}
  try{
    const parsed=JSON.parse(raw);if(!isValidDb(parsed))throw new Error('invalid');
    if(!confirm('現在の設定・作品を、このバックアップ内容で置き換えますか？'))return;db=parsed;normalizeDb();saveDb();activeProfile=null;el('parentPanel').hidden=true;showToast(STRINGS.restored);setScreen('lock');
  }catch{showToast('バックアップJSONを読み込めません')}
});

/* =========================================================
   [9] 起動・安全側フォールバック
   ========================================================= */
function boot(){
  const state=loadDb();
  if(state==='missing'){setScreen('setup');return}
  if(state==='broken'){
    localStorage.removeItem(STORAGE_KEY);setScreen('setup');setTimeout(()=>showToast(salvagedWorks.length?'設定を作り直します。作品データは救出しました。':STRINGS.brokenData),100);return;
  }
  setScreen('lock');
}
window.addEventListener('pagehide',()=>{stopUsageEngine();saveDb()});
window.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopUsageEngine();saveDb()}else if(usageAllowedScreen()&&el('parentPanel').hidden&&el('parentAuthModal').hidden){lastUsageAt=performance.now();startUsageEngine()}
});
window.addEventListener('pointerdown',()=>{if(audioCtx?.state==='suspended')audioCtx.resume().catch(()=>{})},{passive:true});
boot();
