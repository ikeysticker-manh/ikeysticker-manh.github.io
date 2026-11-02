
const SIZE=384, FPS=30, MAX=90, GSZ=320, PART=9*1024*1024;
const $=id=>document.getElementById(id);
const ls={get:k=>{try{return localStorage.getItem(k)||''}catch(e){return ''}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
let gifenc=null, lastZipParts=null, lastName='';
// ---- token ----
function showTok(){const t=ls.get('tg_token');$('tokSaved').style.display=t?'block':'none';$('tokBox').style.display=t?'none':'block';}
$('tok').addEventListener('change',e=>{ls.set('tg_token',e.target.value.replace(/\s+/g,''));showTok();});
$('tokSaved').onclick=()=>{$('tokSaved').style.display='none';$('tokBox').style.display='block';$('tok').value=ls.get('tg_token');};
$('by').value=ls.get('share_by');$('by').onchange=e=>ls.set('share_by',e.target.value.trim());
showTok();
// mở từ app cài trên điện thoại (chia sẻ link sticker từ Telegram vào app): điền sẵn link, có token thì tự chạy
(()=>{const q=new URLSearchParams(location.search);const sh=[q.get('link'),q.get('url'),q.get('text'),q.get('title')].filter(Boolean).join(' ');
 const m=sh.match(/addstickers\/([A-Za-z0-9_]{1,64})/);if(m){$('links').value='https://t.me/addstickers/'+m[1];if(ls.get('tg_token'))setTimeout(()=>$('go').click(),400);}})();
function dev(){let d=ls.get('share_dev');if(d.length<32){const a=new Uint8Array(24);crypto.getRandomValues(a);d=btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');ls.set('share_dev',d);}return d;}
const say=(t,c)=>{$('msg').textContent=t;$('msg').style.color=c||'';};
const prog=f=>$('prog').style.width=Math.round(f*100)+'%';
function setName(l){l=(l||'').trim();let m=l.match(/(?:addstickers\/|set=)([A-Za-z0-9_]{1,64})/);if(m)return m[1];return /^[A-Za-z0-9_]{1,64}$/.test(l)?l:'';}
async function tg(tok,method,q){const r=await fetch('https://api.telegram.org/bot'+tok+'/'+method+'?'+new URLSearchParams(q));const j=await r.json();if(!j.ok)throw new Error(j.description||'Telegram từ chối');return j.result;}
async function tgFile(tok,id){const f=await tg(tok,'getFile',{file_id:id});if(!/^[A-Za-z0-9_\-]{1,40}\/[A-Za-z0-9_.\-]{1,80}$/.test(f.file_path))throw new Error('đường dẫn lạ: '+String(f.file_path).slice(0,60));try{const r=await fetch('https://api.telegram.org/file/bot'+tok+'/'+f.file_path);if(r.ok)return new Uint8Array(await r.arrayBuffer());}catch(e){}
 // máy chủ tệp của Telegram không cho trình duyệt tải thẳng (CORS) -> nhờ máy chủ Apps Script tải hộ
 const r=await fetch(SERVER,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'tgfile',bot:tok,path:f.file_path})});
 const j=await r.json();if(j.error)throw new Error(j.error);const bin=atob(j.data);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a;}
// ---- WebP động: ghép các khung WebP tĩnh ----
function le(n,b){const a=[];for(let i=0;i<b;i++)a.push((n>>(8*i))&255);return a;}
function chunk(id,d){const a=[...id].map(c=>c.charCodeAt(0)).concat(le(d.length,4),Array.from(d));if(d.length&1)a.push(0);return a;}
function webpChunks(u8){const out=[];let p=12;while(p+8<=u8.length){const id=String.fromCharCode(...u8.slice(p,p+4));const sz=u8[p+4]|u8[p+5]<<8|u8[p+6]<<16|u8[p+7]<<24;const t=8+sz+(sz&1);if(p+8+sz>u8.length)break;if(id==='ALPH'||id==='VP8 '||id==='VP8L')out.push(...u8.slice(p,Math.min(p+t,u8.length)));p+=t;}return out;}
function muxWebp(frames,w,h,dur){let body=[...'WEBP'].map(c=>c.charCodeAt(0));body=body.concat(chunk('VP8X',[0x12,0,0,0,...le(w-1,3),...le(h-1,3)]));body=body.concat(chunk('ANIM',[0,0,0,0,0,0]));
 for(const f of frames){const d=[...le(0,3),...le(0,3),...le(w-1,3),...le(h-1,3),...le(Math.max(10,dur),3),0x03,...webpChunks(f)];body=body.concat(chunk('ANMF',d));}
 return new Uint8Array([...'RIFF'].map(c=>c.charCodeAt(0)).concat(le(body.length,4),body));}
const dataUrlBytes=u=>{const b=atob(u.split(',')[1]);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;};
// ---- GIF ----
function makeGif(){const {GIFEncoder}=gifenc;return GIFEncoder();}
function gifFrame(enc,ctx,delay,transparent){const {quantize,applyPalette}=gifenc;const im=ctx.getImageData(0,0,GSZ,GSZ).data;
 if(transparent){const pal=quantize(im,256,{format:'rgba4444',oneBitAlpha:true,clearAlpha:true,clearAlphaThreshold:127});const idx=applyPalette(im,pal,'rgba4444');let ti=pal.findIndex(c=>c[3]===0);enc.writeFrame(idx,GSZ,GSZ,{palette:pal,delay,transparent:ti>=0,transparentIndex:Math.max(0,ti),dispose:2});}
 else{const pal=quantize(im,256,{format:'rgb565'});const idx=applyPalette(im,pal,'rgb565');enc.writeFrame(idx,GSZ,GSZ,{palette:pal,delay});}}
// ---- dựng khung: tgs (Lottie) hoặc webm ----
async function renderFrames(kind,bytes,onFrame){const c=$('c');c.width=c.height=SIZE;const ctx=c.getContext('2d');
 if(kind==='tgs'){const json=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();if(json.length>5e6)throw new Error('quá lớn');
  const anim=lottie.loadAnimation({renderer:'canvas',loop:false,autoplay:false,animationData:JSON.parse(json),rendererSettings:{context:ctx,clearCanvas:true,preserveAspectRatio:'xMidYMid meet'}});
  const total=anim.totalFrames,src=anim.frameRate||60,step=src/FPS,n=Math.min(MAX,Math.ceil(total/step));
  for(let i=0;i<n;i++){anim.goToAndStop(Math.min(total-1,i*step),true);await onFrame(c,i,n);}anim.destroy();}
 else{const url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'}));const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.src=url;
  document.body.appendChild(v);v.style.cssText='position:fixed;left:-9999px;width:1px;height:1px';
  await new Promise((ok,bad)=>{const to=setTimeout(()=>bad(new Error('video không tải được (quá 15 giây)')),15000);v.onloadeddata=()=>{clearTimeout(to);ok();};v.onerror=()=>{clearTimeout(to);bad(new Error('trình duyệt không giải mã được video .webm'));};v.load();});
  try{await v.play();v.pause();}catch(e){}
  const dur=isFinite(v.duration)&&v.duration>0?v.duration:3,n=Math.max(1,Math.min(MAX,Math.round(dur*FPS)));
  const vw=v.videoWidth||SIZE,vh=v.videoHeight||SIZE,sc=Math.min(SIZE/vw,SIZE/vh),dw=vw*sc,dh=vh*sc;
  for(let k=0;k<n;k++){await new Promise(ok=>{const to=setTimeout(ok,2000);v.onseeked=()=>{clearTimeout(to);ok();};v.currentTime=Math.min(dur-0.001,k/FPS);});ctx.clearRect(0,0,SIZE,SIZE);ctx.imageSmoothingQuality='high';ctx.drawImage(v,(SIZE-dw)/2,(SIZE-dh)/2,dw,dh);await onFrame(c,k,n);}
  URL.revokeObjectURL(url);v.remove();}}
async function convertAnimated(kind,bytes){
 const webps=[],small=document.createElement('canvas');small.width=small.height=GSZ;const sx=small.getContext('2d');
 const fl=document.createElement('canvas');fl.width=fl.height=GSZ;const fx=fl.getContext('2d');
 const gT=makeGif(),gW=makeGif(),gB=makeGif(),delay=Math.round(1000/FPS);
 await renderFrames(kind,bytes,async(c)=>{webps.push(dataUrlBytes(c.toDataURL('image/webp',0.92)));
  sx.clearRect(0,0,GSZ,GSZ);sx.imageSmoothingQuality='high';sx.drawImage(c,0,0,GSZ,GSZ);gifFrame(gT,sx,delay,true);
  fx.fillStyle='#fff';fx.fillRect(0,0,GSZ,GSZ);fx.drawImage(small,0,0);gifFrame(gW,fx,delay,false);
  fx.fillStyle='#000';fx.fillRect(0,0,GSZ,GSZ);fx.drawImage(small,0,0);gifFrame(gB,fx,delay,false);
  if(webps.length%10===0)await new Promise(r=>setTimeout(r));});
 if(!webps.length)throw new Error('không vẽ được');
 [gT,gW,gB].forEach(g=>g.finish());
 return {webp:muxWebp(webps,SIZE,SIZE,delay),gif:gT.bytes(),tgw:gW.bytes(),tgb:gB.bytes()};}
function addPreview(bytes,anim){const d=document.createElement('div');const im=document.createElement('img');im.src=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));d.appendChild(im);if(anim){const b=document.createElement('b');b.textContent='động';d.appendChild(b);}$('grid').appendChild(d);}
// ---- chia phần zip ----
async function buildParts(items){const parts=[];let z=null,size=0,count=0;
 for(const it of items){if(!z||(it.main&&size>PART-1048576)){if(z)parts.push({zip:z,count});z=new JSZip();size=0;count=0;}z.file(it.name,it.data);size+=it.data.length;if(it.main)count++;}
 if(z)parts.push({zip:z,count});const out=[];for(const p of parts)out.push({b64:await p.zip.generateAsync({type:'base64',compression:'STORE'}),count:p.count});return out;}
const SERVER='https://script.google.com/macros/s/AKfycbzrwq2csr5cogpIZRoOxmkCb9UwvexJaVeUGMvGauOpePZsXleMRp-y_gHuPgQqvhZPhQ/exec';
async function upload(o){const r=await fetch(SERVER,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(o)});const j=await r.json();if(j.error)throw new Error(j.error);return j;}
async function doPack(tok,name){
 say('Đang lấy thông tin bộ '+name+'…');prog(0);$('grid').innerHTML='';
 const set=await tg(tok,'getStickerSet',{name});const st=set.stickers.slice(0,200);const items=[];let ok=0;const errs=[];
 for(let i=0;i<st.length;i++){const s=st[i];const anim=s.is_animated||s.is_video;const base=String(i).padStart(3,'0')+(anim?'a':'');
  say('Đang tải & chuyển '+(i+1)+'/'+st.length+' – '+set.title);prog(i/st.length);
  try{const b=await tgFile(tok,s.file_id);if(b.length>3e6)throw new Error('tệp quá lớn');
   if(!anim){items.push({name:base+'.webp',data:b,main:true});addPreview(b,false);ok++;continue;}
   const r=await convertAnimated(s.is_video?'webm':'tgs',b);
   items.push({name:base+'.webp',data:r.webp,main:true},{name:'gif__'+base+'.gif',data:r.gif},{name:'tgw__'+base+'.gif',data:r.tgw},{name:'tgb__'+base+'.gif',data:r.tgb});
   addPreview(r.webp,true);ok++;}catch(e){console.warn(i,e);errs.push('hình '+(i+1)+' ('+(s.is_video?'video':s.is_animated?'động':'tĩnh')+'): '+(e&&e.message||e));}}
 if(!ok)throw new Error('Không chuyển được hình nào. '+(errs[0]||'')+(errs.length>1?' (và '+(errs.length-1)+' lỗi khác)':''));
 prog(1);say('Đang nén…');const parts=await buildParts(items);lastZipParts={name,items};lastName=name;$('dl').disabled=false;
 if($('auto').checked){for(let i=0;i<parts.length;i++){say('Đang đưa lên kho chung: phần '+(i+1)+'/'+parts.length+'…');
   await upload({key:'vnkey-share-2026',name,count:ok,by:$('by').value.trim(),dev:dev(),part:i+1,parts:parts.length,data:parts[i].b64});}
  say('✓ '+set.title+': '+ok+' hình đã lên kho chung'+(errs.length?' ('+errs.length+' hình lỗi: '+errs[0]+')':'')+'. Trong app: Cài đặt → Sticker & GIF → Kho dùng chung → Tải.','var(--green)');}
 else say('✓ Đã chuyển '+ok+' hình. Bấm "Tải zip về máy" để lưu.','var(--green)');}
$('go').onclick=async()=>{const tok=ls.get('tg_token')||$('tok').value.replace(/\s+/g,'');if(!tok){say('Hãy dán token bot trước','var(--red)');return;}ls.set('tg_token',tok);showTok();
 const names=$('links').value.split(/\n+/).map(setName).filter(Boolean);if(!names.length){say('Hãy dán link dạng https://t.me/addstickers/TenBo','var(--red)');return;}
 $('go').disabled=true;let wl=null;try{wl=await navigator.wakeLock.request('screen');}catch(e){}say('Đang làm… giữ app mở (màn hình sẽ không tự tắt).');try{if(!gifenc)gifenc=await import('./gifenc.esm.js');
  for(const n of names)await doPack(tok,n);}catch(e){say('✕ '+(e.message||e),'var(--red)');}finally{$('go').disabled=false;try{wl&&wl.release();}catch(e){}}};
$('dl').onclick=async()=>{if(!lastZipParts)return;const z=new JSZip();lastZipParts.items.forEach(it=>z.file(it.name,it.data));const b=await z.generateAsync({type:'blob'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=lastName+'.zip';a.click();};
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
