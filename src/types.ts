export const clients = ['opencode', 'claude', 'codex'] as const;
export type Client = typeof clients[number];
export const names: Record<Client,string> = { opencode:'OpenCode', claude:'Claude Code', codex:'Codex' };
export const metrics: Record<Client,string> = { opencode:'recorded_assistant_response_span_ms', claude:'bounded_message_gap_estimate_ms', codex:'bounded_message_gap_estimate_ms' };
export const labels = ['work','personal','mixed','unknown'] as const;
export type Label = typeof labels[number];
export type Span = [number,number];
export type Model = { id:string; providerID:string; name?:string };
export type Counts = Record<Label,number>;
export const counts = ():Counts => ({ work:0,personal:0,mixed:0,unknown:0 });
export const reasonCodes = new Set('reason_unavailable conflicting_evidence conflicting_messages conflicting_session_directories source_metadata_ambiguous source_changed_since_discovery source_load_failed no_relevant_messages malformed_transcript transcript_text_limit missing_message_timestamp incomplete_transcript no_conversation_text no_project_context cached_classification cached_unknown_reason_unavailable keyword_project_reference project_alias_reference project_directory_reference jira_issue_reference model_project_match model_personal model_mixed model_unknown model_low_confidence invalid_model_response model_transport_failure model_request_timeout model_rate_limited evidence_chunk_limit call_budget_exhausted failure_circuit_open session_time_limit operator_declared_work_only'.split(' '));
export interface RecordEntry { role:'user'|'assistant'; start:number|null; end:number|null; text:string; cwd:string|null; fingerprint:string }
export interface Session {
  client:Client; identity:string; directory:string|null; records:Map<string,RecordEntry>;
  sources:string[]; reasons:Set<string>; incomplete:boolean; conflict:boolean; retained:number;
  label?:Label; reason?:string; method?:'model'|'keyword'|'declared';
}
export interface Candidate {
  client:Client; identity:string; directory:string|null; sources:string[]; size:number;
  history:string[]; metadata:Session; load:()=>Promise<Session>;
}
export interface SourceStatus { coverage:'unavailable'|'partial'|'unverified'; source_issue_count:number; available_source_count:number }
export interface Project { key:string; title:string; client:string; seen_in_own_punches:boolean; jira_references:{ host:string; project_key:string }[]; text_aliases?:string[]; directory_aliases?:string[] }
export interface Day {
  date:string; day_status:string; returned_punch_hours:number|null; developer_hours:number|null;
  history_observed_by_client:Partial<Record<Client,boolean|null>>;
  observed_inferred_work_hours:Partial<Record<Client,number|null>>;
  captured_work_hours_by_client:Partial<Record<Client,number|null>>;
  ratios_by_client:Partial<Record<Client,number|null>>;
  ratio_status_by_client:Partial<Record<Client,string>>; ratio:number|null;
}
export interface ClientReport {
  metric:string; source_coverage:SourceStatus['coverage']; classification_counts:Counts;
  observed_inferred_work_hours:number|null; keyword_related_hours:number|null;
  model_inferred_work_hours:number|null; source_issue_count:number; available_source_count:number;
}
export interface Aggregate { paired_days:number; captured_activity_hours:number|null; developer_hours:number|null; ratio:number|null; metric:string }
export interface Report {
  schema_version:5; implementation:'bun-typescript-v1'; since:string; until:string; timezone:'America/Toronto';
  current_day_in_progress:boolean; work_ownership_source:string; timesentry_coverage:'operator_confirmed'|'unknown';
  timesentry_retrieval:{ status:'self_only_read_completed'; scope_completeness:string };
  daily_ratio_policy:Record<string,unknown>; daily_ratio_interpretation:string; primary_ratio_client:Client;
  classification_counts:Counts; classifier_counts:Record<string,number>; unknown_reason_counts:Record<string,number>;
  clients:Partial<Record<Client,ClientReport>>; days:Day[]; observed_day_aggregates:Partial<Record<Client,Aggregate>>;
  default_aggregate:{ paired_days:0; agent_hours:null; developer_hours:null; ratio:null };
  processed_sessions:number; pending_sessions:number; run_status:'in_progress'|'completed'|'interrupted'|'failed';
  processed_session_count?:number; pending_session_count?:number; profiling?:Record<string,unknown>;
}
