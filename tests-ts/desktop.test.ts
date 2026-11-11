import { beforeEach,afterEach,expect,test } from 'bun:test';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover,transcript } from '../src/sources.ts';
import { exportEntries,desktopConversation } from '../src/desktop.ts';

let root:string;beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'agent-hours-desktop-'));});afterEach(async()=>{await rm(root,{recursive:true,force:true});});
const conversation=(id='one')=>({uuid:id,name:'PRIVATE_TITLE',created_at:'2026-06-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',chat_messages:[{uuid:'m1',sender:'human',created_at:'2026-06-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',text:'PRIVATE_USER_TEXT',content:[]},{uuid:'m2',sender:'assistant',created_at:'2026-06-01T12:01:00Z',updated_at:'2026-11-01T12:00:00Z',text:'PRIVATE_ASSISTANT_TEXT',content:[{type:'thinking',start_timestamp:'2026-06-01T12:00:10Z',stop_timestamp:'2026-06-01T12:00:20Z',thinking:'DO_NOT_RETAIN_THINKING'}]}]});
test('official-export conversations use the same lazy discovery/classification pipeline',async()=>{
  const file=join(root,'conversations.json');await writeFile(file,JSON.stringify([conversation(),conversation('two')]));const inv=await discover({'claude-desktop':[file]},'2026-06-01','2026-06-01');expect(inv.candidates.length).toBe(2);expect(inv.candidates[0].history).toEqual(['2026-06-01']);expect(transcript(inv.candidates[0].metadata)).toBe('');const s=await inv.candidates[0].load();expect(transcript(s)).toContain('PRIVATE_USER_TEXT');expect(transcript(s)).not.toContain('PRIVATE_TITLE');expect(transcript(s)).not.toContain('DO_NOT_RETAIN_THINKING');expect(s.telemetry?.recorded_spans.size).toBe(1);
});
test('updated_at is not response runtime',()=>{const s=desktopConversation(conversation());expect([...s.records.values()].every(r=>r.end===null)).toBe(true);});
test('export parser handles escaped braces, quotes, UTF-8 and lazy byte offsets',async()=>{
  const value=conversation();value.chat_messages[0].text='é漢字 { brace } " quote '+('x'.repeat(70000));const file=join(root,'conversations.json');await writeFile(file,JSON.stringify([value,conversation('two')]));const inv=await discover({'claude-desktop':[file]},'2026-06-01','2026-06-01');expect(inv.candidates.length).toBe(2);expect(transcript(await inv.candidates.find(c=>c.identity==='one')!.load())).toContain('é漢字 { brace } " quote');
});
for(const data of ['[{"uuid":"one","chat_messages":[]},]','[{"uuid":"one","chat_messages":[]}','{}','[] trailing','[{"uuid":"one","uuid":"two","chat_messages":[]}]'])test('malformed export cannot produce partially trusted sessions: '+data.slice(0,25),async()=>{
  const file=join(root,'conversations.json');await writeFile(file,data);const inv=await discover({'claude-desktop':[file]},'2026-06-01','2026-06-01');expect(inv.candidates.length).toBe(0);expect(inv.statuses['claude-desktop']?.coverage).toBe('partial');
});
test('changed export fails closed without reading a different conversation',async()=>{
  const file=join(root,'conversations.json');await writeFile(file,JSON.stringify([conversation()]));const inv=await discover({'claude-desktop':[file]},'2026-06-01','2026-06-01');await writeFile(file,JSON.stringify([conversation('changed')]));expect((await inv.candidates[0].load()).incomplete).toBe(true);
});
test('content tool intervals override later result message timestamps',()=>{
  const value=conversation();(value.chat_messages[1].content as any[]).push({type:'tool_use',id:'tool',name:'WebSearch',start_timestamp:'2026-06-01T12:00:20Z',stop_timestamp:'2026-06-01T12:00:25Z'});(value.chat_messages as any[]).push({uuid:'m3',sender:'assistant',created_at:'2026-06-01T12:01:10Z',text:'',content:[{type:'tool_result',tool_use_id:'tool'}]});const s=desktopConversation(value);expect(s.telemetry?.tools.get('tool')?.duration_ms).toBe(5000);expect(s.telemetry?.tools.get('tool')?.timing).toBe('recorded_interval');
});
