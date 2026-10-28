import {setTimeout as wait} from 'node:timers/promises';
import {GenerationIdlePollError, workerFailureCode, type IdleDatabaseReason} from './poll-error';

export type GenerationLoopEvent =
  | {event:'generation_idle_retry';reason:IdleDatabaseReason;retry:number;delayMs:number}
  | {event:'generation_idle_recovered';retries:number}
  | {event:'generation_idle_retries_exhausted';reason:IdleDatabaseReason}
  | {event:'generation_release_failed';reason:string};
type Worker = {tick():Promise<boolean>;release():Promise<void>};
type Options = {signal:AbortSignal;report:(event:GenerationLoopEvent)=>void;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>};
export class GenerationLoopFailure extends Error {
  constructor(public readonly code:'IDLE_DATABASE_RETRIES_EXHAUSTED'|'WORKER_RELEASE_FAILED') {super(code);}
}
const backoff = [2000,4000,8000] as const;
async function sleep(ms:number,signal:AbortSignal) {
  try {await wait(ms,undefined,{signal});}
  catch(error){if(!signal.aborted)throw error;}
}

/** Retries idle polling only. Never retries an active execution or speech request. */
export async function runGenerationWorker(worker:Worker,options:Options) {
  const delay=options.sleep??sleep;let retries=0,failed=false;
  try {
    while(!options.signal.aborted) {
      let delayMs=2000;
      try {
        await worker.tick();
        if(retries)options.report({event:'generation_idle_recovered',retries});
        retries=0;
      } catch(error) {
        if(options.signal.aborted&&error instanceof GenerationIdlePollError)break;
        // A raw Mongo error may be a post-claim/settlement failure. Stop, don't retry.
        if(!(error instanceof GenerationIdlePollError))throw error;
        if(retries===backoff.length) {
          options.report({event:'generation_idle_retries_exhausted',reason:error.reason});
          throw new GenerationLoopFailure('IDLE_DATABASE_RETRIES_EXHAUSTED');
        }
        delayMs=backoff[retries++];
        options.report({event:'generation_idle_retry',reason:error.reason,retry:retries,delayMs});
      }
      if(!options.signal.aborted)await delay(delayMs,options.signal);
    }
  } catch(error) {failed=true;throw error;}
  finally {
    try {await worker.release();}
    catch(error) {
      options.report({event:'generation_release_failed',reason:workerFailureCode(error)});
      // Do not replace an execution/exhaustion failure with a cleanup failure.
      if(!failed)throw new GenerationLoopFailure('WORKER_RELEASE_FAILED');
    }
  }
}
