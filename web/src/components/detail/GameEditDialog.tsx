import { useCallback, useRef, useState } from 'react';
import type { Game } from '../../types';
import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { GameEditTab } from './GameEditTab';

/**
 * A game's settings, with one Save button.
 *
 * The dialog owns the close gesture so an unsaved draft is never lost to a
 * stray Escape: closing with changes asks first. The Save button lives in the
 * footer, pinned where a long form cannot scroll it away.
 */
export function GameEditDialog({
  game,
  onUpdate,
  onClose,
  hideLaunchSettings = false,
  onRemoveFromBacklog,
  saveDir,
  onSaveDir,
  startOn,
}: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  onClose: () => void;
  saveDir?: string;
  onSaveDir?: (path: string) => void;
  hideLaunchSettings?: boolean;
  onRemoveFromBacklog?: () => void;
  startOn?: 'game' | 'actions' | 'launch' | 'extra' | 'tools' | 'saves' | 'proton' | 'artwork';
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<(() => boolean) | null>(null);

  const registerSave = useCallback((save: () => boolean) => { saveRef.current = save; }, []);
  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose]);

  const saveAndClose = () => {
    if (saveRef.current?.()) onClose();
  };

  return (
    <>
      <Modal
        title="Game settings"
        subtitle={game.title}
        size="xl"
        bare
        panelClassName="orbit-modaledit"
        onClose={requestClose}
        footer={
          <div className="orbit-edit-footer">
            {onRemoveFromBacklog && (
              <button type="button" className="orbit-btn is-danger" onClick={() => setConfirmRemove(true)}>
                <Trash2 className="size-3.5" /> Remove from Backlog
              </button>
            )}
            <span className="orbit-edit-status" role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            <button type="button" className="orbit-btn is-quiet" onClick={requestClose}>Close</button>
            <button type="button" className="orbit-btn is-accent" disabled={!dirty} onClick={saveAndClose}>Save changes</button>
          </div>
        }
      >
        <GameEditTab
          key={game.id}
          game={game}
          onUpdate={onUpdate}
          hideLaunchSettings={hideLaunchSettings}
          saveDir={saveDir}
          onSaveDir={onSaveDir}
          startOn={startOn}
          onDirtyChange={setDirty}
          registerSave={registerSave}
        />
      </Modal>
      {confirmRemove && onRemoveFromBacklog && (
        <ConfirmDialog
          title={`Remove ${game.title} from the Backlog?`}
          description="The game stays in your Library with its files, sessions and notes. Only its Backlog membership is removed."
          confirmLabel="Remove from Backlog"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => { setConfirmRemove(false); onRemoveFromBacklog(); }}
        />
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          description="This game has edits that have not been saved. Closing now will leave the game as it was."
          confirmLabel="Discard changes"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        />
      )}
    </>
  );
}
