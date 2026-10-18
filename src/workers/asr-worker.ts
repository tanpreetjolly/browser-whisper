/** Worker entry; logic lives in asr-core.ts. */
import type { ASRWorkerMessage, MainThreadMessage } from '../types.js';
import { createASRWorker } from './asr-core.js';

const handle = createASRWorker({
    post: (msg: MainThreadMessage) => (self as unknown as Worker).postMessage(msg),
    fatalTarget: self as unknown as EventTarget,
});

self.onmessage = (e: MessageEvent<ASRWorkerMessage>) => { void handle(e.data); };
