import { useState } from 'react';
import type { Game } from '../../types';
import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { GameEditTab, EditDrawerFrame } from './GameEditTab';

/**
 * A game's settings, as a drawer beside the library.
 *
 * It used to be a centred dialog with a title bar and a paragraph explaining
 * itself. A drawer says the same thing with its position: the library is still
 * there on the left, this is one game's page pulled out of it, and closing it
 * puts the page back rather than dismissing a window.
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
  startOn?: 'game' | 'actions' | 'launch' | 'tools' | 'saves' | 'proton';
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <>
      <EditDrawerFrame onClose={onClose}>
        <GameEditTab
          key={game.id}
          game={game}
          onUpdate={onUpdate}
          hideLaunchSettings={hideLaunchSettings}
          saveDir={saveDir}
          onSaveDir={onSaveDir}
          startOn={startOn}
        />
        {onRemoveFromBacklog && (
          <div className="orbit-drawer-foot">
            <button type="button" className="orbit-pill is-danger" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-3.5" /> Remove from Backlog
            </button>
          </div>
        )}
      </EditDrawerFrame>
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
