import { ITestWaiter, Token, buildWaiter } from 'ember-test-waiters';

import { DEBUG } from '@glimmer/env';

type MaybeRequestAnimationFrame = (callback: FrameRequestCallback | Function) => number;
type DomOperation = [Token, () => void];

const IS_BROWSER = typeof window === 'object' && typeof document === 'object';
const SCHEDULE_MACROTASK = (callback: Function) => setTimeout(callback);
const readDOMWaiter: ITestWaiter = buildWaiter('ember-batcher: readDOM');
const mutateDOMWaiter: ITestWaiter = buildWaiter('ember-batcher: mutateDOM');

const reads: Array<DomOperation> = [];
const mutations: Array<DomOperation> = [];
let running: boolean = false;
let scheduleFnExecuted: boolean = false;

const racedRAF = (callback: Function) => {
  setTimeout(() => {
    if (!scheduleFnExecuted) {
      callback();
    }
  }, 20);

  return requestAnimationFrame(() => {
    scheduleFnExecuted = true;
    callback();
  });
};

const scheduleFn: MaybeRequestAnimationFrame =
  typeof window === 'object' && typeof window.requestAnimationFrame === 'function'
    ? racedRAF
    : SCHEDULE_MACROTASK;

export const visibilityChange = (
  hidden = IS_BROWSER ? document.hidden : false,
  hasQueuedWork = () => reads.length > 0 && mutations.length > 0
) => {
  return () => {
    if (hidden && hasQueuedWork()) {
      throw new Error(
        "Your browser tab is running in the background. ember-batcher's execution is not guaranteed in this environment"
      );
    }
  };
};

if (DEBUG && typeof document === 'object') {
  document.addEventListener('visibilitychange', visibilityChange());
}

function run(): void {
  if (!running) {
    running = true;

    scheduleFn(() => {
      let i: number, l: number;

      for (i = 0, l = reads.length; i < l; i++) {
        let [token, readTask] = reads.pop()!;
        readTask();
        readDOMWaiter.endAsync(token);
      }
      for (i = 0, l = mutations.length; i < l; i++) {
        let [token, mutateTask] = mutations.pop()!;
        mutateTask();
        mutateDOMWaiter.endAsync(token);
      }

      running = false;

      if (mutations.length > 0 || reads.length > 0) {
        run();
      }
    });
  }
}

/**
 * Provides a mechanism to group DOM reads to minimize layout thrashing.
 *
 * @param readTask The function to call as part of the reads batch.
 */
export function readDOM(readTask: () => void): void {
  let token = readDOMWaiter.beginAsync();

  reads.unshift([token, readTask]);
  run();
}

/**
 * Provides a mechanism to group DOM mutations to minimize layout thrashing.
 *
 * @param mutationTask The function to call as part of the mutations batch.
 */
export function mutateDOM(mutationTask: () => void): void {
  let token = mutateDOMWaiter.beginAsync();

  mutations.unshift([token, mutationTask]);
  run();
}
