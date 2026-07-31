export type LatestRequestResult<T> =
  | { applied: true; value: T }
  | { applied: false; reason: "superseded" | "aborted" };

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Coordinates overlapping reads without allowing an older response to win. */
export class LatestRequestCoordinator<T> {
  private requestId = 0;
  private active: { id: number; controller: AbortController } | null = null;

  async run(
    cancelPrevious: boolean,
    loader: (signal: AbortSignal) => Promise<T>,
  ): Promise<LatestRequestResult<T>> {
    if (cancelPrevious) this.active?.controller.abort();
    const id = ++this.requestId;
    const controller = new AbortController();
    this.active = { id, controller };
    try {
      const value = await loader(controller.signal);
      return id === this.requestId
        ? { applied: true, value }
        : { applied: false, reason: "superseded" };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return { applied: false, reason: "aborted" };
      if (id !== this.requestId) return { applied: false, reason: "superseded" };
      throw error;
    } finally {
      if (this.active?.id === id) this.active = null;
    }
  }

  abort(): void {
    this.requestId += 1;
    this.active?.controller.abort();
    this.active = null;
  }
}
