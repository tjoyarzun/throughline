# ADR 0011 — A `core.job` table and cron drain, not a queue vendor

**Date:** 2026-09-20 · **Status:** Accepted

## Decision

Background work runs on one table plus a cron endpoint. No Inngest, no QStash, no SQS.

`core.job(id, kind, payload, status, attempts, run_after, locked_at, locked_by, last_error)`, a
`claim_jobs(n)` function using `FOR UPDATE SKIP LOCKED`, and `/api/cron/drain` processing up to 40
jobs per invocation against a wall-clock budget, hit by Vercel Cron every minute. Roughly 120 lines.

## Why

The fan-out is small, the operational burden of a fifth vendor is real for one developer, and a job
table in the same transaction as the data it produces gives exactly-once semantics an external queue
would not.

## Upgrade trigger

Sustained queue depth > 500, or a need for multi-step durable workflows with fan-out/fan-in.

## Non-negotiable

A cron job must **never exit 0 on a failed fetch.** `/api/health` asserts freshness _and_
non-error state per job kind — a job that succeeds at doing nothing is not healthy. This is the
directly transferable lesson from a scheduled sync elsewhere that reported success every 15 minutes
for 13 days while doing nothing.
