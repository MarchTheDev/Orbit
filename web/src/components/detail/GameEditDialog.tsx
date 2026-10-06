import type { Game } from '../../types';
import { Modal } from '../ui/Modal';
import { GameEditTab } from './GameEditTab';

/** A centered, full-width editor used by the pencil affordance and context menus. */
export function GameEditDialog({
  game,
  onUpdate,
  onClose,
  hideLaunchSettings = false,
}: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  onClose: () => void;
  /** The Backlog edits the game record, not how it is started. */
  hideLaunchSettings?: boolean;
}) {
  return (
    <Modal
      title={`Edit ${game.title}`}
      subtitle={hideLaunchSettings
        ? "Edit this game's details. Changes save when you choose Save."
        : "All of this game's details and launch settings, together. Changes save when you choose Save."}
      size="xl"
      onClose={onClose}
    >
      <GameEditTab key={game.id} game={game} onUpdate={onUpdate} onSaved={onClose} hideLaunchSettings={hideLaunchSettings} />
    </Modal>
  );
}
