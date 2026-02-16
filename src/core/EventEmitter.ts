/**
 * Game On Dude! - Type-safe Event Emitter
 * www.gameonguy.com
 *
 * A typed event emitter for handling server events.
 */

type EventMap = {
  [key: string]: (...args: any[]) => void;
};

export class TypedEventEmitter<Events extends EventMap = EventMap> {
  private listeners: Map<keyof Events, Set<Events[keyof Events]>> = new Map();

  on<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    const wrappedListener = ((...args: Parameters<Events[K]>) => {
      this.off(event, wrappedListener as Events[K]);
      (listener as (...args: any[]) => void)(...args);
    }) as Events[K];

    return this.on(event, wrappedListener);
  }

  off<K extends keyof Events>(event: K, listener: Events[K]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
    }
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => {
        try {
          (listener as (...args: any[]) => void)(...args);
        } catch (error) {
          console.error(`Error in event listener for ${String(event)}:`, error);
        }
      });
    }
  }

  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
