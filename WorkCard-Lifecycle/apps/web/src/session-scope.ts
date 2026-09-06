export class SessionScope {
  readonly #commandState = new Map<string, unknown>();
  readonly #protectedCache = new Map<string, unknown>();
  #revision = 0;

  get revision(): number {
    return this.#revision;
  }

  getCached<T>(key: string): T | undefined {
    return this.#protectedCache.get(key) as T | undefined;
  }

  getCommandState<T>(key: string): T | undefined {
    return this.#commandState.get(key) as T | undefined;
  }

  setCached<T>(key: string, value: T): void {
    this.#protectedCache.set(key, value);
  }

  setCommandState<T>(key: string, value: T): void {
    this.#commandState.set(key, value);
  }

  clear(): number {
    this.#commandState.clear();
    this.#protectedCache.clear();
    this.#revision += 1;
    return this.#revision;
  }
}

export function resetSessionScope(scope: SessionScope): number {
  return scope.clear();
}
