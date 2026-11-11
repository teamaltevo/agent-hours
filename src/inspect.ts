import { readdir,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { strictJSON, SafeError } from './core.ts';
import { lines } from './sources.ts';
import { labels,clients,reasonCodes,type Label } from './types.ts';
import { isAbsolute } from 'node:path';
import type { UI } from './ui.ts';

/** Explicitly requested private metadata view. Never reads conversation sources. */
export async function inspectLatest(directory:string,ui:UI,options:{label:Label;limit:number;details:boolean}):Promise<void> {
  const local=join(directory,'local');
  const entries=(await readdir(local).catch(()=>{throw new SafeError('index_unavailable');})).filter(name=>/^session-index-[\w.-]+\.jsonl$/.test(name));
  const paths=await Promise.all(entries.map(async name=>({path:join(local,name),mtime:(await stat(join(local,name))).mtimeMs})));
  const path=paths.sort((a,b)=>b.mtime-a.mtime)[0]?.path;if(!path)throw new SafeError('index_unavailable');
  const rows:any[]=[];let committed:number|null=null;let status='unavailable';
  for await(const line of lines(path)){
    let row:any;try{row=strictJSON(line);}catch{continue;}
    if(row?.kind==='report'&&Number.isSafeInteger(row.processed_sessions))committed=row.processed_sessions;
    if(['report','status'].includes(row?.kind)&&['in_progress','interrupted','failed','completed'].includes(row.run_status))status=row.run_status;
    if(row?.kind==='session'&&labels.includes(row.classification)&&Number.isSafeInteger(row.sequence)){
      const path=(value:unknown)=>typeof value==='string'&&value.length<=4096&&isAbsolute(value)&&!/[\x00-\x1f\x7f]/.test(value)?value:null;
      rows.push({sequence:row.sequence,classification:row.classification,client:clients.includes(row.client)?row.client:'unavailable',session_id:typeof row.session_id==='string'&&/^[\w.:/-]{1,512}$/.test(row.session_id)?row.session_id:null,directory:path(row.directory),source_files:Array.isArray(row.source_files)?row.source_files.map(path).filter(Boolean):[],reason_code:reasonCodes.has(row.reason_code)?row.reason_code:'reason_unavailable'});
    }
  }
  const selected=rows.filter(r=>r.classification===options.label&&(committed===null||r.sequence<=committed));
  ui.title('Private local diagnostics');ui.note('Contains session paths and IDs. Do not share or upload this output.');
  ui.note(`${selected.length} ${options.label} sessions · ${status}`);
  if(options.details){
    for(const row of selected.slice(0,options.limit))ui.note(JSON.stringify({client:row.client,session_id:row.session_id,directory:row.directory,source_files:row.source_files,classification:row.classification,reason_code:row.reason_code}));
  }else{
    const counts=new Map<string,number>();for(const row of selected){const directory=typeof row.directory==='string'?row.directory:'(missing directory)';counts.set(directory,(counts.get(directory)??0)+1);}
    for(const [directory,count]of [...counts].sort((a,b)=>b[1]-a[1]).slice(0,options.limit))ui.note(`${String(count).padStart(6)}  ${directory}`);
    const reasons=new Map<string,number>();for(const row of selected)reasons.set(row.reason_code,(reasons.get(row.reason_code)??0)+1);
    ui.note('Reasons: '+JSON.stringify(Object.fromEntries(reasons)));
  }
}
