import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MongoError,MongoNetworkError,MongoServerError,MongoOperationTimeoutError} from 'mongodb';
import {GenerationFault} from '../src/server/generation/engine';
import {GenerationIdlePollError,idleDatabaseFailure,workerFailureCode} from '../src/server/generation/poll-error';
import {runGenerationWorker,GenerationLoopFailure,type GenerationLoopEvent} from '../src/server/generation/loop';

const transient=()=>new GenerationIdlePollError('DATABASE_UNAVAILABLE');
test('idle retry classification accepts driver failures but never raw text, forged labels or configuration errors',()=>{
  assert.equal(idleDatabaseFailure(new MongoNetworkError('private URI'))?.reason,'DATABASE_UNAVAILABLE');
  assert.equal(idleDatabaseFailure(new MongoOperationTimeoutError('private timeout'))?.reason,'DATABASE_UNAVAILABLE');
  const labeled=new MongoError('private transaction');labeled.addErrorLabel('TransientTransactionError');
  assert.equal(idleDatabaseFailure(labeled)?.reason,'DATABASE_TRANSIENT');
  for(const error of [new Error('MongoNetworkError: private'),{hasErrorLabel:()=>true},new MongoServerError({message:'private',code:18}),new GenerationFault('ENGINE_NOT_CAPABLE')])assert.equal(idleDatabaseFailure(error),null);
  assert.equal(workerFailureCode(new GenerationFault('private raw code')),'WORKER_EXECUTION_STOPPED');
});

test('idle database failures recover with bounded backoff and safe diagnostics',async()=>{
  const stop=new AbortController(),events:GenerationLoopEvent[]=[],delays:number[]=[];let ticks=0,releases=0;
  await runGenerationWorker({tick:async()=>{if(++ticks<=2)throw transient();stop.abort();return false;},release:async()=>{releases++;}},
    {signal:stop.signal,report:e=>events.push(e),sleep:async ms=>{delays.push(ms);}});
  assert.equal(ticks,3);assert.equal(releases,1);assert.deepEqual(delays,[2000,4000]);
  assert.deepEqual(events,[{event:'generation_idle_retry',reason:'DATABASE_UNAVAILABLE',retry:1,delayMs:2000},{event:'generation_idle_retry',reason:'DATABASE_UNAVAILABLE',retry:2,delayMs:4000},{event:'generation_idle_recovered',retries:2}]);
});
test('persistent idle failures stop after three retries and release once',async()=>{
  let ticks=0,releases=0;const delays:number[]=[],events:GenerationLoopEvent[]=[];
  await assert.rejects(runGenerationWorker({tick:async()=>{ticks++;throw transient();},release:async()=>{releases++;}},
    {signal:new AbortController().signal,report:e=>events.push(e),sleep:async ms=>{delays.push(ms);}}),e=>e instanceof GenerationLoopFailure&&e.code==='IDLE_DATABASE_RETRIES_EXHAUSTED');
  assert.equal(ticks,4);assert.equal(releases,1);assert.deepEqual(delays,[2000,4000,8000]);assert.equal(events.at(-1)?.event,'generation_idle_retries_exhausted');
});
test('a successful poll resets only consecutive idle failures',async()=>{
  const stop=new AbortController(),events:GenerationLoopEvent[]=[];let ticks=0;
  await runGenerationWorker({tick:async()=>{ticks++;if(ticks===1||ticks===3)throw transient();if(ticks===4)stop.abort();return false;},release:async()=>{}},
    {signal:stop.signal,report:e=>events.push(e),sleep:async()=>{}});
  assert.deepEqual(events.filter(e=>e.event==='generation_idle_retry').map(e=>e.retry),[1,1]);
});
test('raw execution/network/configuration errors stop without retry or diagnostic leakage',async()=>{
  for(const error of [new MongoNetworkError('private URI'),new MongoOperationTimeoutError('private timeout'),new MongoServerError({message:'private response',code:18}),new GenerationFault('GENERATION_CONFIGURATION_REQUIRED'),new Error('private prompt')])for(const stopping of [false,true]){
    let ticks=0,releases=0,delays=0;const events:GenerationLoopEvent[]=[],stop=new AbortController();
    await assert.rejects(runGenerationWorker({tick:async()=>{ticks++;if(stopping)stop.abort();throw error;},release:async()=>{releases++;}},
      {signal:stop.signal,report:e=>events.push(e),sleep:async()=>{delays++;}}),e=>e===error);
    assert.equal(ticks,1);assert.equal(releases,1);assert.equal(delays,0);assert.deepEqual(events,[]);assert.ok(!workerFailureCode(error).includes('private'));
  }
});
test('shutdown interrupts real backoff and never starts another tick',async()=>{
  const stop=new AbortController();let ticks=0,releases=0;
  await runGenerationWorker({tick:async()=>{ticks++;throw transient();},release:async()=>{releases++;}},
    {signal:stop.signal,report:()=>queueMicrotask(()=>stop.abort())});
  assert.equal(ticks,1);assert.equal(releases,1);
});
test('release errors preserve the original failure and emit only a safe category',async()=>{
  const original=new Error('private original'),events:GenerationLoopEvent[]=[];
  await assert.rejects(runGenerationWorker({tick:async()=>{throw original;},release:async()=>{throw new MongoNetworkError('private cleanup');}},
    {signal:new AbortController().signal,report:e=>events.push(e)}),e=>e===original);
  assert.deepEqual(events,[{event:'generation_release_failed',reason:'DATABASE_UNAVAILABLE'}]);
  const stopped=AbortSignal.abort();let ticks=0;
  await assert.rejects(runGenerationWorker({tick:async()=>{ticks++;return false;},release:async()=>{throw new Error('private');}},
    {signal:stopped,report:()=>{}}),e=>e instanceof GenerationLoopFailure&&e.code==='WORKER_RELEASE_FAILED');assert.equal(ticks,0);
});
