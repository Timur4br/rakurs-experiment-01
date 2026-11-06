(function(root){
 'use strict';
 class PhotoEditor {
  constructor(canvas,onMark){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onMark=onMark;this.zoom=1;this.pan=[0,0];this.point='O1';this.token=0;this.attempt=null;
   new ResizeObserver(()=>this.draw()).observe(canvas);
   canvas.addEventListener('wheel',e=>{if(!this.image)return;e.preventDefault();const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,p=this.toImage(x,y);this.zoom=Math.max(1,Math.min(20,this.zoom*Math.exp(-e.deltaY*.0015)));const t=this.transform();this.pan[0]+=x-(t.x+p[0]*t.s);this.pan[1]+=y-(t.y+p[1]*t.s);this.draw();},{passive:false});
   canvas.addEventListener('pointerdown',e=>{if(!this.image)return;canvas.setPointerCapture(e.pointerId);this.drag={x:e.clientX,y:e.clientY,pan:[...this.pan],moved:false};});
   canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(Math.hypot(dx,dy)>4)this.drag.moved=true;if(this.drag.moved){this.pan=[this.drag.pan[0]+dx,this.drag.pan[1]+dy];this.draw();}});
   canvas.addEventListener('pointerup',e=>{const d=this.drag;this.drag=null;if(!d||d.moved||!this.image)return;const r=canvas.getBoundingClientRect(),p=this.toImage(e.clientX-r.left,e.clientY-r.top);if(p[0]>=0&&p[1]>=0&&p[0]<this.image.naturalWidth&&p[1]<this.image.naturalHeight)this.onMark(p.map(v=>Math.round(v*1000)/1000));});canvas.addEventListener('pointercancel',()=>{this.drag=null;});
  }
  transform(){const r=this.canvas.getBoundingClientRect(),s=Math.min((r.width-24)/this.image.naturalWidth,(r.height-24)/this.image.naturalHeight)*this.zoom;return{s,x:(r.width-this.image.naturalWidth*s)/2+this.pan[0],y:(r.height-this.image.naturalHeight*s)/2+this.pan[1]};}
  toImage(x,y){const t=this.transform();return[(x-t.x)/t.s,(y-t.y)/t.s];}
  async load(attempt){this.attempt=attempt;const token=++this.token;this.image=null;this.draw();if(!attempt?.workingKey)return;try{const b=await root.LabStore.blob(attempt.workingKey),im=await root.LabFiles.loadImage(b);if(token!==this.token)return;this.image=im;this.fit();}catch(e){if(token===this.token)root.dispatchEvent(new CustomEvent('lab-error',{detail:e.message}));}}
  fit(){this.zoom=1;this.pan=[0,0];this.draw();}
  update(a,point){this.attempt=a;this.point=point;this.draw();}
  draw(){const c=this.canvas,r=c.getBoundingClientRect();if(!r.width||!r.height)return;const d=devicePixelRatio||1;c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);const ctx=this.ctx;ctx.setTransform(d,0,0,d,0,0);ctx.fillStyle='#182b2b';ctx.fillRect(0,0,r.width,r.height);if(!this.image)return;const t=this.transform();ctx.drawImage(this.image,t.x,t.y,this.image.naturalWidth*t.s,this.image.naturalHeight*t.s);if(!this.attempt)return;const p=this.attempt.points,v=this.attempt.visibility;
   for(const pair of [['O1','O2'],['R1','R2']]){if(pair.every(k=>p[k]&&v[k]==='visible')){ctx.strokeStyle=pair[0][0]==='O'?'#66e3b5':'#ffce66';ctx.lineWidth=1.5;ctx.beginPath();pair.forEach((k,i)=>ctx[i?'lineTo':'moveTo'](t.x+p[k][0]*t.s,t.y+p[k][1]*t.s));ctx.stroke();}}
   for(const k of root.LabCore.POINTS){if(!p[k]||v[k]!=='visible')continue;const x=t.x+p[k][0]*t.s,y=t.y+p[k][1]*t.s;ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.fillStyle=k[0]==='O'?'#168a62':'#bd8120';ctx.beginPath();ctx.arc(x,y,k===this.point?8:5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font='bold 12px Arial';ctx.fillStyle='#102d28';ctx.fillRect(x+10,y-17,27,18);ctx.fillStyle='#fff';ctx.fillText(k,x+13,y-4);}
  }
 }
 root.LabEditor={PhotoEditor};
})(globalThis);
