import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Classifier, redact, validateDecision, type Transport } from '../src/classifier.ts';
import { addRecord, newSession } from '../src/sources.ts';
import { hash } from '../src/core.ts';
import { applyAliases, jiraReference, ProjectMatcher } from '../src/projects.ts';
import type { Project } from '../src/types.ts';

let root:string;const project:Project={key:'p0000',title:'DistinctiveProduct API',client:'Synthetic client',seen_in_own_punches:true,jira_references:[]};
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'agent-hours-classifier-test-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
const decision=(label='work',project:string|null='p0000',confidence=.99,reason='project_match')=>({label,project,confidence,reason});
function session(text='Substantive employer work on the supplied project',id='s1'){
  const s=newSession('claude',id,'/synthetic');addRecord(s,'m1',{role:'user',start:1780315200000,end:null,text,cwd:s.directory,fingerprint:hash(text)});return s;
}
function classifier(generate:Transport['generate'],keywords=false,maxCalls=200){return new Classifier({projects:[project],model:{id:'synthetic',providerID:'test'},transport:{generate,models:async()=>({defaultModel:{id:'synthetic',providerID:'test'},models:[]})},cache:root,maxCalls,requestMs:1000,sessionMs:1000,keywords,signal:new AbortController().signal});}
test('strict work needs a candidate and confidence',()=>expect(validateDecision(decision(),[project]).label).toBe('work'));
for(const item of [decision('work','foreign'),decision('personal','p0000',.99,'personal_context'),decision('work',null),decision('work','p0000',2),decision('work','p0000',true as any),{...decision(),extra:'text'},decision('work','p0000',.99,'personal_context')])test('invalid decision fails closed '+JSON.stringify(item),()=>expect(()=>validateDecision(item,[project])).toThrow());
test('private content is redacted best-effort',()=>{
  const value=redact('email person@example.com password="SECRET_VALUE" Bearer secretToken /Users/username/project https://host/?token=xyz sk-1234567890123456');
  for(const secret of ['person@example.com','SECRET_VALUE','secretToken','username','token=xyz','sk-1234567890123456'])expect(value).not.toContain(secret);
});
test('valid decision caches enum only and avoids another request',async()=>{
  let calls=0;const c=classifier(async()=>{calls++;return JSON.stringify(decision());});
  expect(await c.classify(session('PRIVATE_EVIDENCE'))).toBe('work');expect(await c.classify(session('PRIVATE_EVIDENCE'))).toBe('work');expect(calls).toBe(1);
  for(const path of await readdir(root)){const text=await readFile(join(root,path),'utf8');expect(JSON.parse(text)).toEqual({label:'work'});expect(text).not.toContain('PRIVATE_EVIDENCE');}
});
test('fresh model project attribution is retained in memory but never added to caches',async()=>{
  const c=classifier(async()=>JSON.stringify(decision())),s=session('PRIVATE_PROJECT_EVIDENCE');expect(await c.classify(s)).toBe('work');expect(s.project).toBe('p0000');const cached=session('PRIVATE_PROJECT_EVIDENCE');expect(await c.classify(cached)).toBe('work');expect(cached.project??null).toBeNull();for(const path of await readdir(root))expect(JSON.parse(await readFile(join(root,path),'utf8'))).toEqual({label:'work'});
});
test('low confidence is unknown',async()=>expect(await classifier(async()=>JSON.stringify(decision('work','p0000',.8))).classify(session())).toBe('unknown'));
test('transport failures are not cached and circuit opens at three',async()=>{
  let calls=0;const c=classifier(async()=>{calls++;throw new Error('PROVIDER_SECRET_BODY');});
  for(let i=0;i<5;i++)expect(await c.classify(session('evidence '+i))).toBe('unknown');
  expect(calls).toBe(3);expect((await readdir(root)).length).toBe(0);expect(c.failed).toBe(3);
});
test('shared request budget is reserved synchronously',async()=>{
  const c=classifier(async()=>JSON.stringify(decision()),false,1);
  await Promise.all([c.classify(session('one')),c.classify(session('two'))]);expect(c.calls).toBe(1);
});
test('local aliases bypass generation, personal cues block shortcut',async()=>{
  let calls=0;const c=classifier(async()=>{calls++;return JSON.stringify(decision('unknown',null,1,'insufficient_evidence'));},true);
  expect(await c.classify(session('Fix DistinctiveProduct API for employer'))).toBe('work');expect(calls).toBe(0);
  expect(await c.classify(session('My personal project resembles DistinctiveProduct API'))).toBe('unknown');expect(calls).toBe(1);
});
test('cached personal decisions outrank later local shortcut',async()=>{
  const c=classifier(async()=>JSON.stringify(decision('personal',null,1,'personal_context')),false);
  const s=session('DistinctiveProduct API');await c.saveCache(c.key(s),'personal');c.matcher=new ProjectMatcher([project]);
  expect(await c.classify(s)).toBe('personal');expect(c.calls).toBe(0);
});
test('adding aliases does not override earlier personal decisions',async()=>{
  const c=classifier(async()=>JSON.stringify(decision('personal',null,1,'personal_context')),false);
  const s=session('Octopus analysis');expect(await c.classify(s)).toBe('personal');
  c.options.projects=[{...project,text_aliases:['Octopus']}];c.matcher=new ProjectMatcher(c.options.projects);
  expect(await c.classify(session('Octopus analysis'))).toBe('personal');expect(c.calls).toBe(1);
});
test('context and model changes do not reuse decisions',async()=>{
  const c=classifier(async()=>JSON.stringify(decision()));const first=session('same');expect(await c.classify(first)).toBe('work');
  const second=session('same');second.directory='/other';await c.classify(second);c.options.model={id:'other',providerID:'test'};await c.classify(first);expect(c.calls).toBe(3);
});
test('whole session text limit abstains',async()=>{
  const s=session('x'.repeat(300001));expect(s.incomplete).toBe(true);const c=classifier(async()=>JSON.stringify(decision()));expect(await c.classify(s)).toBe('unknown');expect(c.calls).toBe(0);
});
test('chunk cap abstains without model requests',async()=>{
  const c=classifier(async()=>JSON.stringify(decision()));const s=session('x'.repeat(299999));expect(await c.classify(s)).toBe('unknown');expect(s.reason).toBe('evidence_chunk_limit');expect(c.calls).toBe(0);
});
test('chunk decisions mixed, not a sampled-head work classification',async()=>{
  let calls=0;const c=classifier(async()=>JSON.stringify(++calls===1?decision():decision('personal',null,1,'personal_context')));
  expect(await c.classify(session('x'.repeat(13000)))).toBe('mixed');expect(calls).toBe(2);
});
test('batch decisions remain associated even when returned out of order',async()=>{
  const c=classifier(async()=>JSON.stringify({decisions:[{key:'b1',...decision('personal',null,1,'personal_context')},{key:'b0',...decision()}]}));
  expect(await c.classifyBatch([session('one'),session('two')])).toEqual(['work','personal']);expect(c.calls).toBe(1);
});
for(const items of [[{key:'b0',...decision()}],[{key:'b0',...decision()},{key:'b0',...decision()}],[{key:'b0',...decision()},{key:'foreign',...decision()}]])test('invalid batch does not retry or cache '+JSON.stringify(items.map(x=>x.key)),async()=>{
  const c=classifier(async()=>JSON.stringify({decisions:items}));expect(await c.classifyBatch([session('one'),session('two')])).toEqual(['unknown','unknown']);expect(c.calls).toBe(1);expect(await readdir(root)).toEqual([]);
});
test('local shortcuts continue after model budget',async()=>{
  const c=classifier(async()=>JSON.stringify(decision()),true,1);await c.classify(session('no shortcut'));expect(await c.classify(session('DistinctiveProduct employer work'))).toBe('work');expect(c.calls).toBe(1);
});
test('Jira clue projects only host and prefix',()=>expect(jiraReference('https://synthetic.atlassian.net/browse/TSV-123?token=SECRET')).toEqual({host:'synthetic.atlassian.net',project_key:'TSV'}));
test('strict Jira issue key, not file extension or bare acronym',()=>{
  const matcher=new ProjectMatcher([{...project,title:'Generic',jira_references:[{host:'synthetic.atlassian.net',project_key:'TSV'}]}]);
  expect(matcher.match('Fix TSV-123')).toBe('jira_issue_reference');expect(matcher.match('Read a .tsv file')).toBeNull();expect(matcher.match('TSV')).toBeNull();
});
test('ambiguous issue prefix needs host-qualified URL',()=>{
  const matcher=new ProjectMatcher([{...project,title:'Generic',jira_references:[{host:'a.atlassian.net',project_key:'TSV'},{host:'b.atlassian.net',project_key:'TSV'}]}]);expect(matcher.match('TSV-123')).toBeNull();expect(matcher.match('https://a.atlassian.net/browse/TSV-123')).toBe('jira_issue_reference');
});
test('aliases bind only to accessible catalogue',()=>{
  const rule={schema_version:1,mappings:[{match_names:['DistinctiveProduct'],text_aliases:['Octopus'],directory_aliases:['TSV']}]};
  const matcher=new ProjectMatcher(applyAliases([project],rule));expect(matcher.match('Octopus bugfix')).toBe('project_alias_reference');expect(matcher.match('fix','/Users/name/worktrees/TSV'.split(',') as any)).toBe('project_directory_reference');
  const unavailable=new ProjectMatcher(applyAliases([{...project,title:'Unrelated',client:'Unrelated'}],rule));expect(unavailable.match('Octopus bugfix')).toBeNull();
});
test('generic aliases refused',()=>expect(()=>applyAliases([project],{schema_version:1,mappings:[{match_names:['DistinctiveProduct'],text_aliases:['Downloads'],directory_aliases:[]}]})).toThrow());
