(function(root){
 'use strict';
 const VERSION='0.1.0',SCHEMA=1,POINTS=['O1','O2','R1','R2'];
 const GROUPS=['initial','object','reference','wide'];
 const GROUP_NAMES={initial:'Начальные общие планы',object:'Вокруг объекта',reference:'Масштабный образец',wide:'Дополнительные общие планы'};
 const uid=()=>root.crypto?.randomUUID?.()||'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 const clone=x=>JSON.parse(JSON.stringify(x));
 function reference(){return {readings:['','','','',''],instrument:'',resolution:'',standardB:'',definition:'',repositioned:false};}
 function session(code='S001'){
  return {id:uid(),code,date:new Date().toISOString().slice(0,10),objectId:'',condition:'normal',phone:'',lens:'',newSetup:false,notes:'',
   reference:{scale:reference(),control:reference(),relationship:'unknown'},
   frames:Array.from({length:24},(_,i)=>({slot:i+1,group:GROUPS[Math.floor(i/6)],azimuth:[-30,0,30][i%3],heightLevel:i%6<3?'Ниже':'Выше',attempts:[],activeId:null})),
   reconstruction:null,analysisSettings:{pixelSigma:1,budget:6,tolerance:''}};
 }
 function project(name='Пилотная серия'){const now=new Date().toISOString();return {schemaVersion:SCHEMA,version:VERSION,id:uid(),name,createdAt:now,updatedAt:now,synthetic:false,sessions:[session('S001'),session('S002')]};}
 function attempt(file,projectId,slot,retakeReason=''){
  const id=uid();return {id,originalKey:`${projectId}/${id}/original`,workingKey:null,thumbKey:null,originalName:file.name,originalType:file.type||'application/octet-stream',originalSize:file.size,originalHash:'',workingHash:'',workingName:`f${String(slot).padStart(3,'0')}_${id.slice(0,8)}.png`,width:null,height:null,status:'pending',retakeReason,notes:'',createdAt:new Date().toISOString(),visibility:Object.fromEntries(POINTS.map(k=>[k,'unknown'])),points:Object.fromEntries(POINTS.map(k=>[k,null])),revisions:[],position:{azimuth:'',height:'',distance:'',elapsed:''}};
 }
 function active(frame){return frame.attempts.find(a=>a.id===frame.activeId)||null;}
 function number(value){if(value===''||value===null||value===undefined)return null;const n=Number(String(value).replace(',','.'));return Number.isFinite(n)?n:null;}
 function referenceStats(ref){
  const raw=ref.readings||[],values=raw.map(number).filter(v=>v!==null&&v>0),n=values.length;
  const mean=n?values.reduce((a,b)=>a+b,0)/n:null;
  const sd=n>1?Math.sqrt(values.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)):null;
  const standardA=sd===null?null:sd/Math.sqrt(n),standardB=number(ref.standardB);
  const complete=!!(n>=2&&ref.repositioned&&standardB!==null&&standardB>=0);
  return {n,mean,sd,standardA,standardB,complete,u:complete?Math.hypot(standardA,standardB):null,invalid:raw.some(v=>v!==''&&(number(v)===null||number(v)<=0))};
 }
 function counts(s){const attempts=s.frames.flatMap(f=>f.attempts);return {filled:s.frames.filter(f=>active(f)).length,reviewed:s.frames.filter(f=>active(f)?.status!=='pending'&&active(f)).length,accepted:s.frames.filter(f=>active(f)?.status==='accepted').length,annotated:s.frames.filter(f=>{const a=active(f);return a&&POINTS.every(k=>a.visibility[k]!=='unknown');}).length,failures:attempts.filter(a=>a.status==='rejected').length,attempts:attempts.length};}
 function annotationReady(a){return !!(a?.workingKey&&POINTS.every(k=>a.visibility[k]==='occluded'||(a.visibility[k]==='visible'&&Array.isArray(a.points[k])&&a.points[k].every(Number.isFinite))));}
 function escape(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 const safeName=s=>String(s).replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').slice(0,160)||'file';
 function csv(rows){return '\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';}
 function validateProject(p){
  if(!p||p.schemaVersion!==SCHEMA||typeof p.id!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(p.id)||typeof p.name!=='string'||!Array.isArray(p.sessions)||!p.sessions.length||p.sessions.length>200)throw new Error('Неизвестный формат проекта.');
  const ids=new Set(),codes=new Set();
  for(const s of p.sessions){
   if(typeof s.id!=='string'||ids.has(s.id)||!Array.isArray(s.frames)||s.frames.length!==24||!s.reference)throw new Error('Некорректная структура сессии.');ids.add(s.id);
   if(!/^[A-Za-z0-9_-]{1,30}$/.test(s.code)||codes.has(s.code))throw new Error('Некорректный или повторный код сессии.');codes.add(s.code);
   if(!s.analysisSettings||!s.reference.scale||!s.reference.control||!['scale','control'].every(k=>Array.isArray(s.reference[k].readings)&&s.reference[k].readings.length===5))throw new Error('В архиве отсутствуют поля опорных измерений.');
   if(s.reconstruction&&(typeof s.reconstruction.cameras!=='string'||typeof s.reconstruction.images!=='string'))throw new Error('Некорректная запись камер.');
   for(let i=0;i<24;i++){
    const f=s.frames[i];if(f.slot!==i+1||f.group!==GROUPS[Math.floor(i/6)]||!Array.isArray(f.attempts)||f.attempts.length>100)throw new Error('Некорректный план кадров.');
    for(const a of f.attempts){if(typeof a.id!=='string'||ids.has(a.id)||!a.visibility||!a.points||typeof a.originalKey!=='string'||!a.position||!Array.isArray(a.revisions)||typeof a.workingName!=='string'||!/^[A-Za-z0-9_.-]+\.png$/.test(a.workingName))throw new Error('Некорректная запись фотографии.');ids.add(a.id);
     if(!['pending','accepted','rejected'].includes(a.status))throw new Error('Некорректный статус снимка.');
     for(const k of POINTS){if(!['unknown','visible','occluded'].includes(a.visibility[k]))throw new Error('Некорректная видимость точки.');const pt=a.points[k];if(pt!==null&&(!Array.isArray(pt)||pt.length!==2||!pt.every(Number.isFinite)))throw new Error('Некорректные координаты точки.');if(a.visibility[k]==='visible'&&(!pt||pt[0]<0||pt[1]<0||pt[0]>=a.width||pt[1]>=a.height))throw new Error('Точка выходит за размер изображения.');}
    }
    if(f.activeId!==null&&!f.attempts.some(a=>a.id===f.activeId))throw new Error('Активная попытка не найдена.');
   }
  }
  return p;
 }
 const api={VERSION,SCHEMA,POINTS,GROUPS,GROUP_NAMES,uid,clone,reference,session,project,attempt,active,number,referenceStats,counts,annotationReady,escape,escapeHTML:escape,safeName,csv,validateProject};root.LabCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
