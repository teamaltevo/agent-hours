import { expect,test } from 'bun:test';
import { personFromProfile,displayName } from '../src/person.ts';
import { employeePerson } from '../src/timesentry.ts';
import { publicReport } from '../src/public-report.ts';
import { dashboardHTML } from '../src/dashboard.ts';
import { sampleReport } from './fixtures.ts';
import { emailMIME } from '../worker/src/mime.ts';

test('TimeSentry profile name takes precedence over the company email',()=>{
  expect(personFromProfile({fullName:'Félix Example',email:'felix@altevo.ca'})).toEqual({name:'Félix Example',source:'timesentry_profile'});
  expect(personFromProfile({firstName:'Anne-Marie',lastName:"O'Neill",email:'anne@altevo.ca'})?.name).toBe("Anne-Marie O'Neill");
});
test('Altevo email local part is used only when there is no profile name',()=>{
  expect(personFromProfile({email:'felix@altevo.ca'})).toEqual({name:'Felix',source:'timesentry_altevo_email'});
  expect(personFromProfile({email:'jean-marc.example@ALTEVO.CA'})?.name).toBe('Jean-Marc Example');
});
test('other email domains and missing names do not trigger a guessed identity',()=>{
  expect(personFromProfile({email:'felix@example.com'})).toBeUndefined();expect(personFromProfile({email:'felix@altevo.ca.attacker.example'})).toBeUndefined();expect(personFromProfile({employeeId:'synthetic-only'})).toBeUndefined();
});
test('only the validated signed-in employee result is used',()=>{
  const value={structuredContent:{employeeId:'00000000-0000-4000-8000-000000000000',firstName:'Synthetic',lastName:'Person',email:'synthetic@altevo.ca'}};
  expect(employeePerson(value)?.name).toBe('Synthetic Person');expect(()=>employeePerson({structuredContent:{employeeId:'invalid',name:'Other person'}})).toThrow();
});
for(const name of ['<script>alert(1)</script>','Alex\r\nBcc: victim@example.com','name@altevo.ca','/Users/private/path','Alex\u202eFake','00000000-0000-4000-8000-00000000000a'])test('invalid name is not included: '+JSON.stringify(name),()=>expect(displayName(name)).toBeNull());
test('person name is escaped in the heading and raw email/IDs cannot be exported',()=>{
  const r=sampleReport();r.person={name:'Anne & Eve',source:'timesentry_profile'};const html=dashboardHTML(r);expect(html).toContain('<h1>Anne &amp; Eve</h1>');expect(publicReport(r).person?.name).toBe('Anne & Eve');
  (r.person as any).email='PRIVATE_EMAIL@example.com';expect(()=>publicReport(r)).toThrow();
});
test('long Unicode names use valid folded UTF-8 subject words',()=>{
  const subject='Agent Hours · '+'漢字'.repeat(80);const mime=emailMIME({from:'reports@example.com',to:'recipient@example.com',subject,text:'Synthetic test',attachments:[]});
  const encoded=mime.match(/Subject: ([\s\S]*?)\r\nDate:/)![1].split('\r\n ');expect(encoded.every(word=>word.length<=75)).toBe(true);
  const decoded=encoded.map(word=>new TextDecoder().decode(Uint8Array.from(atob(word.slice(10,-2)),c=>c.charCodeAt(0)))).join('');expect(decoded).toBe(subject);
});
