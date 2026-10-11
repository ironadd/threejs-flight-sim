import * as THREE from 'three';
import {Sky} from 'three/addons/objects/Sky.js';
// ---- 噪声 ----
const P=new Uint8Array(512);{const p=[...Array(256).keys()];let s=1337;for(let i=255;i>0;i--){s=(s*16807)%2147483647;const j=s%(i+1);[p[i],p[j]]=[p[j],p[i]];}for(let i=0;i<512;i++)P[i]=p[i&255];}
const fade=t=>t*t*t*(t*(t*6-15)+10),lerp=(a,b,t)=>a+(b-a)*t;
function grad(h,x,y){const g=h&7;const u=g<4?x:y,v=g<4?y:x;return((g&1)?-u:u)+((g&2)?-2*v:2*v);}
export function noise(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255;x-=Math.floor(x);y-=Math.floor(y);const u=fade(x),v=fade(y);
  const a=P[X]+Y,b=P[X+1]+Y;return lerp(lerp(grad(P[a],x,y),grad(P[b],x-1,y),u),lerp(grad(P[a+1],x,y-1),grad(P[b+1],x-1,y-1),u),v)*0.25;}
function fbm(x,y,o=6){let s=0,a=1,f=1;for(let i=0;i<o;i++){s+=a*noise(x*f,y*f);a*=.5;f*=2.03;}return s;}
export const WORLD=12000,RWY={len:1800,w:45,elev:12};
const smooth=(e0,e1,x)=>{const t=Math.min(Math.max((x-e0)/(e1-e0),0),1);return t*t*(3-2*t);};
export function terrainHeight(x,z){
  const r=Math.hypot(x,z)/(WORLD*.5);
  let h=fbm(x*.00035,z*.00035,6)*420+60;
  const ridge=1-Math.abs(fbm(x*.00022+7,z*.00022-3,5));h+=Math.pow(ridge,3)*900*smooth(-.2,.9,-z/5000+fbm(x*.0002,1.3,2));
  h-=smooth(.55,1,r)*500;              // 外围入海
  h-=smooth(1500,3500,x)*smooth(-3000,2000,z)*180; // 东侧海湾
  // 机场平整
  const dx=Math.max(Math.abs(x)-200,0),dz=Math.max(Math.abs(z)-RWY.len/2-250,0),d=Math.hypot(dx,dz);
  const k=smooth(0,500,d);return lerp(RWY.elev,h,k);
}
export function buildWorld(scene,renderer,quality){
  const out={};
  // ---- 天空 ----
  const sky=new Sky();sky.scale.setScalar(45000);scene.add(sky);
  const u=sky.material.uniforms;u.turbidity.value=6;u.rayleigh.value=1.6;u.mieCoefficient.value=.004;u.mieDirectionalG.value=.85;
  const sun=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(68),THREE.MathUtils.degToRad(200));u.sunPosition.value.copy(sun);
  scene.fog=new THREE.Fog(0xb9d3ea,1500,9500);
  const pm=new THREE.PMREMGenerator(renderer);const env=pm.fromScene(sky).texture;scene.environment=env;
  const hemi=new THREE.HemisphereLight(0xcfe6ff,0x5a6b3a,.7);scene.add(hemi);
  const dl=new THREE.DirectionalLight(0xfff1dd,2.4);dl.position.copy(sun).multiplyScalar(400);dl.castShadow=quality>0;
  dl.shadow.mapSize.set(quality>1?2048:1024,quality>1?2048:1024);const sc=dl.shadow.camera;sc.left=sc.bottom=-60;sc.right=sc.top=60;sc.near=1;sc.far=1000;dl.shadow.bias=-.0005;
  scene.add(dl,dl.target);out.sun=dl;out.sunDir=sun;
  // ---- 地形 ----
  const seg=quality>1?320:quality>0?240:160;
  const g=new THREE.PlaneGeometry(WORLD,WORLD,seg,seg);g.rotateX(-Math.PI/2);
  const pos=g.attributes.position,col=new Float32Array(pos.count*3),c=new THREE.Color();
  const sand=new THREE.Color(0xe0cf9a),grass=new THREE.Color(0x5d8a3a),grass2=new THREE.Color(0x7a9c45),forest=new THREE.Color(0x3c5e2a),rock=new THREE.Color(0x7d736a),snow=new THREE.Color(0xf6f8fb),seabed=new THREE.Color(0x8a7f5a);
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=terrainHeight(x,z);pos.setY(i,h);
    const n=noise(x*.01,z*.01)*.5+.5;
    if(h<-2)c.copy(seabed);else if(h<6)c.copy(sand);else if(h<160)c.copy(grass).lerp(grass2,n);else if(h<380)c.copy(forest).lerp(grass,n*.5);else if(h<620)c.copy(rock).lerp(forest,n*.3);else c.copy(rock).lerp(snow,smooth(620,800,h+n*80));
    col.set([c.r,c.g,c.b],i*3);}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
  // 根据坡度把陡坡染成岩石
  const nr=g.attributes.normal;for(let i=0;i<pos.count;i++){const s=1-nr.getY(i);if(s>.25&&pos.getY(i)>10){c.fromArray(col,i*3).lerp(rock,smooth(.25,.5,s));col.set([c.r,c.g,c.b],i*3);}}
  const terrain=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0}));terrain.receiveShadow=true;scene.add(terrain);
  // ---- 水面（动画着色器）----
  const wMat=new THREE.ShaderMaterial({fog:true,transparent:true,uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{uTime:{value:0},uSun:{value:sun},uCam:{value:new THREE.Vector3()}}]),
    vertexShader:`#include <fog_pars_vertex>
    uniform float uTime;varying vec3 vW;void main(){vec3 p=position;vec4 w=modelMatrix*vec4(p,1.);
    w.y+=sin(w.x*.02+uTime)*.6+cos(w.z*.017+uTime*1.3)*.5;vW=w.xyz;vec4 mvPosition=viewMatrix*w;gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
    }`,
    fragmentShader:`#include <fog_pars_fragment>
    uniform float uTime;uniform vec3 uSun,uCam;varying vec3 vW;
    float h(vec2 p){return sin(p.x)*cos(p.y);}
    void main(){vec2 p=vW.xz*.05;float t=uTime;
      vec3 n=normalize(vec3(cos(p.x*1.7+t)*.15+cos(p.y*2.3-t*1.2)*.1+sin((p.x+p.y)*4.1+t*2.)*.05,1.,sin(p.y*1.9+t*.8)*.15+cos((p.x-p.y)*3.7-t*1.7)*.07));
      vec3 v=normalize(uCam-vW);float fr=pow(1.-max(dot(n,v),0.),4.);
      vec3 deep=vec3(.02,.17,.32),shallow=vec3(.1,.5,.6),skyc=vec3(.65,.8,.95);
      vec3 col=mix(deep,shallow,.35)+fr*skyc*.8;
      vec3 r=reflect(-uSun,n);float sp=pow(max(dot(r,v),0.),180.)*3.;col+=vec3(1.,.95,.8)*sp;
      gl_FragColor=vec4(col,.92);
      #include <fog_fragment>
    }`});
  const water=new THREE.Mesh(new THREE.PlaneGeometry(WORLD*3,WORLD*3,80,80).rotateX(-Math.PI/2),wMat);water.position.y=0;scene.add(water);out.water=wMat;
  // ---- 跑道 ----
  const cv=document.createElement('canvas');cv.width=256;cv.height=2048;const x=cv.getContext('2d');
  x.fillStyle='#3a3b3e';x.fillRect(0,0,256,2048);for(let i=0;i<4000;i++){x.fillStyle=`rgba(${Math.random()*80|0},${Math.random()*80|0},${Math.random()*80|0},.25)`;x.fillRect(Math.random()*256,Math.random()*2048,2,2);}
  x.fillStyle='#fff';x.fillRect(6,0,5,2048);x.fillRect(245,0,5,2048);
  for(let y=200;y<1850;y+=60)x.fillRect(125,y,6,32);
  for(const end of[0,1]){const y0=end?2048-110:20;for(let i=0;i<8;i++){x.fillRect(20+i*14+(i>3?60:0),y0,9,80);}
    x.save();x.font='bold 60px sans-serif';x.textAlign='center';x.translate(128,end?1830:220);if(!end)x.rotate(Math.PI);x.fillText(end?'36':'18',0,0);x.restore();
    const yy=end?1680:300;x.fillRect(40,yy,30,70);x.fillRect(186,yy,30,70);}
  const rt=new THREE.CanvasTexture(cv);rt.anisotropy=8;rt.colorSpace=THREE.SRGBColorSpace;
  const rwy=new THREE.Mesh(new THREE.PlaneGeometry(RWY.w,RWY.len).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({map:rt,roughness:.85}));rwy.position.y=RWY.elev+.05;rwy.receiveShadow=true;scene.add(rwy);
  // 滑行道 + 停机坪
  const asph=new THREE.MeshStandardMaterial({color:0x48494c,roughness:.9});
  const twy=new THREE.Mesh(new THREE.PlaneGeometry(18,RWY.len*.8).rotateX(-Math.PI/2),asph);twy.position.set(80,RWY.elev+.04,0);twy.receiveShadow=true;scene.add(twy);
  const apron=new THREE.Mesh(new THREE.PlaneGeometry(120,160).rotateX(-Math.PI/2),asph);apron.position.set(150,RWY.elev+.04,0);apron.receiveShadow=true;scene.add(apron);
  // 跑道边灯（实例化）
  const lg=new THREE.SphereGeometry(.35,6,6),lm=new THREE.MeshBasicMaterial({color:0xffe9a0});const nL=Math.floor(RWY.len/60)*2;const li=new THREE.InstancedMesh(lg,lm,nL);
  const M=new THREE.Matrix4();let k=0;for(let z=-RWY.len/2;z<RWY.len/2&&k<nL;z+=60){for(const s of[-1,1]){M.makeTranslation(s*(RWY.w/2+1.5),RWY.elev+.4,z);li.setMatrixAt(k++,M);}}scene.add(li);
  // 塔台、机库
  const bw=new THREE.MeshStandardMaterial({color:0xe8e4da,roughness:.8});
  const tower=new THREE.Mesh(new THREE.CylinderGeometry(3,4,26,12),bw);tower.position.set(200,RWY.elev+13,-120);tower.castShadow=true;scene.add(tower);
  const cab=new THREE.Mesh(new THREE.CylinderGeometry(6,5,5,8),new THREE.MeshStandardMaterial({color:0x335577,metalness:.6,roughness:.15}));cab.position.set(200,RWY.elev+28.5,-120);scene.add(cab);
  for(let i=0;i<3;i++){const h=new THREE.Mesh(new THREE.CylinderGeometry(14,14,40,20,1,false,0,Math.PI),new THREE.MeshStandardMaterial({color:0x8a96a3,metalness:.5,roughness:.4}));h.rotation.z=Math.PI/2;h.rotation.y=Math.PI/2;h.position.set(230,RWY.elev,40+i*45);h.castShadow=true;scene.add(h);}
  // 风向袋
  const sock=new THREE.Mesh(new THREE.ConeGeometry(1,5,12,1,true),new THREE.MeshStandardMaterial({color:0xff6600,side:THREE.DoubleSide}));sock.rotation.z=Math.PI/2;sock.position.set(-50,RWY.elev+8,-700);scene.add(sock);
  // ---- 小镇（实例化房屋）----
  const houseG=new THREE.BoxGeometry(1,1,1);houseG.translate(0,.5,0);const roofG=new THREE.ConeGeometry(.75,.6,4);roofG.rotateY(Math.PI/4);roofG.translate(0,1.3,0);
  const nH=quality>0?700:350;const hm=new THREE.InstancedMesh(houseG,new THREE.MeshStandardMaterial({roughness:.8}),nH),rm=new THREE.InstancedMesh(roofG,new THREE.MeshStandardMaterial({roughness:.7}),nH);
  const Q=new THREE.Quaternion(),S=new THREE.Vector3(),V=new THREE.Vector3(),E=new THREE.Euler();let placed=0,tries=0;
  const wallC=[0xf2eadb,0xe8d7b8,0xdfe6ea,0xf5f0e6,0xcfd9c4],roofC=[0xb5482c,0x8a3b2a,0x4a5a6a,0xa0522d];
  while(placed<nH&&tries<20000){tries++;const cx=-900+Math.random()*700,cz=-300+Math.random()*900;const hx=Math.round(cx/22)*22,hz=Math.round(cz/22)*22+ (Math.random()<.5?0:6);
    const h=terrainHeight(hx,hz);if(h<4||h>120)continue;const s=6+Math.random()*6,hh=s*(.7+Math.random()*(Math.hypot(hx+550,hz-150)<180?3:.6));
    E.set(0,(Math.random()<.5?0:Math.PI/2),0);Q.setFromEuler(E);S.set(s,hh,s*(.8+Math.random()*.6));M.compose(V.set(hx,h-.5,hz),Q,S);hm.setMatrixAt(placed,M);hm.setColorAt(placed,c.setHex(wallC[placed%5]));
    S.set(s*1.0,s*.8,S.z);M.compose(V.set(hx,h-.5+hh-s*1.0,hz),Q,S);rm.setMatrixAt(placed,M);rm.setColorAt(placed,c.setHex(roofC[placed%4]));placed++;}
  hm.count=rm.count=placed;hm.castShadow=rm.castShadow=true;scene.add(hm,rm);
  // ---- 树木（实例化，两级LOD）----
  const nT=quality>1?14000:quality>0?9000:4500;
  const trunkG=new THREE.CylinderGeometry(.25,.35,2,5);trunkG.translate(0,1,0);
  const pineG=new THREE.ConeGeometry(2.2,7,7);pineG.translate(0,5.5,0);const leafG=new THREE.IcosahedronGeometry(2.6,0);leafG.translate(0,4.2,0);
  const pines=new THREE.InstancedMesh(pineG,new THREE.MeshStandardMaterial({color:0x2f5a2a,roughness:.9,flatShading:true}),nT);
  const leafs=new THREE.InstancedMesh(leafG,new THREE.MeshStandardMaterial({color:0x4f7d32,roughness:.9,flatShading:true}),nT);
  const trunks=new THREE.InstancedMesh(trunkG,new THREE.MeshStandardMaterial({color:0x5b3f2a}),nT*2);
  let np=0,nl=0,nt=0;tries=0;
  while((np+nl)<nT&&tries<nT*8){tries++;const tx=(Math.random()-.5)*WORLD*.85,tz=(Math.random()-.5)*WORLD*.85;
    if(Math.abs(tx)<260&&Math.abs(tz)<RWY.len/2+300)continue;if(tx>-950&&tx<-150&&tz>-350&&tz<650)continue;
    const h=terrainHeight(tx,tz);if(h<8||h>560)continue;if(noise(tx*.002,tz*.002)<-.05)continue;
    const s=1+Math.random()*1.4;E.set(0,Math.random()*6,0);Q.setFromEuler(E);S.set(s,s*(.8+Math.random()*.5),s);M.compose(V.set(tx,h-.3,tz),Q,S);
    if(h>200||Math.random()<.4){pines.setMatrixAt(np,M);pines.setColorAt(np,c.setHSL(.28+Math.random()*.05,.4,.18+Math.random()*.08));np++;}else{leafs.setMatrixAt(nl,M);leafs.setColorAt(nl,c.setHSL(.22+Math.random()*.08,.45,.25+Math.random()*.1));nl++;}
    trunks.setMatrixAt(nt++,M);}
  pines.count=np;leafs.count=nl;trunks.count=nt;pines.castShadow=leafs.castShadow=quality>1;scene.add(pines,leafs,trunks);
  out.trunks=trunks;
  // ---- 云 ----
  const cc=document.createElement('canvas');cc.width=cc.height=128;const cx2=cc.getContext('2d');
  for(let i=0;i<14;i++){const gx=30+Math.random()*68,gy=40+Math.random()*48,r=18+Math.random()*26;const gr=cx2.createRadialGradient(gx,gy,0,gx,gy,r);gr.addColorStop(0,'rgba(255,255,255,.9)');gr.addColorStop(1,'rgba(255,255,255,0)');cx2.fillStyle=gr;cx2.fillRect(0,0,128,128);}
  const ct=new THREE.CanvasTexture(cc);const clouds=new THREE.Group();
  const cm=new THREE.SpriteMaterial({map:ct,transparent:true,depthWrite:false,fog:true,opacity:.9});
  const nC=quality>0?90:45;for(let i=0;i<nC;i++){const cx=(Math.random()-.5)*WORLD,cz=(Math.random()-.5)*WORLD,cy=900+Math.random()*700;
    for(let j=0;j<6;j++){const s=new THREE.Sprite(cm);const sz=180+Math.random()*260;s.scale.set(sz,sz*.6,1);s.position.set(cx+(Math.random()-.5)*400,cy+Math.random()*80,cz+(Math.random()-.5)*300);clouds.add(s);}}
  scene.add(clouds);out.clouds=clouds;out.terrain=terrain;
  return out;
}
