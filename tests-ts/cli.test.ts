import { beforeEach,afterEach,expect,test } from 'bun:test';
import { mkdtemp,rm,readdir,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';

let root:string;beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'agent-hours-cli-test-'));});afterEach(async()=>{await rm(root,{recursive:true,force:true});});
async function run(args:string[],input?:string){
  const child=Bun.spawn([process.execPath,resolve('src/cli.ts'),...args],{cwd:root,stdout:'pipe',stderr:'pipe',stdin:input===undefined?'ignore':new Blob([input]),env:{...process.env,NO_COLOR:'1'}});
  const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return {stdout,stderr,code};
}
test('help does not read histories, authenticate, or write files',async()=>{const result=await run(['--help']);expect(result.code).toBe(0);expect(result.stdout).toContain('Agent Hours');expect(await readdir(root)).toEqual([]);});
test('demo is synthetic, offline and leaves no files',async()=>{const result=await run(['--demo','--data-dir',root]);expect(result.code).toBe(0);expect(result.stdout).toContain('SYNTHETIC PREVIEW');expect(result.stdout).not.toContain('\x1b');expect(await readdir(root)).toEqual([]);});
test('invalid arguments fail before side effects',async()=>{const result=await run(['--workers','100']);expect(result.code).toBe(2);expect(result.stderr).toContain('Invalid options');expect(await readdir(root)).toEqual([]);});
test('EOF safely cancels before source discovery or sign-in',async()=>{const result=await run(['--data-dir',root]);expect(result.code).toBe(130);expect(result.stdout).toContain('Cancelled');expect(await readdir(root)).toEqual([]);});
test('work-only cancellation requires explicit consent and reads no history',async()=>{const result=await run(['--work-only','--clients','claude','--data-dir',root],'\n');expect(result.code).toBe(0);expect(result.stdout).toContain('Cancelled');expect(result.stdout).not.toContain('Complete Microsoft sign-in');expect(await readdir(root)).toEqual([]);});
test('plain model picker search and selection uses only synthetic catalogue',async()=>{const result=await run(['--demo-picker'],'reasoning\n1\n');expect(result.code).toBe(0);expect(result.stdout).toContain('Selected synthetic/reasoning');expect(await readdir(root)).toEqual([]);});
test('executable launcher has same safe entrypoint',async()=>{const child=Bun.spawn([process.execPath,resolve('bin/agent-hours'),'--demo'],{cwd:root,stdout:'pipe',stderr:'pipe'});expect(await child.exited).toBe(0);expect(await new Response(child.stdout).text()).toContain('SYNTHETIC PREVIEW');});
test('private inspector only shows committed fixed metadata projection',async()=>{
  await mkdir(join(root,'local'));
  const rows=[{kind:'session',sequence:1,classification:'unknown',session_id:'s1',directory:'/synthetic',source_files:['/synthetic/source'],client:'claude',reason_code:'failure_circuit_open',text:'NEVER_PRINT'}, {kind:'session',sequence:2,classification:'unknown',session_id:'s2',directory:'/uncommitted',reason_code:'NEVER_PRINT'}, {kind:'report',run_status:'interrupted',processed_sessions:1}];
  await writeFile(join(root,'local/session-index-synthetic.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n{truncated');
  const result=await run(['--inspect','--details','--data-dir',root]);expect(result.code).toBe(0);expect(result.stdout).toContain('Private local diagnostics');expect(result.stdout).toContain('failure_circuit_open');expect(result.stdout).not.toContain('NEVER_PRINT');expect(result.stdout).not.toContain('/uncommitted');
});
