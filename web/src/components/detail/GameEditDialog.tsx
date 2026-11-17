import { useState } from 'react';
import type { Game } from '../../types';
import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { GameEditTab } from './GameEditTab';

/**
 * A game's settings, in the middle of the window.
 *
 * It is a wide, tall dialog rather than a narrow form: the first thing in it is
 * the game's own artwork, then one column of panels of rows. Nothing sits in a
 * drawer at the side - the library is not being read while a game is edited,
 * and a page pinned to an edge makes the artwork look like a toolbar.
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
  /** The Backlog edits the game record, not how it is started. */
  hideLaunchSettings?: boolean;
  /** Remove only this game's Backlog membership, preserving its Library record. */
  onRemoveFromBacklog?: () => void;
  /** Open on one page, for the development preview. */
  startOn?: 'game' | 'actions' | 'launch' | 'tools' | 'saves' | 'proton' | 'artwork';
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <>
      <Modal
        title="Game settings"
        size="xl"
        bare
        onClose={onClose}
        footer={onRemoveFromBacklog ? (
          <div className="flex justify-start">
            <button type="button" className="orbit-btn is-danger" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-3.5" /> Remove from Backlog
            </button>
          </div>
        ) : undefined}
      >
        <GameEditTab
          key={game.id}
          game={game}
          onUpdate={onUpdate}
          hideLaunchSettings={hideLaunchSettings}
          saveDir={saveDir}
          onSaveDir={onSaveDir}
          startOn={startOn}
        />
      </Modal>
      {confirmRemove && onRemoveFromBacklog && (
        <ConfirmDialog
          title={`Remove ${game.title} from the Backlog?`}
          description="The game stays in your Library with its files, sessions and notes. Only its Backlog membership is removed."
          confirmLabel="Remove from Backlog"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            onRemoveFromBacklog();
          }}
        />
      )}
    </>
  );
}
