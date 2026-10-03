# Conversion contracts

Runtime-independent conversion concepts shared by accounts, trial grants, the workflow, and application contracts: conversion phases and failures, conversion ownership, audiobook references, measurements, and duration balances.

The root export contains schemas, types, and [artifact-prefix construction and recognition](src/artifact-prefix.ts). Account artifacts share an account root for deletion and have separate conversion prefixes; trial conversions retain their existing storage layout. Workflow, production, delivery, and cleanup callers use these helpers. The `/duration-accounting` export contains shared segment-usage validation and pure duration estimation and balance calculations. Grant allowance defaults remain in conversion-grants, while account welcome allowance and ledger persistence remain in accounts. This library has no Cloudflare or database dependency.
