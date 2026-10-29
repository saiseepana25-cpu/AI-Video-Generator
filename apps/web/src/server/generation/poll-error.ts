import {MongoError, MongoNetworkError, MongoServerSelectionError, MongoOperationTimeoutError} from 'mongodb';
import {DatabaseSetupError} from '../db/migrations';
import {GenerationFault} from './engine';

export type IdleDatabaseReason = 'DATABASE_UNAVAILABLE' | 'DATABASE_TRANSIENT';
/** Constructed only at the worker boundary before any claimed execution starts. */
export class GenerationIdlePollError extends Error {
  constructor(public readonly reason: IdleDatabaseReason) {super(reason);}
}
export function idleDatabaseFailure(error: unknown): GenerationIdlePollError | null {
  if (error instanceof MongoNetworkError || error instanceof MongoServerSelectionError || error instanceof MongoOperationTimeoutError) return new GenerationIdlePollError('DATABASE_UNAVAILABLE');
  if (error instanceof MongoError && ['RetryableWriteError','TransientTransactionError','UnknownTransactionCommitResult'].some(label => error.hasErrorLabel(label))) return new GenerationIdlePollError('DATABASE_TRANSIENT');
  return null;
}
const safeGenerationCodes = new Set(['DATABASE_CONFIGURATION_REQUIRED','GENERATION_CONFIGURATION_REQUIRED','LOCAL_BROWSER_REQUIRED','ENGINE_NOT_CAPABLE','WORKER_OWNERSHIP_LOST','RENDERER_CHANGED','EXECUTOR_STOP_UNCONFIRMED']);
export function workerFailureCode(error: unknown): string {
  if (error instanceof GenerationIdlePollError) return error.reason;
  if (error instanceof DatabaseSetupError) return 'DATABASE_READINESS_REQUIRED';
  if (error instanceof GenerationFault && safeGenerationCodes.has(error.code)) return error.code;
  if (error instanceof MongoNetworkError || error instanceof MongoServerSelectionError || error instanceof MongoOperationTimeoutError) return 'DATABASE_UNAVAILABLE';
  if (error instanceof MongoError) return 'DATABASE_ERROR';
  return 'WORKER_EXECUTION_STOPPED';
}
