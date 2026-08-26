/* =========================================================
   [9] データ定数・localStorageスキーマ・時間エンジン
   ========================================================= */
const STORAGE_KEY = 'beatpon_v1';
const SCHEMA_VERSION = 1;
const DEFAULT_BPM = 112;
const TONE_LABELS = ['', 'C', 'E', 'G', 'A'];
const TONE_FREQ = [0, 261.63, 329.63, 392.0, 440.0];
const TRACKS = [
  { id:'kick', label:'ドン', icon:'●' },
  { id:'snare', label:'タン', icon:'◆' },
  { id:'hat', label:'チキ', icon:'✦' },
  { id:'tone', label:'ポン', icon:'♪' }
];
const STRINGS = {
  saved:'ほぞんしたよ！',
  restored:'バックアップを復元しました。',
  badPassword:'パスワードがちがいます。',
  webCryptoError:'このブラウザでは安全なパスワード保存機能を使えません。',
  brokenData:'保存データを読み込めませんでした。安全のため初回設定に戻ります。'
};

let db = null;
let screen = 'lock';
let activeProfile = null;
let pattern = makeEmptyPattern();
let bpm = DEFAULT_BPM;
let pageIndex = 0;
let currentWorkId = null;
let dirty = false;
let audioCtx = null;
let noiseBuffer = null;
let schedulerId = null;
let nextNoteTime = 0;
let playStep = 0;
let lastVisualStep = -1;
let sessionTickId = null;
let lastUsageAt = 0;
let lastPersistAt = 0;
let threeMinuteWarned = false;
let closingHandled = false;
let toastTimer = null;
let parentAuthOrigin = 'lock';
let salvagedWorks = [];

const el = id => document.getElementById(id);
const screens = {
  setup:el('setupScreen'), lock:el('lockScreen'), profile:el('profileScreen'), home:el('homeScreen'), maker:el('makerScreen'), gallery:el('galleryScreen')
};

function makeEmptyPattern(){
  return Array.from({length:4},()=>Array(16).fill(0));
}
function clonePattern(src){
  return src.map(row=>row.slice(0,16).map(v=>Number(v)||0));
}
function localDateString(d=new Date()){
  const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function nowIso(){return new Date().toISOString()}
function isValidDb(x){
  return !!(x && x.settings && typeof x.settings.passHash==='string' && Number.isFinite(Number(x.settings.dailyMin)) && Array.isArray(x.settings.names) && x.usage && Array.isArray(x.works));
}
function defaultDb(passHash,dailyMin){
  return {schemaVersion:SCHEMA_VERSION,settings:{passHash,dailyMin,names:['おねえちゃん','おとうと']},usage:{date:localDateString(),usedSec:0,bonusSec:0},works:[]};
}
function saveDb(){
  if(!db) return;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(db));}catch(err){console.error('saveDb',err)}
}
function loadDb(){
  const raw=localStorage.getItem(STORAGE_KEY);
  salvagedWorks=[];
  if(!raw){db=null;return 'missing'}
  try{
    const parsed=JSON.parse(raw);
    if(!isValidDb(parsed)){
      if(Array.isArray(parsed?.works)) salvagedWorks=parsed.works;
      throw new Error('invalid schema');
    }
    db=parsed;
    if(!db.schemaVersion) db.schemaVersion=SCHEMA_VERSION;
    normalizeDb();
    return 'ok';
  }catch(err){
    console.error('loadDb',err); db=null; return 'broken';
  }
}
function normalizeDb(){
  db.settings.dailyMin=Math.max(1,Math.min(240,Number(db.settings.dailyMin)||15));
  db.settings.names=[db.settings.names?.[0]||'おねえちゃん',db.settings.names?.[1]||'おとうと'];
  if(!Array.isArray(db.works)) db.works=[];
  ensureToday();
}
function ensureToday(){
  if(!db) return;
  const today=localDateString();
  if(db.usage.date!==today){
    db.usage={date:today,usedSec:0,bonusSec:0};
    threeMinuteWarned=false; closingHandled=false; saveDb();
  }
}
function remainingSec(){
  if(!db) return 0;
  ensureToday();
  const total=db.settings.dailyMin*60+(Number(db.usage.bonusSec)||0);
  return Math.max(0,Math.floor(total-(Number(db.usage.usedSec)||0)));
}
function usageAllowedScreen(){return screen==='home'||screen==='maker'||screen==='gallery'}
function startUsageEngine(){
  stopUsageEngine();
  lastUsageAt=performance.now(); lastPersistAt=lastUsageAt;
  sessionTickId=setInterval(tickUsage,250);
  tickUsage();
}
function stopUsageEngine(){
  if(sessionTickId){clearInterval(sessionTickId);sessionTickId=null}
  if(db && lastUsageAt && usageAllowedScreen()){
    const now=performance.now();
    const delta=Math.max(0,(now-lastUsageAt)/1000);
    if(delta<5) db.usage.usedSec=(Number(db.usage.usedSec)||0)+delta;
    saveDb();
  }
  lastUsageAt=0;
}
function tickUsage(){
  if(!db) return;
  ensureToday();
  const now=performance.now();
  if(usageAllowedScreen() && !el('closingOverlay').hidden){ lastUsageAt=now; updateTimerUI(); return; }
  if(usageAllowedScreen()){
    const delta=Math.max(0,(now-lastUsageAt)/1000);
    if(delta<5) db.usage.usedSec=(Number(db.usage.usedSec)||0)+delta;
  }
  lastUsageAt=now;
  if(now-lastPersistAt>=10000){saveDb();lastPersistAt=now}
  updateTimerUI();
  const rem=remainingSec();
  if(rem<=180 && rem>0 && !threeMinuteWarned){
    threeMinuteWarned=true; saveDb(); warningBeep(); showToast('あと3ぷん。さいごのひらめきを！');
  }
  if(rem<=0 && !closingHandled && usageAllowedScreen()) handleClosing();
}

async function sha256(text){
  if(!window.crypto?.subtle) throw new Error('WebCrypto unavailable');
  const bytes=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyPassword(value){
  if(!db || !value) return false;
  try{return (await sha256(value))===db.settings.passHash}catch{return false}
}

function setScreen(name){
  stopPlayback();
  stopUsageEngine();
  screen=name;
  Object.entries(screens).forEach(([key,node])=>node.hidden=key!==name);
  window.scrollTo({top:0,behavior:'instant'});
  if(name==='profile') renderProfiles();
  if(name==='home') renderHome();
  if(name==='maker') renderMaker();
  if(name==='gallery') renderGallery();
  if(name==='lock') renderLock();
  renderStudioHeaders();
  if(usageAllowedScreen()) startUsageEngine();
}
function applyTheme(){
  const color=activeProfile===1?'var(--c-cyan)':'var(--c-accent)';
  document.documentElement.style.setProperty('--theme',color);
}
function showToast(message){
  clearTimeout(toastTimer); const t=el('toast'); t.textContent=message; t.classList.add('show');
  toastTimer=setTimeout(()=>t.classList.remove('show'),1800);
}
function formatTime(sec){
  const s=Math.max(0,Math.ceil(sec)); const m=Math.floor(s/60); const r=s%60;
  return `${m}:${String(r).padStart(2,'0')}`;
}
function updateTimerUI(){
  if(!db) return;
  const rem=remainingSec(); const total=db.settings.dailyMin*60+(Number(db.usage.bonusSec)||0); const pct=total?Math.max(0,Math.min(100,rem/total*100)):0;
  document.querySelectorAll('.timer-ring').forEach(r=>{
    r.style.setProperty('--timer-pct',`${pct}%`);
    r.classList.toggle('warning',rem<=180&&rem>60);
    r.classList.toggle('critical',rem<=60);
    const txt=r.querySelector('.timer-text'); if(txt) txt.innerHTML=`<strong>${formatTime(rem)}</strong>のこり`;
  });
}
function renderStudioHeaders(){
  if(activeProfile==null||!db) return;
  document.querySelectorAll('[data-studio-header]').forEach(host=>{
    host.innerHTML=`<div class="studio-bar"><div class="timer-ring"><div class="timer-text"><strong>${formatTime(remainingSec())}</strong>のこり</div></div><div class="studio-meta"><div class="name">${escapeHtml(db.settings.names[activeProfile])}のスタジオ</div><div class="sub">じかんがきたら じどうほぞん</div></div><button class="icon-btn parent-shortcut" type="button" aria-label="おうちのひと用">⚙</button></div>`;
    host.querySelector('.parent-shortcut').addEventListener('click',()=>openParentAuth('studio'));
  });
  updateTimerUI();
}
function escapeHtml(s=''){
  return String(s).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

/* =========================================================
   [1] 初回セットアップ ロジック
   ========================================================= */
el('setupPresets').addEventListener('click',e=>{
  const b=e.target.closest('[data-min]'); if(!b)return; el('setupMinutes').value=b.dataset.min;
});
el('setupSubmit').addEventListener('click',async()=>{
  const pass=el('setupPassword').value; const daily=Number(el('setupMinutes').value); const err=el('setupError'); err.textContent='';
  if(pass.length<4){err.textContent='パスワードは4文字以上にしてください。';return}
  if(!Number.isFinite(daily)||daily<1||daily>240){err.textContent='営業時間は1〜240分で設定してください。';return}
  try{
    const hash=await sha256(pass); db=defaultDb(hash,daily); if(salvagedWorks.length) db.works=salvagedWorks; salvagedWorks=[]; saveDb(); el('setupPassword').value=''; setScreen('lock');
  }catch{err.textContent=STRINGS.webCryptoError}
});

/* =========================================================
   [2] ロック画面 ロジック
   ========================================================= */
function renderLock(){
  if(!db){setScreen('setup');return}
  ensureToday(); const closed=remainingSec()<=0;
  el('lockOpenArea').hidden=closed; el('closedMessage').hidden=!closed;
  el('lockMessage').textContent=closed?'きょうも いっぱい つくったね':'おうちのひとに あけてもらってね';
  el('lockError').textContent=''; el('lockPassword').value='';
}
el('lockSubmit').addEventListener('click',async()=>{
  const ok=await verifyPassword(el('lockPassword').value);
  if(!ok){el('lockError').textContent=STRINGS.badPassword;return}
  if(remainingSec()<=0){renderLock();return}
  el('lockPassword').value=''; setScreen('profile');
});
el('lockPassword').addEventListener('keydown',e=>{if(e.key==='Enter')el('lockSubmit').click()});
el('lockParent').addEventListener('click',()=>openParentAuth('lock'));

/* =========================================================
   [3] プロフィール選択 ロジック
   ========================================================= */
function renderProfiles(){
  if(!db)return;
  el('profileName0').textContent=db.settings.names[0]; el('profileName1').textContent=db.settings.names[1];
}
document.querySelectorAll('.profile').forEach(btn=>btn.addEventListener('click',()=>{
  ensureAudio().catch(()=>{});
  activeProfile=Number(btn.dataset.profile); applyTheme(); resetMaker(); setScreen('home');
}));
el('profileBack').addEventListener('click',()=>{activeProfile=null;setScreen('lock')});

/* =========================================================
   [4] ホーム画面 ロジック
   ========================================================= */
function todaysWorks(profile=activeProfile){
  const today=localDateString();
  return db.works.filter(w=>Number(w.profile)===Number(profile)&&localDateString(new Date(w.createdAt||0))===today);
}
function renderHome(){
  const n=todaysWorks().length; el('todayCount').textContent=n;
  el('todayText').textContent=n===0?'まだ 0こ。さいしょのビートを つくろう。':`きょうは ${n}こ のこってる。ぜんぶ じぶんの音！`;
}
el('goMaker').addEventListener('click',()=>{resetMaker();setScreen('maker')});
el('goGallery').addEventListener('click',()=>setScreen('gallery'));

