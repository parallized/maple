export const MAX_SCROLL_CURL_STRENGTH = 0.06;

const FULL_STRENGTH_VELOCITY_PX_PER_SECOND = 800;
const ATTACK_SECONDS = 0.025;
const RELEASE_SECONDS = 0.175;
const MIN_FRAME_SECONDS = 1 / 240;
const MAX_FRAME_SECONDS = 0.1;

export interface ScrollCurlFrame {
  scrollTop: number;
  velocity: number;
  strength: number;
}

export interface ScrollCurlMotion {
  reset(scrollTop: number): void;
  update(scrollTop: number, deltaSeconds: number): void;
  subscribe(listener: (frame: ScrollCurlFrame) => void): () => void;
}

export function createScrollCurlMotion(): ScrollCurlMotion {
  const listeners = new Set<(frame: ScrollCurlFrame) => void>();
  let previousScrollTop = 0;
  let response = 0;

  const emit = (scrollTop: number, velocity: number) => {
    const frame: ScrollCurlFrame = {
      scrollTop,
      velocity,
      strength: response * MAX_SCROLL_CURL_STRENGTH
    };
    for (const listener of listeners) listener(frame);
  };

  return {
    reset(scrollTop) {
      previousScrollTop = scrollTop;
      response = 0;
      emit(scrollTop, 0);
    },

    update(scrollTop, deltaSeconds) {
      const dt = Math.max(MIN_FRAME_SECONDS, Math.min(deltaSeconds, MAX_FRAME_SECONDS));
      const velocity = Math.abs(scrollTop - previousScrollTop) / dt;
      previousScrollTop = scrollTop;

      const target = Math.max(
        0,
        Math.min(velocity / FULL_STRENGTH_VELOCITY_PX_PER_SECOND, 1)
      );
      const responseSeconds = target > response ? ATTACK_SECONDS : RELEASE_SECONDS;
      const blend = 1 - Math.exp(-dt / Math.max(responseSeconds, 0.0001));
      response += (target - response) * blend;

      if (target === 0 && response < 0.00001) response = 0;
      emit(scrollTop, velocity);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
