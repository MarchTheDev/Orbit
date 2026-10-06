/**
 * How a drive is written.
 *
 * Windows writes a drive as `D:` and a path on it as `D:\Games`, and the
 * database stores the bare `D:` because that is what it looks like to the
 * system. Reading a list of locations that says `D:` next to `D:\Games` looks
 * like a typo, so a label adds the separator the player expects to see: `D:\`.
 *
 * Only a bare letter and colon is touched. A drive that is already written some
 * other way, or a folder that happens to be in the same place, is returned
 * unchanged, so this can be used on anything without having to know where it
 * came from.
 */
export function driveLabel(drive: string | null | undefined): string {
  if (!drive) return '';
  return /^[A-Za-z]:$/.test(drive) ? `${drive}\\` : drive;
}
