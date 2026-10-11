import * as THREE from 'three';
// 程序化建模的单发螺旋桨飞机（机头朝 -Z，右翼 +X）
export function buildAircraft(){
  const root=new THREE.Group();
  const white=new THREE.MeshStandardMaterial({color:0xf4f4f0,metalness:.3,roughness:.4});
  const red=new THREE.MeshStandardMaterial({color:0xc8202a,metalness:.3,roughness:.45});
  const dark=new THREE.MeshStandardMaterial({color:0x222428,metalness:.6,roughness:.5});
  const metal=new THREE.MeshStandardMaterial({color:0xaab0b8,metalness:.9,roughness:.25});
  const glass=new THREE.MeshPhysicalMaterial({color:0x88bbdd,metalness:.1,roughness:.05,transmission:.0,transparent:true,opacity:.45});
  const rubber=new THREE.MeshStandardMaterial({color:0x111111,roughness:.9});
  const sh=m=>{m.castShadow=true;m.receiveShadow=true;return m;};
  // 机身：Lathe 旋转体
  const prof=[[0,-4.2],[.35,-4.1],[.55,-3.8],[.62,-3.2],[.68,-2],[.7,-.5],[.66,1],[.5,2.6],[.3,3.8],[.14,4.6],[0,4.7]].map(p=>new THREE.Vector2(p[0],p[1]));
  const fusG=new THREE.LatheGeometry(prof,32);fusG.rotateX(Math.PI/2);fusG.scale(1,1.05,1);
  const fus=sh(new THREE.Mesh(fusG,white));root.add(fus);
  // 腰线红色条纹
  const stripe=sh(new THREE.Mesh(new THREE.CylinderGeometry(.705,.6,5.5,32,1,true),red));stripe.rotation.x=Math.PI/2;stripe.scale.set(1,1,.25);stripe.position.set(0,-.1,.3);root.add(stripe);
  // 整流罩 + 桨毂
  const cowl=sh(new THREE.Mesh(new THREE.CylinderGeometry(.55,.68,.9,32),red));cowl.rotation.x=Math.PI/2;cowl.position.z=-3.75;root.add(cowl);
  const spinner=sh(new THREE.Mesh(new THREE.ConeGeometry(.28,.7,24),metal));spinner.rotation.x=-Math.PI/2;spinner.position.z=-4.55;root.add(spinner);
  const prop=new THREE.Group();prop.position.z=-4.35;root.add(prop);
  for(let i=0;i<3;i++){const b=new THREE.Mesh(new THREE.BoxGeometry(.16,1.15,.04),dark);b.position.y=.6;b.rotation.y=.35;const tip=new THREE.Mesh(new THREE.BoxGeometry(.16,.12,.045),new THREE.MeshStandardMaterial({color:0xffcc00}));tip.position.y=1.1;const a=new THREE.Group();a.add(b,tip);a.rotation.z=i*Math.PI*2/3;prop.add(a);}
  const disc=new THREE.Mesh(new THREE.CircleGeometry(1.25,40),new THREE.MeshBasicMaterial({color:0x333333,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));disc.position.z=-4.37;root.add(disc);
  // 排气管
  for(const s of[-1,1]){const ex=new THREE.Mesh(new THREE.CylinderGeometry(.05,.06,.4,8),metal);ex.rotation.x=Math.PI/2.4;ex.position.set(s*.5,-.35,-3.2);root.add(ex);}
  // 座舱盖
  const can=new THREE.Mesh(new THREE.SphereGeometry(.55,32,16,0,Math.PI*2,0,Math.PI/2),glass);can.scale.set(.95,.85,2.4);can.position.set(0,.5,-1.1);root.add(can);
  const frame=new THREE.Mesh(new THREE.TorusGeometry(.52,.035,8,24,Math.PI),dark);frame.position.set(0,.5,-1.1);frame.scale.set(.95,.85,1);root.add(frame);
  // 座舱内部：仪表板 + 座椅
  const panel=new THREE.Mesh(new THREE.BoxGeometry(1,.3,.08),dark);panel.position.set(0,.45,-2.05);panel.rotation.x=-.3;root.add(panel);
  const seat=new THREE.Mesh(new THREE.BoxGeometry(.5,.7,.15),new THREE.MeshStandardMaterial({color:0x553322}));seat.position.set(0,.25,-.3);root.add(seat);
  // 翼型截面挤出
  function wing(span,root_c,tip_c,thick,sweep){
    const g=new THREE.BoxGeometry(span,thick,root_c,16,1,4);const p=g.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),t=Math.abs(x)/(span/2),c=root_c+(tip_c-root_c)*t;let z=p.getZ(i)/root_c*c+sweep*t;let y=p.getY(i);
      const u=(z/c)+.5; y*= (1-t*.4)*Math.max(.15,Math.sin(Math.PI*Math.min(Math.max(1-u,0.02),1)*.9+.15));p.setXYZ(i,x,y,z);}
    g.computeVertexNormals();return g;}
  const wingG=wing(11,1.7,1.05,.22,.25);const wingM=sh(new THREE.Mesh(wingG,white));wingM.position.set(0,-.25,-.9);wingM.rotation.z=0;root.add(wingM);
  // 翼尖红色 + 航行灯
  const lights={nav:[],strobe:[],beacon:null};
  for(const s of[-1,1]){const tip=sh(new THREE.Mesh(new THREE.BoxGeometry(.4,.14,1.1),red));tip.position.set(s*5.4,-.25,-.65);root.add(tip);
    const col=s<0?0xff2020:0x20ff40;const l=new THREE.Mesh(new THREE.SphereGeometry(.07,8,8),new THREE.MeshBasicMaterial({color:col}));l.position.set(s*5.62,-.22,-.8);root.add(l);lights.nav.push(l);
    const st=new THREE.Mesh(new THREE.SphereGeometry(.06,8,8),new THREE.MeshBasicMaterial({color:0xffffff}));st.position.set(s*5.62,-.22,-.55);root.add(st);lights.strobe.push(st);}
  // 副翼（铰链组）
  function surface(w,c,th,mat){const g=new THREE.BoxGeometry(w,th,c);g.translate(0,0,c/2);const m=sh(new THREE.Mesh(g,mat));const h=new THREE.Group();h.add(m);return h;}
  const ailL=surface(2.4,.35,.06,white),ailR=surface(2.4,.35,.06,white);
  ailL.position.set(-3.8,-.25,-.05);ailR.position.set(3.8,-.25,-.05);root.add(ailL,ailR);
  const flapL=surface(2.3,.38,.06,metal),flapR=surface(2.3,.38,.06,metal);
  flapL.position.set(-1.5,-.27,.0);flapR.position.set(1.5,-.27,.0);root.add(flapL,flapR);
  // 尾翼
  const hstab=sh(new THREE.Mesh(wing(3.8,.9,.6,.1,.15),white));hstab.position.set(0,.05,3.7);root.add(hstab);
  const elev=surface(3.4,.4,.05,red);elev.position.set(0,.05,4.15);root.add(elev);
  const vg=wing(1.7,1.3,.7,.1,.5);vg.rotateZ(Math.PI/2);vg.translate(0,.85,0);const vstab=sh(new THREE.Mesh(vg,white));vstab.position.set(0,.2,3.7);root.add(vstab);
  const rud=surface(.05,.4,1.5,red);rud.children[0].geometry.translate(0,.75,0);rud.position.set(0,.25,4.3);root.add(rud);
  const beacon=new THREE.Mesh(new THREE.SphereGeometry(.07,8,8),new THREE.MeshBasicMaterial({color:0xff3300}));beacon.position.set(0,1.95,4.15);root.add(beacon);lights.beacon=beacon;
  const tailL=new THREE.Mesh(new THREE.SphereGeometry(.06,8,8),new THREE.MeshBasicMaterial({color:0xffffff}));tailL.position.set(0,.2,4.7);root.add(tailL);
  // 起落架（前三点式，可收放）
  const gear=[];
  function strut(x,z,len,isNose){const g=new THREE.Group();g.position.set(x,-.45,z);
    const s=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,len,8),metal);s.position.y=-len/2;g.add(s);
    const w=sh(new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.15,20),rubber));w.rotation.z=Math.PI/2;w.position.y=-len;g.add(w);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,.17,12),metal);hub.rotation.z=Math.PI/2;hub.position.y=-len;g.add(hub);
    if(!isNose){const fair=sh(new THREE.Mesh(new THREE.SphereGeometry(.28,16,8),red));fair.scale.set(.6,.7,1.4);fair.position.y=-len+.05;g.add(fair);}
    g.userData={isNose,side:Math.sign(x)};root.add(g);gear.push(g);return g;}
  strut(0,-3.0,.85,true);strut(-1.25,-.4,.85,false);strut(1.25,-.4,.85,false);
  // 着陆灯
  const land=new THREE.SpotLight(0xfff2cc,0,250,.35,.5);land.position.set(0,-.3,-3.8);land.target.position.set(0,-6,-60);root.add(land,land.target);
  root.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  root.userData={prop,disc,ailL,ailR,flapL,flapR,elev,rud,gear,lights,land,gearH:1.55};
  return root;
}
export function animateAircraft(a,st,t){
  const u=a.userData;
  u.prop.rotation.z+=st.rpm*0.9+0.0;
  u.prop.visible=st.rpm<0.55;u.disc.material.opacity=Math.min(st.rpm*0.6,.35);
  u.ailL.rotation.x=st.roll*0.4;u.ailR.rotation.x=-st.roll*0.4;
  u.elev.rotation.x=-st.pitch*0.45;u.rud.rotation.y=st.yaw*0.45;
  u.flapL.rotation.x=u.flapR.rotation.x=st.flapPos*0.7;
  for(const g of u.gear){g.rotation.x=g.userData.isNose?-st.gearRetract*Math.PI/2:0;g.rotation.z=g.userData.isNose?0:g.userData.side*st.gearRetract*Math.PI/2;
    g.scale.setScalar(st.gearRetract>.98?0.001:1);}
  const L=u.lights;const s=(t%1.2)<0.06||((t%1.2)>0.15&&(t%1.2)<0.2);L.strobe.forEach(x=>x.visible=s);L.beacon.visible=(t%1)<.5;
}
