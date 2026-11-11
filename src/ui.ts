import { createInterface, emitKeypressEvents, type Interface, type Key } from 'node:readline';
import type { ReadStream, WriteStream } from 'node:tty';
import { names, type Model, type Client, type Report } from './types.ts';
import { SafeError } from './core.ts';

export const clean=(value:unknown):string=>String(value).replace(/[\x00-\x1f\x7f-\x9f]/g,' ');
export function matchingModels(models:Model[],query:string):Model[] {
  const words=query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(m=>words.every(w=>(m.providerID+'/'+m.id+' '+(m.name??m.id)).toLowerCase().includes(w)));
}
export class UI {
  color:boolean;interactive:boolean;private input?:Interface;private answers?:AsyncIterableIterator<string>;
  private lastProgress=-1;private started=performance.now();private progressActive=false;
  constructor(noColor=false) {
    this.interactive=Boolean(process.stdin.isTTY&&process.stdout.isTTY&&process.env.TERM!=='dumb');
    this.color=this.interactive&&!noColor&&!('NO_COLOR' in process.env);
  }
  line(text=''):void {if(this.progressActive){process.stdout.write('\n');this.progressActive=false;}process.stdout.write(clean(text)+'\n');}
  title(text:string):void {this.line();this.line(this.color?'  '+text.toUpperCase():'  '+text);}
  note(text:string):void {this.line('    '+text);}
  async ask(prompt:string):Promise<string> {
    if (!this.input) {
      this.input=createInterface({input:process.stdin,terminal:false});this.answers=this.input[Symbol.asyncIterator]();
    }
    process.stdout.write('  '+clean(prompt)+' > ');
    const next=await this.answers!.next();if(next.done) throw new SafeError('cancelled');return next.value.trim();
  }
  async confirm(prompt:string,defaultYes=false):Promise<boolean> {
    while(true){
      const answer=(await this.ask(prompt+(defaultYes?' [Y/n]':' [y/N]'))).toLowerCase();
      if(!answer)return defaultYes;
      if(answer==='y'||answer==='yes')return true;
      if(answer==='n'||answer==='no')return false;
      this.note('Choose y or n.');
    }
  }
  async historyMode():Promise<boolean> {
    this.title('Your history');this.note('Choose Yes if any history is personal, mixed-use or uncertain.');
    this.note('Choose No only if all selected history is your own work; conversation classification is skipped.');
    while(true){const answer=(await this.ask('Personal or mixed-use history? [Y/n]')).toLowerCase();if(['','y','yes'].includes(answer))return false;if(['n','no'].includes(answer))return true;this.note('Choose y or n.');}
  }
  close():void {this.input?.close();this.input=undefined;this.answers=undefined;if(this.progressActive){process.stdout.write('\n');this.progressActive=false;}}
  async model(defaultModel:Model,models:Model[]):Promise<Model|null> {
    const all=[...models];if(!all.some(m=>m.id===defaultModel.id&&m.providerID===defaultModel.providerID))all.unshift(defaultModel);
    all.sort((a,b)=>Number(!(a.id===defaultModel.id&&a.providerID===defaultModel.providerID))-Number(!(b.id===defaultModel.id&&b.providerID===defaultModel.providerID))||a.providerID.localeCompare(b.providerID)||(a.name??a.id).localeCompare(b.name??b.id));
    if(this.color){this.close();return keyboardPicker(defaultModel,all);}
    this.title('Classification model');this.note('Fast models lower cost; stronger reasoning helps mixed history.');
    this.note('Conversation excerpts go to this provider. Use a verified local provider to keep them on-device.');
    this.note('Search with /name or /provider, or type a search directly. Select a number to use a result.');
    this.note('Enter uses '+defaultModel.providerID+'/'+defaultModel.id+'.');
    this.note('n/p pages · / clear · q cancel');
    let query='',page=0;
    while(true){
      const found=matchingModels(all,query);page=Math.min(page,Math.max(0,Math.ceil(found.length/10)-1));
      found.slice(page*10,page*10+10).forEach((m,i)=>this.note(`${i+1}. ${m.name??m.id} (${m.providerID}/${m.id})`));
      if(query)this.note('Search: '+query);
      if(!found.length)this.note('No matches. Try another search or / to clear.');else this.note(`Page ${page+1}/${Math.ceil(found.length/10)} · ${found.length} of ${all.length} models`);
      const choice=await this.ask('Search /name or select a number');
      if(!choice)return {id:defaultModel.id,providerID:defaultModel.providerID};
      if(choice==='q')return null;
      if(choice==='n')page++;else if(choice==='p')page=Math.max(0,page-1);else if(choice==='/'){query='';page=0;}
      else if(/^\d+$/.test(choice)){const selected=found[page*10+Number(choice)-1];if(Number(choice)>=1&&Number(choice)<=10&&selected)return {id:selected.id,providerID:selected.providerID};}
      else {query=choice.startsWith('/')?choice.slice(1):choice;page=0;}
    }
  }
  progress(done:number,total:number,active=0):void {
    const elapsed=Math.floor((performance.now()-this.started)/1000);
    const text=`  ${done}/${total} sessions${total?' · '+Math.floor(done/total*100)+'%':''}${active?' · '+active+' active':''} · ${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
    if(this.color){process.stdout.write('\r\x1b[2K'+clean(text));this.progressActive=true;}
    else if(done===0||done===total||Math.floor(done/20)!==this.lastProgress){this.line(text);this.lastProgress=Math.floor(done/20);}
  }
  summary(report:Report,path:string):void {
    this.title('Results');this.note(report.work_ownership_source==='operator_declared_work_only'?'Work-only history (your declaration).':'Estimated work activity; automatically identified sessions only.');
    for(const client of Object.keys(report.clients) as Client[]){
      const data=report.clients[client]!;const hours=data.observed_inferred_work_hours;
      this.note(`${names[client].padEnd(14)} ${hours===null?'not observed':hours.toFixed(2)+' h'} · ${client==='opencode'?'response spans':'message-gap estimate'}`);
      if(data.source_coverage!=='unverified')this.note('History '+data.source_coverage+'.');
      const aggregate=report.observed_day_aggregates[client];
      if(aggregate?.ratio!=null)this.note(`${aggregate.ratio.toFixed(3)} activity h / work h · ${aggregate.paired_days} paired days`);
    }
    this.title('Sessions');this.note(Object.entries(report.classification_counts).map(([k,v])=>`${k[0].toUpperCase()+k.slice(1)} ${v.toLocaleString()}`).join('  |  '));
    this.note('Personal, mixed and unknown sessions are excluded from work totals.');
    if(report.classifier_counts.failed_calls)this.note(`Some sessions could not be classified (${report.classifier_counts.failed_calls} model requests failed).`);
    if(report.unknown_reason_counts.call_budget_exhausted)this.note(`${report.unknown_reason_counts.call_budget_exhausted} sessions reached the model request limit. Increase --max-calls to process more.`);
    if(report.timesentry_coverage!=='operator_confirmed')this.note('Ratios withheld: TimeSentry completeness is unconfirmed.');
    this.note('History may be incomplete. Estimates can overcount or miss activity; not productivity or compute runtime.');
    this.note('Parallel sessions and waiting can produce ratios above 1. Today is partial.');
    this.line();this.line('  Saved: '+path);this.line('  Daily CSV: '+path.replace(/\.json$/,'.daily.csv'));
  }
}
/** Alternate-screen picker, restored on selection, EOF, cancellation and resize. */
export function keyboardPicker(defaultModel:Model,models:Model[],input=process.stdin as ReadStream,output=process.stdout as WriteStream):Promise<Model|null> {
  return new Promise((resolve,reject)=>{
    let query='',selected=0,help=false,finished=false;const wasRaw=input.isRaw;const wasPaused=input.isPaused();
    emitKeypressEvents(input);input.setRawMode(true);input.resume();output.write('\x1b[?1049h\x1b[?25l');
    const done=(model:Model|null,error?:Error)=>{
      if(finished)return;finished=true;input.off('keypress',key);input.off('end',end);output.off('resize',draw);process.off('SIGTERM',terminate);process.off('SIGINT',terminate);
      input.setRawMode(Boolean(wasRaw));if(wasPaused)input.pause();output.write('\x1b[?25h\x1b[?1049l');if(error)reject(error);else resolve(model);
    };
    const end=()=>done(null);const terminate=()=>done(null,new SafeError('cancelled'));
    function draw(){
      const width=output.columns||80,height=output.rows||24;const rows=Math.max(1,height-12);
      const found=matchingModels(models,query);selected=Math.min(selected,Math.max(0,found.length-1));
      const parts=['\x1b[H\x1b[2J'];
      function line(y:number,text:string,inverse=false){if(y>=height)return;parts.push(`\x1b[${y+1};3H`+(inverse?'\x1b[7m':'')+clean(text).slice(0,Math.max(1,width-4))+(inverse?'\x1b[0m':''));}
      if(width<42||height<12){line(0,'Enlarge terminal or Esc to cancel.');output.write(parts.join(''));return;}
      line(1,'CHOOSE A CLASSIFICATION MODEL');line(2,'Search: type a model or provider · ↑↓ browse · Enter select');
      line(4,'/ '+query+'_');line(5,`${found.length} of ${models.length} models${query?' matching your search':''}`);
      const start=Math.floor(selected/rows)*rows;
      found.slice(start,start+rows).forEach((m,i)=>line(7+i,`${start+i===selected?'›':' '} ${m.name??m.id} · ${m.providerID}${m.id===defaultModel.id&&m.providerID===defaultModel.providerID?' [default]':''}`,start+i===selected));
      if(!found.length)line(7,'No matches. Backspace to edit; Ctrl+U to clear.');
      if(found[selected])line(height-4,found[selected].providerID+'/'+found[selected].id);
      line(height-3,help?'Fast models cost less; stronger reasoning helps mixed history.':'Conversation excerpts are sent to the selected provider.');
      line(height-2,help?'Verify a local provider to keep data on-device. F1 closes help.':'Esc cancel · Ctrl+U clear search · F1 advice · PgUp/Down browse');
      output.write(parts.join(''));
    }
    function key(text:string,key:Key){
      try {
        const found=matchingModels(models,query);const rows=Math.max(1,(output.rows||24)-12);
        if(key.ctrl&&key.name==='c'){done(null,new SafeError('cancelled'));return;}
        if(key.name==='escape'){done(null);return;}
        if(key.name==='return'&&found[selected]){const m=found[selected];done({id:m.id,providerID:m.providerID});return;}
        if(key.name==='up')selected=Math.max(0,selected-1);else if(key.name==='down')selected=Math.min(found.length-1,selected+1);
        else if(key.name==='pageup')selected=Math.max(0,selected-rows);else if(key.name==='pagedown')selected=Math.min(found.length-1,selected+rows);
        else if(key.name==='backspace'){query=Array.from(query).slice(0,-1).join('');selected=0;}
        else if(key.ctrl&&key.name==='u'){query='';selected=0;}else if(key.name==='f1')help=!help;
        else if(text==='/'&&!query){selected=0;}
        else if(text&&!key.ctrl&&!key.meta&&!/[\x00-\x1f\x7f-\x9f]/.test(text)){query+=text;selected=0;}
        selected=Math.max(0,selected);draw();
      }catch{done(null,new SafeError('picker_failed'));}
    }
    input.on('keypress',key);input.once('end',end);output.on('resize',draw);process.once('SIGTERM',terminate);process.once('SIGINT',terminate);draw();
  });
}
