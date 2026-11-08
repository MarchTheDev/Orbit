import type { Game } from '../../types';
import { Trash2 } from 'lucide-react';
import { Modal, btnGhost } from '../ui/Modal';
import { GameEditTab } from './GameEditTab';

/** A centered, full-width editor used by the pencil affordance and context menus. */
export function GameEditDialog({
  game,
  onUpdate,
  onClose,
  hideLaunchSettings = false,
  onRemoveFromBacklog,
}: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  onClose: () => void;
  /** The Backlog edits the game record, not how it is started. */
  hideLaunchSettings?: boolean;
  /** Remove only this game's Backlog membership, preserving its Library record. */
  onRemoveFromBacklog?: () => void;
}) {
  return (
    <Modal
      title={`Edit ${game.title}`}
      subtitle={hideLaunchSettings
        ? "Edit this game's details. Closing this keeps the changes."
        : "All of this game's details and launch settings, together. Closing this keeps the changes."}
      size="xl"
      onClose={onClose}
      footer={onRemoveFromBacklog ? (
        <div className="flex justify-start">
          <button type="button" className={`${btnGhost} flex items-center gap-2 border-rose-500/40 bg-rose-500/10 text-rose-300 hover:border-rose-400 hover:bg-rose-500/20 hover:text-rose-200 text-xs`} onClick={onRemoveFromBacklog}>
            <Trash2 className="size-3.5" /> Remove from Backlog
          </button>
        </div>
      ) : undefined}
    >
      <GameEditTab key={game.id} game={game} onUpdate={onUpdate} hideLaunchSettings={hideLaunchSettings} />
    </Modal>
  );
}
