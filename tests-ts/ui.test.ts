import { expect,test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { UI,keyboardPicker,clean,matchingModels } from '../src/ui.ts';
import type { ReadStream,WriteStream } from 'node:tty';

const defaultModel={id:'fast',providerID:'synthetic'};
const models=[{...defaultModel,name:'Fast'},{id:'reasoning',providerID:'other',name:'Reasoner'}];
class Input extends PassThrough {isRaw=false;setRawMode(raw:boolean){this.isRaw=raw;return this;}}
function screen(){const input=new Input();const output=new PassThrough() as PassThrough&{columns:number;rows:number};output.columns=90;output.rows=24;let rendered='';output.on('data',data=>rendered+=data);return {input,output,text:()=>rendered};}
test('multi-token model search matches provider and name',()=>expect(matchingModels(models,'other reason')).toEqual([models[1]]));
test('terminal control characters are stripped from provider labels',()=>expect(clean('name\x1b[2J\n')).not.toContain('\x1b'));
test('picker default selection restores raw mode and alternate screen',async()=>{
  const s=screen();const picked=keyboardPicker(defaultModel,models,s.input as unknown as ReadStream,s.output as unknown as WriteStream);
  expect(s.input.isRaw).toBe(true);s.input.emit('keypress','\r',{name:'return'});expect(await picked).toEqual(defaultModel);expect(s.input.isRaw).toBe(false);expect(s.text()).toContain('\x1b[?1049l');
});
test('picker live search selects filtered model',async()=>{
  const s=screen();const picked=keyboardPicker(defaultModel,models,s.input as unknown as ReadStream,s.output as unknown as WriteStream);
  for(const char of 'reason')s.input.emit('keypress',char,{name:char});s.input.emit('keypress','\r',{name:'return'});expect(await picked).toEqual({id:'reasoning',providerID:'other'});
});
test('picker escape cancels and removes listeners',async()=>{
  const s=screen();const count=process.listenerCount('SIGINT');const picked=keyboardPicker(defaultModel,models,s.input as unknown as ReadStream,s.output as unknown as WriteStream);
  s.input.emit('keypress','\x1b',{name:'escape'});expect(await picked).toBeNull();expect(process.listenerCount('SIGINT')).toBe(count);expect(s.input.isRaw).toBe(false);
});
test('picker Ctrl+C cancels with screen restored',async()=>{
  const s=screen();const picked=keyboardPicker(defaultModel,models,s.input as unknown as ReadStream,s.output as unknown as WriteStream);s.input.emit('keypress','\x03',{name:'c',ctrl:true});await expect(picked).rejects.toThrow('cancelled');expect(s.input.isRaw).toBe(false);expect(s.text()).toContain('\x1b[?25h');
});
test('picker no matches can clear and resume',async()=>{
  const s=screen();const picked=keyboardPicker(defaultModel,models,s.input as unknown as ReadStream,s.output as unknown as WriteStream);s.input.emit('keypress','zz',{name:'z'});s.input.emit('keypress','\r',{name:'return'});expect(s.text()).toContain('No matches');s.input.emit('keypress','\x15',{name:'u',ctrl:true});s.input.emit('keypress','\r',{name:'return'});expect(await picked).toEqual(defaultModel);
});
test('picker respects prior raw mode',async()=>{
  const s=screen();s.input.isRaw=true;const picked=keyboardPicker(defaultModel,models,s.input as unknown as ReadStream,s.output as unknown as WriteStream);s.input.emit('keypress','\r',{name:'return'});await picked;expect(s.input.isRaw).toBe(true);
});
test('slash starts live model search without becoming part of the query',async()=>{
  const s=screen();const picked=keyboardPicker(defaultModel,models,s.input as unknown as ReadStream,s.output as unknown as WriteStream);
  for(const char of '/other reason')s.input.emit('keypress',char,{name:char});
  expect(s.text()).toContain('1 of 2 models matching your search');
  s.input.emit('keypress','\r',{name:'return'});expect(await picked).toEqual({id:'reasoning',providerID:'other'});
});
test('plain picker supports slash-prefixed search in a large catalogue',async()=>{
  const ui=new UI(true);const output:string[]=[];ui.note=text=>output.push(text);ui.title=()=>{};
  const answers=['/provider-199 target','1'];ui.ask=async()=>answers.shift()!;
  const catalogue=Array.from({length:200},(_,i)=>({id:'target-'+i,providerID:'provider-'+i,name:'Target '+i}));
  expect(await ui.model(defaultModel,catalogue)).toEqual({id:'target-199',providerID:'provider-199'});
  expect(output).toContain('Search: provider-199 target');expect(output.some(line=>line.includes('1 of 201 models'))).toBe(true);
});
test('plain picker can search reserved navigation letters explicitly',async()=>{
  const ui=new UI(true);ui.note=()=>{};ui.title=()=>{};const answers=['/q','1'];ui.ask=async()=>answers.shift()!;
  expect(await ui.model(defaultModel,[{id:'q-model',providerID:'provider',name:'Q Model'}])).toEqual({id:'q-model',providerID:'provider'});
});
test('confirmation with Yes default accepts Enter and advertises Y/n',async()=>{
  const ui=new UI(true);let prompt='';ui.ask=async text=>{prompt=text;return '';};
  expect(await ui.confirm('Allow conversation classification and sign in?',true)).toBe(true);expect(prompt).toEndWith('[Y/n]');
});
test('explicit No still declines a default-Yes confirmation',async()=>{
  const ui=new UI(true);ui.ask=async()=> 'n';expect(await ui.confirm('Continue?',true)).toBe(false);
});
test('other confirmations remain default No',async()=>{
  const ui=new UI(true);ui.ask=async()=> '';expect(await ui.confirm('Continue?')).toBe(false);
});
test('invalid confirmation answers reprompt instead of accepting consent',async()=>{
  const ui=new UI(true);ui.note=()=>{};const answers=['maybe','n'];ui.ask=async()=>answers.shift()!;
  expect(await ui.confirm('Continue?',true)).toBe(false);expect(answers.length).toBe(0);
});
