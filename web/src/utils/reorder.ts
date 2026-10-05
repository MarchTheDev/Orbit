/**
 * Where a dragged row lands in a list.
 *
 * `after` is which half of the row under the pointer the drag was released on,
 * which is what lets a drag go both ways: dropping on the lower half of a row
 * puts the thing after it, the upper half puts it before. Without that, dragging
 * downwards only ever moved a row one place, because it was always placed before
 * the row it was dropped on.
 *
 * The awkward case that leaves is dropping on the upper half of the row directly
 * below the one being moved, or the lower half of the row directly above it:
 * both describe the place it already is, and a drag that changes nothing reads
 * as a drag that did not work. Those are nudged one place in the direction of
 * travel, so every drag that reaches another row moves something. That is what
 * made reordering the tabs in Settings look broken: the rows are one line tall,
 * so the halfway mark is a few pixels in and almost every drop landed on the
 * no-op half.
 */
export function moveInOrder(ids: string[], fromId: string, toId: string, after: boolean): string[] {
  if (fromId === toId) return ids;
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0) return ids;

  // The order without the thing being moved, which is the list the new index
  // has to be counted in.
  const next = ids.filter((id) => id !== fromId);
  const at = next.indexOf(toId) + (after ? 1 : 0);
  const land = at === from ? from + (to > from ? 1 : -1) : at;
  next.splice(Math.max(0, Math.min(next.length, land)), 0, fromId);
  return next;
}

/** One row of a vertical list, as the pointer sees it. */
export interface RowRect {
  id: string;
  /** Distance from the top of the viewport to the top of the row. */
  top: number;
  height: number;
}

/**
 * Which row a pointer at this height belongs to, in a vertical list.
 *
 * The rows are walked in the order they are drawn and the pointer is compared
 * with the middle of each: the last row whose middle has been passed is the row
 * the thing lands after. Passing none of them means the top of the list, and
 * being below all of them means the bottom, because the last row is then the one
 * that was passed.
 *
 * Working from the pointer's height rather than from whatever element happens to
 * be under it is what makes a list of one-line rows usable: the few pixels of
 * the gap between two rows, and the space past the last row, are not dead zones
 * that silently throw a drag away.
 */
export function slotAt(rows: RowRect[], y: number): { id: string; after: boolean } | null {
  if (rows.length === 0) return null;
  let above: RowRect | null = null;
  for (const row of rows) {
    if (y > row.top + row.height / 2) above = row;
  }
  if (!above) return { id: rows[0].id, after: false };
  return { id: above.id, after: true };
}
