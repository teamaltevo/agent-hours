import type { ReportPerson } from './types.ts';

/** A display name is the only identity detail permitted in aggregate exports. */
export function displayName(value:unknown):string|null {
  if(typeof value!=='string'||value.length>160||/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value))return null;
  const name=value.normalize('NFC').trim().replace(/ +/g,' ');
  if(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(name))return null;
  return name&&/\p{L}/u.test(name)&&/^[\p{L}\p{M}\p{N} .,'"’()&-]+$/u.test(name)?name:null;
}
export function personFromProfile(profile:any):ReportPerson|undefined {
  if(!profile||typeof profile!=='object')return;
  const first=profile.firstName??profile.first_name,last=profile.lastName??profile.last_name;
  const joined=[first,last].filter(v=>typeof v==='string'&&v.trim()).join(' ');
  for(const candidate of [profile.fullName,profile.employeeName,first&&last?joined:undefined,profile.displayName,profile.name,joined]){
    const name=displayName(candidate);if(name)return {name,source:'timesentry_profile'};
  }
  for(const value of [profile.email,profile.emailAddress,profile.userEmail]){
    if(typeof value!=='string'||value.length>254)continue;
    const match=value.trim().match(/^([\p{L}\p{N}][\p{L}\p{N}._'-]*)@altevo\.ca$/iu);if(!match)continue;
    const local=match[1].replace(/[._]+/g,' ').replace(/(^|[ -])(\p{L})/gu,(_all,separator,letter)=>separator+letter.toLocaleUpperCase());
    const name=displayName(local);if(name)return {name,source:'timesentry_altevo_email'};
  }
}
export function escapeHTML(value:string):string {return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
