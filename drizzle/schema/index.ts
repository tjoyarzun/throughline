/**
 * Schema barrel for MIGRATIONS AND INGEST ONLY.
 *
 * Application code must not import this. It reaches the database through
 * src/server/repos/, which reads sem.* views and writes usr.* inside
 * withUser(). ESLint blocks core/raw schema imports from src/app, src/components
 * and src/actions; scripts/check-layers.sh is the backstop.
 */
export * as raw from './raw';
export * as core from './core';
export * as usr from './usr';
