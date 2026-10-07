/**
 * The version this build is.
 *
 * The number itself is written into the bundle by `vite.config.ts` from the
 * `VERSION` file at the repository root, which is also what the release
 * workflow reads, so what the app says it is and what the release is called
 * come from one line in one place rather than from remembering to update two
 * files.
 */
export { APP_VERSION } from 'virtual:orbit-version';
