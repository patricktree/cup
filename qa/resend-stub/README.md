# Resend stub

Tests that exercise Resend use this stub (`@cup/resend-stub`): a local stand-in for `POST /emails` that models Resend’s request checks and idempotency and lets a test script, hang, or hold the next answer. Start one per test from [`src/resend-stub.ts`](src/resend-stub.ts).

## Live contract test

`pnpm test:resend-live` (in [`test-live/`](test-live/), with its own Vitest config) is the opt-in contract test that checks the stub’s model against the real Resend API. It needs `RESEND_API_KEY` (`RESEND_FROM` defaults to `Cup <no-reply@cup.audio>`) and sends real emails to `delivered@resend.dev`, so it is part of no validation command and only the operator runs it; agents never run it.
