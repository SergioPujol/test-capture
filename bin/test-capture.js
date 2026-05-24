#!/usr/bin/env node

import { runCli } from "../src/cli.mjs";

runCli(process.argv.slice(2)).catch((error) => {
  const payload = error?.toResponse?.() ?? {
    error: error?.name ?? "UnexpectedError",
    message: error?.message ?? String(error),
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
