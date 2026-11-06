import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollaborativeUndo, UndoError } from '../dist/esm/index.js';

test('documented workflow produces required outputs', async () => {
  const history = createCollaborativeUndo({ actor: 'a' });
  history.applyGroup('typing', [{ key: 'text', value: 'Hello' }]);
  assert.equal(history.get('text'), 'Hello');
  assert.equal(history.undo().changes[0].result, 'applied');
  assert.equal(history.get('text'), undefined);
  history.redo();
  assert.equal(history.get('text'), 'Hello');
});
test('undo never overwrites a remote edit', () => {
  const h = createCollaborativeUndo({ actor: 'a' });
  h.applyGroup('x', [{ key: 'x', value: 1 }]);
  h.applyRemote({ actor: 'b', counter: 1, key: 'x', value: 2 });
  assert.equal(h.undo().changes[0].result, 'conflict');
  assert.equal(h.get('x'), 2);
});
test('remote ID deduplicates and rejects reuse', () => {
  const h = createCollaborativeUndo({ actor: 'a' });
  const r = { actor: 'b', counter: 1, key: 'x', value: 1 };
  h.applyRemote(r);
  assert.equal(h.applyRemote(r), 'duplicate');
  assert.throws(() => h.applyRemote({ ...r, value: 2 }), { code: 'conflict' });
});
test('invalid group is atomic and bounded', () => {
  const h = createCollaborativeUndo({ actor: 'a', maxHistory: 1 });
  assert.throws(() =>
    h.applyGroup('x', [
      { key: 'x', value: 1 },
      { key: 'x', value: 2 },
    ]),
  );
  assert.deepEqual(h.snapshot(), {});
  h.applyGroup('x', [{ key: 'x', value: 1 }]);
  assert.throws(() => h.applyGroup('y', [{ key: 'y', value: 1 }]), { code: 'capacity' });
});
test('redo refuses newer remote revision', () => {
  const h = createCollaborativeUndo({ actor: 'a' });
  h.applyGroup('x', [{ key: 'x', value: 1 }]);
  h.undo();
  h.applyRemote({ actor: 'b', counter: 1, key: 'x', value: 2 });
  assert.equal(h.redo().changes[0].result, 'conflict');
  assert.equal(h.get('x'), 2);
});
