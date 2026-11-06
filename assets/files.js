(function(root){
 'use strict';
 const C=root.LabCore,Z=root.LabZip,S=root.LabStore;
 const textBlob=(s,type='text/plain')=>new Blob([s],{type:type+';charset=utf-8'});
 const jsonBlob=x=>textBlob(JSON.stringify(x,null,2),'application/json');
 async function hash(blob){if(!crypto.subtle)throw new Error('Для контроля файлов откройте приложение через HTTPS или localhost в современном браузере.');const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
 async function loadImage(blob){const url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();return image;}finally{URL.revokeObjectURL(url);}}
 const toBlob=(canvas,type='image/png',quality)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось подготовить изображение.')),type,quality));
 async function normalize(blob){
  const image=await loadImage(blob),width=image.naturalWidth,height=image.naturalHeight;
  if(!(width>0&&height>0)||width*height>60e6)throw new Error('Изображение слишком велико: максимум 60 мегапикселей для рабочего просмотра.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0);
  const working=await toBlob(canvas),thumb=document.createElement('canvas'),ratio=Math.min(1,320/Math.max(width,height));thumb.width=Math.round(width*ratio);thumb.height=Math.round(height*ratio);thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);
  const thumbnail=await toBlob(thumb,'image/jpeg',.78);canvas.width=canvas.height=1;
  return {working,thumbnail,width,height};
 }
 async function preparePhoto(file,projectId,slot,reason=''){
  if(file.size>100*1024**2)throw new Error('Один оригинал не должен превышать 100 МБ.');if(/svg|html/i.test(file.type))throw new Error('Загружайте растровую фотографию JPEG, PNG, WebP или HEIC.');
  const record=C.attempt(file,projectId,slot,reason),media=[];record.originalHash=await hash(file);record.originalLastModified=file.lastModified||null;media.push({key:record.originalKey,blob:file});
  try{const normalized=await normalize(file);Object.assign(record,{width:normalized.width,height:normalized.height,workingKey:`${projectId}/${record.id}/working`,thumbKey:`${projectId}/${record.id}/thumb`,workingHash:await hash(normalized.working)});media.push({key:record.workingKey,blob:normalized.working},{key:record.thumbKey,blob:normalized.thumbnail});}
  catch(error){record.previewIssue=error.message;}
  return {record,media};
 }
 function journal(s){
  const frames=[['session_id','slot','group','attempt','active','working_name','original_name','original_sha256','status','retake_reason','notes','azimuth_deg_approx','height_mm_approx','distance_mm_approx','elapsed_seconds']];
  const points=[['session_id','slot','attempt_id','working_name','point','visibility','x_working_px','y_working_px','working_width','working_height','coordinate_system']];
  for(const f of s.frames)for(const [i,a]of f.attempts.entries()){
   frames.push([s.code,f.slot,f.group,i+1,a.id===f.activeId,a.workingName,a.originalName,a.originalHash,a.status,a.retakeReason,a.notes,a.position.azimuth,a.position.height,a.position.distance,a.position.elapsed]);
   for(const k of C.POINTS)points.push([s.code,f.slot,a.id,a.workingName,k,a.visibility[k],a.points[k]?.[0]??'',a.points[k]?.[1]??'',a.width,a.height,'decoded_display_orientation_working_png']);
  }
  const refs=[['session_id','quantity','repeat','reading_mm','instrument','resolution_mm','other_standard_uncertainty_mm','endpoints','repositioned','instrument_relationship']];
  for(const type of ['scale','control']){const r=s.reference[type];r.readings.forEach((v,i)=>refs.push([s.code,type,i+1,v,r.instrument,r.resolution,r.standardB,r.definition,r.repositioned,s.reference.relationship]));}
  return {frames:C.csv(frames),points:C.csv(points),reference:C.csv(refs)};
 }
 function analysisInput(s){return {schemaVersion:1,session:{code:s.code,objectId:s.objectId,condition:s.condition,phone:s.phone,lens:s.lens,newSetup:s.newSetup,notes:s.notes},scale:s.reference.scale,controlBlinded:true,settings:s.analysisSettings,
   frames:s.frames.map(f=>{const a=C.active(f);return {slot:f.slot,group:f.group,attempt:a?{workingName:a.workingName,workingHash:a.workingHash,width:a.width,height:a.height,status:a.status,points:a.points,visibility:a.visibility,position:a.position,notes:a.notes}:null};})};}
 async function workingArchive(s,onProgress){
  const entries=[];for(const f of s.frames){const a=C.active(f);if(a?.workingKey)entries.push({name:'images/'+a.workingName,blob:await S.blob(a.workingKey)});}
  if(!entries.length)throw new Error('Сначала добавьте фотографии с рабочими копиями.');entries.push({name:'analysis-input.json',blob:jsonBlob(analysisInput(s))});
  entries.push({name:'README.txt',blob:textBlob('Рабочие PNG созданы декодированием оригиналов с применённой ориентацией, без уменьшения размера. Точки размечены в этих PNG. Для реконструкции используйте именно папку images. Контрольная длина предмета в этом пакете отсутствует. Файл analysis-input.json предназначен для ретроспективной проверки; настоящие опорные значения храните отдельно.')});
  return Z.create(entries,onProgress);
 }
 async function backup(project,onProgress){
  const entries=[],blobs=[];
  for(const s of project.sessions){const base='sessions/'+s.code,j=journal(s);entries.push({name:base+'/frames.csv',blob:textBlob(j.frames,'text/csv')},{name:base+'/annotations.csv',blob:textBlob(j.points,'text/csv')},{name:base+'/reference/measurements.csv',blob:textBlob(j.reference,'text/csv')});
   if(s.reconstruction)entries.push({name:base+'/reconstruction/cameras.txt',blob:textBlob(s.reconstruction.cameras)},{name:base+'/reconstruction/images.txt',blob:textBlob(s.reconstruction.images)});
   for(const f of s.frames)for(const [i,a]of f.attempts.entries()){
    const stem=`${String(f.slot).padStart(3,'0')}_a${i+1}_${a.id.slice(0,8)}_`;
    for(const [field,folder,name,mime,sha]of [['originalKey','photos',stem+C.safeName(a.originalName),a.originalType,a.originalHash],['workingKey','working',a.workingName,'image/png',a.workingHash],['thumbKey','thumbnails',a.id+'.jpg','image/jpeg',null]]){
     if(!a[field])continue;const path=`${base}/${folder}/${name}`,blob=await S.blob(a[field]);entries.push({name:path,blob});blobs.push({key:a[field],path,mime,sha256:sha,size:blob.size});
    }
   }
  }
  entries.unshift({name:'manifest.json',blob:jsonBlob({format:'rakurs-experiment-backup',schemaVersion:1,exportedAt:new Date().toISOString(),project,blobs})});return Z.create(entries,onProgress);
 }
 async function importBackup(file,onProgress=()=>{}){
  const entries=await Z.read(file),manifestEntry=entries.get('manifest.json');if(!manifestEntry||manifestEntry.size>64*1024**2)throw new Error('Это не резервный архив приложения.');const manifest=JSON.parse(await(await manifestEntry.blob('application/json')).text());
  if(manifest.format!=='rakurs-experiment-backup'||manifest.schemaVersion!==1||!Array.isArray(manifest.blobs))throw new Error('Неизвестный формат резервного архива.');
  const project=C.clone(C.validateProject(manifest.project)),oldId=project.id,newId=C.uid(),mapping=new Map(),media=[];
  for(const [i,descriptor]of manifest.blobs.entries()){
   if(typeof descriptor.key!=='string'||!descriptor.key.startsWith(oldId+'/')||mapping.has(descriptor.key)||!entries.has(descriptor.path)||descriptor.size>300*1024**2)throw new Error('Некорректное описание файла в архиве.');
   const blob=await entries.get(descriptor.path).blob(descriptor.mime);if(blob.size!==descriptor.size)throw new Error('Размер файла не совпал с описанием.');if(descriptor.sha256&&await hash(blob)!==descriptor.sha256)throw new Error('Не совпала SHA-256 файла '+descriptor.path);
   const key=newId+'/'+descriptor.key.slice(oldId.length+1);mapping.set(descriptor.key,key);media.push({key,blob});onProgress(i+1,manifest.blobs.length,descriptor.path);
  }
  for(const s of project.sessions)for(const f of s.frames)for(const a of f.attempts)for(const field of ['originalKey','workingKey','thumbKey'])if(a[field]){if(!mapping.has(a[field]))throw new Error('В архиве отсутствует необходимый файл.');a[field]=mapping.get(a[field]);}
  project.sourceProjectId=oldId;project.id=newId;project.name+=' · восстановлено';project.importedAt=new Date().toISOString();return {project,media};
 }
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 root.LabFiles={hash,loadImage,normalize,preparePhoto,journal,analysisInput,workingArchive,backup,importBackup,download,textBlob,jsonBlob};
})(globalThis);
