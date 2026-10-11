// 全部音效使用 Web Audio API 实时合成，无需外部音频文件
export class Sound{
  constructor(){this.ctx=null;this.muted=false;}
  unlock(){
    if(this.ctx){this.ctx.resume();return;}
    const C=window.AudioContext||window.webkitAudioContext; if(!C)return;
    const ctx=this.ctx=new C();
    this.master=ctx.createGain();this.master.gain.value=0.8;this.master.connect(ctx.destination);
    // 噪声缓冲
    const nb=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),d=nb.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1; this.noiseBuf=nb;
    // 发动机：两个锯齿 + 方波次谐波 + 低通 + 活塞脉动LFO
    this.engGain=ctx.createGain();this.engGain.gain.value=0;
    this.engFilter=ctx.createBiquadFilter();this.engFilter.type='lowpass';this.engFilter.frequency.value=600;this.engFilter.Q.value=2;
    this.engFilter.connect(this.engGain);this.engGain.connect(this.master);
    this.oscs=[['sawtooth',1],['sawtooth',1.01],['square',0.5]].map(([t,m])=>{const o=ctx.createOscillator();o.type=t;o.m=m;const g=ctx.createGain();g.gain.value=t==='square'?0.25:0.35;o.connect(g);g.connect(this.engFilter);o.start();return o;});
    this.lfo=ctx.createOscillator();this.lfoG=ctx.createGain();this.lfoG.gain.value=0.15;this.lfo.connect(this.lfoG);this.lfoG.connect(this.engGain.gain);this.lfo.start();
    // 螺旋桨嗡嗡声（噪声带通）
    this.propN=this.noise(true);this.propF=ctx.createBiquadFilter();this.propF.type='bandpass';this.propF.Q.value=1.5;this.propG=ctx.createGain();this.propG.gain.value=0;
    this.propN.connect(this.propF);this.propF.connect(this.propG);this.propG.connect(this.master);
    // 风噪
    this.windN=this.noise(true);this.windF=ctx.createBiquadFilter();this.windF.type='lowpass';this.windF.frequency.value=400;this.windG=ctx.createGain();this.windG.gain.value=0;
    this.windN.connect(this.windF);this.windF.connect(this.windG);this.windG.connect(this.master);
    // 滚轮噪声
    this.rollN=this.noise(true);this.rollF=ctx.createBiquadFilter();this.rollF.type='lowpass';this.rollF.frequency.value=180;this.rollG=ctx.createGain();this.rollG.gain.value=0;
    this.rollN.connect(this.rollF);this.rollF.connect(this.rollG);this.rollG.connect(this.master);
    // 失速警告
    this.stallO=ctx.createOscillator();this.stallO.type='square';this.stallO.frequency.value=880;this.stallG=ctx.createGain();this.stallG.gain.value=0;
    this.stallO.connect(this.stallG);this.stallG.connect(this.master);this.stallO.start();
    this.stallOn=false;
  }
  noise(loop){const s=this.ctx.createBufferSource();s.buffer=this.noiseBuf;s.loop=loop;s.start();return s;}
  setMuted(m){this.muted=m;if(this.master)this.master.gain.setTargetAtTime(m?0:0.8,this.ctx.currentTime,0.05);}
  update(rpm,speed,onGround,stall,alive,inCockpit){
    if(!this.ctx)return;const t=this.ctx.currentTime,k=0.08;
    const f=28+rpm*62; // 点火基频
    this.oscs.forEach(o=>o.frequency.setTargetAtTime(f*o.m,t,k));
    this.lfo.frequency.setTargetAtTime(f/2,t,k);
    this.engFilter.frequency.setTargetAtTime(300+rpm*1800,t,k);
    const v=alive?(0.12+rpm*0.25)*(inCockpit?1.2:1):0;
    this.engGain.gain.setTargetAtTime(v,t,0.15);
    this.propF.frequency.setTargetAtTime(150+rpm*500,t,k);this.propG.gain.setTargetAtTime(alive?rpm*0.12:0,t,0.15);
    const s=Math.min(speed/90,1.5);
    this.windF.frequency.setTargetAtTime(300+s*2200,t,k);this.windG.gain.setTargetAtTime(alive?s*s*0.18:0,t,0.2);
    this.rollG.gain.setTargetAtTime(onGround&&alive?Math.min(speed/30,1)*0.35:0,t,0.08);
    const st=stall&&alive&&!onGround;
    if(st!==this.stallOn){this.stallOn=st;}
    this.stallG.gain.setTargetAtTime(st?(Math.floor(t*6)%2?0.08:0):0,t,0.01);
  }
  env(node,g0,dur){const g=this.ctx.createGain();g.gain.setValueAtTime(g0,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);node.connect(g);g.connect(this.master);return g;}
  click(){if(!this.ctx)return;const o=this.ctx.createOscillator();o.frequency.value=1500;o.type='triangle';this.env(o,0.15,0.05);o.start();o.stop(this.ctx.currentTime+0.06);}
  gear(){ // 起落架电机：上扬锯齿 + 机械锁定声
    if(!this.ctx)return;const c=this.ctx,t=c.currentTime,o=c.createOscillator();o.type='sawtooth';
    o.frequency.setValueAtTime(90,t);o.frequency.linearRampToValueAtTime(160,t+2.2);
    const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=500;o.connect(f);
    const g=c.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.12,t+0.2);g.gain.setValueAtTime(0.12,t+2.1);g.gain.linearRampToValueAtTime(0,t+2.3);
    f.connect(g);g.connect(this.master);o.start(t);o.stop(t+2.4);
    setTimeout(()=>this.thump(0.3,120),2300);
  }
  flap(){ // 襟翼液压声
    if(!this.ctx)return;const c=this.ctx,s=this.noise(false),f=c.createBiquadFilter();f.type='bandpass';f.frequency.setValueAtTime(400,c.currentTime);f.frequency.linearRampToValueAtTime(900,c.currentTime+0.9);
    s.connect(f);this.env(f,0.25,1.0);s.stop(c.currentTime+1.1);
  }
  thump(vol=0.6,freq=80){if(!this.ctx)return;const c=this.ctx,o=c.createOscillator();o.frequency.setValueAtTime(freq,c.currentTime);o.frequency.exponentialRampToValueAtTime(30,c.currentTime+0.25);this.env(o,vol,0.3);o.start();o.stop(c.currentTime+0.35);}
  touchdown(intensity){if(!this.ctx)return;this.thump(Math.min(0.3+intensity,1));const c=this.ctx,s=this.noise(false),f=c.createBiquadFilter();f.type='highpass';f.frequency.value=1500;s.connect(f);this.env(f,0.2*Math.min(intensity*2+0.3,1),0.4);s.stop(c.currentTime+0.5);}
  crash(){if(!this.ctx)return;const c=this.ctx,s=this.noise(false),f=c.createBiquadFilter();f.type='lowpass';f.frequency.setValueAtTime(3000,c.currentTime);f.frequency.exponentialRampToValueAtTime(100,c.currentTime+2);s.connect(f);this.env(f,1.0,2.2);s.stop(c.currentTime+2.3);this.thump(1,60);}
}
