(function(root){
 'use strict';
 const C=root.LabCore||(typeof require!=='undefined'?require('./core.js'):null),G=root.LabGeometry||(typeof require!=='undefined'?require('./geometry.js'):null);
 const STRATEGIES=['object_only','periodic','alternating','frozen','adaptive','wide','random'];
 const NAMES={object_only:'Вокруг объекта',periodic:'Эталон каждый третий',alternating:'Чередование 1 к 1',frozen:'План по первым кадрам',adaptive:'Адаптивный выбор',wide:'Общие планы',random:'Случайный выбор'};
 function prepareSession(s){
  if(!s.reconstruction)throw new Error('Сначала импортируйте cameras.txt и images.txt.');const model=G.parseCOLMAP(s.reconstruction.cameras,s.reconstruction.images),frames=[],excluded=[];
  for(const f of s.frames){const a=C.active(f);if(!a){excluded.push({slot:f.slot,reason:'Нет снимка'});continue;}
   if(a.status!=='accepted'){excluded.push({slot:f.slot,reason:a.status==='rejected'?'Кадр отклонён':'Не проверен'});continue;}
   if(!C.annotationReady(a)){excluded.push({slot:f.slot,reason:'Не завершена разметка'});continue;}
   let view=model.views[a.workingName];if(!view){const matches=Object.values(model.views).filter(v=>v.name.replace(/\\/g,'/').split('/').pop()===a.workingName);if(matches.length===1)view=matches[0];}
   if(!view){excluded.push({slot:f.slot,reason:'Нет позы в реконструкции'});continue;}
   if(view.camera.width!==a.width||view.camera.height!==a.height){excluded.push({slot:f.slot,reason:'Размеры камеры не совпадают с рабочим изображением'});continue;}
   const points=Object.fromEntries(C.POINTS.map(k=>[k,a.visibility[k]==='visible'?a.points[k]:null]));frames.push({slot:f.slot,group:f.group,view,points,attemptId:a.id});
  }
  const scale=C.referenceStats(s.reference.scale);if(!scale.mean||scale.invalid)throw new Error('Заполните корректные показания длины масштабного образца.');
  const sigma=C.number(s.analysisSettings.pixelSigma);if(!(sigma>0&&sigma<=100))throw new Error('Шум разметки должен быть больше 0 и не превышать 100 пикселей.');
  return {frames,excluded,model,scale,sigma};
 }
 function calculate(s){
  const data=prepareSession(s);if(data.frames.length<2)throw new Error('Недостаточно принятых кадров с позами и разметкой.');
  let result;try{result=G.fitFrames(data.frames,data.sigma,data.scale.mean,data.scale.u);}catch(e){throw new Error('Восстановление не выполнено: '+e.message);}
  const control=C.referenceStats(s.reference.control);return {result,excluded:data.excluded,used:data.frames.map(f=>f.slot),scale:data.scale,control,pixelSigma:data.sigma,referenceDifference:control.mean===null?null:result.q-control.mean,conditional:true,retrospective:true};
 }
 function addExpected(plan,view,sigma){
  for(const k of C.POINTS){const p=plan.points[k],xy=G.project(p.P,view);if(!xy||xy[0]<0||xy[1]<0||xy[0]>=view.camera.width||xy[1]>=view.camera.height)continue;const J=G.jacobian(p.P,view);for(const row of J)for(let i=0;i<3;i++)for(let j=0;j<3;j++)p.H[i*3+j]+=row[i]*row[j]/sigma**2;p.covariance=G.inverse(p.H);}
 }
 function randomOrder(list){let x=42;return list.map(f=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return {f,r:x};}).sort((a,b)=>a.r-b.r).map(x=>x.f.slot);}
 function strategies(s){
  const d=prepareSession(s),initial=d.frames.filter(f=>f.group==='initial'),candidates=d.frames.filter(f=>f.group!=='initial');
  if(initial.length!==6)throw new Error('Для сравнения нужны все шесть начальных кадров: принятые, размеченные и зарегистрированные.');
  const budget=Number(s.analysisSettings.budget);if(!Number.isInteger(budget)||budget<1||budget>6)throw new Error('Для плана из 24 кадров бюджет сравнения составляет от 1 до 6 дополнительных кадров.');
  let first;try{first=G.fitFrames(initial,d.sigma,d.scale.mean,d.scale.u);}catch(e){throw new Error('Начальный набор не восстанавливает все четыре точки: '+e.message);}
  const plan=C.clone(first),planned=[],random=randomOrder(candidates);
  for(let step=0;step<budget;step++){const available=candidates.filter(f=>!planned.includes(f.slot));if(!available.length)break;available.sort((a,b)=>G.predict(plan,a.view,d.sigma)-G.predict(plan,b.view,d.sigma)||a.slot-b.slot);const a=available[0];planned.push(a.slot);addExpected(plan,a.view,d.sigma);}
  const runs={};
  for(const strategy of STRATEGIES){let selected=initial.slice(),current=first;const history=[{step:0,slots:selected.map(f=>f.slot),q:current.q,u:current.u}],used=[];let reason=null;
   for(let step=0;step<budget;step++){
    let available=candidates.filter(f=>!used.includes(f.slot));let group=null;
    if(strategy==='object_only')group='object';if(strategy==='wide')group='wide';if(strategy==='periodic')group=(step+1)%3===0?'reference':'object';if(strategy==='alternating')group=step%2===0?'object':'reference';if(group)available=available.filter(f=>f.group===group);
    let next;if(strategy==='frozen')next=available.find(f=>f.slot===planned[step]);else if(strategy==='random')next=available.find(f=>f.slot===random.find(slot=>!used.includes(slot)));else{available.sort((a,b)=>G.predict(current,a.view,d.sigma)-G.predict(current,b.view,d.sigma)||a.slot-b.slot);next=available[0];}
    if(!next){reason='Недостаточно доступных кадров нужной группы';break;}
    used.push(next.slot);selected.push(next);try{current=G.fitFrames(selected,d.sigma,d.scale.mean,d.scale.u);}catch(e){reason=e.message;break;}
    history.push({step:step+1,slot:next.slot,slots:selected.map(f=>f.slot),q:current.q,u:current.u});
   }
   runs[strategy]={history,complete:history.length===budget+1,reason,final:history.at(-1)};
  }
  return {runs,budget,excluded:d.excluded,scale:d.scale,conditional:true,retrospective:true};
 }
 const api={prepareSession,calculate,strategies,STRATEGIES,NAMES};root.LabAnalysis=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
