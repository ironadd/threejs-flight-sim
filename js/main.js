import * as THREE from 'three';
import {buildWorld,terrainHeight,RWY,WORLD} from './world.js';
import {buildAircraft,animateAircraft} from './aircraft.js';
import {Sound} from './audio.js';
const $=id=>document.getElementById(id);
const isMobile=matchMedia('(pointer:coarse)').matches;
const LS=localStorage;const qParam=new URLSearchParams(location.search).get('q');
let quality=qParam!==null?+qParam:(LS.fsQ!=null?+LS.fsQ:(isMobile?1:2));
const QN=['低','中','高'];
const opt={assist:LS.fsAssist!=='0',invert:LS.fsInvert==='1'};
// ---------- 渲染器 ----------
const renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:quality>0,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,[1,1.5,2][quality]));
renderer.shadowMap.enabled=quality>0;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.6;renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(62,1,.3,40000);
const world=buildWorld(scene,renderer,quality);
const plane=buildAircraft();scene.add(plane);
const snd=new Sound();
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
// ---------- 飞行状态 ----------
const S={pos:new THREE.Vector3(),vel:new THREE.Vector3(),quat:new THREE.Quaternion(),throttle:0,rpm:0,pitch:0,roll:0,yaw:0,
  flaps:0,flapPos:0,gearDown:true,gearRetract:0,brake:false,onGround:true,alive:true,paused:false,stall:false,aoa:0,started:false};
const FLAPS=[0,10,20,30];
function reset(mode='air'){
  S.quat.identity();S.alive=true;S.brake=false;S.stall=false;
  if(mode==='air'){S.pos.set(0,320,3200);S.vel.set(0,0,-56);S.throttle=.7;S.rpm=.75;S.flaps=0;S.flapPos=0;S.gearDown=false;S.gearRetract=1;S.onGround=false;
    toast('已在空中 · 前方是机场跑道');}
  else{S.pos.set(0,RWY.elev+plane.userData.gearH,RWY.len/2-60);S.vel.set(0,0,0);S.throttle=0;S.rpm=.18;S.flaps=1;S.flapPos=1/3;S.gearDown=true;S.gearRetract=0;S.onGround=true;
    toast('把油门推到底，速度到 100km/h 会自动抬头离地',4);}
  S.pitch=S.roll=S.yaw=0;thrUI(S.throttle);$('crashOv').style.display='none';plane.visible=true;debris.visible=false;camPos.copy(S.pos).add(new THREE.Vector3(0,5,22));updStatus();}
// 坠毁碎片/火焰
const debris=new THREE.Group();scene.add(debris);debris.visible=false;
const fireM=new THREE.MeshBasicMaterial({color:0xff6a00,transparent:true,opacity:.8});const smokeM=new THREE.MeshBasicMaterial({color:0x333333,transparent:true,opacity:.5,depthWrite:false});
const parts=[];for(let i=0;i<40;i++){const m=new THREE.Mesh(new THREE.IcosahedronGeometry(1,0),i<15?fireM:smokeM);debris.add(m);parts.push({m,v:new THREE.Vector3(),life:0});}
const crashPos=new THREE.Vector3();
function crash(reason){if(!S.alive)return;S.alive=false;snd.crash();plane.visible=false;debris.visible=true;crashPos.copy(S.pos);
  parts.forEach(p=>{p.m.position.copy(S.pos);p.v.set((Math.random()-.5)*20,Math.random()*15,(Math.random()-.5)*20);p.life=Math.random()*3;});
  $('crashTxt').textContent='坠毁'+reason;setTimeout(()=>{if(!S.alive)$('crashOv').style.display='flex';},1200);}
// ---------- 物理 ----------
const MASS=950,AREA=16.2,G=9.81,TMAX=5200;
const fwd=new THREE.Vector3(),up=new THREE.Vector3(),right=new THREE.Vector3(),F=new THREE.Vector3(),tmp=new THREE.Vector3(),tq=new THREE.Quaternion(),Y=new THREE.Vector3(0,1,0);
const clamp=THREE.MathUtils.clamp;
function physics(dt,inp){
  S.pitch+=(inp.pitch-S.pitch)*Math.min(dt*8,1);S.roll+=(inp.roll-S.roll)*Math.min(dt*8,1);S.yaw+=(inp.yaw-S.yaw)*Math.min(dt*8,1);
  S.rpm+=((S.alive?0.18+S.throttle*0.82:0)-S.rpm)*Math.min(dt*1.5,1);
  S.flapPos+=(FLAPS[S.flaps]/30-S.flapPos)*Math.min(dt*1.2,1);
  S.gearRetract+=((S.gearDown?0:1)-S.gearRetract)*Math.min(dt*.9,1);if(Math.abs(S.gearRetract-(S.gearDown?0:1))<.01)S.gearRetract=S.gearDown?0:1;
  if(!S.alive)return;
  fwd.set(0,0,-1).applyQuaternion(S.quat);up.set(0,1,0).applyQuaternion(S.quat);right.set(1,0,0).applyQuaternion(S.quat);
  const V=S.vel.length(),rho=1.225*Math.exp(-S.pos.y/9000),q=.5*rho*V*V;
  const vf=S.vel.dot(fwd),vu=S.vel.dot(up),vr=S.vel.dot(right);
  const alpha=V>2?Math.atan2(-vu,Math.max(vf,.1)):0,beta=V>2?Math.atan2(vr,Math.max(vf,.1)):0;S.aoa=alpha;
  const crit=.27+S.flapPos*.02,cl0=.42+S.flapPos*.6;let CL=cl0+5.2*alpha;
  if(alpha>crit)CL=(cl0+5.2*crit)*Math.max(.35,1-(alpha-crit)*4);if(alpha<-.25)CL=cl0-5.2*.25;
  S.stall=alpha>crit-.03&&V>5&&!S.onGround;
  const CD=.026+.042*CL*CL+S.flapPos*.05+(1-S.gearRetract)*.016+(alpha>crit?.15:0);
  F.set(0,-MASS*G,0);
  if(V>.5){const vd=tmp.copy(S.vel).divideScalar(V);const ld=new THREE.Vector3().crossVectors(right,vd).normalize();
    F.addScaledVector(ld,q*AREA*CL);F.addScaledVector(vd,-q*AREA*CD);F.addScaledVector(right,-q*AREA*.9*Math.sin(beta));}
  const thrust=TMAX*S.throttle*Math.max(.3,1-V/100)*Math.min(S.rpm/(0.18+S.throttle*.82+1e-3),1);F.addScaledVector(fwd,thrust);
  const gh=Math.max(terrainHeight(S.pos.x,S.pos.z),0),clearance=S.gearRetract<.5?plane.userData.gearH:.75;
  const wasGround=S.onGround;S.onGround=S.pos.y<=gh+clearance+(wasGround?.05:0)&&!(wasGround&&S.vel.y>0.3);
  const eff=Math.min(.15+q/900,1.6);
  const pitchNow=Math.asin(clamp(fwd.y,-1,1)),bank=Math.atan2(-right.y,up.y);
  let pIn=S.pitch,rIn=S.roll;
  // —— 飞行辅助：失速保护 + 自动改平 + 姿态保持 ——
  if(opt.assist&&!S.onGround){
    if(alpha>crit-.07&&pIn>0)pIn*=Math.max(0,1-(alpha-(crit-.07))/.05);
    if(V<30)pIn=Math.min(pIn,-(30-V)*.03);
    bankLimit:{const lim=1.05;if(bank>lim&&rIn<0)rIn=0;if(bank<-lim&&rIn>0)rIn=0;}
  }
  let wp=pIn*1.1*eff, wr=-rIn*2.1*eff, wy=-S.yaw*.45*eff;
  if(!S.onGround){wp+=-(alpha-0.05)*1.5*eff;}
  wy+=-beta*2.5*eff;
  if(opt.assist&&!S.onGround){
    if(Math.abs(S.roll)<.08)wr+=bank*1.2*Math.min(eff,1);                 // 自动改平
    if(Math.abs(S.pitch)<.08){const agl0=S.pos.y-gh,tv=(agl0<150&&S.throttle>.6)?3:0;wp+=clamp((tv-S.vel.y)*.3-(pitchNow>.35?pitchNow-.35:0),-.3,.3);} // 保持高度（低空时保持爬升）
    wy+=-Math.sin(bank)*.25;                                                  // 协调转弯
    if(Math.abs(bank)>.15)wp+=Math.abs(Math.sin(bank))*.12*eff;               // 转弯带杆
  }else if(!S.onGround){wy+=-Math.sin(bank)*.12;}
  if(S.stall){wp-=.35;wr+=Math.sin(performance.now()*.003)*.4*(opt.assist?.2:1);}
  if(S.onGround){
    const onRwy=Math.abs(S.pos.x)<RWY.w/2+3&&Math.abs(S.pos.z)<RWY.len/2+5;
    const vh=Math.hypot(S.vel.x,S.vel.z);
    if(!wasGround){const vs=-S.vel.y;
      if(terrainHeight(S.pos.x,S.pos.z)<0.5){crash('（落水）');return;}
      if(S.gearRetract>.5&&(vs>1.5||vh>25)){crash('（未放起落架）');return;}
      if(vs>(opt.assist?8:6.5)){crash('（下沉率过大）');return;}
      const rollDeg=Math.abs(Math.asin(clamp(right.y,-1,1)))*57.3;
      if(rollDeg>25||pitchNow*57.3<-8){crash('（姿态异常）');return;}
      snd.touchdown(vs/6);toast(vs<1.5?'完美着陆！':'着陆');}
    if(!onRwy&&vh>15&&terrainNormal(S.pos.x,S.pos.z).y<.96){crash('（撞击地形）');return;}
    if(terrainHeight(S.pos.x,S.pos.z)<0.3){crash('（落水）');return;}
    S.pos.y=gh+clearance;if(S.vel.y<0)S.vel.y=0;
    const mu=(onRwy?.02:.07)+(S.brake?.55:0);
    const fv=tmp.copy(fwd).setY(0).normalize(),along=S.vel.dot(fv);
    F.addScaledVector(fv,-Math.sign(along)*Math.min(mu*MASS*G,Math.abs(along)*MASS/dt*.5));
    const side=new THREE.Vector3().crossVectors(fv,Y),lat=S.vel.dot(side);S.vel.addScaledVector(side,-lat*Math.min(dt*8,1));
    wy+=-S.yaw*clamp(vh/8,0,1)*.6;
    // 起飞辅助：速度够了自动抬头（拉杆可更早抬头，推杆可阻止）
    let tgt=0;if(pIn>.05&&vh>18)tgt=.2*pIn;
    if(opt.assist&&vh>25&&pIn>-.3)tgt=Math.max(tgt,.2);
    wp=(tgt-pitchNow)*2.5;wr=Math.asin(clamp(right.y,-1,1))*4;
    if(S.gearRetract>.5&&vh>2)S.vel.multiplyScalar(1-dt*1.5);
  }
  S.vel.addScaledVector(F,dt/MASS);S.pos.addScaledVector(S.vel,dt);
    tq.setFromAxisAngle(tmp.set(1,0,0),wp*dt);S.quat.multiply(tq);tq.setFromAxisAngle(tmp.set(0,0,1),wr*dt);S.quat.multiply(tq);tq.setFromAxisAngle(tmp.set(0,1,0),wy*dt);S.quat.multiply(tq);S.quat.normalize();
  if(!S.onGround&&V>5){S.vel.lerp(tmp.copy(fwd).multiplyScalar(V),Math.min(dt*.5*eff,0.04));}
  const th=terrainHeight(S.pos.x,S.pos.z);
  if(!S.onGround&&S.pos.y<Math.max(th,0)+.6)crash(th<0.5?'（落水）':'（撞击地形）');
  const lim=WORLD*.42;if(Math.abs(S.pos.x)>lim||Math.abs(S.pos.z)>lim){if(!S._edge){toast('已到达地图边界，请掉头');S._edge=1;}}else S._edge=0;
}
function terrainNormal(x,z){const e=3;return new THREE.Vector3(terrainHeight(x-e,z)-terrainHeight(x+e,z),2*e,terrainHeight(x,z-e)-terrainHeight(x,z+e)).normalize();}
// ---------- 触屏输入（Pointer Events，多点触控各自独立）----------
const inp={pitch:0,roll:0,yaw:0};const joy={x:0,y:0,id:null};const keys={};const tilt={on:false,b0:0,g0:0,b:0,g:0};
const jEl=$('joy'),kEl=$('knob');
function joyMove(e){const r=jEl.getBoundingClientRect(),R=r.width/2;let dx=e.clientX-r.left-R,dy=e.clientY-r.top-R;const d=Math.hypot(dx,dy),M=R*.75;if(d>M){dx*=M/d;dy*=M/d;}
  joy.x=dx/M;joy.y=dy/M;kEl.style.transform=`translate(${dx}px,${dy}px)`;}
jEl.addEventListener('pointerdown',e=>{e.preventDefault();joy.id=e.pointerId;try{jEl.setPointerCapture(e.pointerId);}catch(_){}joyMove(e);});
jEl.addEventListener('pointermove',e=>{if(e.pointerId===joy.id){e.preventDefault();joyMove(e);}});
const joyEnd=e=>{if(e.pointerId!==joy.id)return;joy.id=null;joy.x=joy.y=0;kEl.style.transform='';};
['pointerup','pointercancel','lostpointercapture'].forEach(t=>jEl.addEventListener(t,joyEnd));
const tW=$('thrWrap');let thrId=null;
function thrUI(v){S.throttle=v;const h=tW.clientHeight||170;$('thrFill').style.height=(v*100)+'%';$('thrKnob').style.top=((1-v)*(h-34)+4)+'px';$('thrTxt').textContent=Math.round(v*100)+'%';}
function thrMove(e){const r=tW.getBoundingClientRect();thrUI(clamp(1-(e.clientY-r.top-17)/(r.height-34),0,1));}
tW.addEventListener('pointerdown',e=>{e.preventDefault();thrId=e.pointerId;try{tW.setPointerCapture(e.pointerId);}catch(_){}thrMove(e);});
tW.addEventListener('pointermove',e=>{if(e.pointerId===thrId){e.preventDefault();thrMove(e);}});
['pointerup','pointercancel','lostpointercapture'].forEach(t=>tW.addEventListener(t,e=>{if(e.pointerId===thrId)thrId=null;}));
// 阻止 iOS 滚动/缩放
document.addEventListener('touchmove',e=>{if(e.cancelable)e.preventDefault();},{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault());
const hold={L:false,R:false};
function holdBtn(id,k){const b=$(id);b.addEventListener('pointerdown',e=>{e.preventDefault();hold[k]=true;b.classList.add('on');snd.click();});['pointerup','pointercancel','pointerleave'].forEach(t=>b.addEventListener(t,()=>{hold[k]=false;b.classList.remove('on');}));}
holdBtn('bRudL','L');holdBtn('bRudR','R');
function tap(id,fn){$(id).addEventListener('click',e=>{snd.click();fn();});}
const toggleFlaps=()=>{S.flaps=(S.flaps+1)%4;snd.flap();updStatus();};
const toggleGear=()=>{if(S.onGround&&S.gearDown){toast('地面上无法收起起落架');return;}S.gearDown=!S.gearDown;snd.gear();updStatus();};
const toggleBrake=()=>{S.brake=!S.brake;updStatus();};
tap('bFlap',toggleFlaps);tap('bGear',toggleGear);tap('bBrake',toggleBrake);
const CAMS=['追尾','座舱','环绕','飞掠'];let cam=0;const nextCam=()=>{cam=(cam+1)%4;$('camName').textContent=CAMS[cam];if(cam===3)placeFlyby();look.yaw=0;};
tap('btnCam',nextCam);tap('btnCam2',nextCam);
const drawer=$('drawer');tap('btnMenu',()=>{drawer.classList.toggle('open');$('btnMenu').classList.toggle('on');});
const closeDrawer=()=>{drawer.classList.remove('open');$('btnMenu').classList.remove('on');};
tap('btnReset',()=>{reset('air');closeDrawer();});tap('btnRwy',()=>{reset('rwy');closeDrawer();});
tap('btnRestart',()=>reset('air'));tap('btnRestartRwy',()=>reset('rwy'));
tap('btnHome',()=>{closeDrawer();S.started=false;$('hud').style.display='none';$('start').style.display='flex';});
const setPause=p=>{S.paused=p;$('btnPause').innerHTML=`<svg class="ic"><use href="#i-${p?'play':'pause'}"/></svg>`;$('pauseOv').style.display=p?'flex':'none';if(snd.ctx)p?snd.ctx.suspend():snd.ctx.resume();};
const togglePause=()=>setPause(!S.paused);tap('btnPause',togglePause);tap('btnResume',()=>setPause(false));
const toggleMute=()=>{snd.setMuted(!snd.muted);$('btnMute').innerHTML=`<svg class="ic"><use href="#i-${snd.muted?'mute':'sound'}"/></svg>${snd.muted?'已静音':'声音'}`;};tap('btnMute',toggleMute);
const syncOpts=()=>{$('btnAssist').classList.toggle('on',opt.assist);$('btnInvert').classList.toggle('on',opt.invert);$('optAssist').checked=opt.assist;$('optInvert').checked=opt.invert;LS.fsAssist=opt.assist?1:0;LS.fsInvert=opt.invert?1:0;};
tap('btnAssist',()=>{opt.assist=!opt.assist;syncOpts();toast('飞行辅助：'+(opt.assist?'开':'关'));});
tap('btnInvert',()=>{opt.invert=!opt.invert;syncOpts();toast(opt.invert?'俯仰已反转：上推抬头':'俯仰默认：下拉抬头');});
$('optAssist').onchange=e=>{opt.assist=e.target.checked;syncOpts();};$('optInvert').onchange=e=>{opt.invert=e.target.checked;syncOpts();};
$('optQ').value=quality;$('optQ').onchange=e=>{LS.fsQ=e.target.value;location.href=location.pathname;};
$('btnQ').textContent='画质：'+QN[quality];tap('btnQ',()=>{LS.fsQ=(quality+1)%3;location.href=location.pathname;});
syncOpts();
tap('btnTilt',async()=>{if(!tilt.on){try{if(typeof DeviceOrientationEvent!=='undefined'&&DeviceOrientationEvent.requestPermission){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted'){toast('未获得陀螺仪权限');return;}}}catch(e){}
  tilt.on=true;tilt.cal=true;toast('重力感应已开启（当前姿势为中立）');}else tilt.on=false;$('btnTilt').classList.toggle('on',tilt.on);});
addEventListener('deviceorientation',e=>{if(e.beta==null)return;const ang=(screen.orientation&&screen.orientation.angle)||window.orientation||0;
  let p,r;if(ang===90){p=-e.gamma;r=e.beta;}else if(ang===-90||ang===270){p=e.gamma;r=-e.beta;}else{p=e.beta;r=e.gamma;}
  if(tilt.cal){tilt.b0=p;tilt.g0=r;tilt.cal=false;}tilt.b=p;tilt.g=r;});
async function goFull(){const d=document,el=d.documentElement;const rq=el.requestFullscreen||el.webkitRequestFullscreen;
  if(!rq){toast('iPhone 请点击「分享 → 添加到主屏幕」以全屏游玩',4);return;}
  try{await rq.call(el,{navigationUI:'hide'});}catch(e){}try{await screen.orientation.lock('landscape');}catch(e){}}
tap('btnFull',()=>{const d=document;if(d.fullscreenElement||d.webkitFullscreenElement)(d.exitFullscreen||d.webkitExitFullscreen).call(d);else goFull();});
addEventListener('keydown',e=>{keys[e.code]=true;snd.unlock();const k=e.code;
  if(k==='KeyF')toggleFlaps();if(k==='KeyG')toggleGear();if(k==='KeyB')toggleBrake();if(k==='KeyC')nextCam();if(k==='KeyR')reset('air');if(k==='KeyT')reset('rwy');if(k==='KeyP')togglePause();if(k==='KeyM')toggleMute();
  if(k.startsWith('Digit')){const n=+k.slice(5);thrUI(n===0?1:n/10);}});
addEventListener('keyup',e=>keys[e.code]=false);
// 在画面空白处拖动：旋转视角
const look={yaw:0,pitch:.12,dist:20,id:null,lx:0,ly:0};
$('c').addEventListener('pointerdown',e=>{look.id=e.pointerId;look.lx=e.clientX;look.ly=e.clientY;closeDrawer();});
addEventListener('pointermove',e=>{if(e.pointerId!==look.id)return;look.yaw-=(e.clientX-look.lx)*.008;look.pitch=clamp(look.pitch+(e.clientY-look.ly)*.006,-1.2,1.4);look.lx=e.clientX;look.ly=e.clientY;});
addEventListener('pointerup',e=>{if(e.pointerId===look.id)look.id=null;});addEventListener('pointercancel',e=>{if(e.pointerId===look.id)look.id=null;});
$('c').addEventListener('wheel',e=>{look.dist=clamp(look.dist+e.deltaY*.02,8,80);},{passive:true});
function readInput(dt){
  let p=joy.y,r=joy.x,y=(hold.R?1:0)-(hold.L?1:0);  // p>0：摇杆向下
  if(keys.KeyS||keys.ArrowDown)p=1;if(keys.KeyW||keys.ArrowUp)p=-1;
  if(keys.KeyA||keys.ArrowLeft)r=-1;if(keys.KeyD||keys.ArrowRight)r=1;if(keys.KeyQ)y=-1;if(keys.KeyE)y=1;
  if(keys.ShiftLeft||keys.ShiftRight)thrUI(Math.min(S.throttle+dt*.5,1));if(keys.ControlLeft||keys.ControlRight)thrUI(Math.max(S.throttle-dt*.5,0));
  if(tilt.on&&joy.id===null){p=clamp((tilt.b-tilt.b0)/25,-1,1);r=clamp((tilt.g-tilt.g0)/30,-1,1);}
  const cur=v=>Math.sign(v)*v*v*.6+v*.4;
  inp.pitch=cur(p)*(opt.invert?-1:1);   // 默认：下拉 = 抬头
  inp.roll=cur(r);inp.yaw=y;
}
// ---------- HUD ----------
let toastT=0;function toast(t,s=2.5){const e=$('toast');e.textContent=t;e.classList.add('show');toastT=s;}
function updStatus(){$('stFlap').textContent='襟翼 '+FLAPS[S.flaps]+'°';$('stGear').textContent=S.gearDown?'起落架↓':'起落架↑';$('bGear').classList.toggle('on',S.gearDown);$('bBrake').classList.toggle('on',S.brake);$('bFlap').classList.toggle('on',S.flaps>0);}
const cmp=$('compass').getContext('2d'),adi=$('adi').getContext('2d'),mini=$('mini').getContext('2d');
const mapC=document.createElement('canvas');mapC.width=mapC.height=256;{const m=mapC.getContext('2d'),img=m.createImageData(256,256);
  for(let j=0;j<256;j++)for(let i=0;i<256;i++){const x=(i/256-.5)*WORLD,z=(j/256-.5)*WORLD,h=terrainHeight(x,z),o=(j*256+i)*4;
    const c=h<0?[28,92,140]:h<6?[214,200,150]:h<200?[86,140,70]:h<500?[60,105,60]:h<700?[130,122,112]:[235,238,242];
    const sh=h>0?clamp(1+(terrainHeight(x-30,z-30)-h)*.01,.7,1.25):1;img.data.set([c[0]*sh,c[1]*sh,c[2]*sh,255],o);}
  m.putImageData(img,0,0);m.fillStyle='#e8e8e8';const s=256/WORLD;m.fillRect(128-1,128-RWY.len/2*s,2.5,RWY.len*s);}
let hudN=0;
function drawHUD(){
  fwd.set(0,0,-1).applyQuaternion(S.quat);right.set(1,0,0).applyQuaternion(S.quat);up.set(0,1,0).applyQuaternion(S.quat);
  const hdg=(Math.atan2(fwd.x,-fwd.z)*57.3+360)%360,pitch=Math.asin(clamp(fwd.y,-1,1)),roll=Math.atan2(right.y,up.y);
  const agl=S.pos.y-Math.max(terrainHeight(S.pos.x,S.pos.z),0)-(S.gearRetract<.5?plane.userData.gearH:.75);
  if((hudN++&3)===0){$('spd').textContent=(S.vel.length()*3.6).toFixed(0);$('alt').textContent=S.pos.y.toFixed(0);$('vs').textContent=(S.vel.y>0?'+':'')+S.vel.y.toFixed(1);}
  // 罗盘带
  const W=520,H=64;cmp.clearRect(0,0,W,H);const gr=cmp.createLinearGradient(0,0,W,0);gr.addColorStop(0,'rgba(16,24,40,0)');gr.addColorStop(.2,'rgba(16,24,40,.5)');gr.addColorStop(.8,'rgba(16,24,40,.5)');gr.addColorStop(1,'rgba(16,24,40,0)');
  cmp.fillStyle=gr;cmp.beginPath();cmp.roundRect(0,0,W,H,20);cmp.fill();cmp.strokeStyle='rgba(255,255,255,.75)';cmp.lineWidth=2;cmp.font='600 22px -apple-system,sans-serif';cmp.textAlign='center';
  const names={0:'N',90:'E',180:'S',270:'W'};for(let d=-60;d<=60;d+=5){const a=Math.round(hdg/5)*5+d,x=W/2+(a-hdg)*4,an=((a%360)+360)%360;cmp.globalAlpha=1-Math.abs(x-W/2)/(W/2);cmp.beginPath();cmp.moveTo(x,H-4);cmp.lineTo(x,H-(an%10?10:18));cmp.stroke();
    if(an%30===0){cmp.fillStyle=names[an]?'#38bdf8':'#fff';cmp.fillText(names[an]||(an/10),x,30);}}
  cmp.globalAlpha=1;cmp.fillStyle='#f59e0b';cmp.beginPath();cmp.moveTo(W/2-8,H);cmp.lineTo(W/2+8,H);cmp.lineTo(W/2,H-12);cmp.fill();
  // 姿态仪
  const R=100;adi.save();adi.clearRect(0,0,200,200);adi.beginPath();adi.arc(R,R,R-3,0,7);adi.clip();adi.translate(R,R);adi.rotate(-roll);const py=pitch*57.3*3;
  let g1=adi.createLinearGradient(0,-200+py,0,py);g1.addColorStop(0,'#1e5fa8');g1.addColorStop(1,'#5aa9e6');adi.fillStyle=g1;adi.fillRect(-200,-300+py,400,300);
  g1=adi.createLinearGradient(0,py,0,py+200);g1.addColorStop(0,'#8b5a2b');g1.addColorStop(1,'#4a2e14');adi.fillStyle=g1;adi.fillRect(-200,py,400,300);
  adi.strokeStyle='#fff';adi.lineWidth=2.5;adi.beginPath();adi.moveTo(-200,py);adi.lineTo(200,py);adi.stroke();
  adi.lineWidth=2;adi.font='600 14px sans-serif';adi.fillStyle='#fff';adi.textAlign='left';for(let d=-30;d<=30;d+=10){if(!d)continue;const y=py-d*3,w=d%20?16:28;adi.beginPath();adi.moveTo(-w,y);adi.lineTo(w,y);adi.stroke();if(!(d%20))adi.fillText(Math.abs(d),w+4,y+5);}
  adi.restore();adi.strokeStyle='#f59e0b';adi.lineWidth=5;adi.lineCap='round';adi.beginPath();adi.moveTo(R-50,R);adi.lineTo(R-18,R);adi.lineTo(R-9,R+9);adi.moveTo(R+50,R);adi.lineTo(R+18,R);adi.lineTo(R+9,R+9);adi.stroke();
  adi.fillStyle='#f59e0b';adi.beginPath();adi.arc(R,R,4,0,7);adi.fill();
  adi.beginPath();adi.arc(R,R,R-3,0,7);adi.strokeStyle='rgba(255,255,255,.85)';adi.lineWidth=5;adi.stroke();
  // 小地图（航向朝上）
  mini.save();mini.clearRect(0,0,200,200);mini.beginPath();mini.arc(100,100,97,0,7);mini.clip();mini.translate(100,100);mini.rotate(-hdg/57.3);
  const s=256/WORLD;mini.scale(4.5,4.5);mini.imageSmoothingEnabled=true;mini.drawImage(mapC,-(S.pos.x*s+128),-(S.pos.z*s+128));mini.restore();
  mini.fillStyle='#f59e0b';mini.strokeStyle='#000';mini.lineWidth=1;mini.beginPath();mini.moveTo(100,84);mini.lineTo(110,110);mini.lineTo(100,104);mini.lineTo(90,110);mini.closePath();mini.fill();mini.stroke();
  mini.fillStyle='#fff';mini.font='700 18px sans-serif';mini.textAlign='center';const nA=-hdg/57.3;mini.fillText('N',100+Math.sin(nA)*80,106-Math.cos(nA)*80);
  mini.beginPath();mini.arc(100,100,97,0,7);mini.strokeStyle='rgba(255,255,255,.85)';mini.lineWidth=5;mini.stroke();
  const w=$('warn');let txt='';
  if(S.alive&&!S.onGround){if(S.stall)txt='⚠ 失速 STALL';else if(agl<60&&S.vel.y<-5)txt='⚠ 拉起 PULL UP';else if(agl<80&&S.gearRetract>.5&&S.vel.y<-1)txt='⚠ 起落架未放下';}
  if(w.textContent!==txt)w.textContent=txt;
}
// ---------- 相机 ----------
const camPos=new THREE.Vector3(),camTarget=new THREE.Vector3(),flyby=new THREE.Vector3();
function placeFlyby(){fwd.set(0,0,-1).applyQuaternion(S.quat);flyby.copy(S.pos).addScaledVector(S.vel.lengthSq()>4?S.vel.clone().normalize():fwd,180).add(new THREE.Vector3(25,8,0));flyby.y=Math.max(flyby.y,terrainHeight(flyby.x,flyby.z)+4);}
function yawOnly(){fwd.set(0,0,-1).applyQuaternion(S.quat);return new THREE.Quaternion().setFromAxisAngle(Y,Math.atan2(-fwd.x,-fwd.z));}
function updateCamera(dt){
  const p=S.alive?S.pos:crashPos;
  if(cam===0){const d=look.dist,off=new THREE.Vector3(Math.sin(look.yaw)*d*Math.cos(look.pitch),Math.sin(look.pitch)*d+2.5,Math.cos(look.yaw)*d*Math.cos(look.pitch)).applyQuaternion(yawOnly());
    camPos.lerp(tmp.copy(p).add(off),1-Math.exp(-dt*5));camera.position.copy(camPos);camTarget.lerp(tmp.copy(p).addScaledVector(fwd.set(0,0,-1).applyQuaternion(S.quat),12),1-Math.exp(-dt*10));camera.up.set(0,1,0);camera.lookAt(camTarget);
    if(look.id===null)look.yaw*=Math.exp(-dt*1.5);}
  else if(cam===1){camera.position.copy(tmp.set(0,.92,-.9).applyQuaternion(S.quat).add(p));camera.quaternion.copy(S.quat);camera.rotateX(-.06);camera.rotateY(look.yaw);}
  else if(cam===2){if(look.id===null)look.yaw+=dt*.25;const d=look.dist*1.3;camera.position.set(p.x+Math.sin(look.yaw)*d*Math.cos(look.pitch),p.y+Math.sin(look.pitch)*d+2,p.z+Math.cos(look.yaw)*d*Math.cos(look.pitch));camera.up.set(0,1,0);camera.lookAt(p);}
  else{if(camera.position.distanceTo(p)>400)placeFlyby();camera.position.copy(flyby);camera.up.set(0,1,0);camera.lookAt(p);}
  const th=Math.max(terrainHeight(camera.position.x,camera.position.z),0)+1.5;if(camera.position.y<th)camera.position.y=th;
  camera.fov=THREE.MathUtils.lerp(camera.fov,(cam===1?70:60)+Math.min(S.vel.length()/8,10),dt*2);camera.updateProjectionMatrix();
}
// ---------- 主循环 ----------
let last=performance.now(),acc=0,fpsT=0,frames=0;const H=1/120;
function step(dt){readInput(dt);acc+=dt;let n=0;while(acc>=H&&n<40){physics(H,inp);acc-=H;n++;}if(n>=40)acc=0;}
function loop(now){requestAnimationFrame(loop);const dt=Math.min((now-last)/1000,.25);last=now;const t=now/1000;
  if(S.started&&!S.paused){step(dt);
    if(!S.alive)parts.forEach(p=>{p.life+=dt;const sm=p.m.material===smokeM;p.v.y+=(sm?3:-9.8)*dt;p.m.position.addScaledVector(p.v,dt);p.v.multiplyScalar(1-dt);p.m.scale.setScalar(sm?1+p.life*2:1.5);if(p.life>4){p.life=0;p.m.position.copy(crashPos);p.v.set((Math.random()-.5)*6,Math.random()*8,(Math.random()-.5)*6);}});
    snd.update(S.rpm,S.vel.length(),S.onGround,S.stall,S.alive,cam===1);
    if(toastT>0){toastT-=dt;if(toastT<=0)$('toast').classList.remove('show');}}
  plane.position.copy(S.pos);plane.quaternion.copy(S.quat);animateAircraft(plane,S,t);plane.userData.land.intensity=S.gearDown?40:0;
  if(S.started)updateCamera(dt);else{const a=t*.08;camera.position.set(S.pos.x+Math.sin(a)*16,S.pos.y+3,S.pos.z+Math.cos(a)*16);camera.lookAt(S.pos.x,S.pos.y+.5,S.pos.z);}
  world.sun.position.copy(S.pos).addScaledVector(world.sunDir,400);world.sun.target.position.copy(S.pos);
  world.water.uniforms.uTime.value=t;world.water.uniforms.uCam.value.copy(camera.position);
  world.clouds.position.x=(t*4)%2000;
  if(S.started)drawHUD();renderer.render(scene,camera);
  frames++;if(now-fpsT>1000){window.__fps=frames;frames=0;fpsT=now;}
}
function startGame(mode){snd.unlock();snd.click();$('start').style.display='none';$('hud').style.display='block';S.started=true;setPause(false);reset(mode);cam=0;$('camName').textContent=CAMS[0];
  if(isMobile)goFull();}
$('playAir').addEventListener('click',()=>startGame('air'));$('playRwy').addEventListener('click',()=>startGame('rwy'));
['touchstart','pointerdown','keydown'].forEach(ev=>addEventListener(ev,()=>snd.unlock(),{once:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.started&&!S.paused)setPause(true);});
reset('rwy');$('toast').classList.remove('show');requestAnimationFrame(loop);
window.__S=S;window.__opt=opt;window.__step=(sec)=>{for(let i=0;i<sec*120;i++){readInput(H);physics(H,inp);}};
