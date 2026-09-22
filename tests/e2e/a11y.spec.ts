import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { AUTH_STATE, FIXTURES, type Fixtures } from './fixture-paths';

/**
 * WCAG 2.2 AA, asserted rather than asserted-about.
 *
 * AC-31 committed to axe-core over five routes with zero violations gating
 * CI. Until now accessibility appeared in the plan and in code review and
 * nowhere a machine could see it, which is the same shape as every other
 * defect this project has found: a rule that exists and is never evaluated.
 *
 * axe catches roughly a third of WCAG issues -- it cannot tell whether a
 * focus order makes sense or whether alt text is honest. The manual pass in
 * the Phase 10 DoD is not replaced by this, and the keyboard and
 * screen-reader criteria (AC-32, AC-33) still need a person. What this does
 * is make the machine-checkable third impossible to regress.
 */

const fixtures = (): Fixtures => JSON.parse(readFileSync(FIXTURES, 'utf8')) as Fixtures;

/**
 * Color contrast is included deliberately. The palette was corrected once
 * already (two tokens failed at the ratios the spec claimed), and the unit
 * test over the token matrix only proves the DOCUMENTED pairs are sound --
 * not that a component used one of them where it should not have.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, path: string) {
  await page.goto(path);
  // Suspense boundaries stream in; auditing before they resolve audits the
  // skeletons, which are not what anybody uses.
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations;
}

function report(violations: Awaited<ReturnType<typeof audit>>): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n    ')}`,
    )
    .join('\n  ');
}

test.describe('accessibility — public', () => {
  for (const path of ['/auth/signin', '/offline']) {
    test(`${path} has no axe violations`, async ({ page }) => {
      const violations = await audit(page, path);
      expect(violations, `\n  ${report(violations)}\n`).toEqual([]);
    });
  }

  test('the share page has no axe violations', async ({ page }) => {
    const violations = await audit(page, `/s/${fixtures().shareSlug}`);
    expect(violations, `\n  ${report(violations)}\n`).toEqual([]);
  });
});

/**
 * Light mode, separately.
 *
 * The suite otherwise runs in dark because the config pins colorScheme there,
 * and dark is the default the app is used in. But the two contrast failures
 * the spec had to correct were BOTH light-mode tokens -- the aged-gold accent
 * at 3.2:1 on warm paper, and --text-faint at 3.4:1 -- so light is precisely
 * the mode where a regression is most likely and was, until now, the one mode
 * nothing looked at.
 */
test.describe('accessibility — light mode', () => {
  test.use({ colorScheme: 'light', storageState: AUTH_STATE });

  for (const path of ['/auth/signin', '/', '/library']) {
    test(`${path} has no axe violations in light mode`, async ({ page }) => {
      const violations = await audit(page, path);
      expect(violations, `\n  ${report(violations)}\n`).toEqual([]);
    });
  }

  test('the share page has no axe violations in light mode', async ({ page }) => {
    const violations = await audit(page, `/s/${fixtures().shareSlug}`);
    expect(violations, `\n  ${report(violations)}\n`).toEqual([]);
  });
});

test.describe('accessibility — signed in', () => {
  test.use({ storageState: AUTH_STATE });

  test('the session fixture actually authenticates', async ({ page }) => {
    // Without this, every audit below would silently be auditing the sign-in
    // page instead -- passing, and proving nothing about the real screens.
    await page.goto('/library');
    expect(page.url(), 'the seeded session must not be bounced to sign-in').not.toContain(
      '/auth/signin',
    );
  });

  for (const path of ['/', '/library', '/me', '/universe', '/universe/connect']) {
    test(`${path} has no axe violations`, async ({ page }) => {
      const violations = await audit(page, path);
      expect(violations, `\n  ${report(violations)}\n`).toEqual([]);
    });
  }

  test('the title detail page has no axe violations', async ({ page }) => {
    const violations = await audit(page, `/title/${fixtures().titleSlug}`);
    expect(violations, `\n  ${report(violations)}\n`).toEqual([]);
  });
});
