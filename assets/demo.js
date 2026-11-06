(function(root){
 'use strict';
 const C=root.LabCore,G=root.LabGeometry;
 const P={O1:[-65,-20,-15],O2:[65,25,45],R1:[305,65,-20],R2:[405,85,30]},L=G.norm(G.sub(P.R2,P.R1)),Q=G.norm(G.sub(P.O2,P.O1));
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const unit=a=>a.map(x=>x/G.norm(a));
 function quaternion(R){const t=R[0][0]+R[1][1]+R[2][2];let q;
  if(t>0){const s=Math.sqrt(t+1)*2;q=[s/4,(R[2][1]-R[1][2])/s,(R[0][2]-R[2][0])/s,(R[1][0]-R[0][1])/s];}
  else{let i=0;if(R[1][1]>R[i][i])i=1;if(R[2][2]>R[i][i])i=2;const j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(1+R[i][i]-R[j][j]-R[k][k])*2;q=[0,0,0,0];q[0]=(R[k][j]-R[j][k])/s;q[i+1]=s/4;q[j+1]=(R[j][i]+R[i][j])/s;q[k+1]=(R[k][i]+R[i][k])/s;}return q;
 }
 function fixture(){const camera={id:1,model:'PINHOLE',width:1280,height:960,params:[1400,1400,640,480]};camera.intrinsics=G.intrinsics(camera);
  return Array.from({length:24},(_,i)=>{const group=C.GROUPS[Math.floor(i/6)],az=[-30,0,30][i%3]*Math.PI/180,el=(i%6<3?12:32)*Math.PI/180,center=group==='object'?[0,0,15]:group==='reference'?[355,75,5]:[170,35,10],radius=['initial','wide'].includes(group)?1150:600;
   const pos=center.map((x,j)=>x+radius*[Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)][j]),z=unit(G.sub(center,pos)),x=unit(cross(z,[0,1,0])),y=cross(z,x),R=[x,y,z];return {camera,R,C:pos,group};});
 }
 function observations(seed=42){let state=seed>>>0;const uniform=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;},noise=()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform())*.35;
  return fixture().map(view=>({view,points:Object.fromEntries(C.POINTS.map(k=>{const p=G.project(P[k],view);return [k,p&&p[0]>=0&&p[0]<1280&&p[1]>=0&&p[1]<960?p.map(x=>x+noise()):null];}))}));
 }
 function exportPose(frames){return {cameras:'# CAMERA_ID MODEL WIDTH HEIGHT PARAMS\n1 PINHOLE 1280 960 1400 1400 640 480\n',images:'# IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME\n'+frames.map((f,i)=>{const q=quaternion(f.view.R),t=f.view.R.map(row=>-G.dot(row,f.view.C));return `${i+1} ${[...q,...t].join(' ')} 1 ${f.name}\n\n`;}).join('')};}
 const toBlob=canvas=>new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 async function make(onProgress=()=>{}){
  const project=C.project('Учебный пример'),media=[];project.synthetic=true;project.demoTruth={objectLength:Q,referenceLength:L};
  for(const [si,s]of project.sessions.entries()){
   s.objectId='DEMO-BLOCK';s.phone='Виртуальная камера';s.lens='PINHOLE';s.newSetup=true;s.notes='Синтетические проекции. Не лабораторные данные.';s.reference.relationship='separate';
   for(const type of ['scale','control']){const mean=type==='scale'?L:Q;s.reference[type]={...C.reference(),readings:[-.02,.01,0,.015,-.005].map(x=>(mean+x).toFixed(4)),instrument:type==='scale'?'DEMO-SCALE':'DEMO-CONTROL',resolution:'0.01',standardB:'0.05',definition:type==='scale'?'R1–R2':'O1–O2',repositioned:true};}
   s.analysisSettings.pixelSigma=.35;const data=observations(42+si),exported=[];
   for(let i=0;i<24;i++){
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=960;const ctx=canvas.getContext('2d');ctx.fillStyle='#f3f5ef';ctx.fillRect(0,0,1280,960);ctx.strokeStyle='#d5ded3';ctx.lineWidth=1;
    for(let x=0;x<1280;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,960);ctx.stroke();}for(let y=0;y<960;y+=80){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke();}
    ctx.fillStyle='#587167';ctx.font='20px Arial';ctx.fillText(`СИНТЕТИЧЕСКИЙ ПРИМЕР / ${s.code} / КАДР ${i+1}`,40,50);ctx.font='17px Arial';ctx.fillText('Условная сцена для проверки программы. Не фотография реального опыта.',40,82);
    for(const [pair,color]of [[['O1','O2'],'#16755c'],[['R1','R2'],'#b98029']]){const pts=pair.map(k=>data[i].points[k]);if(pts.every(Boolean)){ctx.strokeStyle=color;ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(...pts[0]);ctx.lineTo(...pts[1]);ctx.stroke();}for(let k=0;k<2;k++)if(pts[k]){ctx.fillStyle='#fff';ctx.strokeStyle=color;ctx.lineWidth=4;ctx.beginPath();ctx.arc(...pts[k],10,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=color;ctx.font='24px Arial';ctx.fillText(pair[k],pts[k][0]+17,pts[k][1]-17);}}
    const blob=await toBlob(canvas),file=new File([blob],`demo_${s.code}_${String(i+1).padStart(3,'0')}.png`,{type:'image/png'}),prepared=await root.LabFiles.preparePhoto(file,project.id,i+1);
    const a=prepared.record;a.status='accepted';a.points=data[i].points;a.visibility=Object.fromEntries(C.POINTS.map(k=>[k,a.points[k]?'visible':'occluded']));a.notes='Учебная разметка сгенерирована вместе с проекциями.';s.frames[i].attempts.push(a);s.frames[i].activeId=a.id;media.push(...prepared.media);exported.push({...data[i],name:a.workingName});onProgress(si*24+i+1,48);
   }
   const pose=exportPose(exported);s.reconstruction={...pose,importedAt:new Date().toISOString(),synthetic:true};
  }
  return {project,media};
 }
 const api={P,L,Q,fixture,observations,quaternion,exportPose,make};root.LabDemo=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
