(function(root){
 'use strict';
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]),norm=a=>Math.sqrt(dot(a,a));
 const mv=(a,v)=>[0,1,2].map(i=>dot(a.slice(i*3,i*3+3),v));
 const outer=(H,a,w=1)=>{for(let i=0;i<3;i++)for(let j=0;j<3;j++)H[i*3+j]+=a[i]*a[j]*w;};
 function inverse(A){
  const a=Math.sqrt(A[0]),b=A[3]/a,c=A[6]/a,d=Math.sqrt(A[4]-b*b),e=(A[7]-c*b)/d,f=Math.sqrt(A[8]-c*c-e*e);
  if(![a,d,f].every(x=>Number.isFinite(x)&&x>1e-12))throw new Error('Недостаточно независимых ракурсов для восстановления точки.');
  const out=Array(9).fill(0);
  for(let k=0;k<3;k++){const y0=(k===0?1:0)/a,y1=((k===1?1:0)-b*y0)/d,y2=((k===2?1:0)-c*y0-e*y1)/f;const x2=y2/f,x1=(y1-e*x2)/d,x0=(y0-b*x1-c*x2)/a;out[k]=x0;out[3+k]=x1;out[6+k]=x2;}return out;
 }
 const SUPPORTED={SIMPLE_PINHOLE:3,PINHOLE:4,SIMPLE_RADIAL:4,RADIAL:5,OPENCV:8,FULL_OPENCV:12};
 function intrinsics(camera){
  const p=camera.params,m=camera.model;
  if(!Object.hasOwn(SUPPORTED,m)||p.length!==SUPPORTED[m]||!p.every(Number.isFinite))throw new Error(`Модель камеры ${m} не поддерживается или содержит неверные параметры.`);
  const simple=['SIMPLE_PINHOLE','SIMPLE_RADIAL','RADIAL'].includes(m);
  const fx=p[0],fy=simple?p[0]:p[1],cx=simple?p[1]:p[2],cy=simple?p[2]:p[3];
  if(!(fx>0&&fy>0&&camera.width>0&&camera.height>0))throw new Error('Некорректные размеры или фокус камеры.');
  let k=[0,0,0,0,0,0],t=[0,0];
  if(m==='SIMPLE_RADIAL')k[0]=p[3];if(m==='RADIAL'){k[0]=p[3];k[1]=p[4];}
  if(m==='OPENCV'||m==='FULL_OPENCV'){k[0]=p[4];k[1]=p[5];t=[p[6],p[7]];}
  if(m==='FULL_OPENCV')k=[p[4],p[5],p[8],p[9],p[10],p[11]];
  return {fx,fy,cx,cy,k,t};
 }
 function distort([x,y],c){const r=x*x+y*y,r2=r*r,r3=r2*r;const radial=(1+c.k[0]*r+c.k[1]*r2+c.k[2]*r3)/(1+c.k[3]*r+c.k[4]*r2+c.k[5]*r3),[p1,p2]=c.t;return [x*radial+2*p1*x*y+p2*(r+2*x*x),y*radial+p1*(r+2*y*y)+2*p2*x*y];}
 function undistort(pixel,c){
  const target=[(pixel[0]-c.cx)/c.fx,(pixel[1]-c.cy)/c.fy];let x=target.slice();
  for(let n=0;n<20;n++){
   const d=distort(x,c),r=sub(target,d);if(norm(r)<1e-12)return x;
   const h=1e-6,a=distort([x[0]+h,x[1]],c),b=distort([x[0]-h,x[1]],c),e=distort([x[0],x[1]+h],c),f=distort([x[0],x[1]-h],c);
   const j00=(a[0]-b[0])/(2*h),j10=(a[1]-b[1])/(2*h),j01=(e[0]-f[0])/(2*h),j11=(e[1]-f[1])/(2*h),det=j00*j11-j01*j10;
   if(!Number.isFinite(det)||Math.abs(det)<1e-14)break;
   x=[x[0]+(j11*r[0]-j01*r[1])/det,x[1]+(-j10*r[0]+j00*r[1])/det];if(!x.every(Number.isFinite)||norm(x)>100)break;
  }
  throw new Error('Не удалось скорректировать дисторсию отмеченной точки.');
 }
 function rotation(q){const n=norm(q);if(!(n>1e-12))throw new Error('Нулевая ориентация камеры.');const [w,x,y,z]=q.map(v=>v/n);return [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];}
 function parseCOLMAP(camerasText,imagesText){
  const cameras={};
  for(const raw of camerasText.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const p=line.split(/\s+/),id=Number(p[0]);if(!Number.isInteger(id)||id<0||cameras[id])throw new Error('Некорректный идентификатор камеры.');const camera={id,model:p[1],width:Number(p[2]),height:Number(p[3]),params:p.slice(4).map(Number)};camera.intrinsics=intrinsics(camera);cameras[id]=camera;}
  const views={},lines=imagesText.split(/\r?\n/);let i=0;
  while(i<lines.length){const line=lines[i++].trim();if(!line||line.startsWith('#'))continue;const p=line.split(/\s+/);if(p.length<10)throw new Error('Неверный заголовок в images.txt.');const nums=p.slice(0,9).map(Number);if(!nums.every(Number.isFinite))throw new Error('Некорректная поза камеры.');const [id,qw,qx,qy,qz,tx,ty,tz,cameraId]=nums,camera=cameras[cameraId],name=p.slice(9).join(' ');if(!camera)throw new Error(`Не найдена камера ${cameraId}.`);if(views[name])throw new Error('Повторное имя изображения в модели.');const R=rotation([qw,qx,qy,qz]),t=[tx,ty,tz],C=[0,1,2].map(k=>-R.reduce((v,row,j)=>v+row[k]*t[j],0));views[name]={id,name,cameraId,camera,R,C};
   // The following physical line is the POINTS2D line. It may be empty.
   if(i<lines.length)i++;
  }
  if(!Object.keys(views).length)throw new Error('В images.txt не найдены зарегистрированные изображения.');return {cameras,views};
 }
 function project(P,v){const pc=v.R.map(row=>dot(row,sub(P,v.C)));if(!(pc[2]>1e-9))return null;const xy=distort([pc[0]/pc[2],pc[1]/pc[2]],v.camera.intrinsics),c=v.camera.intrinsics;return [c.fx*xy[0]+c.cx,c.fy*xy[1]+c.cy];}
 function jacobian(P,v){const scale=Math.max(1,norm(P),norm(v.C)),h=scale*1e-6;const J=[[],[]];for(let k=0;k<3;k++){const a=P.slice(),b=P.slice();a[k]+=h;b[k]-=h;const pa=project(a,v),pb=project(b,v);if(!pa||!pb)throw new Error('Точка находится за камерой.');for(let j=0;j<2;j++)J[j][k]=(pa[j]-pb[j])/(2*h);}return J;}
 function objective(P,obs){return obs.reduce((s,o)=>{const p=project(P,o.view);return p?s+sub(o.xy,p).reduce((a,x)=>a+x*x,0):Infinity;},0);}
 function triangulate(obs,sigma=1){
  if(obs.length<2)throw new Error('Для каждой точки нужны как минимум два наблюдения.');if(!(sigma>0))throw new Error('Шум координат должен быть положительным.');
  let H=Array(9).fill(0),b=[0,0,0];
  for(const o of obs){const xy=undistort(o.xy,o.view.camera.intrinsics);for(let k=0;k<2;k++){const a=o.view.R[2].map((x,j)=>xy[k]*x-o.view.R[k][j]);outer(H,a);const rhs=dot(a,o.view.C);a.forEach((x,j)=>b[j]+=x*rhs);}}
  let P=mv(inverse(H),b);
  for(let it=0;it<12;it++){
   H=Array(9).fill(0);b=[0,0,0];
   for(const o of obs){const pred=project(P,o.view);if(!pred)throw new Error('Восстановленная точка находится за камерой.');const J=jacobian(P,o.view);for(let k=0;k<2;k++){outer(H,J[k],1/sigma**2);J[k].forEach((x,j)=>b[j]+=x*(o.xy[k]-pred[k])/sigma**2);}}
   const delta=mv(inverse(H),b);if(norm(delta)<1e-10*Math.max(1,norm(P)))break;
   const cost=objective(P,obs);let step=1,next=P;while(step>1/128){next=P.map((x,j)=>x+step*delta[j]);if(objective(next,obs)<=cost+1e-10)break;step/=2;}if(step<=1/128)break;P=next;
  }
  H=Array(9).fill(0);let squared=0;
  for(const o of obs){const p=project(P,o.view);if(!p)throw new Error('Точка за камерой.');squared+=sub(o.xy,p).reduce((s,x)=>s+x*x,0);for(const row of jacobian(P,o.view))outer(H,row,1/sigma**2);}
  const covariance=inverse(H),condition=Math.max(...H.map(Math.abs))*Math.max(...covariance.map(Math.abs));if(condition>1e12)throw new Error('Геометрия вырождена: ракурсы недостаточно различаются.');
  return {P,H,covariance,n:obs.length,reprojectionRMSE:Math.sqrt(squared/(2*obs.length))};
 }
 function measure(points,L,uL){
  const od=sub(points.O2.P,points.O1.P),rd=sub(points.R2.P,points.R1.P),d=norm(od),ell=norm(rd);if(!(ell>1e-9&&d>1e-9&&L>0))throw new Error('Некорректная длина отрезка.');
  const q=L*d/ell,og=od.map(x=>L/ell*x/d),rg=rd.map(x=>-L*d/ell**2*x/ell),g={O1:og.map(x=>-x),O2:og,R1:rg.map(x=>-x),R2:rg};
  const cp=Object.fromEntries(Object.keys(g).map(k=>[k,dot(g[k],mv(points[k].covariance,g[k]))]));const geometric=cp.O1+cp.O2+cp.R1+cp.R2;
  const floor=uL===null?null:(d/ell*uL)**2,variance=floor===null?null:geometric+floor;
  return {q,d,ell,g,components:{object:cp.O1+cp.O2,scale:cp.R1+cp.R2,reference:floor},geometricU:Math.sqrt(geometric),u:variance===null?null:Math.sqrt(variance),variance};
 }
 function fitFrames(frames,sigma,L,uL){const points={};for(const key of ['O1','O2','R1','R2']){try{points[key]=triangulate(frames.filter(f=>f.points[key]).map(f=>({view:f.view,xy:f.points[key]})),sigma);}catch(e){throw new Error(key+': '+e.message);}}return {points,...measure(points,L,uL)};}
 function predict(result,view,sigma){let variance=result.components.reference??0;for(const k of Object.keys(result.g)){const p=result.points[k],projection=project(p.P,view);let H=p.H.slice();if(projection&&projection[0]>=0&&projection[1]>=0&&projection[0]<view.camera.width&&projection[1]<view.camera.height)for(const row of jacobian(p.P,view))outer(H,row,1/sigma**2);variance+=dot(result.g[k],mv(inverse(H),result.g[k]));}return variance;}
 const api={SUPPORTED,intrinsics,distort,undistort,rotation,parseCOLMAP,project,jacobian,triangulate,measure,fitFrames,predict,inverse,dot,norm,sub};root.LabGeometry=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
