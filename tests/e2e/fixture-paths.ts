/**
 * Paths and types shared between the seed setup and the specs that consume
 * it. A module of its own because Playwright refuses to let one test file
 * import another, and a spec importing the setup is exactly that.
 */

export const AUTH_STATE = 'tests/e2e/.auth/state.json';
export const FIXTURES = 'tests/e2e/.auth/fixtures.json';

export interface Fixtures {
  titleSlug: string;
  shareSlug: string;
}
