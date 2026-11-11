import { EmailMessage } from 'cloudflare:email';
import handler,{type Env} from './index.ts';
import { emailMIME } from './mime.ts';
/** Legacy Email Routing API works with the account's existing verified domain;
 * it does not require onboarding the newer Email Sending beta service. */
export default {fetch(request:Request,env:Omit<Env,'EMAIL'>&{EMAIL:{send(message:EmailMessage):Promise<unknown>}}){
  return handler.fetch(request,{...env,EMAIL:{send:message=>env.EMAIL.send(new EmailMessage(message.from,message.to,emailMIME(message)))}});
}};
