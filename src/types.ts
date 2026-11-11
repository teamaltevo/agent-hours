export const clients = ['opencode', 'claude', 'codex', 'claude-desktop'] as const;
export type Client = typeof clients[number];
export const names: Record<Client,string> = { opencode:'OpenCode', claude:'Claude Code', codex:'Codex', 'claude-desktop':'Claude Chat (Desktop/web)' };
export const metrics: Record<Client,string> = { opencode:'recorded_assistant_response_span_ms', claude:'bounded_message_gap_estimate_ms', codex:'bounded_message_gap_estimate_ms', 'claude-desktop':'bounded_message_gap_estimate_ms' };
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
  telemetry?:Telemetry;
}
export const toolCategories=['shell','file_read','file_write','search','web','browser','agent','other'] as const;
export type ToolCategory=typeof toolCategories[number];
export type ToolStatus='success'|'failure'|'unknown';
export interface ToolEvent { id:string; category:ToolCategory; command_family:string|null; start:number|null; end:number|null; duration_ms:number|null; timing:'recorded_interval'|'recorded_duration'|'round_trip'|'unavailable'; status:ToolStatus; conflict?:boolean }
export interface UsageEvent { id:string; at:number|null; input:number|null; output:number|null; cache_read:number|null; cache_write:number|null; reasoning:number|null; cost_usd:number|null }
export interface DurationEvent { id:string; at:number|null; duration_ms:number }
export interface Telemetry { tools:Map<string,ToolEvent>; usage:Map<string,UsageEvent>; turns:Map<string,DurationEvent>; recorded_spans:Map<string,Span>; rejected:Set<string>; issues:number }
export interface Distribution { count:number; total_ms:number; min_ms:number|null; median_ms:number|null; p95_ms:number|null; max_ms:number|null; frequencies_ms:[number,number][] }
export interface ToolSummary { calls:number; success:number; failure:number; unknown_status:number; missing_duration:number; recorded_duration:Distribution; observed_round_trip:Distribution; by_category:Record<ToolCategory,ToolSummaryLeaf>; shell_command_families:Record<string,ToolSummaryLeaf>; coverage:'partial'|'unavailable' }
export interface ToolSummaryLeaf { calls:number; success:number; failure:number; unknown_status:number; missing_duration:number; recorded_duration:Distribution; observed_round_trip:Distribution }
export interface UsageSummary { input_tokens:number|null; output_tokens:number|null; cache_read_tokens:number|null; cache_write_tokens:number|null; reasoning_tokens:number|null; reported_estimated_cost_usd:number|null; samples:number }
export interface ActivitySummary { summed_hours:number; elapsed_union_hours:number; overlapping_hours:number; peak_concurrency:number; recorded_span_hours:number|null; recorded_turn_duration_hours:number|null; bounded_message_gap_hours:number|null }
export interface DailyDetails { sessions:Counts; attribution:{model:number;keyword:number;declared:number}; tools:ToolSummary; usage:UsageSummary; activity:ActivitySummary; telemetry_issues:number }
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
  details_by_client?:Partial<Record<Client,DailyDetails>>;
  combined?:CombinedDay;
}
export interface ClientReport {
  metric:string; source_coverage:SourceStatus['coverage']; classification_counts:Counts;
  observed_inferred_work_hours:number|null; keyword_related_hours:number|null;
  model_inferred_work_hours:number|null; source_issue_count:number; available_source_count:number;
  details?:DailyDetails;
}
export interface Aggregate { paired_days:number; captured_activity_hours:number|null; developer_hours:number|null; ratio:number|null; metric:string }
export interface Report {
  schema_version:5; implementation:'bun-typescript-v1'; since:string; until:string; timezone:'America/Toronto';
  current_day_in_progress:boolean; work_ownership_source:string; timesentry_coverage:'complete'|'operator_confirmed'|'unknown';
  timesentry_retrieval:{ status:'self_only_read_completed'; scope_completeness:string };
  daily_ratio_policy:Record<string,unknown>; daily_ratio_interpretation:string; primary_ratio_client:Client;
  classification_counts:Counts; classifier_counts:Record<string,number>; unknown_reason_counts:Record<string,number>;
  clients:Partial<Record<Client,ClientReport>>; days:Day[]; observed_day_aggregates:Partial<Record<Client,Aggregate>>;
  default_aggregate:{ paired_days:0; agent_hours:null; developer_hours:null; ratio:null };
  processed_sessions:number; pending_sessions:number; run_status:'in_progress'|'completed'|'interrupted'|'failed';
  processed_session_count?:number; pending_session_count?:number; profiling?:Record<string,unknown>;
  telemetry_schema_version?:1; telemetry_interpretation?:string;
  period_summaries?:{week:PeriodSummary[];month:PeriodSummary[]};
  combined?:{metric:'cross_client_message_gap_union_ms';aggregate:Aggregate;details:DailyDetails;period_summaries:{week:CombinedPeriod[];month:CombinedPeriod[]}};
}
export interface PeriodSummary { period:string; client:Client; developer_hours:number|null; captured_work_hours:number|null; paired_days:number; paired_activity_hours:number|null; paired_developer_hours:number|null; ratio:number|null; days_with_activity_and_zero_work:number; details:DailyDetails }
export interface CombinedDay {history_observed:boolean;captured_work_hours:number|null;ratio:number|null;ratio_status:string;details:DailyDetails}
export type CombinedPeriod=Omit<PeriodSummary,'client'>;
