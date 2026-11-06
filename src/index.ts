export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Value = Json | undefined;

export interface Mutation {
  key: string;
  value: Value;
}

export interface RemoteChange {
  actor: string;
  counter: number;
  key: string;
  value: Value;
}

export interface ChangeOutcome {
  key: string;
  result: 'applied' | 'conflict';
  reason?: 'newer-write' | 'empty-history';
}

export interface UndoReport {
  groupId: string;
  label: string;
  changes: ChangeOutcome[];
}

export interface UndoOptions {
  actor: string;
  maxHistory?: number;
}

export class UndoError extends Error {
  constructor(
    readonly code: 'invalid' | 'capacity' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'UndoError';
  }
}

interface Revision {
  actor: string;
  counter: number;
}

interface Cell {
  value: Value;
  revision: Revision;
}

interface GroupChange {
  key: string;
  before: Value;
  after: Value;
  revision: Revision;
}

interface HistoryGroup {
  id: string;
  label: string;
  changes: GroupChange[];
}

function validActor(actor: string): boolean {
  return typeof actor === 'string' && actor.length > 0 && actor.length <= 256;
}

function clone(value: Value): Value {
  if (value === undefined) return undefined;
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 32)
      throw new UndoError('capacity', 'JSON structure bound exceeded.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (
      typeof item !== 'object' ||
      item === null ||
      (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)
    )
      throw new UndoError('invalid', 'Expected finite plain JSON.');
    if (seen.has(item)) throw new UndoError('invalid', 'Cyclic value.');
    seen.add(item);
    if (Object.getOwnPropertySymbols(item).length)
      throw new UndoError('invalid', 'Symbol properties unsupported.');
    for (const key of Object.keys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!('value' in descriptor)) throw new UndoError('invalid', 'Accessors unsupported.');
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(item).length !== item.length)
      throw new UndoError('invalid', 'Sparse arrays unsupported.');
    seen.delete(item);
  };
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (encoded === undefined || encoded.length > 100_000)
    throw new UndoError('invalid', 'Values must be bounded JSON data.');
  return JSON.parse(encoded) as Json;
}

function equal(a: Value, b: Value): boolean {
  if (a === undefined || b === undefined) return a === b;
  const canonical = (value: Json): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`)
      .join(',')}}`;
  };
  return canonical(a) === canonical(b);
}

function sameRevision(a: Revision | undefined, b: Revision): boolean {
  return a?.actor === b.actor && a.counter === b.counter;
}

export interface CollaborativeUndo {
  applyGroup(label: string, mutations: readonly Mutation[]): string;
  applyRemote(change: RemoteChange): 'applied' | 'duplicate';
  undo(): UndoReport | null;
  redo(): UndoReport | null;
  get(key: string): Value;
  snapshot(): Record<string, Json>;
  canUndo(): boolean;
  canRedo(): boolean;
}

export function createCollaborativeUndo(options: UndoOptions): CollaborativeUndo {
  if (options === null || typeof options !== 'object' || !validActor(options.actor))
    throw new UndoError('invalid', 'actor must be a nonempty identifier.');
  const maxHistory = options.maxHistory ?? 100;
  if (!Number.isSafeInteger(maxHistory) || maxHistory < 1 || maxHistory > 10_000)
    throw new UndoError('invalid', 'maxHistory must be from 1 to 10000.');
  const cells = new Map<string, Cell>();
  const seen = new Map<string, RemoteChange>();
  const undoStack: HistoryGroup[] = [];
  const redoStack: { group: HistoryGroup; expected: Map<string, Revision> }[] = [];
  let counter = 0;
  let groupCounter = 0;

  const write = (key: string, value: Value): Revision => {
    counter += 1;
    if (!Number.isSafeInteger(counter)) throw new UndoError('capacity', 'Actor counter exhausted.');
    const revision = { actor: options.actor, counter };
    cells.set(key, { value: clone(value), revision });
    return revision;
  };

  const currentValue = (key: string): Value => {
    const cell = cells.get(key);
    return cell ? clone(cell.value) : undefined;
  };

  return {
    applyGroup(label, mutations) {
      if (typeof label !== 'string' || label.length < 1 || label.length > 256)
        throw new UndoError('invalid', 'Group label must contain 1..256 characters.');
      if (!Array.isArray(mutations) || mutations.length < 1 || mutations.length > 1000)
        throw new UndoError('invalid', 'A group must contain 1..1000 mutations.');
      if (undoStack.length >= maxHistory) throw new UndoError('capacity', 'Undo history is full.');
      const keys = new Set<string>();
      for (const mutation of mutations) {
        if (
          mutation === null ||
          typeof mutation !== 'object' ||
          typeof mutation.key !== 'string' ||
          mutation.key.length < 1 ||
          mutation.key.length > 256 ||
          keys.has(mutation.key)
        )
          throw new UndoError('invalid', 'Mutation keys must be unique nonempty strings.');
        clone(mutation.value);
        keys.add(mutation.key);
      }
      if (
        new Set([...cells.keys(), ...keys]).size > 100000 ||
        !Number.isSafeInteger(counter + mutations.length)
      )
        throw new UndoError('capacity', 'Cell/counter capacity exceeded.');
      const changes: GroupChange[] = mutations.map((mutation) => {
        const before = currentValue(mutation.key);
        const after = clone(mutation.value);
        const revision = write(mutation.key, after);
        return { key: mutation.key, before, after, revision };
      });
      groupCounter += 1;
      const id = `${options.actor}:group:${groupCounter}`;
      undoStack.push({ id, label, changes });
      redoStack.length = 0;
      return id;
    },
    applyRemote(change) {
      if (
        change === null ||
        typeof change !== 'object' ||
        !validActor(change.actor) ||
        !Number.isSafeInteger(change.counter) ||
        change.counter < 1 ||
        typeof change.key !== 'string' ||
        change.key.length < 1 ||
        change.key.length > 256
      )
        throw new UndoError('invalid', 'Remote change has invalid metadata.');
      if (change.actor === options.actor)
        throw new UndoError('conflict', 'Remote writer cannot reuse the local actor.');
      clone(change.value);
      const id = `${change.actor}\u0000${change.counter}`;
      const previous = seen.get(id);
      if (previous) {
        if (previous.key !== change.key || !equal(previous.value, change.value))
          throw new UndoError('conflict', 'A remote operation ID was reused with different data.');
        return 'duplicate';
      }
      if (seen.size >= 100_000)
        throw new UndoError('capacity', 'Remote duplicate history is full.');
      if (!cells.has(change.key) && cells.size >= 100000)
        throw new UndoError('capacity', 'Cell capacity exceeded.');
      seen.set(id, { ...change, value: clone(change.value) });
      cells.set(change.key, {
        value: clone(change.value),
        revision: { actor: change.actor, counter: change.counter },
      });
      return 'applied';
    },
    undo() {
      const group = undoStack.pop();
      if (!group) return null;
      const changes: ChangeOutcome[] = [];
      const redoGroup: HistoryGroup = { ...group, changes: [] };
      const expected = new Map<string, Revision>();
      for (const change of [...group.changes].reverse()) {
        const cell = cells.get(change.key);
        if (!sameRevision(cell?.revision, change.revision)) {
          changes.push({ key: change.key, result: 'conflict', reason: 'newer-write' });
          continue;
        }
        const revision = write(change.key, change.before);
        redoGroup.changes.unshift({ ...change, revision });
        expected.set(change.key, revision);
        changes.push({ key: change.key, result: 'applied' });
      }
      if (redoGroup.changes.length > 0) {
        redoStack.push({ group: redoGroup, expected });
        if (redoStack.length > maxHistory) redoStack.shift();
      }
      return { groupId: group.id, label: group.label, changes };
    },
    redo() {
      const item = redoStack.pop();
      if (!item) return null;
      const changes: ChangeOutcome[] = [];
      const undoGroup: HistoryGroup = { ...item.group, changes: [] };
      for (const change of item.group.changes) {
        const cell = cells.get(change.key);
        if (!sameRevision(cell?.revision, item.expected.get(change.key)!)) {
          changes.push({ key: change.key, result: 'conflict', reason: 'newer-write' });
          continue;
        }
        const revision = write(change.key, change.after);
        undoGroup.changes.push({ ...change, revision });
        changes.push({ key: change.key, result: 'applied' });
      }
      if (undoGroup.changes.length > 0) {
        undoStack.push(undoGroup);
        if (undoStack.length > maxHistory) undoStack.shift();
      }
      return { groupId: item.group.id, label: item.group.label, changes };
    },
    get: currentValue,
    snapshot() {
      const result: Record<string, Json> = {};
      for (const [key, cell] of cells) {
        if (cell.value === undefined) continue;
        Object.defineProperty(result, key, {
          value: clone(cell.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
}
