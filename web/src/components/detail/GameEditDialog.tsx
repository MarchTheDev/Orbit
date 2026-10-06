import type { Game } from '../../types';
import { Modal } from '../ui/Modal';
import { GameEditTab } from './GameEditTab';

/** A centered, full-width editor used by the pencil affordance and context menus. */
export function GameEditDialog({
  game,
  onUpdate,
  onClose,
}: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Edit ${game.title}`}
      subtitle="All of this game's details and launch settings, together. Changes save when you choose Save."
      size="xl"
      onClose={onClose}
    >
      <GameEditTab key={game.id} game={game} onUpdate={onUpdate} onSaved={onClose} />
    </Modal>
  );
}
