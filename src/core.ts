import { Temporal } from '@js-temporal/polyfill';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, link, rename, unlink, readFile, chmod, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const zone = 'America/Toronto';
export const hash = (value:string):string => createHash('sha256').update(value).digest('hex');
export class SafeError extends Error {
  constructor(public code:string) { super(code); this.name='SafeError'; }
}
export function date(value:string):Temporal.PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new SafeError('invalid_date');
  const result=Temporal.PlainDate.from(value);
  if (result.toString()!==value) throw new SafeError('invalid_date');
  return result;
}
export function today():string { return Temporal.Now.plainDateISO(zone).toString(); }
export function boundaries(since:string,until:string):{ date:string; lo:number; hi:number }[] {
  let current=date(since); const last=date(until);
  if (Temporal.PlainDate.compare(current,last)>0 || current.until(last).days>3660) throw new SafeError('invalid_period');
  const result=[];
  while (Temporal.PlainDate.compare(current,last)<=0) {
    const next=current.add({days:1});
    result.push({date:current.toString(),lo:Number(current.toZonedDateTime(zone).epochMilliseconds),hi:Number(next.toZonedDateTime(zone).epochMilliseconds)});
    current=next;
  }
  return result;
}
export function timestamp(value:unknown):number|null {
  if (typeof value==='number') return Number.isSafeInteger(value)&&value>=0?value:null;
  if (typeof value!=='string' || !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const result=Date.parse(value); return Number.isFinite(result)&&result>=0?result:null;
}
export function localDate(value:string):string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value).toString();
  const stamp=timestamp(value); if (stamp===null) throw new SafeError('invalid_punch_date');
  return Temporal.Instant.fromEpochMilliseconds(stamp).toZonedDateTimeISO(zone).toPlainDate().toString();
}
export function stable(value:unknown):string {
  if (Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
/** Strict JSON: reject duplicate keys at any depth, non-finite numbers and trailing prose. */
export function strictJSON(text:string,parseNumber?:(literal:string)=>unknown):any {
  let i=0; const ws=()=>{ while (/[ \t\r\n]/.test(text[i]??'') && i<text.length) i++; };
  const bad=():never=>{throw new SafeError('invalid_json');};
  function string():string {
    const start=i++; while (i<text.length) {
      const c=text[i++];
      if (c==='\\') { i++; continue; }
      if (c==='"') return JSON.parse(text.slice(start,i));
    }
    return bad();
  }
  function value(depth=0):any {
    if (depth>100) return bad(); ws();
    if (text[i]==='"') return string();
    if (text[i]==='{') {
      i++; ws(); const result:Record<string,unknown>=Object.create(null); const seen=new Set<string>();
      if (text[i]==='}') { i++; return result; }
      while (i<text.length) {
        ws(); if (text[i]!=='"') return bad(); const key=string();
        if (seen.has(key)) return bad(); seen.add(key); ws(); if (text[i++]!==':') return bad();
        result[key]=value(depth+1); ws(); const c=text[i++];
        if (c==='}') return result; if (c!==',') return bad();
      }
      return bad();
    }
    if (text[i]==='[') {
      i++; ws(); const result:any[]=[]; if (text[i]===']') { i++; return result; }
      while (i<text.length) { result.push(value(depth+1)); ws(); const c=text[i++]; if (c===']') return result; if (c!==',') return bad(); }
      return bad();
    }
    const token=text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!token) return bad(); i+=token.length; const result=JSON.parse(token);
    if (typeof result==='number'&&!Number.isFinite(result)) return bad();
    return typeof result==='number'&&parseNumber?parseNumber(token):result;
  }
  const result=value(); ws(); if (i!==text.length) return bad(); return result;
}
export async function readJSON(path:string):Promise<any> { return strictJSON(await readFile(path,'utf8')); }
/** Create owner-only files; atomically publish. Never replace a pre-existing report. */
export async function privateWrite(path:string,text:string|Uint8Array,replace=false):Promise<void> {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  // Reject redirected private output folders rather than follow a local/ symlink.
  for(const directory of [dirname(path),dirname(dirname(path))]) {
    if((await lstat(directory)).isSymbolicLink()) throw new SafeError('private_directory_symlink');
  }
  const temp=join(dirname(path),'.agent-hours-'+randomUUID());
  try {
    await writeFile(temp,text,{mode:0o600,flag:'wx'});
    if (replace) await rename(temp,path); else await link(temp,path);
    await chmod(path,0o600);
  } finally { await unlink(temp).catch(()=>{}); }
}
export function mergeSpans(spans:[number,number][]):[number,number][] {
  const result:[number,number][]=[];
  for (const [a,b] of [...spans].sort((x,y)=>x[0]-y[0])) {
    const last=result.at(-1);
    if (last && a<=last[1]) last[1]=Math.max(last[1],b); else result.push([a,b]);
  }
  return result;
}
