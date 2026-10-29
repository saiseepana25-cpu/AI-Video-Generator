/** A rejected shutdown is not evidence that Chrome/its children stopped. */
export class ExecutorStopUnconfirmed extends Error {
  constructor() {super('EXECUTOR_STOP_UNCONFIRMED');}
}

export async function requireBrowserStopped(close: () => Promise<void>): Promise<void> {
  try {await close();} catch {throw new ExecutorStopUnconfirmed();}
}
