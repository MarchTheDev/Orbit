import { hltbExtraEstimate } from '../../utils/hltb';

export function HltbExtraEstimate({
  hours,
  className = '',
}: {
  hours: number;
  className?: string;
}) {
  const estimate = hltbExtraEstimate(hours);
  if (!estimate) return null;
  return <p className={`text-[11px] leading-relaxed text-muted ${className}`}>{estimate}</p>;
}
