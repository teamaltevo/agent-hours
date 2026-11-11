import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, readTranscript, lines, spans, transcript, validateRoots } from '../src/sources.ts';

let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'agent-hours-ts-test-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
const claude=(id:string,time:string,text:string)=>JSON.stringify({sessionId:'s1',cwd:'/synthetic/work',uuid:id,type:'user',timestamp:time,message:{content:[{type:'text',text}]}})+'\n';
const codex=(type:string,payload:unknown,time='2026-06-01T12:00:00Z')=>JSON.stringify({type,payload,timestamp:time})+'\n';
test('lazy discovery retains no text and loads one session',async()=>{
  const file=join(root,'a.jsonl');await writeFile(file,claude('m1','2026-06-01T12:00:00Z','PRIVATE_TEXT'));
  const {candidates}=await discover({claude:[root]},'2026-06-01','2026-06-01');expect(candidates.length).toBe(1);
  expect(transcript(candidates[0].metadata)).toBe('');expect(candidates[0].history).toEqual(['2026-06-01']);
  expect(transcript(await candidates[0].load())).toContain('PRIVATE_TEXT');
});
test('changed file fails closed',async()=>{
  const file=join(root,'a.jsonl');await writeFile(file,claude('m1','2026-06-01T12:00:00Z','first'));
  const {candidates}=await discover({claude:[root]},'2026-06-01','2026-06-01');await writeFile(file,claude('m1','2026-06-01T12:00:00Z','changed size'));
  expect((await candidates[0].load()).incomplete).toBe(true);
});
test('long gaps are excluded, not session wall-time',async()=>{
  const file=join(root,'a.jsonl');await writeFile(file,claude('m1','2026-06-01T12:00:00Z','a')+claude('m2','2026-06-01T12:02:00Z','b')+claude('m3','2026-06-01T13:00:00Z','c'));
  const s=await readTranscript(file,'claude');expect(spans(s).reduce((n,[a,b])=>n+b-a,0)).toBe(120000);
});
test('Codex event mirror is not double counted',async()=>{
  const file=join(root,'a.jsonl');await writeFile(file,codex('session_meta',{id:'s1',cwd:'/synthetic'})+codex('event_msg',{type:'user_message',message:'event'})+codex('response_item',{type:'message',role:'user',content:[{type:'input_text',text:'response'}]}));
  expect(transcript(await readTranscript(file,'codex'))).toBe('user: response');
});
test('Codex event-only fallback survives developer context',async()=>{
  const file=join(root,'a.jsonl');await writeFile(file,codex('session_meta',{id:'s1'})+codex('response_item',{type:'message',role:'developer',content:'ignore'})+codex('event_msg',{type:'agent_message',message:'actual'}));
  expect(transcript(await readTranscript(file,'codex'))).toBe('assistant: actual');
});
test('compressed/plain mirrors deduplicate without expanding files',async()=>{
  const text=codex('session_meta',{id:'same'})+codex('event_msg',{type:'user_message',message:'one'});
  await writeFile(join(root,'a.jsonl'),text);await writeFile(join(root,'a.jsonl.zst'),Bun.zstdCompressSync(Buffer.from(text)));
  const inventory=await discover({codex:[root]},'2026-06-01','2026-06-01');
  expect(inventory.statuses.codex?.source_issue_count).toBe(0);expect(inventory.candidates.length).toBe(1);expect(inventory.candidates[0].sources.length).toBe(2);
  expect((await inventory.candidates[0].load()).conflict).toBe(false);
});
test('truncated zstd never supplies a work candidate',async()=>{
  const compressed=Bun.zstdCompressSync(Buffer.from(claude('m','2026-06-01T12:00:00Z','synthetic')));
  await writeFile(join(root,'a.jsonl.zst'),compressed.subarray(0,compressed.length-3));
  const inventory=await discover({codex:[root]},'2026-06-01','2026-06-01');expect(inventory.candidates.length).toBe(0);expect(inventory.statuses.codex?.source_issue_count).toBeGreaterThan(0);
});
test('concatenated zstd frames supported',async()=>{
  const text=codex('session_meta',{id:'s1'})+codex('event_msg',{type:'user_message',message:'a'});
  await writeFile(join(root,'a.jsonl.zst'),Buffer.concat([Bun.zstdCompressSync(Buffer.from(text)),Bun.zstdCompressSync(Buffer.from(codex('event_msg',{type:'agent_message',message:'b'},'2026-06-01T12:01:00Z')))]));
  expect((await readTranscript(join(root,'a.jsonl.zst'),'codex')).records.size).toBe(2);
});
test('record size is bounded',async()=>{
  const file=join(root,'a.jsonl');await writeFile(file,'123456789\n');await expect(async()=>{for await(const _ of lines(file,100,5)){} }).toThrow();
});
test('conflicting mirrors excluded',async()=>{
  await writeFile(join(root,'a.jsonl'),claude('m','2026-06-01T12:00:00Z','first'));await writeFile(join(root,'b.jsonl'),claude('m','2026-06-01T12:00:00Z','second'));
  const {candidates}=await discover({claude:[root]},'2026-06-01','2026-06-01');expect(candidates[0].metadata.conflict).toBe(true);
});
test('subagents retain independent identities',async()=>{
  await mkdir(join(root,'subagents'));await writeFile(join(root,'a.jsonl'),claude('m','2026-06-01T12:00:00Z','parent'));await writeFile(join(root,'subagents/agent-a.jsonl'),claude('m','2026-06-01T12:00:00Z','subagent'));
  expect((await discover({claude:[root]},'2026-06-01','2026-06-01')).candidates.length).toBe(2);
});
test('missing database not created',async()=>{const result=await discover({opencode:[join(root,'absent.db')]},'2026-06-01','2026-06-01');expect(result.statuses.opencode?.coverage).toBe('unavailable');expect(await Bun.file(join(root,'absent.db')).exists()).toBe(false);});
test('broad roots refused',()=>expect(()=>validateRoots(['/synthetic/home'],'/synthetic/home')).toThrow());

function database(path:string,created:number,completed:number|null,text='PRIVATE_TEXT'){
  const db=new Database(path);db.exec('CREATE TABLE session(id TEXT,directory TEXT);CREATE TABLE message(id TEXT,session_id TEXT,data TEXT);CREATE TABLE part(id TEXT,message_id TEXT,data TEXT)');
  db.query('INSERT INTO session VALUES (?,?)').run('s1','/synthetic/work');db.query('INSERT INTO message VALUES (?,?,?)').run('m1','s1',JSON.stringify({role:'assistant',time:{created,completed}}));
  db.query('INSERT INTO part VALUES (?,?,?)').run('p1','m1',JSON.stringify({type:'text',text}));db.close();
}
test('OpenCode span crosses Montréal midnight and no source writes',async()=>{
  const file=join(root,'source.db');database(file,Date.parse('2026-06-02T03:30:00Z'),Date.parse('2026-06-02T04:30:00Z'));
  const before=await Bun.file(file).arrayBuffer();const {candidates}=await discover({opencode:[file]},'2026-06-01','2026-06-02');
  expect(candidates[0].history).toEqual(['2026-06-01','2026-06-02']);expect(transcript(candidates[0].metadata)).toBe('');
  expect(transcript(await candidates[0].load())).toContain('PRIVATE_TEXT');expect(await Bun.file(file).arrayBuffer()).toEqual(before);
});
test('archive fragment outside period cannot hide conflicting messages',async()=>{
  database(join(root,'a.db'),Date.parse('2026-06-01T12:00:00Z'),Date.parse('2026-06-01T12:05:00Z'));
  database(join(root,'b.db'),Date.parse('2025-06-01T12:00:00Z'),Date.parse('2025-06-01T12:05:00Z'));
  const inventory=await discover({opencode:[join(root,'a.db'),join(root,'b.db')]},'2026-06-01','2026-06-01');expect(inventory.candidates[0].metadata.conflict).toBe(true);
});
test('missing completion is never invented',async()=>{
  database(join(root,'a.db'),Date.parse('2026-06-01T12:00:00Z'),null);
  const {candidates}=await discover({opencode:[join(root,'a.db')]},'2026-06-01','2026-06-01');expect(spans(candidates[0].metadata)).toEqual([]);
});
