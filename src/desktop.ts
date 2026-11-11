import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { hash,stable,strictJSON,timestamp,SafeError } from './core.ts';
import { newSession,addRecord } from './sources.ts';
import { meta,addTool,category,commandFamily } from './telemetry.ts';
import type { Session } from './types.ts';

export interface ExportEntry { value:any; start:number; end:number }
/** Bounded streaming array parser. No extraction, cookies, browser storage or
 * account APIs. Entries are bounded; offsets allow lazy per-conversation reads.
 */
export async function* exportEntries(path:string):AsyncGenerator<ExportEntry> {
  const stream=createReadStream(path,{highWaterMark:64*1024});let offset=0,total=0,start=-1,depth=0,inString=false,escaped=false;
  let phase:'array'|'entryOrEnd'|'entry'|'commaOrEnd'|'done'='array';let afterComma=false;let pieces:Buffer[]=[];let size=0;
  const ws=(byte:number)=>[9,10,13,32].includes(byte);const decoder=new TextDecoder('utf-8',{fatal:true});
  try {
    for await(const raw of stream){const chunk=Buffer.from(raw);total+=chunk.length;if(total>256*1024*1024)throw new SafeError('desktop_export_size_limit');let segment=-1;
      for(let i=0;i<chunk.length;i++,offset++){
        const b=chunk[i];
        if(phase==='array'){if(ws(b))continue;if(b!==91)throw new SafeError('invalid_desktop_export');phase='entryOrEnd';continue;}
        if(phase==='done'){if(!ws(b))throw new SafeError('invalid_desktop_export');continue;}
        if(phase==='commaOrEnd'){if(ws(b))continue;if(b===93){phase='done';continue;}if(b!==44)throw new SafeError('invalid_desktop_export');phase='entryOrEnd';afterComma=true;continue;}
        if(phase==='entryOrEnd'){if(ws(b))continue;if(b===93&&!afterComma){phase='done';continue;}if(b!==123)throw new SafeError('invalid_desktop_export');phase='entry';start=offset;depth=0;size=0;pieces=[];inString=false;escaped=false;segment=i;afterComma=false;}
        if(phase==='entry'){
          if(segment<0)segment=i;size++;if(size>32*1024*1024)throw new SafeError('desktop_conversation_size_limit');
          if(inString){if(escaped)escaped=false;else if(b===92)escaped=true;else if(b===34)inString=false;}
          else if(b===34)inString=true;else if(b===123||b===91)depth++;else if(b===125||b===93)depth--;
          if(depth===0){pieces.push(Buffer.from(chunk.subarray(segment,i+1)));segment=-1;const value=strictJSON(decoder.decode(Buffer.concat(pieces)));pieces=[];phase='commaOrEnd';yield {value,start,end:offset};}
        }
      }
      if(segment>=0)pieces.push(Buffer.from(chunk.subarray(segment)));
    }
    if(phase!=='done')throw new SafeError('invalid_desktop_export');
  }finally{stream.destroy();}
}
export async function readExportEntry(path:string,start:number,end:number):Promise<any> {
  if(start<0||end<start||end-start>32*1024*1024)throw new SafeError('invalid_desktop_export');
  const handle=await open(path,'r');try{const buffer=Buffer.alloc(end-start+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,start);if(bytesRead!==buffer.length)throw new SafeError('source_changed_since_discovery');return strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(buffer));}finally{await handle.close();}
}
export function desktopConversation(value:any,metadataOnly=false):Session {
  if(!value||typeof value.uuid!=='string'||!value.uuid||!Array.isArray(value.chat_messages))throw new SafeError('invalid_desktop_export');
  const session=newSession('claude-desktop',value.uuid);const t=meta(session);
  for(const message of value.chat_messages){
    if(!message||typeof message.uuid!=='string'||!['human','assistant'].includes(message.sender)){session.incomplete=true;session.reasons.add('malformed_transcript');continue;}
    const role=message.sender==='human'?'user':'assistant';const at=timestamp(message.created_at);
    const blocks=Array.isArray(message.content)?message.content:[];
    // Never treat conversation/message updated_at as response completion: edits
    // can occur days later. Only explicit timed content blocks establish spans.
    const text=typeof message.text==='string'&&message.text?message.text:blocks.filter((b:any)=>b?.type==='text'&&typeof b.text==='string').map((b:any)=>b.text).join('\n');
    addRecord(session,message.uuid,{role,start:at,end:null,text:metadataOnly?'':text,cwd:null,fingerprint:hash(stable([role,at,text]))});
    blocks.forEach((b:any,index:number)=>{
      if(!b||typeof b!=='object')return;const start=timestamp(b.start_timestamp),end=timestamp(b.stop_timestamp);
      if(role==='assistant'&&['text','thinking'].includes(b.type)&&start!==null&&end!==null&&end>=start)t.recorded_spans.set(message.uuid+':block:'+index,[start,end]);
      if(b.type==='tool_use'){
        const id=typeof b.id==='string'?b.id:message.uuid+':tool:'+index;const c=category(b.name);
        addTool(t,{id,category:c,command_family:c==='shell'?commandFamily(b.input?.command):null,start:start??at,end,duration_ms:start!==null&&end!==null&&end>=start?end-start:null,timing:start!==null&&end!==null&&end>=start?'recorded_interval':'unavailable',status:'unknown'});
      }
      if(b.type==='tool_result'&&typeof b.tool_use_id==='string')addTool(t,{id:b.tool_use_id,category:'other',command_family:null,start:null,end:end??at,duration_ms:null,timing:'unavailable',status:b.is_error===true?'failure':'success'});
    });
  }
  return session;
}
