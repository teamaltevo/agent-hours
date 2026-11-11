import { mergeSpans, stable, timestamp } from './core.ts';
import { toolCategories,counts,type Telemetry,type ToolCategory,type ToolEvent,type UsageEvent,type Session,type Distribution,type ToolSummaryLeaf,type ToolSummary,type UsageSummary,type DailyDetails,type Span } from './types.ts';

export const telemetry=():Telemetry=>({tools:new Map(),usage:new Map(),turns:new Map(),recorded_spans:new Map(),rejected:new Set(),issues:0});
export function meta(s:Session):Telemetry { return s.telemetry??=telemetry(); }
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const integer=(v:unknown):number|null=>finite(v)&&Number.isSafeInteger(v)?v:null;
export function category(name:unknown):ToolCategory {
  if(typeof name!=='string')return 'other';const n=name.toLowerCase();
  if(['bash','shell','powershell','exec_command','shell_command','shell.exec'].includes(n))return 'shell';
  if(['read','read_file','readfile','file_read'].includes(n))return 'file_read';
  if(['write','edit','multiedit','apply_patch','write_file','edit_file','notebookedit'].includes(n))return 'file_write';
  if(['grep','glob','rg','search','file_search'].includes(n))return 'search';
  if(['websearch','webfetch','web_search','web_fetch','web.run'].includes(n))return 'web';
  if(['agent','task','subagent','spawn_agent'].includes(n))return 'agent';
  if(/^(?:mcp__[^\s]+__)?(?:browser_|playwright)/.test(n)||['browser','computer','computer_use'].includes(n))return 'browser';
  return 'other';
}
export function commandFamily(input:unknown):string {
  if(typeof input!=='string'||input.length>100000)return 'other';
  const first=input.trim().match(/^(?:[\w]+=[^\s]+\s+)*([\w./-]+)/)?.[1]?.split('/').at(-1)??'';
  if(['git','hg','svn'].includes(first))return 'version_control';
  if(['npm','pnpm','yarn','pip','pip3','uv','brew'].includes(first))return 'package_manager';
  if(['pytest','vitest','jest','mocha','unittest'].includes(first))return 'test_runner';
  if(['bun','node','python','python3','ruby','deno'].includes(first))return 'runtime';
  if(['make','cmake','ninja','tsc','cargo','go','gradle','mvn','dotnet'].includes(first))return 'build';
  if(['ls','cat','cp','mv','mkdir','rm','find','sed','awk','grep','rg','head','tail','wc','pwd'].includes(first))return 'filesystem';
  if(['curl','wget'].includes(first))return 'network';return 'other';
}
export function addTool(t:Telemetry,event:ToolEvent):void {
  const prior=t.tools.get(event.id);if(!prior){t.tools.set(event.id,event);return;}
  if(prior.conflict)return;
  // Fill complementary invocation/result records; reject contradictory evidence.
  const intervalPriority=prior.timing==='recorded_interval'&&event.timing!=='recorded_interval'||event.timing==='recorded_interval'&&prior.timing!=='recorded_interval';
  const conflict=(prior.category!=='other'&&event.category!=='other'&&prior.category!==event.category)||
    (!intervalPriority&&((prior.start!==null&&event.start!==null&&prior.start!==event.start)||(prior.end!==null&&event.end!==null&&prior.end!==event.end)))||
    (prior.status!=='unknown'&&event.status!=='unknown'&&prior.status!==event.status)||
    (prior.duration_ms!==null&&event.duration_ms!==null&&prior.timing!=='round_trip'&&event.timing!=='round_trip'&&prior.duration_ms!==event.duration_ms);
  if(conflict){prior.conflict=true;prior.duration_ms=null;prior.timing='unavailable';prior.status='unknown';t.issues++;return;}
  const recorded=event.timing==='recorded_interval'||event.timing==='recorded_duration';
  const result={...prior,category:prior.category==='other'?event.category:prior.category,command_family:prior.command_family??event.command_family,start:prior.start??event.start,end:prior.end??event.end,status:event.status==='unknown'?prior.status:event.status} as ToolEvent;
  if(event.timing==='recorded_interval'){result.start=event.start;result.end=event.end;}
  if(recorded){result.duration_ms=event.duration_ms;result.timing=event.timing;}
  if(result.start!==null&&result.end!==null&&result.end<result.start){result.duration_ms=null;result.timing='unavailable';t.issues++;}
  else if(result.duration_ms===null&&result.start!==null&&result.end!==null){result.duration_ms=result.end-result.start;result.timing='round_trip';}
  t.tools.set(event.id,result);
}
export function addUsage(t:Telemetry,event:UsageEvent):void {
  const prior=t.usage.get(event.id);if(!prior){t.usage.set(event.id,event);return;}
  for(const key of ['input','output','cache_read','cache_write','reasoning','cost_usd'] as const){
    const next=event[key];if(next!==null)prior[key]=Math.max(prior[key]??0,next);
  }
  if(prior.at===null)prior.at=event.at;
  if(event.model){if(prior.model&&prior.model!==event.model){prior.model=null;prior.format=undefined;t.issues++;}else if(prior.model!==null)prior.model=event.model;}
  if(prior.format===undefined&&prior.model!==null)prior.format=event.format;
  if(event.cache_write_1h!=null)prior.cache_write_1h=Math.max(prior.cache_write_1h??0,event.cache_write_1h);
  if(event.invalid_usage)prior.invalid_usage=true;
}
export function mergeTelemetry(a:Telemetry,b:Telemetry):void {
  b.tools.forEach(e=>addTool(a,{...e}));b.usage.forEach(e=>addUsage(a,{...e}));
  b.rejected.forEach(key=>a.rejected.add(key));
  for(const [key,event]of b.turns){if(a.rejected.has('turn:'+key)){a.turns.delete(key);continue;}const prior=a.turns.get(key);if(prior&&stable(prior)!==stable(event)){a.turns.delete(key);a.rejected.add('turn:'+key);a.issues++;}else a.turns.set(key,event);}
  for(const [key,span]of b.recorded_spans){if(a.rejected.has('span:'+key)){a.recorded_spans.delete(key);continue;}const prior=a.recorded_spans.get(key);if(prior&&stable(prior)!==stable(span)){a.recorded_spans.delete(key);a.rejected.add('span:'+key);a.issues++;}else a.recorded_spans.set(key,span);}
  a.issues+=b.issues;
}
export function nativeUsage(id:string,at:number|null,value:any,cost:unknown=null,format:'claude'|'opencode'|'codex'='claude',model:unknown=undefined):UsageEvent|null {
  if(!value||typeof value!=='object')value={};
  const event:UsageEvent={id,at,input:integer(format==='opencode'?value.input:value.input_tokens),output:integer(format==='opencode'?value.output:value.output_tokens),cache_read:integer(format==='opencode'?value.cache?.read:format==='codex'?value.cached_input_tokens:value.cache_read_input_tokens),cache_write:integer(format==='opencode'?value.cache?.write:value.cache_creation_input_tokens),reasoning:integer(format==='opencode'?value.reasoning:value.reasoning_output_tokens),cost_usd:finite(cost)?cost:null};
  const available=Object.entries(event).some(([key,v])=>!['id','at'].includes(key)&&v!==null);
  if(available){event.format=format;if(typeof model==='string'&&model.length<=200)event.model=model;if(format==='claude')event.cache_write_1h=integer(value.cache_creation?.ephemeral_1h_input_tokens);
    const raw=format==='opencode'?[value.input,value.output,value.reasoning,value.cache?.read,value.cache?.write]:[value.input_tokens,value.output_tokens,format==='codex'?value.cached_input_tokens:value.cache_read_input_tokens,value.cache_creation_input_tokens,value.reasoning_output_tokens,value.cache_creation?.ephemeral_1h_input_tokens];
    if(raw.some(v=>v!=null&&integer(v)===null))event.invalid_usage=true;
  }
  return available?event:null;
}
export function claudeTelemetry(t:Telemetry,rec:any):void {
  const at=timestamp(rec.timestamp);
  if(rec.type==='system'&&rec.subtype==='turn_duration'&&finite(rec.durationMs)&&at!==null){
    const id=typeof rec.uuid==='string'?rec.uuid:'turn:'+at+':'+rec.durationMs;t.turns.set(id,{id,at,duration_ms:rec.durationMs});
  }
  const message=rec.message;if(!message||typeof message!=='object')return;
  if(rec.type==='assistant'){
    const u=nativeUsage('message:'+(message.id??rec.uuid??at),at,message.usage,null,'claude',message.model);if(u)addUsage(t,u);
  }
  const blocks=Array.isArray(message.content)?message.content:[];
  for(const b of blocks){
    if(b?.type==='tool_use'&&typeof b.id==='string'){
      const c=category(b.name);addTool(t,{id:b.id,category:c,command_family:c==='shell'?commandFamily(b.input?.command):null,start:at,end:null,duration_ms:null,timing:'unavailable',status:'unknown'});
    }
    if(b?.type==='tool_result'&&typeof b.tool_use_id==='string'){
      const result=rec.toolUseResult;
      // The enclosing result describes one call only; do not copy its duration
      // onto every call if a row contains several tool_result blocks.
      let duration:number|null=null;
      if(blocks.filter((x:any)=>x?.type==='tool_result').length===1&&result&&typeof result==='object'){
        if(finite(result.durationMs))duration=result.durationMs;
        else if(finite(result.totalDurationMs))duration=result.totalDurationMs;
        else if(finite(result.durationSeconds))duration=result.durationSeconds*1000;
      }
      addTool(t,{id:b.tool_use_id,category:'other',command_family:null,start:null,end:at,duration_ms:duration,timing:duration===null?'unavailable':'recorded_duration',status:b.is_error===true||result?.interrupted===true?'failure':'success'});
    }
  }
}
export function codexTelemetry(t:Telemetry,rec:any,model?:string):void {
  const p=rec.payload;if(!p||typeof p!=='object')return;const at=timestamp(rec.timestamp);
  if(rec.type==='response_item'&&['function_call','custom_tool_call'].includes(p.type)&&typeof p.call_id==='string'){
    let args:any;try{args=typeof p.arguments==='string'&&p.arguments.length<100000?JSON.parse(p.arguments):p.arguments;}catch{}
    const c=category(p.name);addTool(t,{id:p.call_id,category:c,command_family:c==='shell'?commandFamily(args?.cmd??args?.command):null,start:at,end:null,duration_ms:null,timing:'unavailable',status:'unknown'});
  }
  if(rec.type==='response_item'&&['function_call_output','custom_tool_call_output'].includes(p.type)&&typeof p.call_id==='string'){
    // Output strings are untrusted command output. Never parse timing or status
    // claims out of that text; use structured native fields only.
    const duration=finite(p.duration_ms)?p.duration_ms:null;
    addTool(t,{id:p.call_id,category:'other',command_family:null,start:null,end:at,duration_ms:duration,timing:duration===null?'unavailable':'recorded_duration',status:typeof p.exit_code==='number'?(p.exit_code===0?'success':'failure'):'unknown'});
  }
  if(rec.type==='event_msg'&&p.type==='token_count'&&p.info?.last_token_usage&&p.info?.total_token_usage){
    // Codex repeats cumulative snapshots. Only the last reported turn usage is
    // attributed, keyed by the cumulative snapshot so repeats/mirrors dedupe.
    // Never assign the entire historical cumulative total to this event's day.
    const total=nativeUsage('total',null,p.info.total_token_usage,null,'codex');
    if(total){const key='token-snapshot:'+stable({...total,id:null,at:null});const event=nativeUsage(key,at,p.info.last_token_usage,null,'codex',model);if(event)addUsage(t,event);}
  }
}
export function distribution(values:number[]):Distribution {
  const sorted=values.filter(finite).sort((a,b)=>a-b),frequencies=new Map<number,number>();for(const n of sorted)frequencies.set(n,(frequencies.get(n)??0)+1);
  const n=sorted.length;return {count:n,total_ms:sorted.reduce((a,b)=>a+b,0),min_ms:n?sorted[0]:null,median_ms:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null,p95_ms:n?sorted[Math.ceil(.95*n)-1]:null,max_ms:n?sorted[n-1]:null,frequencies_ms:[...frequencies]};
}
export function toolLeaf(events:ToolEvent[]):ToolSummaryLeaf {
  return {calls:events.length,success:events.filter(e=>e.status==='success').length,failure:events.filter(e=>e.status==='failure').length,unknown_status:events.filter(e=>e.status==='unknown').length,missing_duration:events.filter(e=>e.duration_ms===null||e.timing==='round_trip').length,recorded_duration:distribution(events.filter(e=>e.timing==='recorded_interval'||e.timing==='recorded_duration').flatMap(e=>e.duration_ms===null?[]:[e.duration_ms])),observed_round_trip:distribution(events.filter(e=>e.timing==='round_trip').flatMap(e=>e.duration_ms===null?[]:[e.duration_ms]))};
}
export function toolSummary(events:ToolEvent[]):ToolSummary {
  return {...toolLeaf(events),by_category:Object.fromEntries(toolCategories.map(c=>[c,toolLeaf(events.filter(e=>e.category===c))])) as ToolSummary['by_category'],shell_command_families:Object.fromEntries([...new Set(events.filter(e=>e.category==='shell').map(e=>e.command_family??'other'))].sort().map(c=>[c,toolLeaf(events.filter(e=>e.category==='shell'&&(e.command_family??'other')===c))])),coverage:events.length?'partial':'unavailable'};
}
export function usageSummary(events:UsageEvent[]):UsageSummary {
  const sum=(key:keyof UsageEvent)=>{const values=events.map(e=>e[key]).filter((v):v is number=>typeof v==='number');return values.length?values.reduce((a,b)=>a+b,0):null;};
  return {input_tokens:sum('input'),output_tokens:sum('output'),cache_read_tokens:sum('cache_read'),cache_write_tokens:sum('cache_write'),reasoning_tokens:sum('reasoning'),reported_estimated_cost_usd:sum('cost_usd'),samples:events.length};
}
export function emptyDetails():DailyDetails {return {sessions:counts(),attribution:{model:0,keyword:0,declared:0},tools:toolSummary([]),usage:usageSummary([]),activity:{summed_hours:0,elapsed_union_hours:0,overlapping_hours:0,peak_concurrency:0,recorded_span_hours:null,recorded_turn_duration_hours:null,bounded_message_gap_hours:null},telemetry_issues:0};}
export function intervalStats(sessionSpans:Span[][]):{summed_hours:number;elapsed_union_hours:number;overlapping_hours:number;peak_concurrency:number} {
  const intervals=sessionSpans.flatMap(mergeSpans).filter(([a,b])=>b>a);const total=intervals.reduce((n,[a,b])=>n+b-a,0),union=mergeSpans(intervals).reduce((n,[a,b])=>n+b-a,0);
  const endpoints=intervals.flatMap(([a,b])=>[[a,1],[b,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,peak=0;for(const [,delta]of endpoints){active+=delta;peak=Math.max(peak,active);}
  return {summed_hours:total/3600000,elapsed_union_hours:union/3600000,overlapping_hours:(total-union)/3600000,peak_concurrency:peak};
}
