import { scenario, transition, evidence, digest, need } from '../src/domain';
import type { State } from '../src/domain';
const key = 'coldspan.browser-preview.v1';
type Data = {incidents:Record<string,{initial:State;state:State}>;tokens:Record<string,{incident:string;kind:string}>;receipts:Record<string,{hash:string;receipt:any}>};
export function operate(data:Data,path:string,body?:any):any {
 const parts=path.split('/').filter(Boolean);
 if(path==='/session')return {mode:'BROWSER_LOCAL_SYNTHETIC_PREVIEW'};
 if(path==='/incidents'&&!body)return Object.values(data.incidents).map(x=>x.state);
 if(path==='/incidents'&&body){const id=crypto.randomUUID();const s=scenario(id,'browser-local-preview',body.scenario,body.seed);data.incidents[id]={initial:structuredClone(s),state:s};return s;}
 const id=parts[0]==='incidents'?parts[1]:body?.incidentId;
 const item=data.incidents[id];need(item,'NOT_FOUND');
 if(!body&&parts.length===2)return item.state;
 if(!body&&parts[2]==='evidence')return evidence(item.initial,item.state);
 if(parts[2]==='actions'){const actionId=crypto.randomUUID();data.tokens[actionId]={incident:id,kind:body.kind};return {actionId};}
 const route=parts.at(-1)!;
 const kind=parts[0]==='plans'?route:parts[0]==='work-orders'?({'dispatch':'dispatch','arrival-report':'report',arrival:'arrival',cancel:'cancel'} as Record<string,string>)[route]:({facts:'facts',observations:'observe',clock:'clock',plans:'plan',reconcile:'reconcile'} as Record<string,string>)[route];
 need(kind,'PREVIEW_ROUTE_NOT_FOUND');
 const token=data.tokens[body.actionId];need(token?.incident===id&&token?.kind===kind,'INVALID_ACTION_ID');
 const p={...(body.payload||{}),...(parts[0]==='plans'?{planId:parts[1]}:{}),...(parts[0]==='work-orders'?{workId:parts[1]}:{}),...(kind==='arrival'?{authority:'simulator'}:{})};
 const h=digest({id,kind,p});const old=data.receipts[body.actionId];if(old){need(old.hash===h,'ACTION_PAYLOAD_CONFLICT');return old.receipt;}
 need(item.state.version===body.expectedVersion,'VERSION_CONFLICT');
 const result=transition(item.state,kind,p,body.actionId);
 const receipt={actionId:body.actionId,kind,result,version:item.state.version,capturedAt:new Date().toISOString(),mode:'BROWSER_LOCAL_SYNTHETIC_PREVIEW'};
 data.receipts[body.actionId]={hash:h,receipt};return receipt;
}
export async function previewApi(path:string,body?:any){
 const execute=()=>{const raw=localStorage.getItem(key);const data:Data=raw?JSON.parse(raw):{incidents:{},tokens:{},receipts:{}};const result=operate(data,path,body);if(body)localStorage.setItem(key,JSON.stringify(data));return structuredClone(result);};
 if(navigator.locks)return navigator.locks.request('coldspan-preview-storage',execute);
 need(!body,'BROWSER_LOCKS_REQUIRED','Use a current browser with Web Locks for this local simulation.');return execute();
}
export async function downloadEvidence(id:string){const bundle=await previewApi(`/incidents/${id}/evidence`);const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='coldspan-browser-preview-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
