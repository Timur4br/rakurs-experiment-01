(function(root){
 'use strict';
 let opened;
 function open(){if(opened)return opened;opened=new Promise((resolve,reject)=>{const req=indexedDB.open('rakurs-experiment-one',1);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('projects',{keyPath:'id'});db.createObjectStore('media',{keyPath:'key'});};req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Закройте другую вкладку приложения и повторите.'));});return opened;}
 async function transaction(stores,mode,operation){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode);let result;try{result=operation(tx);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error('Не удалось сохранить данные.'));tx.onabort=()=>reject(tx.error||new Error('Сохранение отменено.'));});}
 async function get(store,key){const db=await open();return new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
 async function list(){const db=await open();return new Promise((resolve,reject)=>{const req=db.transaction('projects').objectStore('projects').getAll();req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));req.onerror=()=>reject(req.error);});}
 async function save(project,media=[]){project.updatedAt=new Date().toISOString();await transaction(['projects','media'],'readwrite',tx=>{for(const item of media)tx.objectStore('media').put(item);tx.objectStore('projects').put(project);});return project;}
 async function blob(key){const item=await get('media',key);if(!item)throw new Error('Файл не найден в локальном хранилище. Восстановите его из резервного архива.');return item.blob;}
 root.LabStore={open,list,getProject:id=>get('projects',id),save,blob};
})(globalThis);
