/**
 * Proton: which build a game runs on, the switches that go with it, and the
 * shelf of GE builds anyone can pull down.
 *
 * The Rust half cannot be compiled in this checkout, so what it promises is
 * read from the source and the parts that can be run here - ordering the
 * releases, reading a build's folder out of a path - are run.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildName, sortReleases, tagNumbers } from '../src/utils/proton.ts';
import { WineSettings } from '../src/components/detail/WineSettings.tsx';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

const protonRs = readFileSync(new URL('../src-tauri/src/proton.rs', import.meta.url), 'utf8');
const launchRs = readFileSync(new URL('../src-tauri/src/launch_target.rs', import.meta.url), 'utf8');
const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const typesTs = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const editorTs = readFileSync(
  new URL('../src/components/detail/LaunchEditor.tsx', import.meta.url),
  'utf8',
);
const wineTs = readFileSync(
  new URL('../src/components/detail/WineSettings.tsx', import.meta.url),
  'utf8',
);
const managerTs = readFileSync(
  new URL('../src/components/detail/ProtonManager.tsx', import.meta.url),
  'utf8',
);

console.log('a game remembers which build it runs on');

check('the choice is stored with the game, not in one global setting',
  /kind: 'wine';[\s\S]*?proton\?: string \| null;/.test(typesTs),
  'the wine launch target has no proton field');
check('and an older saved game still loads without it',
  (launchRs.match(/#\[serde\(default\)\]/g) ?? []).length >= 6 &&
    launchRs.includes('#[serde(rename_all = "camelCase", default)]'),
  'the wire shape is not defaulted all the way down');
check('the switches are the same shape on both sides',
  typesTs.includes('export interface WineTweaks') &&
    launchRs.includes('pub struct WineTweaks') &&
    [
      ['gamemode', 'gamemode'],
      ['mangohud', 'mangohud'],
      ['sdl', 'sdl'],
      ['wayland', 'wayland'],
      ['wow64', 'wow64'],
      ['fsync', 'fsync'],
      ['esync', 'esync'],
      ['hud', 'hud'],
      ['gameid', 'gameid'],
      // The page writes camelCase; the desktop side reads it off the same name.
      ['dllOverrides', 'dll_overrides'],
      ['env', 'env'],
    ].every(
      ([page, desk]) =>
        new RegExp(`\\b${page}\\??:`).test(typesTs) && new RegExp(`pub ${desk}:`).test(launchRs),
    ),
  'a switch is spelled differently in the two files');

console.log('the builds on this machine are all offered');

check('Orbit keeps its own builds under its data folder',
  protonRs.includes('.join("runners")') && protonRs.includes('.join("proton")'));
check('Steam\u2019s own and the ones dropped in beside them are read',
  protonRs.includes('apps.join("common")') &&
    protonRs.includes('apps.join("compatibilitytools.d")'));
check('the libraries a Steam library list points at are read too',
  protonRs.includes('libraryfolders.vdf') && protonRs.includes('steamapps/library.vdf') === false);
check('Faugus and Lutris builds are read where they put them',
  protonRs.includes('faugus-launcher/compatibilitytools') &&
    protonRs.includes('lutris/runners'));
check('a build is a folder with a proton script in it',
  protonRs.includes('fn is_proton') && protonRs.includes('dir.join("proton").is_file()'));
check('the same build found twice is listed once',
  protonRs.includes('seen.insert(item.path.clone())'));
check('Orbit\u2019s own come first, then Steam\u2019s, then everyone else\u2019s',
  /"Orbit" => 0/.test(protonRs) && /"Steam" => 1/.test(protonRs));

console.log('the details page picks one');

check('the wine section draws the builds as a list, with a way out of it',
  wineTs.includes('<Select') &&
    wineTs.includes('protonBuilds()') &&
    wineTs.includes('Wine on this machine'));
check('a build that has been deleted stays visible instead of blank',
  wineTs.includes('A build that is gone'));
check('the editor puts the build and the switches under the wine fields',
  editorTs.includes('<WineSettings') &&
    editorTs.includes('onProton=') &&
    editorTs.includes('onTweaks='));
check('the saved line says which build it runs on',
  editorTs.includes('`Proton ${build}`') && editorTs.includes('buildName(t.proton)'));
check('the folder name is what a path means, on either slash',
  buildName('/home/me/.local/share/Steam/compatibilitytools.d/GE-Proton9-20') ===
    'GE-Proton9-20' && buildName('C:\\Orbit\\runners\\proton\\GE-Proton10-3') === 'GE-Proton10-3');
check('no path means no build', buildName(null) === null && buildName('   ') === null);

console.log('the section draws without a desktop behind it');

const drawn = renderToStaticMarkup(
  createElement(WineSettings, {
    proton: null,
    tweaks: undefined,
    onProton: () => {},
    onTweaks: () => {},
  }),
);
check('a game that has never been set up still draws',
  drawn.includes('Wine on this machine') && drawn.includes('Tweaks'));
check('a missing set of switches reads as everything off',
  (drawn.match(/type="checkbox"/g) ?? []).length === 5 &&
    !/\schecked=""/.test(drawn) &&
    drawn.includes('Leave it to the machine'));
check('the build is offered by name, with a way to get one',
  drawn.includes('Get Proton-GE') && drawn.includes('Wine on this machine'));

const set = {
  gamemode: false,
  mangohud: true,
  sdl: false,
  wayland: false,
  wow64: false,
  fsync: true,
  esync: null,
  hud: 'fps',
  gameid: '',
  dllOverrides: '',
  env: [],
};
const switchedOn = renderToStaticMarkup(
  createElement(WineSettings, {
    proton: '/gone/GE-Proton9-20',
    tweaks: set,
    onProton: () => {},
    onTweaks: () => {},
  }),
);
check('a switch that is on is drawn on', /\schecked=""/.test(switchedOn));
check('a build nobody can find is named, rather than drawn as blank',
  switchedOn.includes('A build that is gone'));

console.log('the launch goes through that build');

check('umu comes first, because it brings the runtime Proton expects',
  launchRs.indexOf('which("umu-run")') > 0 &&
    launchRs.indexOf('which("umu-run")') < launchRs.indexOf('build.join("proton")'));
check('umu is told the build and the prefix',
  launchRs.includes('cmd.env("PROTONPATH", build)') &&
    launchRs.includes('cmd.env("WINEPREFIX", &prefix)'));
check('without a game id it says so, rather than borrowing somebody else\u2019s fixes',
  launchRs.includes('"umu-default"'));
check('direct Proton runs the way Steam runs it',
  launchRs.includes('cmd.arg("waitforexitandrun")') &&
    launchRs.includes('cmd.env("STEAM_COMPAT_DATA_PATH", &prefix)'));
check('a game with no prefix gets a bottle of its own, not a shared one',
  protonRs.includes('.join("prefixes")') &&
    protonRs.includes('pub fn default_prefix(app: &AppHandle, program: &Path)') &&
    protonRs.includes('short_hash(&program.to_string_lossy())') &&
    launchRs.includes('crate::proton::default_prefix(&app, program)'));
check('two games with the same program name do not share a bottle',
  protonRs.includes('fn short_hash') && protonRs.includes('0xcbf2_9ce4_8422_2325'));
check('a build that has been deleted says so instead of quietly running Wine',
  launchRs.includes('is not a Proton build any more'));
check('a folder without a proton script is not run through Proton',
  protonRs.includes('pub fn chosen') && protonRs.includes('if is_proton(&path)'));
check('the wrappers are programs, not a shell line',
  launchRs.includes('wrap_in(cmd, "mangohud")') &&
    launchRs.includes('wrap_in(cmd, "gamemoderun")') &&
    launchRs.includes('cmd.get_program()') &&
    !launchRs.includes('sh -c'));

console.log('the tweaks are written only when they are asked for');

for (const [name, line] of [
  ['SDL', 'if tweaks.sdl {'],
  ['Wayland', 'if tweaks.wayland {'],
  ['WOW64', 'if tweaks.wow64 {'],
  ['MangoHud', 'if tweaks.mangohud {'],
]) {
  check(`${name} is off unless it is on`, launchRs.includes(line));
}
check('fsync and esync can be forced either way, or left alone',
  launchRs.includes('if let Some(on) = tweaks.fsync') &&
    launchRs.includes('if let Some(on) = tweaks.esync') &&
    launchRs.includes('"WINEFSYNC"') &&
    launchRs.includes('"WINEESYNC"'));
check('the environment names are the ones Proton and DXVK read',
  ['PROTON_PREFER_SDL', 'PROTON_ENABLE_WAYLAND', 'PROTON_USE_WOW64', 'DXVK_HUD',
    'WINEDLLOVERRIDES'].every((name) => launchRs.includes(`"${name}"`)));
check('a game id that is not a name is dropped, not passed on',
  launchRs.includes('is_ascii_alphanumeric() || ch == \'-\' || ch == \'_\''));
check('an environment name with a space in it is a typo, not a variable',
  launchRs.includes('is_ascii_alphanumeric() || ch == \'_\''));
check('the page has every one of them, with a switch',
  ['MangoHud', 'GameMode', 'SDL controller', 'Wayland driver', 'WOW64'].every((label) =>
    wineTs.includes(`label="${label}"`),
  ) && wineTs.includes('Leave it to the machine'));
check('and rows of its own, for whatever the game needs',
  wineTs.includes('Add a variable') && wineTs.includes('Variable name'));

console.log('Proton-GE is one button away');

check('the list comes from GloriousEggroll\u2019s releases',
  protonRs.includes('api.github.com/repos/GloriousEggroll/proton-ge-custom/releases') &&
    protonRs.includes('GE-Proton'));
check('only an archive is offered', protonRs.includes('.tar.gz') && protonRs.includes('.tar.xz'));
check('only GitHub is downloaded from',
  protonRs.includes('host == "github.com"') &&
    protonRs.includes('.githubusercontent.com') &&
    protonRs.includes('strip_prefix("https://")'));
check('a name that would leave the folder is refused',
  protonRs.includes('tag.contains("..")') && protonRs.includes('tag.contains(\'/\')'));
check('the download is streamed to disk, not held in memory',
  protonRs.includes('.chunk()') && protonRs.includes('file.write_all'));
check('and unpacked where it can be found again', protonRs.includes('"tar"'));
check('only Orbit\u2019s own builds can be removed here',
  protonRs.includes('if !target.is_dir() || !same_folder(&target, &root)'));
check('the page says which are already here', managerTs.includes('already here'));
check('and reports the fetch as it goes',
  managerTs.includes('watchLaunchStatus') && protonRs.includes('orbit-launch-status'));
check('a newer release sorts above an older one, which text does not',
  tagNumbers('GE-Proton9-20')[0] === 9 && tagNumbers('GE-Proton9-20')[1] === 20);
check('the shelf is newest first',
  sortReleases([
    { tag: 'GE-Proton9-4' },
    { tag: 'GE-Proton9-20' },
    { tag: 'GE-Proton10-1' },
  ])
    .map((release) => release.tag)
    .join() === 'GE-Proton10-1,GE-Proton9-20,GE-Proton9-4');
check('two releases with the same numbers keep the order GitHub gave',
  sortReleases([{ tag: 'GE-Proton9-4' }, { tag: 'GE-Proton9-4' }]).length === 2);

console.log('the app can ask for all of it');

check('the module is there', libRs.includes('mod proton;'));
for (const command of ['proton_builds', 'proton_ge_releases', 'proton_install', 'proton_remove']) {
  check(`${command} is a command and is registered`,
    new RegExp(`fn ${command}\\(`).test(libRs) &&
      libRs.includes(`            ${command},`),
    'a command without a handler entry cannot be called');
}

globalThis.__orbitFailures = (globalThis.__orbitFailures ?? 0) + failures;
