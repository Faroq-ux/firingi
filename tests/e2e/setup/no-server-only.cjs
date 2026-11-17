// Lets e2e setup scripts (run with tsx, outside Next.js) import server modules: `server-only` becomes an empty module.
const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("../../stubs/empty.ts");
  return original.call(this, request, ...rest);
};
