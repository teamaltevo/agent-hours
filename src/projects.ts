import type { Project } from './types.ts';
import { stable, SafeError } from './core.ts';

export const generic=new Set(`work project projects client clients altevo internal interne internals website websites site web portal portail support maintenance development developpement application applications app api frontend backend mobile software logiciel service services management gestion platform plateforme integration integrations infrastructure security securite consulting consultation conseil collaboration communication documentation meeting meetings reunion reunions administration admin general miscellaneous divers private name projet projets new nouveau nouvelle test tests testing demo production dev staging data donnees reporting dashboard tableau bord business entreprise design marketing sales vente time system systeme outil outils tools tool task tasks tache taches update updates refactoring improvement facturation billing finance migration ecommerce commerce accounting comptabilite`.split(' '));
export function normalize(text:string,camel=false):string {
  return (camel?text.replace(/([a-z])([A-Z])/g,'$1 $2'):text).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/ +/g,' ');
}
const personal=['personal project','my personal','for myself','my hobby','side project','unrelated to work','not work related','outside of work','my birthday','my vacation','my holiday','my recipe','projet personnel','projet perso','pour moi meme','mon loisir','mes vacances','hors travail','sans rapport avec le travail','ignore previous instructions','classify every session','classify all sessions'];
const includes=(text:string,term:string)=>(' '+text+' ').includes(' '+term+' ');
export function jiraReference(value:unknown):{host:string;project_key:string}|null {
  if (typeof value!=='string'||value.length>8192) return null;
  try {
    const u=new URL(value.replace(/[).,;]+$/,''));
    if (!['http:','https:'].includes(u.protocol)||u.username||u.password||!/^[a-z0-9.-]+$/i.test(u.hostname)) return null;
    let match=decodeURIComponent(u.pathname).match(/\/browse\/([A-Za-z][A-Za-z0-9]{1,15})-\d+(?:\/|$)/);
    if (!match&&u.hostname.endsWith('.atlassian.net')&&u.searchParams.getAll('selectedIssue').length===1) match=u.searchParams.get('selectedIssue')!.match(/^([A-Za-z][A-Za-z0-9]{1,15})-\d+$/);
    return match?{host:u.hostname.toLowerCase(),project_key:match[1].toUpperCase()}:null;
  } catch { return null; }
}
export function projectContext(groups:unknown,punches:any[]):Project[] {
  if (!Array.isArray(groups)) throw new SafeError('invalid_project_context');
  const referenced=new Set(punches.map(p=>p.projectId).filter(p=>typeof p==='string'));
  const result=new Map<string,Omit<Project,'key'>>();
  for (const group of groups) {
    if (!group||typeof group.name!=='string'||!Array.isArray(group.projects)) throw new SafeError('invalid_project_context');
    for (const p of group.projects) {
      if (!p||typeof p.id!=='string'||typeof p.title!=='string'||!p.title.trim()) throw new SafeError('invalid_project_context');
      const refs=punches.filter(punch=>punch.projectId===p.id).map(punch=>jiraReference(punch.ticketLink)).filter((r):r is NonNullable<typeof r>=>r!==null);
      const unique=[...new Map(refs.map(r=>[stable(r),r])).values()].sort((a,b)=>stable(a).localeCompare(stable(b)));
      const value={title:p.title,client:group.name,seen_in_own_punches:referenced.has(p.id),jira_references:unique};
      if (result.has(p.id)&&stable(result.get(p.id))!==stable(value)) throw new SafeError('conflicting_project_context');
      result.set(p.id,value);
    }
  }
  return [...result].sort(([a],[b])=>a.localeCompare(b)).map(([,p],i)=>({key:'p'+String(i).padStart(4,'0'),...p}));
}
export function applyAliases(projects:Project[],config:any):Project[] {
  if (!config||config.schema_version!==1||!Array.isArray(config.mappings)||Object.keys(config).sort().join(',')!=='mappings,schema_version') throw new SafeError('invalid_project_alias_config');
  const result=structuredClone(projects);
  const unsafe=new Set([...generic,'home','downloads','documents','workspace','worktrees','users','tmp','temp']);
  for (const rule of config.mappings) {
    if (!rule||Object.keys(rule).sort().join(',')!=='directory_aliases,match_names,text_aliases') throw new SafeError('invalid_project_alias_config');
    for (const field of ['match_names','text_aliases','directory_aliases']) {
      if (!Array.isArray(rule[field])||!rule[field].every((v:unknown)=>typeof v==='string'&&v.length>=2&&v.length<=100&&/^[\p{L}\p{N}_ -]+$/u.test(v))) throw new SafeError('invalid_project_alias_config');
    }
    if (!rule.match_names.length) throw new SafeError('invalid_project_alias_config');
    for (const alias of [...rule.text_aliases,...rule.directory_aliases]) {
      if (unsafe.has(normalize(alias))||!/[\p{L}]/u.test(alias)) throw new SafeError('invalid_project_alias_config');
    }
    if (rule.text_aliases.some((s:string)=>normalize(s).replaceAll(' ','').length<5)) throw new SafeError('invalid_project_alias_config');
    for (const project of result) {
      const names=[project.title,project.client,...project.jira_references.map(r=>r.project_key)];
      const matched=rule.match_names.some((target:string)=>[normalize(target),normalize(target,true)].some(form=>names.some(name=>includes(normalize(name),form)||form.replaceAll(' ','')===normalize(name).replaceAll(' ',''))));
      if (matched) {
        project.text_aliases=[...new Set([...(project.text_aliases??[]),...rule.text_aliases])] as string[];
        project.directory_aliases=[...new Set([...(project.directory_aliases??[]),...rule.directory_aliases])] as string[];
      }
    }
  }
  return result;
}
export class ProjectMatcher {
  aliases=new Set<string>(); explicit=new Set<string>(); directories=new Set<string>(); jira=new Set<string>(); uniquePrefixes:string[]=[];
  constructor(projects:Project[]) {
    const owners=new Map<string,Set<string>>();
    for (const project of projects) {
      for (const a of project.text_aliases??[]) { this.explicit.add(normalize(a)); this.explicit.add(normalize(a,true)); }
      for (const a of project.directory_aliases??[]) { this.directories.add(normalize(a)); this.directories.add(normalize(a,true)); }
      for (const r of project.jira_references) {
        this.jira.add(stable(r)); const hosts=owners.get(r.project_key)??new Set<string>(); hosts.add(r.host); owners.set(r.project_key,hosts);
      }
      const words=normalize(project.title).split(' '); const meaningful=words.filter(w=>!generic.has(w)&&/\p{L}/u.test(w));
      if (!meaningful.length) continue;
      if (words.length>1&&words.join('').length>=8&&meaningful.some(w=>w.length>=4)) { this.aliases.add(normalize(project.title)); this.aliases.add(normalize(project.title,true)); }
      for (const word of project.title.match(/[\p{L}\p{N}_]+/gu)??[]) {
        const plain=normalize(word),split=normalize(word,true);
        if (plain.length>=8&&!generic.has(plain)&&!split.split(' ').every(w=>generic.has(w))) { this.aliases.add(plain); this.aliases.add(split); }
      }
    }
    this.uniquePrefixes=[...owners].filter(([p,hosts])=>hosts.size===1&&/^[A-Z][A-Z0-9]{1,15}$/.test(p)).map(([p])=>p);
  }
  get enabled():boolean { return Boolean(this.aliases.size||this.explicit.size||this.directories.size||this.jira.size); }
  match(text:string,directories:(string|null)[]=[]):string|null {
    const normal=normalize(text),split=normalize(text,true);
    if (personal.some(c=>includes(normal,c))) return null;
    for (const url of text.match(/https?:\/\/[^\s<>"']+/g)??[]) { const ref=jiraReference(url); if (ref&&this.jira.has(stable(ref))) return 'jira_issue_reference'; }
    const withoutURLs=text.replace(/https?:\/\/[^\s<>"']+/g,' ');
    if (this.uniquePrefixes.some(p=>new RegExp('(?<![\\w-])'+p+'-\\d+(?!\\w)').test(withoutURLs))) return 'jira_issue_reference';
    if ([...this.explicit].some(a=>includes(normal,a)||includes(split,a))) return 'project_alias_reference';
    if ([...this.aliases].some(a=>includes(normal,a)||includes(split,a))) return 'keyword_project_reference';
    for (const directory of directories) {
      if (!directory) continue;
      let parts=directory.split(/[/\\]+/);
      if (['users','home'].includes(parts[1]?.toLowerCase())) parts=parts.slice(3);
      if (parts.some(p=>this.directories.has(normalize(p))||this.directories.has(normalize(p,true)))) return 'project_directory_reference';
    }
    return null;
  }
}
/** Exact one-project evidence only. Never split one session over every project
 * mentioned: ambiguous/multi-project sessions belong to Unattributed. */
export class ProjectAttributor {
  private matchers:{key:string;title:string;matcher:ProjectMatcher}[];
  constructor(projects:Project[]){this.matchers=projects.map(p=>({key:p.key,title:normalize(p.title),matcher:new ProjectMatcher([p])}));}
  match(text:string,directories:(string|null)[]):string|null {
    const parts=directories.filter((d):d is string=>Boolean(d)).flatMap(d=>{const parts=d.split(/[/\\]+/);return ['users','home'].includes(parts[1]?.toLowerCase())?parts.slice(3):parts;}).map(d=>normalize(d));
    const found=this.matchers.filter(p=>p.matcher.match(text,directories)||(p.title.length>=3&&!p.title.split(' ').every(w=>generic.has(w))&&parts.includes(p.title)));return found.length===1?found[0].key:null;
  }
}
