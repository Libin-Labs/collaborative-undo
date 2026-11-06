# @lp-labs/collaborative-undo

Actor-scoped conditional undo and redo with explicit remote-write conflicts.

Original independent MIT TypeScript implementation with **zero runtime/peer dependencies**. ESM and CommonJS with separate declarations, Node 18+ (browser use when adapters/APIs are available). Development dependencies are not consumer runtime dependencies.

## Install

```sh
npm install @lp-labs/collaborative-undo
```

## Complete example

```js
import assert from 'node:assert/strict';
import { createCollaborativeUndo, UndoError } from '@lp-labs/collaborative-undo';
const history = createCollaborativeUndo({ actor: 'a' });
history.applyGroup('typing', [{ key: 'text', value: 'Hello' }]);
assert.equal(history.get('text'), 'Hello');
assert.equal(history.undo().changes[0].result, 'applied');
assert.equal(history.get('text'), undefined);
history.redo();
assert.equal(history.get('text'), 'Hello');
```

CommonJS exposes the same API: `const api = require('@lp-labs/collaborative-undo')`.

## Scope, customization and performance

Process-local actor history, not network replication. Remote changes must be causally ordered by caller; application order determines current value. Undo applies only when the current revision matches the original local revision; remote edits produce explicit per-key conflicts. Groups up to 1,000 unique keys, default history 100 (max 10,000), cells/remote IDs bounded at 100,000. JSON values finite/plain and copied, max 100,000 serialized characters. Empty undo/redo returns null intentionally. No shared-list positional undo, persistent history or automatic operation broadcasting.

Configure explicit limits, clocks, policies and adapters through the API below. Error classes and standard TypeError/RangeError reject malformed input; adapter/handler errors propagate. Await asynchronous methods and handle rejection in your application; no success-shaped fallback on failed work. Inputs must be trusted ordinary data, not hostile proxies; adapters must meet documented atomicity, isolation and ownership contracts. This package never publishes data, loads external code or starts background services at import time.

## API reference

The complete exported TypeScript contract (including option defaults discussed above, method return shapes, and error codes) is included below. TypeScript users import interfaces using `import type`; JavaScript users pass matching ordinary objects. Signature optionals indicate intentionally optional fields, not silent recovery.

```ts
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [key: string]: Json;
    };
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
export declare class UndoError extends Error {
  readonly code: 'invalid' | 'capacity' | 'conflict';
  constructor(code: 'invalid' | 'capacity' | 'conflict', message: string);
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
export declare function createCollaborativeUndo(options: UndoOptions): CollaborativeUndo;
```

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
