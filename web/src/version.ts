/**
 * The version this build is.
 *
 * Filled in at build time from the `VERSION` file at the repository root, which
 * is also what the release workflow reads, so the number the app reports and
 * the number on the GitHub release are the same number by construction rather
 * than by remembering to update two files.
 */
declare const __ORBIT_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __ORBIT_VERSION__ === 'string' ? __ORBIT_VERSION__ : '0.0.0';
