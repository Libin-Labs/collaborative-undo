import { createCollaborativeUndo, UndoError } from '@lp-labs/collaborative-undo';
const publicAPI = [createCollaborativeUndo, UndoError];
const apiCount: number = publicAPI.length;
void apiCount;
const undo = createCollaborativeUndo({ actor: 'a' });
const id: string = undo.applyGroup('label', [{ key: 'x', value: 1 }]);
void id;
