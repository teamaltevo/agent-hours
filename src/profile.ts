export class RunProfile {
  private started=performance.now();private phases=new Map<string,{count:number;total_seconds:number;max_seconds:number}>();
  record(phase:'metadata_discovery'|'session_load'|'model_request'|'oauth_read'|'report_write'|'local_triage',milliseconds:number):void {
    const seconds=Math.max(0,milliseconds/1000);const prior=this.phases.get(phase)??{count:0,total_seconds:0,max_seconds:0};
    prior.count++;prior.total_seconds+=seconds;prior.max_seconds=Math.max(prior.max_seconds,seconds);this.phases.set(phase,prior);
  }
  async measure<T>(phase:Parameters<RunProfile['record']>[0],fn:()=>Promise<T>):Promise<T> {
    const start=performance.now();try{return await fn();}finally{this.record(phase,performance.now()-start);}
  }
  snapshot():Record<string,unknown> {return {enabled:true,wall_elapsed_seconds:(performance.now()-this.started)/1000,phase_totals_are_cumulative_and_can_overlap:true,phases:Object.fromEntries([...this.phases].map(([key,v])=>[key,{...v,mean_seconds:v.total_seconds/v.count}]))};}
}
