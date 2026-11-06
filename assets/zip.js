(function(root){
 'use strict';
 const enc=new TextEncoder(),dec=new TextDecoder('utf-8'),MAX=0xffffffff;
 const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 async function crc32(blob){let crc=0xffffffff;const reader=blob.stream().getReader();try{while(true){const {done,value}=await reader.read();if(done)break;for(const b of value)crc=table[(crc^b)&255]^(crc>>>8);}}finally{reader.releaseLock();}return (crc^0xffffffff)>>>0;}
 function safePath(name){if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.'||!p)||/^[A-Za-z]:/.test(name)||name.includes('\0'))throw new Error('Недопустимый путь внутри архива.');return name;}
 const header=n=>{const a=new Uint8Array(n);return [a,new DataView(a.buffer)];};
 async function create(entries,onProgress=()=>{}){
  if(entries.length>65534)throw new Error('Слишком много файлов для ZIP32.');
  let offset=0;const parts=[],central=[],names=new Set();
  for(let index=0;index<entries.length;index++){
   const {name,blob}=entries[index];safePath(name);if(names.has(name))throw new Error('Повторный путь внутри архива.');names.add(name);
   const bytes=enc.encode(name);if(bytes.length>65535||blob.size>MAX||offset+blob.size+bytes.length+30>MAX)throw new Error('Архив превышает ограничение ZIP32 в 4 ГБ. Экспортируйте сессии отдельно.');
   const crc=await crc32(blob),[local,l]=header(30);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(8,0,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,blob.size,true);l.setUint32(22,blob.size,true);l.setUint16(26,bytes.length,true);
   parts.push(local,bytes,blob);
   const [dir,d]=header(46);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,blob.size,true);d.setUint32(24,blob.size,true);d.setUint16(28,bytes.length,true);d.setUint32(42,offset,true);central.push(dir,bytes);offset+=30+bytes.length+blob.size;onProgress(index+1,entries.length,name);
  }
  const centralSize=central.reduce((s,p)=>s+p.length,0);if(offset+centralSize+22>MAX)throw new Error('Архив слишком велик.');
  const [end,e]=header(22);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
 }
 async function read(file){
  const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65557)).arrayBuffer());let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(new DataView(tail.buffer,tail.byteOffset+i,4).getUint32(0,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Не найден каталог ZIP.');const e=new DataView(tail.buffer,tail.byteOffset+end),count=e.getUint16(10,true),size=e.getUint32(12,true),offset=e.getUint32(16,true);
  if(count===65535||offset===MAX||size===MAX||count>10000||offset+size>file.size)throw new Error('ZIP64, повреждённый или слишком большой архив не поддерживается.');
  const bytes=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer()),entries=new Map();let pos=0,total=0;
  for(let n=0;n<count;n++){
   if(pos+46>bytes.length)throw new Error('Повреждён каталог ZIP.');const d=new DataView(bytes.buffer,bytes.byteOffset+pos);if(d.getUint32(0,true)!==0x02014b50)throw new Error('Неверная запись ZIP.');
   const flags=d.getUint16(8,true),method=d.getUint16(10,true),crc=d.getUint32(16,true),compressed=d.getUint32(20,true),uncompressed=d.getUint32(24,true),nameLen=d.getUint16(28,true),extra=d.getUint16(30,true),comment=d.getUint16(32,true),localOffset=d.getUint32(42,true);
   const name=dec.decode(bytes.slice(pos+46,pos+46+nameLen));pos+=46+nameLen+extra+comment;
   if(name.endsWith('/'))continue;safePath(name);if(entries.has(name)||flags&1||![0,8].includes(method)||uncompressed===MAX||localOffset>=offset)throw new Error('Повреждённый, зашифрованный или неподдерживаемый ZIP.');
   total+=uncompressed;if(total>3*1024**3)throw new Error('Архив распаковывается более чем в 3 ГБ.');
   entries.set(name,{name,size:uncompressed,async blob(type='application/octet-stream'){
    const h=new DataView(await file.slice(localOffset,localOffset+30).arrayBuffer());if(h.byteLength!==30||h.getUint32(0,true)!==0x04034b50)throw new Error('Повреждён заголовок файла ZIP.');
    const start=localOffset+30+h.getUint16(26,true)+h.getUint16(28,true);if(start+compressed>offset)throw new Error('Файл выходит за границы архива.');
    let blob=file.slice(start,start+compressed,type);
    if(method===8){if(typeof DecompressionStream==='undefined')throw new Error('В этом браузере нет распаковки Deflate. Откройте архив в современном Chrome или Edge.');blob=await new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();}
    if(blob.size!==uncompressed||await crc32(blob)!==crc)throw new Error(`Не совпала контрольная сумма ${name}.`);return blob.slice(0,blob.size,type);
   }});
  }
  return entries;
 }
 const api={create,read,crc32,safePath};root.LabZip=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
