import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { boundaries, readJSON, privateWrite, SafeError, today } from './core.ts';
import { clients, names, labels, type Label, type Client, type Model } from './types.ts';
import { discover, validateRoots } from './sources.ts';
import { openCodeTransport, Classifier } from './classifier.ts';
import { fetchTimeSentry,openBrowser } from './timesentry.ts';
import { applyAliases } from './projects.ts';
import { ReportBuilder } from './report.ts';
import { UI } from './ui.ts';
import { RunProfile } from './profile.ts';
import { inspectLatest } from './inspect.ts';
import { loadDelivery,sendReport } from './delivery.ts';
import { reportBundle } from './bundle.ts';
import { publicReport } from './public-report.ts';
import { deliveryRecorder } from './delivery-diagnostics.ts';
import { allClientSummary } from './all-clients.ts';

export const help=`Agent Hours — private AI activity reports

  agent-hours [options]

  --inspect                 Inspect the latest private session index; no login
  --details                 With --inspect, show private IDs and source paths
  --label VALUE             With --inspect: work, personal, mixed, unknown
  --limit N                 With --inspect, maximum rows (default 30)
  --database PATH           Additional OpenCode database/archive (repeatable)
  --clients NAME            opencode, claude, codex, claude-desktop (comma-separated)
  --claude-root PATH        Claude Code history folder (repeatable)
  --codex-root PATH         Codex history folder (repeatable)
  --claude-desktop-export PATH  Extracted Claude conversations.json (repeatable)
  --data-dir PATH           Private settings and output directory
  --submit-url HTTPS_URL    Override the default report delivery Worker
  --participant CODE        Optional assigned participant code, not an account ID
  --no-send                 Keep this run local even when delivery is configured
  --send-report PATH        Submit a completed saved JSON report without rereading history
  --render-report PATH      Rebuild an offline dashboard/bundle from aggregate JSON
  --no-open                 Do not open the dashboard after an interactive run
  --model PROVIDER/MODEL    Skip the model picker
  --work-only               Declare all selected history is your own work
  --max-calls N             Model request budget (default 200)
  --workers N               Concurrent workers, 1–4 (default 2)
  --batch-size N            Short sessions per request, 1–10 (default 5)
  --request-timeout N       Request limit in seconds, 10–300 (default 60)
  --session-timeout N       Session classification limit in seconds (default 120)
  --no-keywords             Disable local project matching
  --project-aliases PATH    Private project alias mappings
  --no-color               Plain terminal interface
  --help                    Show help

Requires Bun 1.4.2+. Mixed-use classification also needs a configured OpenCode V2
model. TimeSentry uses browser sign-in, reads only your hours and stores no tokens.
Period: January 1, 2023 through today in Montréal. Today remains partial.
`;
export function argumentsFor(argv:string[]) {
  const {values}=parseArgs({args:argv,strict:true,allowPositionals:false,options:{
    help:{type:'boolean',short:'h'},inspect:{type:'boolean'},details:{type:'boolean'},label:{type:'string',default:'unknown'},limit:{type:'string',default:'30'},'no-color':{type:'boolean'},'work-only':{type:'boolean'},'no-keywords':{type:'boolean'},'no-send':{type:'boolean'},'no-open':{type:'boolean'},'submit-url':{type:'string'},participant:{type:'string'},'send-report':{type:'string'},'render-report':{type:'string'},
    database:{type:'string',multiple:true},'claude-root':{type:'string',multiple:true},'codex-root':{type:'string',multiple:true},'claude-desktop-export':{type:'string',multiple:true},clients:{type:'string'},'data-dir':{type:'string'},model:{type:'string'},'project-aliases':{type:'string'},'timesentry-scope':{type:'string'},
    'max-calls':{type:'string',default:'200'},workers:{type:'string',default:'2'},'batch-size':{type:'string',default:'5'},'request-timeout':{type:'string',default:'60'},'session-timeout':{type:'string',default:'120'}
  }});
  const number=(key:'max-calls'|'workers'|'batch-size'|'request-timeout'|'session-timeout',min:number,max:number)=>{
    const value=Number(values[key]);if(!/^\d+$/.test(values[key]??'')||!Number.isSafeInteger(value)||value<min||value>max)throw new SafeError('invalid_options');return value;
  };
  const selected=(values.clients??clients.join(',')).split(',');
  if(!selected.length||selected.some(c=>!clients.includes(c as Client)))throw new SafeError('invalid_options');
  if(values['timesentry-scope']&&!['confirmed','unknown'].includes(values['timesentry-scope']))throw new SafeError('invalid_options');
  if(values.model&&!/^[^/\s]+\/.+$/.test(values.model))throw new SafeError('invalid_options');
  if(!labels.includes(values.label as Label)||!/^\d+$/.test(values.limit??'')||Number(values.limit)>1000)throw new SafeError('invalid_options');
  return {values,clients:[...new Set(selected)] as Client[],maxCalls:number('max-calls',1,10000),workers:number('workers',1,4),batchSize:number('batch-size',1,10),requestMs:number('request-timeout',10,300)*1000,sessionMs:number('session-timeout',1,3600)*1000};
}
export async function sourcesFor(directory:string,options:ReturnType<typeof argumentsFor>):Promise<Partial<Record<Client,string[]>>> {
  const home=homedir();let databases:string[]=[];
  const config=join(directory,'local/approved-source-discovery.json');
  if(existsSync(config)) {const saved=await readJSON(config);if(typeof saved.database!=='string')throw new SafeError('invalid_source_config');databases.push(saved.database);}
  if(!databases.length&&options.clients.includes('opencode')){
    try {const child=Bun.spawn(['opencode','debug','paths','db','--log-level','none'],{stdout:'pipe',stderr:'ignore'});
      const timeout=setTimeout(()=>child.kill(),15000);try{const path=(await new Response(child.stdout).text()).trim();if(await child.exited===0&&isAbsolute(path))databases.push(path);}finally{clearTimeout(timeout);}
    }catch{}
  }
  if(!databases.length)databases=[join(process.env.XDG_DATA_HOME??join(home,'.local/share'),'opencode/opencode.db')];
  databases.push(...(options.values.database??[]));
  const imported=join(directory,'local/imports/claude/conversations.json');
  const all:Record<Client,string[]>={opencode:databases,claude:options.values['claude-root']??[join(process.env.CLAUDE_CONFIG_DIR??join(home,'.claude'),'projects')],codex:options.values['codex-root']??['sessions','archived_sessions'].map(p=>join(process.env.CODEX_HOME??join(home,'.codex'),p)),'claude-desktop':options.values['claude-desktop-export']??(existsSync(imported)?[imported]:[])};
  return Object.fromEntries(options.clients.map(c=>[c,validateRoots(all[c],home)]));
}
const errors:Record<string,string>={
  invalid_options:'Invalid options. Run agent-hours --help for usage.',
  invalid_source_folder:'Select a client history folder, not your home or projects folder.',
  invalid_source_config:'The saved source settings are invalid.',
  invalid_project_alias_config:'The project alias file is missing or invalid.',
  model_unavailable:'No default model is configured. Configure a model in OpenCode first.',
  browser_open_failed:'Could not open your browser. Check your default browser and try again.',
  sign_in_timeout:'Sign-in timed out. Try again and complete sign-in in your browser.',
  sign_in_failed:'Sign-in failed. Check your TimeSentry account access and try again.',
  authorization_url_rejected:'TimeSentry requested an unexpected sign-in scope or endpoint. Sign-in was stopped.',
  index_unavailable:'No private session index is available in this data directory.',
  invalid_delivery_config:'The delivery settings are invalid. Use an HTTPS Worker endpoint ending in /reports.',
  delivery_not_configured:'Delivery is disabled. Omit --no-send to submit a saved report.',
  delivery_failed:'Email submission failed or is uncertain. Your local report is unchanged; do not retry repeatedly.',
  delivery_busy:'The delivery service is still processing the report. Your local report is saved.',
  delivery_uncertain:'Email delivery could not be confirmed. Check delivery status before submitting again.',
  delivery_daily_limit:'The daily email limit was reached. Your report is saved locally.',
  delivery_report_too_large:'This report is too large to email. Use the saved local bundle.',
  delivery_report_rejected:'The delivery service rejected the report format. Update the CLI before retrying.',
  delivery_phrase_rejected:'The delivery service rejected the submission phrase. Update the CLI or delivery settings.',
  delivery_service_unavailable:'The email service is not configured correctly. Your report is saved locally.',
  incomplete_report_not_sent:'Incomplete reports cannot be emailed automatically.',
  cancelled:'Cancelled.'
};
export async function main(argv=process.argv.slice(2)):Promise<number> {
  let options:ReturnType<typeof argumentsFor>;
  try {options=argumentsFor(argv);}catch{console.error(errors.invalid_options);return 2;}
  if(options.values.help){console.log(help);return 0;}
  const ui=new UI(options.values['no-color']);const abort=new AbortController();let builder:ReportBuilder|undefined;const profile=new RunProfile();let ticker:ReturnType<typeof setInterval>|undefined;
  const cancel=()=>{abort.abort();ui.close();};process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  try {
    ui.title('Agent Hours');
    const directory=resolve(options.values['data-dir']??(existsSync(join(process.cwd(),'local/approved-source-discovery.json'))?process.cwd():join(process.env.XDG_DATA_HOME??join(homedir(),'.local/share'),'agent-hours')));
    if(options.values.inspect){await inspectLatest(directory,ui,{label:options.values.label as Label,limit:Number(options.values.limit),details:Boolean(options.values.details)});return 0;}
    if(options.values['render-report']){
      const report=publicReport(await readJSON(resolve(options.values['render-report'])));
      report.all_clients=allClientSummary(report);
      const bundle=reportBundle(report),prefix=join(directory,'reports','rebuilt-'+randomUUID());
      await privateWrite(prefix+'.json',bundle.json);await privateWrite(prefix+'.daily.csv',bundle.csv);await privateWrite(prefix+'.html',bundle.html);await privateWrite(prefix+'.zip',bundle.zip);ui.note('Dashboard: '+prefix+'.html');ui.note('Report bundle: '+prefix+'.zip');return 0;
    }
    const delivery=await loadDelivery(directory,{endpoint:options.values['submit-url'],disabled:options.values['no-send'],participant:options.values.participant});
    if(options.values['send-report']){
      if(!delivery)throw new SafeError('delivery_not_configured');
      const report=publicReport(await readJSON(resolve(options.values['send-report'])));
      const recorder=deliveryRecorder(resolve(options.values['send-report']));ui.note('Sending report…');
      try{await sendReport(report,delivery,abort.signal,fetch,{onDiagnostic:recorder.onDiagnostic});await recorder.save('accepted').catch(()=>{});ui.note('Email accepted by the delivery service.');}
      catch(error){await recorder.save('failed',error instanceof SafeError?error.code:'delivery_failed').catch(()=>{});ui.note('Delivery diagnostics: '+recorder.path);throw error;}return 0;
    }
    const workOnly=options.values['work-only']??await ui.historyMode();
    const since='2023-01-01',until=today();boundaries(since,until);
    const sources=await sourcesFor(directory,options);
    ui.title('Report');ui.note(`${since} – ${until} · Montréal · today is partial`);ui.note(options.clients.map(c=>names[c]).join(', '));
    ui.note(workOnly?'Work-only history (your declaration).':`Personal / mixed-use history · up to ${options.maxCalls} model requests`);
    let model:Model|undefined;let transport:Awaited<ReturnType<typeof openCodeTransport>>|undefined;
    if(!workOnly){
      ui.note('Connecting to your configured OpenCode model service…');transport=await openCodeTransport(abort.signal);
      if(options.values.model){const at=options.values.model.indexOf('/');model={providerID:options.values.model.slice(0,at),id:options.values.model.slice(at+1)};}
      else {const catalogue=await transport.models();model=await ui.model(catalogue.defaultModel,catalogue.models)??undefined;if(!model){ui.note('Cancelled.');return 0;}}
    }
    abort.signal.throwIfAborted();ui.title('Privacy & access');
    if(workOnly)ui.note('Reads timing, tool and usage records locally. No conversations or command text are sent to a model.');
    else {ui.note(`Model: ${model!.providerID}/${model!.id}`);ui.note('Reads conversations, including personal history. Selected sessions may include messages outside the report dates.');ui.note('Excerpts and project references may go to this provider. Secret removal is best-effort; provider retention policies apply.');ui.note('Local project matches may identify work without a model. Results are estimates.');}
    ui.note('TimeSentry opens in your browser; only your own hours are read. Nothing is changed.');
    ui.note('Reports include your TimeSentry display name when available and aggregate totals, not conversations or account IDs. Private session IDs and paths stay under local/.');
    if(delivery)ui.note('After completion, aggregate JSON is automatically uploaded to '+delivery.endpoint+' for email delivery. Commands, conversations and private indexes are not uploaded.');
    const confirmation=delivery?(workOnly?'Read timing history, sign in and email the aggregate report?':'Classify history, sign in and email the aggregate report?'):(workOnly?'Read timing history and sign in?':'Allow conversation classification and sign in?');
    if(!await ui.confirm(confirmation,!workOnly)){ui.note('Cancelled.');return 0;}
    abort.signal.throwIfAborted();
    const timesentry=await profile.measure('oauth_read',()=>fetchTimeSentry(since,until,{consent:true,projects:!workOnly,onBrowser:()=>ui.note('Complete Microsoft sign-in in your browser (up to 5 minutes).'),signal:abort.signal}));
    ui.note('Connected to TimeSentry.');
    if(timesentry.person)ui.note('Report for '+timesentry.person.name+'.');
    const alias=options.values['project-aliases']??join(directory,'local/project-aliases.json');
    if(!workOnly&&(options.values['project-aliases']||existsSync(alias)))timesentry.projects=applyAliases(timesentry.projects,await readJSON(alias));
    ui.title(workOnly?'Reading timing history':'Reviewing sessions');ui.note('Finding sessions in the selected period…');
    const inventory=await profile.measure('metadata_discovery',()=>discover(sources,since,until,abort.signal));let completed=0;
    const classifier=workOnly?undefined:new Classifier({projects:timesentry.projects,transport:transport!,model:model!,cache:join(directory,'local/classifier-cache-ts-v1'),maxCalls:options.maxCalls,requestMs:options.requestMs,sessionMs:options.sessionMs,keywords:!options.values['no-keywords'],signal:abort.signal,profile,onRequest:active=>ui.progress(completed,inventory.candidates.length,active)});
    builder=new ReportBuilder({since,until,...inventory,hours:timesentry.hours,person:timesentry.person,workOnly,classifier,workers:options.workers,batchSize:options.batchSize,directory,signal:abort.signal,profile,onProgress:(done,total)=>{completed=done;ui.progress(done,total,classifier?.active??0);}});
    if(ui.color)ticker=setInterval(()=>ui.progress(completed,inventory.candidates.length,classifier?.active??0),1000);
    const report=await builder.run();if(ticker)clearInterval(ticker);ui.summary(report,builder.path);
    const bundle=reportBundle(report),htmlPath=builder.path.replace(/\.json$/,'.html'),zipPath=builder.path.replace(/\.json$/,'.zip');
    await privateWrite(htmlPath,bundle.html);await privateWrite(zipPath,bundle.zip);ui.note('Dashboard: '+htmlPath);ui.note('Shareable bundle: '+zipPath);
    let exit=0;
    if(delivery){const recorder=deliveryRecorder(builder.path);try{ui.note('Sending report…');await sendReport(report,delivery,abort.signal,fetch,{onDiagnostic:recorder.onDiagnostic});await recorder.save('accepted').catch(()=>{});ui.note('Email accepted by the delivery service.');}catch(error){const code=error instanceof SafeError?error.code:'delivery_failed';await recorder.save('failed',code).catch(()=>{});ui.note('Delivery diagnostics: '+recorder.path);if(abort.signal.aborted)throw new SafeError('cancelled');ui.note(errors[code]??errors.delivery_failed);exit=3;}}
    if(ui.interactive&&!options.values['no-open'])await openBrowser(pathToFileURL(htmlPath).href).catch(()=>ui.note('Open the saved dashboard file to view your report.'));
    return exit;
  } catch(error) {
    const code=abort.signal.aborted?'cancelled':error instanceof SafeError?error.code:'run_failed';
    ui.line();ui.note(errors[code]??'Could not finish the report. Check your connection, sign-in and source settings, then try again.');
    if(builder)ui.note('Partial report: '+builder.path);
    return code==='cancelled'?130:code.startsWith('delivery_')?3:2;
  } finally {if(ticker)clearInterval(ticker);ui.close();process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();
