import * as THREE from 'three';
import {buildWorld,terrainHeight,RWY,WORLD} from './world.js';
import {buildAircraft,animateAircraft} from './aircraft.js';
import {Sound} from './audio.js';
const $=id=>document.getElementById(id);
const isMobile=matchMedia('(pointer:coarse)').matches;
const qParam=new URLSearchParams(location.search).get('q');
let quality=qParam!==null?+qParam:(isMobile?1:2);
const QN=['低','中','高'];
// ---------- 渲染器 ----------
const renderer=new THREE.WebGLRenderer({canvas:$('c'),antialias:quality>0,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,[1,1.5,2][quality]));
renderer.shadowMap.enabled=quality>0;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.55;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(65,1,.3,40000);
const world=buildWorld(scene,renderer,quality);
const plane=buildAircraft();scene.add(plane);
const snd=new Sound();
function resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
addEventListener('resize',resize);resize();
// ---------- 飞行状态 ----------
const S={pos:new THREE.Vector3(),vel:new THREE.Vector3(),quat:new THREE.Quaternion(),throttle:0,rpm:0,pitch:0,roll:0,yaw:0,
  flaps:0,flapPos:0,gearDown:true,gearRetract:0,brake:false,onGround:true,alive:true,paused:false,stall:false,aoa:0};
const FLAPS=[0,10,20,30];
function reset(){S.pos.set(0,RWY.elev+plane.userData.gearH,RWY.len/2-60);S.vel.set(0,0,0);S.quat.identity();
  S.throttle=0;S.rpm=0;S.flaps=1;S.gearDown=true;S.gearRetract=0;S.brake=false;S.alive=true;S.onGround=true;
  thrUI(0);$('crashOv').style.display='none';plane.visible=true;debris.visible=false;updStatus();}
// 坠毁碎片/火焰
const debris=new THREE.Group();scene.add(debris);debris.visible=false;
const fireM=new THREE.MeshBasicMaterial({color:0xff6a00,transparent:true,opacity:.8});const smokeM=new THREE.MeshBasicMaterial({color:0x333333,transparent:true,opacity:.5,depthWrite:false});
const parts=[];for(let i=0;i<40;i++){const m=new THREE.Mesh(new THREE.IcosahedronGeometry(1,0),i<15?fireM:smokeM);debris.add(m);parts.push({m,v:new THREE.Vector3(),life:0});}
function crash(reason){if(!S.alive)return;S.alive=false;snd.crash();plane.visible=false;debris.visible=true;
  parts.forEach(p=>{p.m.position.copy(S.pos);p.v.set((Math.random()-.5)*20,Math.random()*15,(Math.random()-.5)*20);p.life=Math.random()*3;});
  $('crashOv').querySelector('h2').textContent='💥 坠毁！'+reason;setTimeout(()=>{$('crashOv').style.display='flex';},1200);}
// ---------- 物理 ----------
const MASS=1100,AREA=16.2,G=9.81,TMAX=4600;
const fwd=new THREE.Vector3(),up=new THREE.Vector3(),right=new THREE.Vector3(),F=new THREE.Vector3(),tmp=new THREE.Vector3(),tq=new THREE.Quaternion();
function physics(dt,inp){
  S.pitch+= (inp.pitch-S.pitch)*Math.min(dt*8,1);S.roll+=(inp.roll-S.roll)*Math.min(dt*8,1);S.yaw+=(inp.yaw-S.yaw)*Math.min(dt*8,1);
  S.rpm+=( (S.alive?0.18+S.throttle*0.82:0)-S.rpm)*Math.min(dt*1.5,1);
  S.flapPos+=(FLAPS[S.flaps]/30-S.flapPos)*Math.min(dt*1.2,1);
  S.gearRetract+=((S.gearDown?0:1)-S.gearRetract)*Math.min(dt*.9,1);if(Math.abs(S.gearRetract-(S.gearDown?0:1))<.01)S.gearRetract=S.gearDown?0:1;
  if(!S.alive)return;
  fwd.set(0,0,-1).applyQuaternion(S.quat);up.set(0,1,0).applyQuaternion(S.quat);right.set(1,0,0).applyQuaternion(S.quat);
  const V=S.vel.length(),rho=1.225*Math.exp(-S.pos.y/9000),q=.5*rho*V*V;
  const vf=S.vel.dot(fwd),vu=S.vel.dot(up),vr=S.vel.dot(right);
  const alpha=V>2?Math.atan2(-vu,Math.max(vf,.1)):0,beta=V>2?Math.atan2(vr,Math.max(vf,.1)):0;S.aoa=alpha;
  const crit=.27+S.flapPos*.02;let CL=.3+S.flapPos*.55+5.2*alpha;
  if(alpha>crit){CL=(.3+S.flapPos*.55+5.2*crit)*Math.max(.35,1-(alpha-crit)*4);} if(alpha<-.25)CL=.3-5.2*.25;
  S.stall=alpha>crit-.04&&V>5;
  const CD=.028+.045*CL*CL+S.flapPos*.06+(1-S.gearRetract)*.018+(alpha>crit?.15:0);
  F.set(0,-MASS*G,0);
  if(V>.5){const vd=tmp.copy(S.vel).divideScalar(V);
    const ld=new THREE.Vector3().crossVectors(right,vd).normalize();F.addScaledVector(ld,q*AREA*CL);
    F.addScaledVector(vd,-q*AREA*CD);F.addScaledVector(right,-q*AREA*.9*Math.sin(beta));}
  const thrust=TMAX*S.throttle*Math.max(.25,1-V/95)*(S.rpm/(0.18+S.throttle*.82+1e-3));F.addScaledVector(fwd,thrust);
  // 地面
  const gh=Math.max(terrainHeight(S.pos.x,S.pos.z),0),clearance=S.gearRetract<.5?plane.userData.gearH:.75;
  const wasGround=S.onGround;S.onGround=S.pos.y<=gh+clearance+.05;
  const eff=Math.min(q/900,1.6);
  // 角速度（机体系）
  let wp=(S.pitch*1.1)*eff - alpha*.0*eff, wr=-S.roll*2.0*eff, wy=-S.yaw*.45*eff;
  wp+=-(alpha-0.06)*1.6*eff*(S.onGround?0:1);wy+=-beta*2.5*eff;
  if(S.stall&&!S.onGround){wp-=.35;wr+=Math.sin(performance.now()*.003)*.4;}
  // 协调转弯：滚转产生偏航
  if(!S.onGround&&V>10){const bank=Math.asin(THREE.MathUtils.clamp(-right.y,-1,1));wy+= -0; }
  if(S.onGround){
    const onRwy=Math.abs(S.pos.x)<RWY.w/2+3&&Math.abs(S.pos.z)<RWY.len/2+5;
    const vh=Math.hypot(S.vel.x,S.vel.z);
    // 着陆判定
    if(!wasGround){const vs=-S.vel.y;
      if(gh<=0.5&&terrainHeight(S.pos.x,S.pos.z)<0.5){crash('（落水）');return;}
      if(S.gearRetract>.5){if(vs>1.5||vh>25){crash('（未放起落架）');return;}}
      if(vs>6.5){crash('（下沉率过大）');return;}
      const rollDeg=Math.abs(Math.asin(THREE.MathUtils.clamp(right.y,-1,1)))*57.3,pitchDeg=Math.asin(THREE.MathUtils.clamp(fwd.y,-1,1))*57.3;
      if(rollDeg>25||pitchDeg<-8){crash('（姿态异常）');return;}
      snd.touchdown(vs/6);flash(vs<1.5?'完美着陆！':'着陆');}
    if(!onRwy&&vh>8&&terrainHeight(S.pos.x,S.pos.z)>0.5){const n=terrainNormal(S.pos.x,S.pos.z);if(n.y<.96&&vh>15){crash('（撞击地形）');return;}}
    if(terrainHeight(S.pos.x,S.pos.z)<0.3){crash('（落水）');return;}
    S.pos.y=gh+clearance;if(S.vel.y<0)S.vel.y=0;
    // 滚动阻力、刹车、侧向摩擦
    const mu=(onRwy?.02:.08)+(S.brake?.55:0);
    const fv=tmp.copy(fwd).setY(0).normalize(),along=S.vel.dot(fv);
    F.addScaledVector(fv,-Math.sign(along)*Math.min(mu*MASS*G,Math.abs(along)*MASS/dt*.5));
    const side=new THREE.Vector3().crossVectors(fv,new THREE.Vector3(0,1,0)),lat=S.vel.dot(side);
    S.vel.addScaledVector(side,-lat*Math.min(dt*8,1));
    // 前轮转向 + 机身保持水平
    wy+=-S.yaw*THREE.MathUtils.clamp(vh/8,0,1)*.6;
    const pitchNow=Math.asin(THREE.MathUtils.clamp(fwd.y,-1,1));if(pitchNow<0.0&&wp<0)wp=-pitchNow*3;if(pitchNow<-.001)wp=Math.max(wp,-pitchNow*3);
    const rollNow=Math.asin(THREE.MathUtils.clamp(right.y,-1,1));wr=rollNow*4;
    if(S.gearRetract>.5&&vh>2)S.vel.multiplyScalar(1-dt*1.5);
  }
  S.vel.addScaledVector(F,dt/MASS);S.pos.addScaledVector(S.vel,dt);
  tq.setFromAxisAngle(tmp.set(1,0,0),wp*dt);S.quat.multiply(tq);tq.setFromAxisAngle(tmp.set(0,0,1),wr*dt);S.quat.multiply(tq);tq.setFromAxisAngle(tmp.set(0,1,0),wy*dt);S.quat.multiply(tq);S.quat.normalize();
  // 低速时速度向机头方向对齐（风标效应）
  if(!S.onGround&&V>5){const nv=tmp.copy(fwd).multiplyScalar(V);S.vel.lerp(nv,Math.min(dt*.6*eff,0.05));}
  // 空中碰撞
  const th=terrainHeight(S.pos.x,S.pos.z);
  if(!S.onGround&&S.pos.y<Math.max(th,0)+.6){crash(th<0.5?'（落水）':'（撞击地形）');}
  const lim=WORLD*.7;if(Math.abs(S.pos.x)>lim||Math.abs(S.pos.z)>lim){flash('已到达地图边界，请掉头');}
}
function terrainNormal(x,z){const e=3;return new THREE.Vector3(terrainHeight(x-e,z)-terrainHeight(x+e,z),2*e,terrainHeight(x,z-e)-terrainHeight(x,z+e)).normalize();}
// ---------- 输入 ----------
const inp={pitch:0,roll:0,yaw:0};const joy={x:0,y:0,id:null};const keys={};let tilt={on:false,b0:0,g0:0,b:0,g:0};
const jEl=$('joy'),kEl=$('knob');
function joyMove(e){const r=jEl.getBoundingClientRect(),R=r.width/2;let dx=e.clientX-r.left-R,dy=e.clientY-r.top-R;const d=Math.hypot(dx,dy);if(d>R){dx*=R/d;dy*=R/d;}
  joy.x=dx/R;joy.y=dy/R;const kr=kEl.offsetWidth/2;kEl.style.left=(R+dx-kr)+'px';kEl.style.top=(R+dy-kr)+'px';}
jEl.addEventListener('pointerdown',e=>{joy.id=e.pointerId;jEl.setPointerCapture(e.pointerId);joyMove(e);});
jEl.addEventListener('pointermove',e=>{if(e.pointerId===joy.id)joyMove(e);});
const joyEnd=e=>{if(e.pointerId!==joy.id)return;joy.id=null;joy.x=joy.y=0;kEl.style.left=kEl.style.top='';};
jEl.addEventListener('pointerup',joyEnd);jEl.addEventListener('pointercancel',joyEnd);
const tW=$('thrWrap');function thrUI(v){S.throttle=v;const h=tW.clientHeight;$('thrFill').style.height=(v*100)+'%';$('thrKnob').style.top=((1-v)*(h-16))+'px';}
function thrMove(e){const r=tW.getBoundingClientRect();thrUI(THREE.MathUtils.clamp(1-(e.clientY-r.top-8)/(r.height-16),0,1));}
tW.addEventListener('pointerdown',e=>{tW.setPointerCapture(e.pointerId);thrMove(e);});tW.addEventListener('pointermove',e=>{if(e.buttons||e.pointerType==='touch')thrMove(e);});
const hold={L:false,R:false};
function holdBtn(id,k){const b=$(id);b.addEventListener('pointerdown',e=>{hold[k]=true;b.classList.add('on');});['pointerup','pointercancel','pointerleave'].forEach(t=>b.addEventListener(t,()=>{hold[k]=false;b.classList.remove('on');}));}
holdBtn('bRudL','L');holdBtn('bRudR','R');
function tap(id,fn){$(id).addEventListener('click',e=>{snd.click();fn();});}
const toggleFlaps=()=>{S.flaps=(S.flaps+1)%4;snd.flap();updStatus();};
const toggleGear=()=>{if(S.onGround&&S.gearDown){flash('地面上无法收起起落架');return;}S.gearDown=!S.gearDown;snd.gear();updStatus();};
const toggleBrake=()=>{S.brake=!S.brake;$('bBrake').classList.toggle('on',S.brake);updStatus();};
tap('bFlap',toggleFlaps);tap('bGear',toggleGear);tap('bBrake',toggleBrake);
const CAMS=['追尾','座舱','环绕','飞掠'];let cam=0;const nextCam=()=>{cam=(cam+1)%4;$('btnCam').textContent='🎥 '+CAMS[cam];if(cam===3)placeFlyby();};
tap('btnCam',nextCam);tap('btnReset',reset);tap('btnRestart',reset);
const togglePause=()=>{S.paused=!S.paused;$('btnPause').textContent=S.paused?'▶':'⏸';$('pauseOv').style.display=S.paused?'flex':'none';if(snd.ctx)S.paused?snd.ctx.suspend():snd.ctx.resume();};
tap('btnPause',togglePause);$('pauseOv').addEventListener('click',togglePause);
const toggleMute=()=>{snd.setMuted(!snd.muted);$('btnMute').textContent=snd.muted?'🔇':'🔊';};tap('btnMute',toggleMute);
tap('btnQ',()=>{const n=(quality+1)%3;location.search='?q='+n;});$('btnQ').textContent='画质:'+QN[quality];
tap('btnTilt',async()=>{if(!tilt.on){try{if(typeof DeviceOrientationEvent!=='undefined'&&DeviceOrientationEvent.requestPermission){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted'){flash('未获得陀螺仪权限');return;}}}catch(e){}
  tilt.on=true;tilt.cal=true;}else tilt.on=false;$('btnTilt').textContent='📐 重力感应:'+(tilt.on?'开':'关');$('btnTilt').classList.toggle('on',tilt.on);});
addEventListener('deviceorientation',e=>{if(e.beta==null)return;const ang=(screen.orientation&&screen.orientation.angle)||window.orientation||0;
  let p,r;if(ang===90){p=-e.gamma;r=e.beta;}else if(ang===-90||ang===270){p=e.gamma;r=-e.beta;}else{p=e.beta;r=e.gamma;}
  if(tilt.cal){tilt.b0=p;tilt.g0=r;tilt.cal=false;}tilt.b=p;tilt.g=r;});
// 全屏 + 横屏锁定
tap('btnFull',async()=>{const d=document,el=d.documentElement;
  if(!(d.fullscreenElement||d.webkitFullscreenElement)){const rq=el.requestFullscreen||el.webkitRequestFullscreen;
    if(rq){try{await rq.call(el,{navigationUI:'hide'});}catch(e){}try{await screen.orientation.lock('landscape');}catch(e){}}
    else{flash('iOS 请点击分享 → 添加到主屏幕，即可全屏游玩');scrollTo(0,1);}}
  else{(d.exitFullscreen||d.webkitExitFullscreen).call(d);}});
// 键盘
addEventListener('keydown',e=>{keys[e.code]=true;snd.unlock();
  const k=e.code;if(k==='KeyF')toggleFlaps();if(k==='KeyG')toggleGear();if(k==='KeyB')toggleBrake();if(k==='KeyC')nextCam();if(k==='KeyR')reset();if(k==='KeyP')togglePause();if(k==='KeyM')toggleMute();
  if(k.startsWith('Digit')){const n=+k.slice(5);if(n>=0&&n<=9)thrUI(n===0?1:n/10);}});
addEventListener('keyup',e=>keys[e.code]=false);
// 拖动屏幕旋转视角（环绕/追尾）
let look={yaw:0,pitch:.15,dist:22,id:null,lx:0,ly:0};
$('c').addEventListener('pointerdown',e=>{look.id=e.pointerId;look.lx=e.clientX;look.ly=e.clientY;});
addEventListener('pointermove',e=>{if(e.pointerId!==look.id)return;look.yaw-=(e.clientX-look.lx)*.008;look.pitch=THREE.MathUtils.clamp(look.pitch+(e.clientY-look.ly)*.006,-1.2,1.4);look.lx=e.clientX;look.ly=e.clientY;});
addEventListener('pointerup',e=>{if(e.pointerId===look.id)look.id=null;});
$('c').addEventListener('wheel',e=>{look.dist=THREE.MathUtils.clamp(look.dist+e.deltaY*.02,8,80);},{passive:true});
function readInput(dt){
  let p=joy.y,r=joy.x,y=(hold.R?1:0)-(hold.L?1:0);
  if(keys.KeyW||keys.ArrowUp)p=1;if(keys.KeyS||keys.ArrowDown)p=-1;  // W 推杆 = 低头
  if(keys.KeyA||keys.ArrowLeft)r=-1;if(keys.KeyD||keys.ArrowRight)r=1;if(keys.KeyQ)y=-1;if(keys.KeyE)y=1;
  if(keys.ShiftLeft||keys.ShiftRight)thrUI(Math.min(S.throttle+dt*.5,1));if(keys.ControlLeft||keys.ControlRight)thrUI(Math.max(S.throttle-dt*.5,0));
  if(tilt.on&&joy.id===null){p=THREE.MathUtils.clamp((tilt.b-tilt.b0)/25,-1,1);r=THREE.MathUtils.clamp((tilt.g-tilt.g0)/30,-1,1);}
  // 摇杆：上推=低头（与真机一致），使用平方曲线提高精度
  const cur=v=>Math.sign(v)*v*v*.7+v*.3;inp.pitch=-cur(p);inp.roll=cur(r);inp.yaw=y;
}
// ---------- HUD ----------
let flashT=0;function flash(t){$('warn').textContent=t;$('warn').style.color='#ffe14d';flashT=2.5;}
function updStatus(){$('stFlap').textContent='襟翼 '+FLAPS[S.flaps]+'°';$('stGear').textContent='起落架 '+(S.gearDown?'放下':'收起');$('stBrake').textContent=S.brake?'🅿 刹车':'';$('bGear').classList.toggle('on',!S.gearDown);}
const cmp=$('compass').getContext('2d'),adi=$('adi').getContext('2d'),mini=$('mini').getContext('2d');
// 预渲染小地图
const mapC=document.createElement('canvas');mapC.width=mapC.height=256;{const m=mapC.getContext('2d'),img=m.createImageData(256,256);
  for(let j=0;j<256;j++)for(let i=0;i<256;i++){const x=(i/256-.5)*WORLD,z=(j/256-.5)*WORLD,h=terrainHeight(x,z),o=(j*256+i)*4;
    let c=h<0?[30,90,150]:h<6?[220,205,150]:h<200?[80,140,60]:h<500?[60,100,50]:h<700?[130,120,110]:[240,240,245];img.data.set([...c,255],o);}
  m.putImageData(img,0,0);m.fillStyle='#222';const s=256/WORLD;m.fillRect(128-RWY.w*s*2,128-RWY.len/2*s,RWY.w*s*4,RWY.len*s);}
function drawHUD(){
  fwd.set(0,0,-1).applyQuaternion(S.quat);right.set(1,0,0).applyQuaternion(S.quat);up.set(0,1,0).applyQuaternion(S.quat);
  const hdg=(Math.atan2(fwd.x,-fwd.z)*57.3+360)%360,pitch=Math.asin(THREE.MathUtils.clamp(fwd.y,-1,1)),roll=Math.atan2(right.y,up.y);
  const agl=S.pos.y-Math.max(terrainHeight(S.pos.x,S.pos.z),0)-(S.gearRetract<.5?plane.userData.gearH:.75);
  $('spd').textContent=(S.vel.length()*3.6).toFixed(0);$('alt').textContent=S.pos.y.toFixed(0);$('vs').textContent=S.vel.y.toFixed(1);
  $('stThr').textContent='油门 '+(S.throttle*100|0)+'%  RPM '+(S.rpm*2700|0);
  // 罗盘
  const W=300;cmp.clearRect(0,0,W,40);cmp.fillStyle='rgba(0,0,0,.4)';cmp.fillRect(0,0,W,40);cmp.strokeStyle=cmp.fillStyle='#fff';cmp.font='bold 13px sans-serif';cmp.textAlign='center';
  const names={0:'北',90:'东',180:'南',270:'西'};for(let d=-60;d<=60;d+=5){const a=Math.round(hdg/5)*5+d,x=W/2+(a-hdg)*2.4,an=(a+360)%360;cmp.beginPath();cmp.moveTo(x,0);cmp.lineTo(x,an%10?6:11);cmp.stroke();
    if(an%30===0){cmp.fillStyle=names[an]?'#ffcc33':'#fff';cmp.fillText(names[an]||(an/10),x,26);}}
  cmp.fillStyle='#ffcc33';cmp.beginPath();cmp.moveTo(W/2-6,40);cmp.lineTo(W/2+6,40);cmp.lineTo(W/2,32);cmp.fill();
  // 姿态仪
  const R=70;adi.save();adi.clearRect(0,0,140,140);adi.beginPath();adi.arc(R,R,R-2,0,7);adi.clip();adi.translate(R,R);adi.rotate(-roll);const py=pitch*57.3*2;
  adi.fillStyle='#2f86d8';adi.fillRect(-150,-300+py,300,300);adi.fillStyle='#8a5a2b';adi.fillRect(-150,py,300,300);adi.strokeStyle='#fff';adi.lineWidth=2;adi.beginPath();adi.moveTo(-150,py);adi.lineTo(150,py);adi.stroke();
  adi.lineWidth=1.5;adi.font='10px sans-serif';adi.fillStyle='#fff';for(let d=-30;d<=30;d+=10){if(!d)continue;const y=py-d*2,w=d%20?12:22;adi.beginPath();adi.moveTo(-w,y);adi.lineTo(w,y);adi.stroke();adi.fillText(Math.abs(d),w+3,y+3);}
  adi.restore();adi.strokeStyle='#ffcc33';adi.lineWidth=3;adi.beginPath();adi.moveTo(R-34,R);adi.lineTo(R-12,R);adi.lineTo(R-6,R+6);adi.moveTo(R+34,R);adi.lineTo(R+12,R);adi.lineTo(R+6,R+6);adi.stroke();
  adi.beginPath();adi.arc(R,R,R-2,0,7);adi.strokeStyle='#ddd';adi.lineWidth=3;adi.stroke();
  adi.fillStyle='#fff';adi.font='bold 11px sans-serif';adi.textAlign='center';adi.fillText('AGL '+Math.max(agl,0).toFixed(0),R,R+48);
  // 小地图（航向朝上）
  mini.save();mini.clearRect(0,0,140,140);mini.beginPath();mini.arc(70,70,68,0,7);mini.clip();mini.translate(70,70);mini.rotate(-hdg/57.3);
  const s=256/WORLD,zoom=3.2;mini.scale(zoom,zoom);mini.drawImage(mapC,-(S.pos.x*s+128),-(S.pos.z*s+128));mini.restore();
  mini.fillStyle='#ffcc33';mini.beginPath();mini.moveTo(70,60);mini.lineTo(76,76);mini.lineTo(70,72);mini.lineTo(64,76);mini.fill();
  mini.beginPath();mini.arc(70,70,68,0,7);mini.strokeStyle='#ddd';mini.lineWidth=3;mini.stroke();
  // 警告
  const w=$('warn');if(!S.alive)w.textContent='';else if(S.stall&&!S.onGround){w.style.color='#ff4040';w.textContent='⚠ 失速 STALL';}
  else if(!S.onGround&&agl<60&&S.vel.y<-5){w.style.color='#ff4040';w.textContent='⚠ 拉起 PULL UP';}
  else if(!S.onGround&&agl<80&&S.gearRetract>.5&&S.vel.y<-1){w.style.color='#ffa040';w.textContent='⚠ 起落架未放下';}
  else if(flashT<=0)w.textContent='';
}
// ---------- 相机 ----------
const camPos=new THREE.Vector3(),camTarget=new THREE.Vector3(),flyby=new THREE.Vector3();
function placeFlyby(){fwd.set(0,0,-1).applyQuaternion(S.quat);flyby.copy(S.pos).addScaledVector(S.vel.lengthSq()>4?S.vel.clone().normalize():fwd,180).add(new THREE.Vector3(25,8,0));flyby.y=Math.max(flyby.y,terrainHeight(flyby.x,flyby.z)+4);}
function updateCamera(dt,t){
  const p=S.alive?S.pos:debris.children[0].position;
  if(cam===0){const off=new THREE.Vector3(Math.sin(look.yaw)*look.dist*Math.cos(look.pitch),look.pitch*look.dist*.8+3,Math.cos(look.yaw)*look.dist).applyQuaternion(yawOnly());
    camPos.lerp(tmp.copy(p).add(off),1-Math.exp(-dt*6));camera.position.copy(camPos);camTarget.lerp(tmp.copy(p).addScaledVector(fwd.set(0,0,-1).applyQuaternion(S.quat),10),1-Math.exp(-dt*10));camera.up.set(0,1,0);camera.lookAt(camTarget);
    if(look.id===null)look.yaw*=Math.exp(-dt*1.5);}
  else if(cam===1){camera.position.copy(tmp.set(0,.9,-.9).applyQuaternion(S.quat).add(p));camera.quaternion.copy(S.quat);camera.rotateX(-.05+(look.id!==null?0:0));camera.rotateY(look.yaw);}
  else if(cam===2){if(look.id===null)look.yaw+=dt*.25;const d=look.dist*1.3;camera.position.set(p.x+Math.sin(look.yaw)*d*Math.cos(look.pitch),p.y+Math.sin(look.pitch)*d+2,p.z+Math.cos(look.yaw)*d*Math.cos(look.pitch));camera.up.set(0,1,0);camera.lookAt(p);}
  else{if(camera.position.distanceTo(p)>400)placeFlyby();camera.position.copy(flyby);camera.up.set(0,1,0);camera.lookAt(p);}
  const th=Math.max(terrainHeight(camera.position.x,camera.position.z),0)+1.5;if(camera.position.y<th)camera.position.y=th;
  camera.fov=THREE.MathUtils.lerp(camera.fov,(cam===1?70:62)+Math.min(S.vel.length()/8,10),dt*2);camera.updateProjectionMatrix();
  plane.userData.prop.parent.visible=S.alive;
}
function yawOnly(){fwd.set(0,0,-1).applyQuaternion(S.quat);const a=Math.atan2(-fwd.x,-fwd.z);return tq.setFromAxisAngle(tmp.set(0,1,0),a).clone();}
// ---------- 主循环 ----------
let last=performance.now(),acc=0,fpsT=0,frames=0;
function loop(now){requestAnimationFrame(loop);let dt=Math.min((now-last)/1000,.1);last=now;const t=now/1000;
  if(!S.paused){readInput(dt);acc+=dt;const h=1/120;while(acc>=h){physics(h,inp);acc-=h;}
    plane.position.copy(S.pos);plane.quaternion.copy(S.quat);animateAircraft(plane,S,t);
    plane.userData.land.intensity=S.gearDown?40:0;
    if(!S.alive)parts.forEach(p=>{p.life+=dt;p.v.y+=(p.m.material===smokeM?3:-9.8)*dt;p.m.position.addScaledVector(p.v,dt);p.v.multiplyScalar(1-dt);const s=p.m.material===smokeM?1+p.life*2:1.5;p.m.scale.setScalar(s);if(p.life>4){p.life=0;p.m.position.copy(debris.children[0].position.y>0?S.pos:S.pos);p.v.set((Math.random()-.5)*6,Math.random()*8,(Math.random()-.5)*6);}});
    snd.update(S.rpm,S.vel.length(),S.onGround,S.stall,S.alive,cam===1);
    flashT-=dt;}
  updateCamera(dt,t);
  world.sun.position.copy(S.pos).addScaledVector(world.sunDir,400);world.sun.target.position.copy(S.pos);
  world.water.uniforms.uTime.value=t;world.water.uniforms.uCam.value.copy(camera.position);
  world.clouds.position.x=(t*4)%2000;
  drawHUD();renderer.render(scene,camera);
  frames++;if(now-fpsT>1000){window.__fps=frames;frames=0;fpsT=now;}
}
$('startBtn').addEventListener('click',()=>{snd.unlock();snd.click();$('start').style.display='none';$('hud').style.display='block';thrUI(S.throttle);
  if(isMobile){const el=document.documentElement,rq=el.requestFullscreen||el.webkitRequestFullscreen;if(rq)Promise.resolve(rq.call(el)).then(()=>screen.orientation?.lock?.('landscape')).catch(()=>{});}});
['touchstart','pointerdown'].forEach(ev=>addEventListener(ev,()=>snd.unlock(),{once:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!S.paused)togglePause();});
reset();requestAnimationFrame(loop);
window.__S=S;window.__sim=(n,pi)=>{for(let i=0;i<n;i++){inp.pitch=pi;inp.roll=0;inp.yaw=0;physics(1/120,inp);}};window.__thr=thrUI;window.__gear=toggleGear;
