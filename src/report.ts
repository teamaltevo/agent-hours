import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { boundaries, privateWrite, today, SafeError } from './core.ts';
import { spans, transcript } from './sources.ts';
import { Classifier, redact } from './classifier.ts';
import { counts, metrics, type Report, type Candidate, type Client, type Session, type Label, type SourceStatus, type Day,type ReportPerson } from './types.ts';
import type { RunProfile } from './profile.ts';
import { DetailBuilder } from './details.ts';
import { dailyCSV } from './public-report.ts';
import { allClientSummary } from './all-clients.ts';
export { dailyCSV } from './public-report.ts';

export interface BuildOptions {
  since:string;until:string;statuses:Partial<Record<Client,SourceStatus>>;candidates:Candidate[];
  hours:Map<string,number>;confirmed?:boolean;workOnly:boolean;classifier?:Classifier;
  workers:number;batchSize:number;directory:string;signal:AbortSignal;
  onProgress:(done:number,total:number)=>void;
  profile?:RunProfile;
  person?:ReportPerson;
}
export class ReportBuilder {
  report:Report;dayBounds:ReturnType<typeof boundaries>;path:string;indexPath:string;done=0;
  private writeQueue=Promise.resolve();
  private details:DetailBuilder;
  private lastSavedDone=0;private lastSavedAt=performance.now();
  constructor(public options:BuildOptions) {
    const active=Object.keys(options.statuses) as Client[];
    if (!active.length) throw new SafeError('no_clients');
    this.dayBounds=boundaries(options.since,options.until);
    this.details=new DetailBuilder(this.dayBounds);
    const id=randomUUID();
    this.path=join(options.directory,'reports',`native-interactive-${options.since}--${options.until}-${id}.json`);
    this.indexPath=join(options.directory,'local',`session-index-ts-${id}.jsonl`);
    const clientReports=Object.fromEntries(active.map(client=>[client,{metric:metrics[client],source_coverage:options.statuses[client]!.coverage,classification_counts:counts(),observed_inferred_work_hours:null,keyword_related_hours:null,model_inferred_work_hours:null,source_issue_count:options.statuses[client]!.source_issue_count,available_source_count:options.statuses[client]!.available_source_count}]));
    const days:Day[]=this.dayBounds.map(({date})=>({date,day_status:date===today()?'in_progress':'historical_date',returned_punch_hours:options.hours.get(date)??null,developer_hours:options.hours.get(date)??0,history_observed_by_client:Object.fromEntries(active.map(c=>[c,false])),observed_inferred_work_hours:{},captured_work_hours_by_client:{},ratios_by_client:{},ratio_status_by_client:{},ratio:null}));
    const lookup=new Map(days.map(d=>[d.date,d]));
    for (const candidate of options.candidates) for (const day of candidate.history) if (lookup.has(day)) lookup.get(day)!.history_observed_by_client[candidate.client]=true;
    this.report={schema_version:5,implementation:'bun-typescript-v1',since:options.since,until:options.until,timezone:'America/Toronto',current_day_in_progress:options.until===today(),work_ownership_source:options.workOnly?'operator_declared_work_only':'automatic_inference',timesentry_coverage:'complete',timesentry_retrieval:{status:'self_only_read_completed',scope_completeness:'complete'},daily_ratio_policy:{schema_version:2,denominator:'all_returned_timesentry_hours',unknown_policy:'exclude_as_personal_for_ratio',ratio_mode:'observed_history_proxy'},daily_ratio_interpretation:'Captured activity divided by returned TimeSentry hours on dates with recorded history. Estimates are not productivity, compute runtime, human work or billing.',primary_ratio_client:active.includes('opencode')?'opencode':active[0],classification_counts:counts(),classifier_counts:{},unknown_reason_counts:{},clients:clientReports,days,observed_day_aggregates:{},default_aggregate:{paired_days:0,agent_hours:null,developer_hours:null,ratio:null},processed_sessions:0,pending_sessions:options.candidates.length,run_status:'in_progress'};
    if(options.person)this.report.person=options.person;
  }
  add(candidate:Candidate,session:Session,label:Label):void {
    const r=this.report;const client=r.clients[session.client]!;
    r.classification_counts[label]++;client.classification_counts[label]++;
    this.details.add(session,label,candidate.history);
    if (label==='unknown') {const reason=session.reason??'reason_unavailable';r.unknown_reason_counts[reason]=(r.unknown_reason_counts[reason]??0)+1;}
    if (label==='work') {
      const intervals=spans(session);
      if (intervals.length) {
        let total=0;
        for (let i=0;i<this.dayBounds.length;i++) {
          const {lo,hi}=this.dayBounds[i];const amount=intervals.reduce((n,[a,b])=>n+Math.max(0,Math.min(b,hi)-Math.max(a,lo)),0)/3_600_000;
          if (amount>0) {this.report.days[i].observed_inferred_work_hours[session.client]=(this.report.days[i].observed_inferred_work_hours[session.client]??0)+amount;total+=amount;}
        }
        client.observed_inferred_work_hours=(client.observed_inferred_work_hours??0)+total;
        const field=session.method==='keyword'?'keyword_related_hours':'model_inferred_work_hours';
        client[field]=(client[field]??0)+total;
      }
    }
    this.done++;r.processed_sessions=this.done;r.pending_sessions=this.options.candidates.length-this.done;
  }
  ratios():void {
    for (const client of Object.keys(this.report.clients) as Client[]) {
      let activity=0,work=0,paired=0;
      for (const day of this.report.days) {
        const history=day.history_observed_by_client[client]===true;
        const amount=day.observed_inferred_work_hours[client]??(history?0:null);
        day.captured_work_hours_by_client[client]=amount;
        const ratio=history&&(day.developer_hours??0)>0?amount!/day.developer_hours!:null;
        day.ratios_by_client[client]=ratio;
        day.ratio_status_by_client[client]=!history?'no_recorded_history':!day.developer_hours?'zero_developer_hours':'observed_subset_proxy';
        if (ratio!==null) {activity+=amount!;work+=day.developer_hours!;paired++;}
        day.ratio=day.ratios_by_client[this.report.primary_ratio_client]??null;
      }
      this.report.observed_day_aggregates[client]={paired_days:paired,captured_activity_hours:paired?activity:null,developer_hours:paired?work:null,ratio:paired?activity/work:null,metric:metrics[client]};
    }
    this.report.classifier_counts=this.options.classifier?.counts()??{model_calls:0,cache_hits:0,failed_calls:0};
    this.details.apply(this.report);
    this.report.all_clients=allClientSummary(this.report);
  }
  async save(initial=false):Promise<void> {
    this.lastSavedDone=this.done;this.lastSavedAt=performance.now();
    this.ratios();this.report.processed_session_count=this.report.processed_sessions;this.report.pending_session_count=this.report.pending_sessions;
    if(this.options.profile){const c=this.options.classifier;this.report.profiling={...this.options.profile.snapshot(),requests:{success:c?.successful??0,failed:c?.failed??0,peak_concurrent:c?.peak??0}};}
    const text=JSON.stringify(this.report,null,2)+'\n';const processed=this.done,pending=this.report.pending_sessions,status=this.report.run_status;
    this.writeQueue=this.writeQueue.then(async()=>{
      const start=performance.now();await privateWrite(this.path,text,!initial);
      await appendFile(this.indexPath,JSON.stringify({kind:'report',run_status:status,processed_sessions:processed,pending_sessions:pending,report_file:this.path})+'\n');
      this.options.profile?.record('report_write',performance.now()-start);
    });await this.writeQueue;
  }
  async index(candidate:Candidate,s:Session,label:Label):Promise<void> {
    // Private fixed projection only. Never include records, text, prompts or replies.
    await appendFile(this.indexPath,JSON.stringify({kind:'session',sequence:this.done,client:candidate.client,session_id:candidate.identity,source_files:candidate.sources,directory:candidate.directory,recorded_directories:[...new Set([...s.records.values()].map(r=>r.cwd).filter(Boolean))],classification:label,attribution_method:s.method==='declared'?'operator_declared':s.method??'model',reason_code:s.reason??'reason_unavailable',evidence_flags:[...s.reasons],timing_status:spans(s).length?'observed':'missing'})+'\n',{mode:0o600});
  }
  async run():Promise<Report> {
    await privateWrite(this.indexPath,JSON.stringify({kind:'run',schema_version:1,private:true,since:this.options.since,until:this.options.until,timezone:'America/Toronto',expected_sessions:this.options.candidates.length,created_at:new Date().toISOString()})+'\n');await this.save(true);
    let next=0;let stopped=false;
    const processGroup=async(group:Candidate[])=>{
      let batch:{candidate:Candidate;session:Session}[]=[];let chars=0;
      const consume=async(items:typeof batch,results:Label[])=>{
        for (let i=0;i<items.length;i++) {const {candidate,session}=items[i];this.add(candidate,session,results[i]);await this.index(candidate,session,results[i]);}
        this.options.onProgress(this.done,this.options.candidates.length);
        if(this.done===this.options.candidates.length||this.done-this.lastSavedDone>=20||performance.now()-this.lastSavedAt>=2000)await this.save();
      };
      const flush=async()=>{if (!batch.length) return;const items=batch;batch=[];chars=0;await consume(items,await this.options.classifier!.classifyBatch(items.map(x=>x.session)));};
      for (const candidate of group) {
        this.options.signal.throwIfAborted();
        if (this.options.workOnly) {
          const session=candidate.metadata;session.method='declared';session.reason=session.conflict||session.incomplete?[...session.reasons][0]??'incomplete_transcript':'operator_declared_work_only';
          await consume([{candidate,session}],[session.conflict||session.incomplete?'unknown':'work']);continue;
        }
        const classifier=this.options.classifier!;
        // If neither cache nor local rules could help, do not read more private text.
        if (!classifier.matcher.enabled&&(classifier.calls>=classifier.options.maxCalls||classifier.consecutive>=3)) {
          await flush();const session=candidate.metadata;session.reason=classifier.consecutive>=3?'failure_circuit_open':'call_budget_exhausted';
          await consume([{candidate,session}],['unknown']);continue;
        }
        const session=this.options.profile?await this.options.profile.measure('session_load',candidate.load):await candidate.load();const size=redact(transcript(session)).length;
        if (size>12000||chars+size>24000) await flush();
        if (size>12000) {await consume([{candidate,session}],[await classifier.classify(session)]);continue;}
        batch.push({candidate,session});chars+=size;
      }
      await flush();
    };
    const worker=async()=>{
      while (!stopped) {
        this.options.signal.throwIfAborted();
        const group=this.options.candidates.slice(next,next+this.options.batchSize);next+=group.length;
        if (!group.length) return;
        try {await processGroup(group);} catch(error) {stopped=true;throw error;}
      }
    };
    this.options.onProgress(0,this.options.candidates.length);
    try {
      const outcomes=await Promise.allSettled(Array.from({length:this.options.workers},worker));
      const failed=outcomes.find((o):o is PromiseRejectedResult=>o.status==='rejected');
      if (failed) throw failed.reason;
      this.report.run_status='completed';await this.save();await privateWrite(this.path.replace(/\.json$/,'.daily.csv'),dailyCSV(this.report));
      await appendFile(this.indexPath,JSON.stringify({kind:'status',run_status:'completed',indexed_sessions:this.done,report_processed_sessions:this.done,expected_sessions:this.options.candidates.length})+'\n');
      return this.report;
    } catch(error) {
      this.report.run_status=this.options.signal.aborted?'interrupted':'failed';
      await this.save();await appendFile(this.indexPath,JSON.stringify({kind:'status',run_status:this.report.run_status,indexed_sessions:this.done,report_processed_sessions:this.done,expected_sessions:this.options.candidates.length})+'\n');throw error;
    }
  }
}
