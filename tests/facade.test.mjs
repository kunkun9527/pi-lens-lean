import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { createLensFacade } = await jiti.import("../index.ts");

const GUIDANCE = "[pi-lens automated context \u2014 not a user request]\n\n\u{1F4CC} pi-lens active \u2014 automated checks run";
// The file name deliberately contains the guidance marker text.
const NUDGE = "[pi-lens automated context \u2014 not a user request] pi-lens: 1 file(s) were reformatted after your last turn: \u{1F4CC} pi-lens active.ts \u2014 re-read before editing.";

const schema = (properties, required = []) => ({ type: "object", properties, required });
const UPSTREAM = {
  symbol_search: schema({ query: { type: "string" }, paths: { type: "array", items: { type: "string" } } }, ["query"]),
  module_report: schema({ path: { type: "string" } }, ["path"]),
  read_symbol: schema({ path: { type: "string" }, symbol: { type: "string" } }, ["path", "symbol"]),
  read_enclosing: schema({ path: { type: "string" }, line: { type: "number" } }, ["path", "line"]),
  ast_grep_outline: schema({ paths: { type: "array", items: { type: "string" } } }, ["paths"]),
  lens_diagnostics: schema({ source: { type: "string", enum: ["session", "lsp"] }, path: { type: "string" }, paths: { type: "array", items: { type: "string" } }, scope: { type: "string" } }),
  lsp_navigation: schema({ operation: { type: "string" }, path: { type: "string" }, line: { type: "number" }, symbol: { type: "string" } }, ["operation"]),
  ast_grep_search: schema({ pattern: { type: "string" }, lang: { type: "string" }, paths: { type: "array", items: { type: "string" } }, rule: { type: "string" }, nodeKind: { type: "string" } }, ["lang"]),
  ast_grep_replace: schema({ pattern: { type: "string" }, rewrite: { type: "string" }, lang: { type: "string" }, apply: { type: "boolean" } }, ["pattern", "rewrite", "lang"]),
  lens_diagnostic_mark: schema({ filePath: { type: "string" }, line: { type: "number" }, message: { type: "string" }, disposition: { type: "string" } }, ["filePath", "line", "message", "disposition"]),
  project_report: schema({ focus: { type: "string" } }),
  effective_config: schema({ file: { type: "string" } }),
};

function createUpstream({ disabled = [] } = {}) {
  const calls = [];
  const upstream = (pi) => {
    for (const [name, parameters] of Object.entries(UPSTREAM)) {
      if (disabled.includes(name)) continue;
      pi.registerTool({
        name,
        description: `${name} upstream description`,
        parameters,
        async execute(callId, args, signal, onUpdate, ctx) {
          calls.push({ name, callId, args, signal, onUpdate, ctx });
          return { content: [{ type: "text", text: name }], details: { name } };
        },
      });
    }
    pi.registerTool({ name: "pi_lens_activate_tools", description: "x", parameters: schema({}), execute() {} });
    pi.setActiveTools(["ast_grep_search"]);
    pi.on("resources_discover", () => ({ skillPaths: ["skills"] }));
    pi.on("context", (event) => ({
      messages: [...event.messages, { role: "user", content: GUIDANCE }, { role: "user", content: NUDGE }],
    }));
    pi.on("session_start", () => "kept");
  };
  return { upstream, calls };
}

function createPi() {
  const tools = new Map();
  const handlers = new Map();
  const activeCalls = [];
  const api = {
    registerTool(tool) { tools.set(tool.name, tool); },
    on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    setActiveTools(names) { activeCalls.push(names); },
  };
  // The real pi-lens also registers flags, commands and renderers; accept them.
  const pi = new Proxy(api, { get: (target, key) => target[key] ?? (() => undefined) });
  return { pi, tools, handlers, activeCalls };
}

function setup(options) {
  const { upstream, calls } = createUpstream(options);
  const host = createPi();
  createLensFacade(upstream)(host.pi);
  const run = (tool, params) => host.tools.get(tool).execute("call-1", params, undefined, undefined, { cwd: "." });
  return { ...host, calls, run };
}

test("registers exactly two fixed tools and blocks tool-set changes and skills", () => {
  const { tools, handlers, activeCalls } = setup();
  assert.deepEqual([...tools.keys()], ["lens_code", "lens"]);
  assert.deepEqual(activeCalls, []);
  assert.equal(handlers.has("resources_discover"), false);
  assert.equal(handlers.get("session_start").length, 1);
  const ops = (name) => tools.get(name).parameters.properties.op.enum;
  assert.deepEqual(ops("lens_code"), ["symbol_search", "module_report", "read_symbol", "read_enclosing", "ast_grep_outline", "help"]);
  assert.deepEqual(ops("lens"), ["lens_diagnostics", "lsp_navigation", "ast_grep_search", "ast_grep_replace", "lens_diagnostic_mark", "project_report", "effective_config", "help"]);
});

test("routes facade fields onto upstream argument names", async () => {
  const { run, calls } = setup();
  await run("lens_code", { op: "read_enclosing", path: "a.ts", line: 42 });
  await run("lens_code", { op: "ast_grep_outline", path: "src" });
  await run("lens", { op: "lens_diagnostic_mark", path: "a.ts", line: 3, input: '{"message":"m","disposition":"defer"}' });
  await run("lens", { op: "effective_config", path: "a.ts" });
  await run("lens", { op: "lsp_navigation", path: "a.ts", line: 7, symbol: "foo", input: '{"operation":"definition"}' });
  assert.deepEqual(calls.map((call) => [call.name, call.args]), [
    ["read_enclosing", { path: "a.ts", line: 42 }],
    ["ast_grep_outline", { paths: ["src"] }],
    ["lens_diagnostic_mark", { filePath: "a.ts", line: 3, message: "m", disposition: "defer" }],
    ["effective_config", { file: "a.ts" }],
    ["lsp_navigation", { path: "a.ts", line: 7, symbol: "foo", operation: "definition" }],
  ]);
  assert.equal(calls[0].callId, "call-1");
  assert.deepEqual(calls[0].ctx, { cwd: "." });
});

test("call shapes named in the descriptions reach upstream", async () => {
  const { run, calls } = setup();
  await run("lens_code", { op: "read_symbol", path: "a.ts", symbol: "greet" });
  await run("lens", { op: "lsp_navigation", path: "a.ts", line: 5, symbol: "greet", input: '{"operation":"hover"}' });
  await run("lens", { op: "ast_grep_search", path: "src", input: '{"lang":"ts","pattern":"greet($A)"}' });
  await run("lens", { op: "ast_grep_search", path: "src", input: '{"lang":"ts","rule":"kind: call_expression"}' });
  await run("lens", { op: "ast_grep_search", path: "src", input: '{"lang":"ts","nodeKind":"call_expression"}' });
  assert.deepEqual(calls.map((call) => [call.name, call.args]), [
    ["read_symbol", { path: "a.ts", symbol: "greet" }],
    ["lsp_navigation", { path: "a.ts", line: 5, symbol: "greet", operation: "hover" }],
    ["ast_grep_search", { paths: ["src"], lang: "ts", pattern: "greet($A)" }],
    ["ast_grep_search", { paths: ["src"], lang: "ts", rule: "kind: call_expression" }],
    ["ast_grep_search", { paths: ["src"], lang: "ts", nodeKind: "call_expression" }],
  ]);
  await assert.rejects(run("lens_code", { op: "read_symbol", path: "a.ts" }), /symbol/);
  await assert.rejects(run("lens", { op: "ast_grep_search", path: "src" }), /lang/);
  assert.equal(calls.length, 5);
});

test("rejects invalid input before reaching upstream", async () => {
  const { run, calls } = setup();
  await assert.rejects(run("lens", { op: "lsp_navigation", path: "a.ts", input: "definition" }), /JSON object string/);
  await assert.rejects(run("lens", { op: "lsp_navigation", input: "[1]" }), /JSON object string/);
  await assert.rejects(run("lens", { op: "lsp_navigation", input: '{"operaton":"definition"}' }), /no argument operaton/);
  await assert.rejects(run("lens", { op: "lsp_navigation", path: "a.ts" }), /operation/);
  await assert.rejects(run("lens_code", { op: "module_report", symbol: "x", path: "a.ts" }), /does not take symbol/);
  await assert.rejects(run("lens", { op: "ast_grep_search", path: "a", paths: ["b"], input: '{"lang":"ts"}' }), /pass one/);
  await assert.rejects(run("lens_code", { op: "read_symbol", path: "a.ts", symbol: "x", input: '{"symbol":"y"}' }), /both as a field and in input/);
  await assert.rejects(run("lens_code", { op: "lens_diagnostics" }), /no op lens_diagnostics/);
  assert.equal(calls.length, 0);
});

test("help lists ops, then discloses upstream schema and recipes", async () => {
  const { run } = setup();
  const index = await run("lens", { op: "help" });
  assert.match(index.content[0].text, /lens_diagnostics, lsp_navigation/);
  const lsp = await run("lens", { op: "help", input: "lsp_navigation" });
  assert.match(lsp.content[0].text, /lsp_navigation upstream description/);
  assert.match(lsp.content[0].text, /"operation"/);
  assert.match(lsp.content[0].text, /prepareCallHierarchy/);
  const outline = await run("lens_code", { op: "help", input: "ast_grep_outline" });
  assert.match(outline.content[0].text, /Metavariables do not work inside strings/);
});

test("ops disabled in the pi-lens config stay unavailable", async () => {
  const { run } = setup({ disabled: ["project_report"] });
  await assert.rejects(run("lens", { op: "project_report" }), /disabled in the pi-lens config/);
  await assert.rejects(run("lens", { op: "help", input: "project_report" }), /disabled in the pi-lens config/);
});

test("context drops only the session-start guidance", async () => {
  const { handlers } = setup();
  const prior = { role: "user", content: GUIDANCE };
  const result = await handlers.get("context")[0]({ messages: [prior] }, {});
  assert.deepEqual(result.messages, [prior, { role: "user", content: NUDGE }]);
});

test("real pinned pi-lens provides every op and the guidance marker", async () => {
  const { readFile } = await import("node:fs/promises");
  const dist = await readFile(new URL("../node_modules/pi-lens/dist/index.js", import.meta.url), "utf8");
  // index.ts drops messages starting with this prefix + the first guidance line.
  assert.match(dist, /var SESSION_START_GUIDANCE = \[\s*"\\u\{1F4CC\} pi-lens active/);
  assert.match(dist, /content: `\[pi-lens automated context \\u2014 not a user request\]\r?\n\r?\n\$\{translateGuidanceToolNames\(guidance\.data\.content/);

  const real = await jiti.import("pi-lens", { default: true });
  const upstreamTools = new Map();
  const spy = (pi) => real(new Proxy(pi, {
    get: (target, key) => key === "registerTool"
      ? (tool) => { upstreamTools.set(tool.name, tool); target.registerTool(tool); }
      : target[key],
  }));
  const host = createPi();
  createLensFacade(spy)(host.pi);
  assert.deepEqual([...host.tools.keys()], ["lens_code", "lens"]);
  assert.deepEqual(host.activeCalls, []);
  // Facade field names for upstream path fields.
  const FACADE_NAME = { filePath: "path", file: "path", paths: "path" };
  for (const name of ["lens_code", "lens"]) {
    const tool = host.tools.get(name);
    for (const op of tool.parameters.properties.op.enum.filter((op) => op !== "help")) {
      const help = await tool.execute("h", { op: "help", input: op });
      assert.match(help.content[0].text, /"properties"/, `${name} ${op}`);
      // Every upstream required argument is named next to its op, so a cold call succeeds.
      const required = upstreamTools.get(op).parameters.required ?? [];
      if (required.length === 0) continue;
      const at = tool.description.indexOf(op);
      assert.notEqual(at, -1, `${name} description names ${op}`);
      // Skip the op name itself: read_symbol already contains "symbol".
      const start = at + op.length;
      const end = tool.description.indexOf(";", start);
      const hint = tool.description.slice(start, end === -1 ? undefined : end);
      for (const field of required) {
        assert.ok(hint.includes(FACADE_NAME[field] ?? field), `${name} ${op} hint names ${field}: ${hint}`);
      }
    }
  }
});
