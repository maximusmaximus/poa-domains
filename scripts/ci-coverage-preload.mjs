// Coverage belongs to application/test Node processes, not Wrangler's CLI and
// its third-party build/watch subprocesses. Workerd JS is not V8 Node coverage.
// Do not alter any other test environment or command arguments.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const isWrangler = args => Array.isArray(args) && typeof args[0] === "string" &&
  /(?:^|[\\/])wrangler[\\/]bin[\\/]wrangler\.js$/.test(args[0]);
function optionsFor(args, options) {
  if (!isWrangler(args)) return options;
  const env = { ...(options?.env ?? process.env) };
  // Node copies this setting from its parent if absent; an empty value disables it.
  env.NODE_V8_COVERAGE = "";
  return { ...options, env };
}
for (const method of ["spawn", "execFileSync"]) {
  const original = childProcess[method];
  childProcess[method] = function(file, args, options) {
    return original.call(this, file, args, optionsFor(args, options));
  };
}
syncBuiltinESMExports();
