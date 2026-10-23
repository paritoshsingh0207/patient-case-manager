'use strict';
const crypto=require('node:crypto'),zlib=require('node:zlib');
const FORMAT='pcm-firestore-encrypted-backup',ROOTS=Object.freeze(['users','patients','medicineCodes','auditEvents']);
const MAX_DOCS=30000,MAX_SIZE=128*1024*1024;
function fail(s){throw Error(s)}
function validProject(x){return typeof x==='string'&&/^[a-z][a-z0-9-]{4,29}$/.test(x)}
function validPath(path){
 if(typeof path!=='string'||path.length>12000)return false;
 const p=path.split('/');
 return p.length>=2&&p.length%2===0&&ROOTS.includes(p[0])&&(p[0]==='patients'||p.length===2)
   &&p.every(x=>x&&x!=='.'&&x!=='..'&&!/[\u0000-\u001f]/.test(x)&&!/^__.*__$/.test(x));
}
function canonical(raw){
 if(!raw||raw.schema!==1||!validProject(raw.sourceProject)||!Array.isArray(raw.documents))fail('Unsupported or malformed backup.');
 if(raw.documents.length>MAX_DOCS)fail('Too many documents for this backup format.');
 const documents=[...raw.documents].sort((a,b)=>a.path.localeCompare(b.path)),seen=new Set();
 for(const d of documents){
  if(!d||!validPath(d.path)||seen.has(d.path)||!d.fields||typeof d.fields!=='object'||Array.isArray(d.fields))
   fail('Duplicate, unknown-scope or malformed Firestore document.');
  seen.add(d.path);
 }
 return {schema:1,sourceProject:raw.sourceProject,exportedAt:raw.exportedAt??null,roots:ROOTS,documents};
}
function digest(a){return crypto.createHash('sha256').update(JSON.stringify(canonical(a))).digest('hex')}
function encrypt(source,pass){
 if(typeof pass!=='string'||pass.length<16)fail('Passphrase must contain at least 16 characters.');
 const archive=canonical(source),plain=Buffer.from(JSON.stringify({archive,digest:digest(archive)}));
 if(plain.length>MAX_SIZE)fail('Too much data for in-memory encrypted backup.');
 const salt=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const key=crypto.scryptSync(pass,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const enc=crypto.createCipheriv('aes-256-gcm',key,iv);enc.setAAD(Buffer.from(FORMAT+':1'));
 const payload=Buffer.concat([enc.update(zlib.gzipSync(plain,{level:9})),enc.final()]);key.fill(0);
 return Buffer.from(JSON.stringify({format:FORMAT,version:1,cipher:'aes-256-gcm',
  kdf:{name:'scrypt',N:32768,r:8,p:1,salt:salt.toString('base64')},
  iv:iv.toString('base64'),tag:enc.getAuthTag().toString('base64'),payload:payload.toString('base64')})+'\n');
}
function decrypt(bytes,pass){
 if(typeof pass!=='string'||!pass)fail('Backup passphrase required.');
 let obj;try{obj=JSON.parse(Buffer.isBuffer(bytes)?bytes.toString():bytes)}catch{fail('Invalid backup container.')}
 if(obj?.format!==FORMAT||obj.version!==1||obj.cipher!=='aes-256-gcm'||obj.kdf?.name!=='scrypt'
 ||obj.kdf.N!==32768||obj.kdf.r!==8||obj.kdf.p!==1)fail('Unsupported backup envelope.');
 const salt=Buffer.from(obj.kdf.salt||'','base64'),iv=Buffer.from(obj.iv||'','base64'),
  tag=Buffer.from(obj.tag||'','base64'),payload=Buffer.from(obj.payload||'','base64');
 if(salt.length!==32||iv.length!==12||tag.length!==16||!payload.length||payload.length>MAX_SIZE)
  fail('Malformed or oversized backup container.');
 const key=crypto.scryptSync(pass,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 let plain;try{
  const dec=crypto.createDecipheriv('aes-256-gcm',key,iv);
  dec.setAAD(Buffer.from(FORMAT+':1'));dec.setAuthTag(tag);
  plain=zlib.gunzipSync(Buffer.concat([dec.update(payload),dec.final()]),{maxOutputLength:MAX_SIZE});
 }catch{fail('Backup authentication failed: wrong passphrase or damaged file.')}
 finally{key.fill(0);}
 let result;try{result=JSON.parse(plain.toString())}catch{fail('Invalid decrypted backup data.')}
 if(!result?.archive||result.digest!==digest(result.archive))fail('Backup integrity check failed.');
 return canonical(result.archive);
}
function counts(a){const result=Object.fromEntries(ROOTS.map(k=>[k,0]));for(const d of a.documents)result[d.path.split('/')[0]]++;return result}
module.exports={FORMAT,ROOTS,MAX_DOCS,canonical,digest,encrypt,decrypt,counts,validPath,validProject};
