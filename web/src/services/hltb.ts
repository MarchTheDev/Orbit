import type { HltbData } from '../types';
import { hltbSearch } from './native';

/**
 * HowLongToBeat has no official API. In the .exe, Rust scrapes the same search
 * endpoint the website uses and caches the answer; in a browser preview the
 * bridge returns a deterministic estimate so the UI still has something to show.
 */
export function fetchHltb(title: string): Promise<HltbData> {
  return hltbSearch<HltbData>(title);
}