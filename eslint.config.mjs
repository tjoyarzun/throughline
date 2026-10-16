import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next';

/**
 * Architectural rules are enforced here, not just documented.
 * See CLAUDE.md "hard rules" and docs/architecture.md.
 *
 * Config notes (both cost time to rediscover — see docs/decisions-log.md):
 *  - ESLint is pinned to 9.x. @typescript-eslint/scope-manager@8 does not
 *    implement ESLint 10's SourceCode API despite the peer range claiming it.
 *  - Typed linting is scoped to **\/*.{ts,tsx} with an explicit parser, because
 *    eslint-config-next installs its own parser that does not forward
 *    parserOptions.project.
 */
const BAN_DANGEROUS_HTML = {
  selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
  message:
    'dangerouslySetInnerHTML is banned. User notes render as plain text. See docs/security.md.',
};

/**
 * The two ways to hand the database a query built from a string. A tagged
 * template (sql`... ${value}`) sends each value as a separate parameter, so
 * input can never become SQL; these splice the text in first. src/ has none,
 * and this keeps it that way. Operator scripts in scripts/ are not covered.
 */
const BAN_RAW_SQL = [
  {
    selector: "CallExpression[callee.property.name='unsafe']",
    message:
      'Raw SQL strings are banned in src/. Use a tagged template so values go as parameters. See docs/security.md.',
  },
  {
    selector: "MemberExpression[object.name='sql'][property.name='raw']",
    message:
      'sql.raw splices text into the query. Use a tagged template so values go as parameters. See docs/security.md.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/lib/ontology/generated.ts',
      'drizzle/generated/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,

  // Typed linting, TS only.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', BAN_DANGEROUS_HTML],
    },
  },

  // Application code never builds SQL from strings.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', BAN_DANGEROUS_HTML, ...BAN_RAW_SQL] },
  },

  // Layer boundary: application code queries sem.* only.
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/actions/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        BAN_DANGEROUS_HTML,
        ...BAN_RAW_SQL,
        {
          selector: 'Literal[value=/\\b(core|raw)\\./]',
          message:
            'Application code must query sem.* only — never core.* or raw.*. Go through src/server/repos/. See docs/architecture.md.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/drizzle/schema/core*', '**/drizzle/schema/raw*'],
              message: 'Application code may not import core/raw schemas. Use src/server/repos/.',
            },
          ],
        },
      ],
    },
  },

  // Build and tooling scripts run in Node and legitimately use the console.
  {
    files: ['ontology/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts', '*.config.{ts,mjs}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
