import { Database } from 'bun:sqlite';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { createZstdDecompress, constants } from 'node:zlib';
import { basename, dirname, join, resolve } from 'node:path';
import { boundaries, hash, stable, timestamp, mergeSpans, SafeError, strictJSON } from './core.ts';
import type { Candidate, Client, Session, RecordEntry, SourceStatus, Span } from './types.ts';
import { reasonCodes } from './types.ts';
import { StrictZstdFrames } from './zstd.ts';
import { telemetry,meta,mergeTelemetry,claudeTelemetry,codexTelemetry,nativeUsage,addUsage,addTool,category,commandFamily } from './telemetry.ts';
import { exportEntries,readExportEntry,desktopConversation } from './desktop.ts';

const TEXT_LIMIT=300_000;
export const newSession=(client:Client,identity:string,directory:string|null=null):Session => ({ client,identity,directory,records:new Map(),sources:[],reasons:new Set(),incomplete:false,conflict:false,retained:0,telemetry:telemetry() });
export function addRecord(s:Session,id:string,record:RecordEntry):void {
  if (record.start===null) { s.incomplete=true; s.reasons.add('missing_message_timestamp'); }
  const prior=s.records.get(id);
  if (prior) { if (prior.fingerprint!==record.fingerprint) { s.conflict=true; s.reasons.add('conflicting_messages'); } return; }
  if (s.retained+record.text.length>TEXT_LIMIT) { s.incomplete=true; s.reasons.add('transcript_text_limit'); record={...record,text:''}; }
  else s.retained+=record.text.length;
  s.records.set(id,record);
}
export function combine(a:Session,b:Session):Session {
  if (a.directory!==b.directory) { a.conflict=true; a.reasons.add('conflicting_session_directories'); }
  a.incomplete ||= b.incomplete; a.conflict ||= b.conflict;
  b.reasons.forEach(r=>a.reasons.add(r));
  a.sources=[...new Set([...a.sources,...b.sources])];
  for (const [id,record] of b.records) addRecord(a,id,record);
  mergeTelemetry(meta(a),meta(b));
  return a;
}
export function transcript(s:Session):string {
  return [...s.records.values()].sort((a,b)=>(a.start??-1)-(b.start??-1)).filter(r=>r.text).map(r=>r.role+': '+r.text).join('\n');
}
export function spans(s:Session):Span[] {
  if (s.client==='opencode') return mergeSpans([...s.records.values()].filter(r=>r.role==='assistant'&&r.start!==null&&r.end!==null&&r.end>=r.start).map(r=>[r.start!,r.end!]));
  const points=[...new Set([...s.records.values()].map(r=>r.start).filter((n):n is number=>n!==null))].sort((a,b)=>a-b);
  return points.slice(1).flatMap((b,i)=>b-points[i]<=180_000&&b>points[i]?[[points[i],b] as Span]:[]);
}
export function messageGapSpans(s:Session):Span[] {
  const points=[...new Set([...s.records.values()].map(r=>r.start).filter((n):n is number=>n!==null))].sort((a,b)=>a-b);
  return points.slice(1).flatMap((b,i)=>b-points[i]<=180_000&&b>points[i]?[[points[i],b] as Span]:[]);
}
function relevant(s:Session,lo:number,hi:number):boolean {
    return [...s.records.values()].some(r=>r.start!==null && ((lo<=r.start&&r.start<hi)||(r.start<lo&&r.end!==null&&r.end>lo)))||
      [...(s.telemetry?.tools.values()??[])].some(e=>[e.start,e.end].some(t=>t!==null&&lo<=t&&t<hi)||(e.start!==null&&e.end!==null&&e.start<hi&&e.end>lo))||
      [...(s.telemetry?.turns.values()??[])].some(e=>e.at!==null&&lo<=e.at&&e.at<hi)||
      [...(s.telemetry?.usage.values()??[])].some(e=>e.at!==null&&lo<=e.at&&e.at<hi)||
      [...(s.telemetry?.recorded_spans.values()??[])].some(([a,b])=>a<hi&&b>lo);
}
export function historyDates(s:Session,days:ReturnType<typeof boundaries>):string[] {
  return days.filter(d=>relevant(s,d.lo,d.hi)).map(d=>d.date);
}
export async function* lines(path:string,maxBytes=256*1024*1024,maxLine=16*1024*1024):AsyncGenerator<string> {
  const source=createReadStream(path,{highWaterMark:64*1024});
  const decoder=path.toLowerCase().endsWith('.zst')?createZstdDecompress({params:{[constants.ZSTD_d_windowLogMax]:26}}):null;
  const frames=decoder?new StrictZstdFrames():null;
  if (decoder) source.on('error',()=>decoder.destroy(new SafeError('transcript_read_failed')));
  if (decoder&&frames) frames.on('error',()=>decoder.destroy(new SafeError('transcript_read_failed')));
  const stream=decoder&&frames?source.pipe(frames).pipe(decoder):source;
  let total=0; let pending=Buffer.alloc(0); let first=true;
  const utf8=new TextDecoder('utf-8',{fatal:true});
  try {
    for await (const chunk of stream) {
      const buffer=Buffer.from(chunk); total+=buffer.length;
      if (total>maxBytes) throw new SafeError('transcript_size_limit');
      pending=Buffer.concat([pending,buffer]); let end:number;
      while ((end=pending.indexOf(10))>=0) {
        if (end+1>maxLine) throw new SafeError('transcript_size_limit');
        let text=utf8.decode(pending.subarray(0,end+1)); pending=pending.subarray(end+1);
        if (first) { text=text.replace(/^\uFEFF/,''); first=false; } yield text;
      }
      if (pending.length>maxLine) throw new SafeError('transcript_size_limit');
    }
    if (pending.length) yield utf8.decode(pending);
  } catch { throw new SafeError('transcript_read_failed'); }
  finally { stream.destroy(); frames?.destroy(); source.destroy(); }
}
export async function transcriptPaths(root:string,client:Client):Promise<string[]> {
  const result:string[]=[]; const canonical=await realpath(root);
  async function visit(path:string):Promise<void> {
    for (const entry of await readdir(path,{withFileTypes:true})) {
      // Never follow symlinks out of a declared source folder.
      if (entry.isSymbolicLink()) continue;
      const full=join(path,entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) {
        const name=entry.name.toLowerCase();
        const accepted=client==='claude'?name.endsWith('.jsonl'):name.includes('.jsonl')&&!name.endsWith('.json')&&!name.endsWith('.json.migrated');
        if (accepted) result.push(full);
      }
    }
  }
  await visit(canonical); return result.sort();
}
function textContent(content:unknown):string {
  if (typeof content==='string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b=>b&&['text','input_text','output_text'].includes(b.type)&&typeof b.text==='string').map(b=>b.text).join('\n');
}
export async function readTranscript(path:string,client:Client,metadataOnly=false):Promise<Session> {
  const stem=basename(path).split(/\.jsonl/i)[0]; let identity=stem; let cwd:string|null=null; let hasResponses=false;let usageModel:string|undefined;
  const response=newSession(client,identity); const event=newSession(client,identity);
  for await (const line of lines(path)) {
    if (!line.trim()) continue;
    let rec:any;
    try { rec=strictJSON(line); if (!rec||typeof rec!=='object'||Array.isArray(rec)) throw 0; }
    catch { response.incomplete=event.incomplete=true; response.reasons.add('malformed_transcript'); event.reasons.add('malformed_transcript'); continue; }
    if (client==='codex'&&rec.type==='session_meta') { if (typeof rec.payload?.id==='string') identity=rec.payload.id; if (typeof rec.payload?.cwd==='string') cwd=rec.payload.cwd; }
    if (client==='claude') { if (typeof rec.sessionId==='string') identity=rec.sessionId; if (typeof rec.cwd==='string') cwd=rec.cwd; }
    if(client==='claude')claudeTelemetry(meta(response),rec);
    if(client==='codex'&&rec.type==='turn_context')usageModel=typeof rec.payload?.model==='string'?rec.payload.model:undefined;
    if(client==='codex')codexTelemetry(meta(response),rec,usageModel);
    let message=client==='claude'?rec.message:rec.payload;
    if (!message||typeof message!=='object') continue;
    let role=client==='claude'?rec.type:message.role; let target=response;
    if (client==='codex') {
      if (rec.type==='response_item'&&message.type==='message') { if (role==='user'||role==='assistant') hasResponses=true; }
      else if (rec.type==='event_msg'&&['user_message','agent_message'].includes(message.type)) {
        role=message.type==='user_message'?'user':'assistant'; message={content:message.message}; target=event;
      } else continue;
    }
    if (role!=='user'&&role!=='assistant') continue;
    const raw=textContent(message.content);
    const toolBlocks=Array.isArray(message.content)&&message.content.some((b:any)=>['tool_use','tool_result'].includes(b?.type));
    if (!raw&&!toolBlocks) continue;
    const start=timestamp(rec.timestamp); const directory=typeof rec.cwd==='string'?rec.cwd:cwd;
    // A content fingerprint detects changed/conflicting mirrors even in metadata mode.
    const fingerprint=hash(stable([role,start,null,raw,directory]));
    const native=client==='claude'?rec.uuid:message.id;
    const key=typeof native==='string'&&native?native:fingerprint;
    addRecord(target,key,{role,start,end:null,text:metadataOnly?'':raw,cwd:directory,fingerprint});
  }
  const result=client==='codex'&&!hasResponses?event:response;
  if(result===event)mergeTelemetry(meta(event),meta(response));
  if (client==='claude'&&basename(dirname(path))==='subagents') identity+=':subagent:'+stem;
  result.identity=identity; result.directory=cwd; result.sources=[path]; return result;
}
function readDatabase(path:string,metadataOnly=true,selected?:string):Session[] {
  const db=new Database(path,{readonly:true,create:false});
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    const sessions=selected?db.query('SELECT id,directory FROM session WHERE id=?').all(selected):db.query('SELECT id,directory FROM session').all();
    const hasParts=Boolean(db.query("SELECT 1 FROM sqlite_master WHERE name='part' AND type='table'").get());
    const rows=db.query(`SELECT id,json_extract(data,'$.role') role,json_extract(data,'$.time.created') start,
      json_extract(data,'$.time.completed') end,json_extract(data,'$.path.cwd') cwd,
      json_extract(data,'$.tokens') tokens,json_extract(data,'$.cost') cost,coalesce(json_extract(data,'$.modelID'),json_extract(data,'$.model.id')) model FROM message WHERE session_id=?`);
    return (sessions as {id:string;directory:string|null}[]).map(row=>{
      const s=newSession('opencode',row.id,row.directory); s.sources=[path];
      for (const rec of rows.all(row.id) as any[]) {
        if (rec.role!=='user'&&rec.role!=='assistant') continue;
        let text='';
        if (hasParts&&!metadataOnly) {
          const pieces:string[]=[];let length=0;
          const parts=db.query("SELECT substr(json_extract(data,'$.text'),1,300001) text FROM part WHERE message_id=? AND json_extract(data,'$.type')='text' ORDER BY id");
          for (const part of parts.iterate(rec.id) as Iterable<{text:unknown}>) {
            if (typeof part.text!=='string') continue;
            length+=part.text.length+(pieces.length?1:0);
            if (s.retained+length>TEXT_LIMIT) {s.incomplete=true;s.reasons.add('transcript_text_limit');pieces.length=0;break;}
            pieces.push(part.text);
          }
          text=pieces.join('\n');
        }
        const entry={role:rec.role,start:timestamp(rec.start),end:timestamp(rec.end),cwd:typeof rec.cwd==='string'?rec.cwd:null,text,fingerprint:''};
        // Text is intentionally absent in database timing discovery/work-only mode.
        entry.fingerprint=hash(stable([entry.role,entry.start,entry.end,entry.cwd,metadataOnly?null:text]));
        addRecord(s,rec.id,entry);
        if(rec.role==='assistant'){let tokens:any;try{tokens=typeof rec.tokens==='string'?strictJSON(rec.tokens):rec.tokens;}catch{}const usage=nativeUsage('message:'+rec.id,entry.start,tokens,rec.cost,'opencode',rec.model);if(usage)addUsage(meta(s),usage);}
      }
      if(hasParts){
        // SQL projects only numeric timing, fixed state/name and command family
        // input; outputs, arbitrary metadata and full part JSON are never kept.
        const tools=db.query(`SELECT p.id,json_extract(p.data,'$.callID') call_id,json_extract(p.data,'$.tool') tool,
          json_extract(p.data,'$.state.status') status,json_extract(p.data,'$.state.time.start') start,json_extract(p.data,'$.state.time.end') end,
          substr(json_extract(p.data,'$.state.input.command'),1,100001) command FROM part p JOIN message m ON p.message_id=m.id
          WHERE m.session_id=? AND json_extract(p.data,'$.type')='tool'`).all(row.id) as any[];
        for(const tool of tools){const start=timestamp(tool.start),end=timestamp(tool.end),c=category(tool.tool);const valid=start!==null&&end!==null&&end>=start;
          addTool(meta(s),{id:typeof tool.call_id==='string'?tool.call_id:String(tool.id),category:c,command_family:c==='shell'?commandFamily(tool.command):null,start,end,duration_ms:valid?end-start:null,timing:valid?'recorded_interval':'unavailable',status:tool.status==='completed'?'success':tool.status==='error'?'failure':'unknown'});
        }
      }
      return s;
    });
  } finally { db.close(); }
}
function metadataSignature(s:Session):string {
  return stable({directory:s.directory,records:[...s.records].map(([id,r])=>[id,r.role,r.start,r.end,r.cwd]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),telemetry:s.telemetry?{tools:[...s.telemetry.tools].sort(),usage:[...s.telemetry.usage].sort(),turns:[...s.telemetry.turns].sort(),spans:[...s.telemetry.recorded_spans].sort()}:null });
}
export interface Inventory { candidates:Candidate[]; statuses:Partial<Record<Client,SourceStatus>> }
export async function discover(sources:Partial<Record<Client,string[]>>,since:string,until:string,signal?:AbortSignal):Promise<Inventory> {
  const days=boundaries(since,until); const lo=days[0].lo,hi=days.at(-1)!.hi;
  const candidates:Candidate[]=[]; const statuses:Inventory['statuses']={};
  for (const [client,paths] of Object.entries(sources) as [Client,string[]][]) {
    let issues=0,available=0; const sessions=new Map<string,Session>(); const stamps=new Map<string,string>(); const scanned=new Set<string>();
    const offsets=new Map<string,Map<string,{start:number;end:number}[]>>();
    for (const path of [...new Set(paths)]) {
      signal?.throwIfAborted();
      try {
        const canonical=await realpath(path);
        if (scanned.has(canonical)) continue; scanned.add(canonical);
        const files=client==='opencode'||client==='claude-desktop'?[canonical]:await transcriptPaths(canonical,client); available++;
        for (const file of files) {
          signal?.throwIfAborted();
          try {
            const stats=await stat(file); stamps.set(file,`${stats.size}:${stats.mtimeMs}:${stats.ino}`);
            const found:Session[]=[];
            if(client==='claude-desktop'){
              const ranges=new Map<string,{start:number;end:number}[]>();offsets.set(file,ranges);
              for await(const entry of exportEntries(file)){const s=desktopConversation(entry.value,true);s.sources=[file];found.push(s);const list=ranges.get(s.identity)??[];list.push({start:entry.start,end:entry.end});ranges.set(s.identity,list);}
            }else found.push(...(client==='opencode'?readDatabase(file,true):[await readTranscript(file,client,true)]));
            for (const session of found) {
              const old=sessions.get(session.identity); if (old) combine(old,session); else sessions.set(session.identity,session);
            }
          } catch { issues++; }
        }
      } catch { issues++; }
    }
    statuses[client]={coverage:available===0?'unavailable':issues?'partial':'unverified',source_issue_count:issues,available_source_count:available};
    for (const metadata of sessions.values()) {
      if (!relevant(metadata,lo,hi)) {if(metadata.incomplete||metadata.conflict){statuses[client]!.source_issue_count++;statuses[client]!.coverage='partial';}continue;}
      const original=metadataSignature(metadata);
      candidates.push({ client,identity:metadata.identity,directory:metadata.directory,sources:metadata.sources,
        size:metadata.records.size,history:historyDates(metadata,days),metadata,
        load:async()=>{
          signal?.throwIfAborted(); let result:Session|undefined;
          try {
            for (const file of metadata.sources) {
              if (client!=='opencode') {
                const stats=await stat(file);
                if (`${stats.size}:${stats.mtimeMs}:${stats.ino}`!==stamps.get(file)) throw new SafeError('source_changed_since_discovery');
              }
              let next:Session|undefined;
              if(client==='claude-desktop'){
                for(const range of offsets.get(file)?.get(metadata.identity)??[]){const entry=desktopConversation(await readExportEntry(file,range.start,range.end));entry.sources=[file];next=next?combine(next,entry):entry;}
              }else next=client==='opencode'?readDatabase(file,false,metadata.identity)[0]:await readTranscript(file,client);
              if (!next || next.identity!==metadata.identity) throw new SafeError('source_metadata_ambiguous');
              result=result?combine(result,next):next;
            }
            if (!result || metadataSignature(result)!==original) throw new SafeError('source_changed_since_discovery');
            if (metadata.incomplete) { result.incomplete=true; metadata.reasons.forEach(r=>result!.reasons.add(r)); }
            if (metadata.conflict) { result.conflict=true; metadata.reasons.forEach(r=>result!.reasons.add(r)); }
            return result;
          } catch (error) {
            const failed=newSession(client,metadata.identity,metadata.directory); failed.sources=metadata.sources;
            failed.incomplete=true; failed.reasons.add(error instanceof SafeError&&reasonCodes.has(error.code)?error.code:'source_load_failed'); return failed;
          }
        }
      });
    }
  }
  candidates.sort((a,b)=>a.size-b.size||a.identity.localeCompare(b.identity)); return {candidates,statuses};
}
export function validateRoots(paths:string[],home:string):string[] {
  const broad=new Set(['/',home,...['Downloads','Documents','workspace','projects','Projects'].map(p=>join(home,p))].map(p=>resolve(p)));
  return [...new Set(paths.map(p=>{
    const full=resolve(p.replace(/^~(?=\/|$)/,home));
    if (broad.has(full)) throw new SafeError('invalid_source_folder'); return full;
  }))];
}
