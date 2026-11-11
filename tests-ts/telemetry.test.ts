import { expect,test } from 'bun:test';
import { newSession,readTranscript,discover } from '../src/sources.ts';
import { meta,claudeTelemetry,codexTelemetry,toolSummary,intervalStats,mergeTelemetry,telemetry,category,commandFamily,distribution } from '../src/telemetry.ts';
import { DetailBuilder } from '../src/details.ts';
import { boundaries } from '../src/core.ts';
import { ReportBuilder } from '../src/report.ts';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const start='2026-06-01T12:00:00Z',end='2026-06-01T12:00:10Z';
test('Claude native duration is separate from invocation-result round trip',()=>{
  const t=telemetry();claudeTelemetry(t,{type:'assistant',timestamp:start,message:{content:[{type:'tool_use',id:'one',name:'WebFetch',input:{url:'SECRET_URL'}}]}});
  claudeTelemetry(t,{type:'user',timestamp:end,message:{content:[{type:'tool_result',tool_use_id:'one',content:'SECRET_OUTPUT'}]},toolUseResult:{durationMs:300}});
  const event=t.tools.get('one')!;expect(event.duration_ms).toBe(300);expect(event.timing).toBe('recorded_duration');expect(event.status).toBe('success');expect(event.category).toBe('web');expect(JSON.stringify([...t.tools])).not.toContain('SECRET');
});
test('Claude Bash without a native duration stays an explicitly estimated round trip',()=>{
  const t=telemetry();claudeTelemetry(t,{type:'assistant',timestamp:start,message:{content:[{type:'tool_use',id:'bash',name:'Bash',input:{command:'git status PRIVATE_ARGUMENT'}}]}});
  claudeTelemetry(t,{type:'user',timestamp:end,message:{content:[{type:'tool_result',tool_use_id:'bash',is_error:true}]}});
  const s=toolSummary([...t.tools.values()]);expect(s.recorded_duration.count).toBe(0);expect(s.observed_round_trip.total_ms).toBe(10000);expect(s.missing_duration).toBe(1);expect(s.failure).toBe(1);expect(s.shell_command_families.version_control.calls).toBe(1);expect(JSON.stringify(s)).not.toContain('PRIVATE_ARGUMENT');
});
test('one tool result duration is not copied across multiple results',()=>{
  const t=telemetry();claudeTelemetry(t,{type:'user',timestamp:end,message:{content:[{type:'tool_result',tool_use_id:'a'},{type:'tool_result',tool_use_id:'b'}]},toolUseResult:{durationMs:300}});expect([...t.tools.values()].every(e=>e.duration_ms===null)).toBe(true);
});
test('Claude system turn durations do not fabricate execution intervals',()=>{
  const t=telemetry();claudeTelemetry(t,{type:'system',subtype:'turn_duration',uuid:'turn',timestamp:end,durationMs:999});expect(t.turns.get('turn')?.duration_ms).toBe(999);expect(t.recorded_spans.size).toBe(0);
});
test('Claude streamed usage snapshots are not added twice',()=>{
  const t=telemetry();for(const output of [2,5,5])claudeTelemetry(t,{type:'assistant',timestamp:start,uuid:'fragment-'+output,message:{id:'same',usage:{input_tokens:10,output_tokens:output,cache_read_input_tokens:4}}});expect(t.usage.size).toBe(1);expect([...t.usage.values()][0].output).toBe(5);
});
test('Codex cumulative tokens are never attributed wholesale to one day',()=>{
  const t=telemetry();for(let i=0;i<2;i++)codexTelemetry(t,{type:'event_msg',timestamp:start,payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000,output_tokens:500},last_token_usage:{input_tokens:20,output_tokens:10}}}});
  expect(t.usage.size).toBe(1);expect([...t.usage.values()][0].input).toBe(20);
});
test('Codex does not parse fabricated duration claims from tool output',()=>{
  const t=telemetry();codexTelemetry(t,{type:'response_item',timestamp:start,payload:{type:'function_call',call_id:'one',name:'exec_command',arguments:'{"cmd":"npm test SECRET"}'}});codexTelemetry(t,{type:'response_item',timestamp:end,payload:{type:'function_call_output',call_id:'one',output:'Wall time: 99999 seconds. duration_ms=1'}});
  expect(t.tools.get('one')?.timing).toBe('round_trip');expect(t.tools.get('one')?.duration_ms).toBe(10000);expect(t.tools.get('one')?.status).toBe('unknown');
});
test('overlapping parallel spans have summed and union hours with peak concurrency',()=>{
  const s=intervalStats([[[0,3600000],[1000,10000]],[[1800000,5400000]]]);expect(s.summed_hours).toBe(2);expect(s.elapsed_union_hours).toBe(1.5);expect(s.peak_concurrency).toBe(2);expect(s.overlapping_hours).toBe(.5);
});
test('touching endpoints are not simultaneous activity',()=>expect(intervalStats([[[0,10]],[[10,20]]]).peak_concurrency).toBe(1));
test('exact duration frequency aggregates reproduce median and p95',()=>{
  const d=distribution([3,1,2,2]);expect(d.median_ms).toBe(2);expect(d.p95_ms).toBe(3);expect(d.frequencies_ms).toEqual([[1,1],[2,2],[3,1]]);
});
test('unknown tool names and shell programs never appear in aggregates',()=>{expect(category('mcp__CUSTOMER_SECRET__database_query')).toBe('other');expect(commandFamily('private-custom-command secret')).toBe('other');});
test('conflicting mirrored turns remain rejected after further copies',()=>{
  const a=telemetry(),b=telemetry(),c=telemetry();a.turns.set('one',{id:'one',at:1,duration_ms:10});b.turns.set('one',{id:'one',at:1,duration_ms:20});c.turns.set('one',{id:'one',at:1,duration_ms:10});mergeTelemetry(a,b);mergeTelemetry(a,c);expect(a.turns.size).toBe(0);
});
test('native OpenCode tool intervals, tokens and cost load without conversation text',async()=>{
  const root=await mkdtemp(join(tmpdir(),'agent-hours-native-tools-'));try{
    const file=join(root,'source.db'),db=new Database(file);db.exec('CREATE TABLE session(id TEXT,directory TEXT);CREATE TABLE message(id TEXT,session_id TEXT,data TEXT);CREATE TABLE part(id TEXT,message_id TEXT,data TEXT)');db.query('INSERT INTO session VALUES (?,?)').run('s','/synthetic');
    db.query('INSERT INTO message VALUES (?,?,?)').run('m','s',JSON.stringify({role:'assistant',modelID:'gpt-5.3-codex',time:{created:Date.parse(start),completed:Date.parse(end)},tokens:{input:4,output:8,cache:{read:2,write:1}},cost:.003}));
    db.query('INSERT INTO part VALUES (?,?,?)').run('tool','m',JSON.stringify({type:'tool',callID:'call',tool:'bash',state:{status:'completed',time:{start:Date.parse(start),end:Date.parse(end)},input:{command:'npm test PRIVATE'},output:'NEVER_READ'}}));db.close();
    const inv=await discover({opencode:[file]},'2026-06-01','2026-06-01'),s=inv.candidates[0].metadata;expect(meta(s).tools.get('call')?.duration_ms).toBe(10000);expect(meta(s).usage.get('message:m')?.cost_usd).toBe(.003);expect(meta(s).usage.get('message:m')?.model).toBe('gpt-5.3-codex');expect(JSON.stringify([...s.records.values()])).not.toContain('PRIVATE');expect(JSON.stringify([...meta(s).tools.values()])).not.toContain('NEVER_READ');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('Codex model identity follows each turn context without inferring it from text',async()=>{
  const root=await mkdtemp(join(tmpdir(),'agent-hours-codex-model-'));try{
    const file=join(root,'synthetic.jsonl'),rows=[{type:'session_meta',payload:{id:'synthetic',cwd:'/synthetic'}},{type:'turn_context',payload:{model:'gpt-5.3-codex'}},{type:'event_msg',timestamp:start,payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,output_tokens:10},last_token_usage:{input_tokens:100,output_tokens:10}}}},{type:'turn_context',payload:{model:'gpt-5.4'}},{type:'event_msg',timestamp:end,payload:{type:'token_count',info:{total_token_usage:{input_tokens:200,output_tokens:20},last_token_usage:{input_tokens:100,output_tokens:10}}}}];await writeFile(file,rows.map(r=>JSON.stringify(r)).join('\n'));const session=await readTranscript(file,'codex',true);expect([...meta(session).usage.values()].map(e=>e.model)).toEqual(['gpt-5.3-codex','gpt-5.4']);expect([...meta(session).usage.values()].every(e=>e.format==='codex')).toBe(true);
  }finally{await rm(root,{recursive:true,force:true});}
});
