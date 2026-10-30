/** Convert the HLTB main-plus-extras hours to weeks at 1.5 hours each day. */
export function hltbExtraWeeks(hours: number): number | null {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.max(1, Math.round(hours / 10.5));
}

export function hltbExtraEstimate(hours: number): string | null {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const days = hours / 1.5;
  if (days < 7) {
    const roundedDays = Math.max(1, Math.round(days));
    return `About ${roundedDays} ${roundedDays === 1 ? 'day' : 'days'} at 1.5 hours/day, focusing on extra content.`;
  }
  const weeks = hltbExtraWeeks(hours);
  if (weeks === null) return null;
  return `About ${weeks} ${weeks === 1 ? 'week' : 'weeks'} at 1.5 hours/day, focusing on extra content.`;
}
