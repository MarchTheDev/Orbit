import {
  siEa,
  siEpicgames,
  siGogdotcom,
  siHeroicgameslauncher,
  siSteam,
  siUbisoft,
} from 'simple-icons';
import type { LauncherId } from '../../types';
import { cn } from '../../utils/cn';

/**
 * The Xbox mark, kept here instead of imported.
 *
 * simple-icons carried it until version 10 and dropped it after, so the copy
 * installed here does not have it. This is the path that package shipped, and
 * simple-icons is CC0, so it is copied in rather than pinned to a release eight
 * majors behind for the sake of one icon.
 */
const siXbox = {
  path: 'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z',
};

/**
 * The Amazon Luna mark, kept here for the same reason as Xbox above.
 *
 * simple-icons dropped `amazonluna` after version 13, and the installed copy is
 * newer than that. This is the path that package shipped under the CC0 licence,
 * so it is copied in rather than pinning the whole icon set back six majors.
 */
const siAmazonLuna = {
  path: 'M21.757 15.4031a4.5796 4.5796 0 0 0-.8157-.3675h-.0038c-.0431-.015-.0863-.0244-.1294-.0375-.5081-.1556-2.4-.8494-3.4782-2.8126v.002l-1.9256-3.334c-.81-1.4212-.6732-3.6844-.585-4.5413a4.519 4.519 0 0 0 .0393-.3244.2659.2659 0 0 0 .0038-.0206h-.0019c.0056-.077.0113-.152.0113-.2307-.002-1.9388-1.5732-3.512-3.512-3.512s-3.512 1.5732-3.512 3.512c0 .0769.0075.1538.0113.2307h-.0038s.0019.0168.0056.045c.0075.09.0188.1762.032.2643.09.8363.2455 3.1876-.6057 4.624h.0018l-2.7582 4.7757v-.0037l-.0318.0581-.2588.45c-.0206.0375-.0356.0769-.0562.1144-.285.4931-.72 1.2057-1.1982 1.8507-.3994.54-1.0238 1.0725-1.637 1.4325l.0076.002c-.0563.028-.1144.0524-.1688.0862a2.3952 2.3952 0 0 0-.8625.8737c-.6694 1.1588-.2719 2.642.8869 3.3114.6056.3506 1.2975.4012 1.9182.2119l-.0038.0056c1.0688-.3732 2.237-.7014 2.8351-.8382 1.0032-.2288 2.4882-.285 3.332-.2963h.96c4.2845.0412 6.4558 1.8582 6.4558 1.8582l.0038-.0038c.1744.1387.3544.27.5531.3844 2.1451 1.2394 4.8902.5043 6.1277-1.6426 1.245-2.145.51-4.8901-1.637-6.1277zm-5.0308 2.267c-.4482.7743-1.0857 1.1568-2.1432 1.2375-1.0575.0806-1.2863.1425-3.2232.1425-1.937 0-2.2295-.06-3.2232-.1425-.992-.0825-1.695-.4632-2.1432-1.2376-.4482-.7744-.4107-1.6594 0-2.475.4106-.8157.6731-1.4457 1.4363-2.7676.7631-1.322 1.0669-1.8226 1.785-2.8145.72-.9919 1.2488-1.2375 2.1432-1.2375.8944 0 1.4644.3319 2.1432 1.2375.6788.9057.8719 1.2563 1.7138 2.7151s1.0556 1.952 1.5075 2.867c.4557.915.45 1.7006.0038 2.475z',
};

const BRAND_ICONS = {
  Steam: siSteam,
  'Epic Games': siEpicgames,
  'Ubisoft Connect': siUbisoft,
  'GOG Galaxy': siGogdotcom,
  'EA app': siEa,
  Xbox: siXbox,
  'Heroic Games Library': siHeroicgameslauncher,
  'Amazon Luna': siAmazonLuna,
} satisfies Record<LauncherId, { path: string }>;

/** Official launcher brand mark, kept as a small local SVG path. */
export function LauncherIcon({ launcher, className }: { launcher: LauncherId; className?: string }) {
  const icon = BRAND_ICONS[launcher];
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-5 shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}
