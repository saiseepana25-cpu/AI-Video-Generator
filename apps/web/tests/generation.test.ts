import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long} from 'mongodb';
import {approvalInput, recoverGenerationCommand} from '../src/lib/generation-command';
import {compatibleWorker} from '../src/server/generation/capability';
import {requiredCapabilities, type GenerationWorker} from '../src/server/generation/contracts';
import {pins, renderFixture} from './fixtures/rendering';

test('generation recovery preserves exact reviewed input and original request key, rejects cross-project/malformed commands', () => {
  const projectId = randomUUID(), body = {expectedProjectRevision: 3, planVersionId: randomUUID(), generationInputHash: 'a'.repeat(64)};
  const command = {projectId, key: randomUUID(), action: 'approve', targetId: projectId, body};
  assert.deepEqual(recoverGenerationCommand(JSON.stringify(command), projectId), command);
  assert.equal(recoverGenerationCommand(JSON.stringify(command), randomUUID()), null);
  for (const change of [{expectedProjectRevision: 0}, {generationInputHash: 'wrong'}, {extra: 1}]) assert.equal(approvalInput({...body, ...change}), null);
  assert.equal(recoverGenerationCommand(JSON.stringify({...command, targetId: randomUUID()}), projectId), null);
  const cancel = {...command, action: 'cancel', targetId: randomUUID(), body: {expectedRevision: 1}};
  assert.deepEqual(recoverGenerationCommand(JSON.stringify(cancel), projectId), cancel);
  assert.equal(recoverGenerationCommand(JSON.stringify({...cancel, body: {expectedRevision: 1, extra: 1}}), projectId), null);
  assert.equal(recoverGenerationCommand('null', projectId), null);
});
test('worker gate requires fresh healthy exact contract, timing, fonts and capabilities', () => {
  const now = new Date(), plan = renderFixture().plan;
  const worker: GenerationWorker = {_id: 'generation:local', owner: randomUUID(), revision: Long.ONE, state: 'healthy', contract: plan.contract,
    compilerVersion: plan.settingsSnapshot.compilerVersion, rendererBuildHash: 'd'.repeat(64), capabilities: requiredCapabilities, fonts: pins, heartbeatAt: now, expiresAt: new Date(now.getTime() + 30000)};
  assert.equal(compatibleWorker(worker, plan, now), true);
  for (const change of [{state: 'disabled' as const}, {state: 'draining' as const}, {contract: 'other'}, {compilerVersion: 'other'}, {capabilities: []}, {fonts: {...pins, body: 'd'.repeat(64)}}, {heartbeatAt: new Date(now.getTime() - 31000)}, {heartbeatAt: new Date(now.getTime() + 10000)}, {expiresAt: now}]) assert.equal(compatibleWorker({...worker, ...change}, plan, now), false);
  assert.equal(compatibleWorker(null, plan, now), false);
});
