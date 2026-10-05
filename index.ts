// pi-lens-lean: two fixed provider-facing tools over the full pi-lens runtime.
// Upstream tool schemas, skills and session-start guidance stay local; `help`
// discloses them on demand. Operation names are the upstream tool names, so the
// tool-name hints inside pi-lens output still point at a valid op.
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import piLens from "pi-lens";
import { Type } from "typebox";
import { AST_GUIDE, DIAGNOSTICS_GUIDE, LSP_GUIDE } from "./guides.ts";

const COLLAPSED_DISPLAY_SERVICE = Symbol.for(
  "@local/pi-collapsed-tools.display-service.v1",
);

type CollapsedDisplayTool = { name: string };
type CollapsedDisplayService = {
  readonly version: 1;
  decorate<T extends CollapsedDisplayTool>(tool: T): T;
};

function decorateWithCollapsedDisplay<T extends CollapsedDisplayTool>(tool: T): T {
  const services = globalThis as unknown as Record<PropertyKey, unknown>;
  const candidate = services[COLLAPSED_DISPLAY_SERVICE];
  if (!candidate || typeof candidate !== "object") return tool;
  const service = candidate as Partial<CollapsedDisplayService>;
  return service.version === 1 && typeof service.decorate === "function"
    ? service.decorate(tool)
    : tool;
}

type CapturedTool = ToolDefinition<any, any, any>;
type UpstreamExtension = (pi: ExtensionAPI) => void;
type Args = Record<string, unknown>;
type ContextHandler = (event: { messages?: unknown[] }, ctx: unknown) => unknown;

const CODE_OPS = [
  "symbol_search",
  "module_report",
  "read_symbol",
  "read_enclosing",
  "ast_grep_outline",
] as const;
const CHECK_OPS = [
  "lens_diagnostics",
  "lsp_navigation",
  "ast_grep_search",
  "ast_grep_replace",
  "lens_diagnostic_mark",
  "project_report",
  "effective_config",
] as const;

const GUIDES: Record<string, string> = {
  lens_diagnostics: DIAGNOSTICS_GUIDE,
  lsp_navigation: LSP_GUIDE,
  ast_grep_search: AST_GUIDE,
  ast_grep_replace: AST_GUIDE,
  ast_grep_outline: AST_GUIDE,
};

// The upstream activation tool mutates the active tool set mid-session, which
// invalidates the prompt cache. Both facades are always active instead.
const UPSTREAM_LOADER = "pi_lens_activate_tools";
// Session-start guidance repeats tool usage already covered by the facade and
// help. Findings, test results and the post-format re-read nudge stay; they use
// a different prefix, so only a message starting with this one is dropped.
const GUIDANCE_PREFIX = "[pi-lens automated context \u2014 not a user request]\n\n\u{1F4CC} pi-lens active";

const SHARED_FIELDS = {
  path: Type.Optional(Type.String()),
  paths: Type.Optional(Type.Array(Type.String())),
  query: Type.Optional(Type.String()),
  symbol: Type.Optional(Type.String()),
  line: Type.Optional(Type.Integer({ minimum: 1 })),
  input: Type.Optional(Type.String({
    description: "JSON object of other upstream args; for help, an op name",
  })),
};

const CODE_PARAMETERS = Type.Object({
  op: Type.Unsafe<string>({ type: "string", enum: [...CODE_OPS, "help"] }),
  ...SHARED_FIELDS,
});

const CHECK_PARAMETERS = Type.Object({
  op: Type.Unsafe<string>({ type: "string", enum: [...CHECK_OPS, "help"] }),
  source: Type.Optional(Type.Unsafe<string>({ type: "string", enum: ["session", "lsp"] })),
  ...SHARED_FIELDS,
});

type FacadeParams = {
  op: string;
  path?: string;
  paths?: string[];
  query?: string;
  symbol?: string;
  source?: string;
  line?: number;
  input?: string;
};

function capturePi(
  pi: ExtensionAPI,
  tools: Map<string, CapturedTool>,
): ExtensionAPI {
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") {
        return (tool: CapturedTool) => {
          if (tool.name !== UPSTREAM_LOADER) tools.set(tool.name, tool);
        };
      }
      if (property === "setActiveTools") return () => undefined;
      if (property === "on") {
        return (event: string, handler: ContextHandler) => {
          // Skills are listed in every system prompt; their guidance lives in help.
          if (event === "resources_discover") return;
          target.on(
            event as never,
            (event === "context" ? withoutGuidance(handler) : handler) as never,
          );
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function isGuidance(message: unknown): boolean {
  const content = (message as { content?: unknown } | null)?.content;
  return typeof content === "string" && content.startsWith(GUIDANCE_PREFIX);
}

function withoutGuidance(handler: ContextHandler): ContextHandler {
  return async (event, ctx) => {
    const result = await handler(event, ctx) as { messages?: unknown[] } | undefined;
    if (!Array.isArray(result?.messages)) return result;
    const existing = new Set(event?.messages ?? []);
    const messages = result.messages.filter(
      (message) => existing.has(message) || !isGuidance(message),
    );
    return messages.length === result.messages.length ? result : { ...result, messages };
  };
}

function parseInput(tool: string, input: string | undefined): Args {
  if (input === undefined || input.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${tool} input must be a JSON object string: ${reason}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${tool} input must be a JSON object string, for example {"operation":"definition"}`);
  }
  return parsed as Args;
}

function upstreamProperties(tool: CapturedTool): Args {
  return (tool.parameters as { properties?: Args }).properties ?? {};
}

// Maps facade fields onto the upstream schema. `path` lands on whichever path
// field the upstream tool has; every other field keeps its name.
export function mapArguments(
  facade: string,
  tool: CapturedTool,
  params: FacadeParams,
): Args {
  const properties = upstreamProperties(tool);
  const has = (key: string) => Object.hasOwn(properties, key);
  const args: Args = {};
  const assign = (key: string, value: unknown) => {
    if (Object.hasOwn(args, key)) {
      throw new Error(`${facade} ${tool.name}: path and paths both set ${key}; pass one`);
    }
    args[key] = value;
  };

  for (const [field, value] of Object.entries(params)) {
    if (field === "op" || field === "input" || value === undefined) continue;
    if (field === "path") {
      const target = ["path", "filePath", "file"].find(has);
      if (target) assign(target, value);
      else if (has("paths")) assign("paths", [value]);
      else throw new Error(`${facade} ${tool.name} does not take path`);
      continue;
    }
    if (!has(field)) throw new Error(`${facade} ${tool.name} does not take ${field}`);
    assign(field, value);
  }

  for (const [key, value] of Object.entries(parseInput(facade, params.input))) {
    if (!has(key)) {
      throw new Error(
        `${facade} ${tool.name} has no argument ${key}. Arguments: ${Object.keys(properties).join(", ")}`,
      );
    }
    if (Object.hasOwn(args, key) && JSON.stringify(args[key]) !== JSON.stringify(value)) {
      throw new Error(`${facade} ${tool.name}: ${key} is set both as a field and in input`);
    }
    args[key] = value;
  }

  // The host validates only the facade schema, so check the upstream one here.
  return validateToolArguments(
    { name: tool.name, description: tool.description, parameters: tool.parameters },
    // Values come from JSON.parse or the facade's JSON schema, so they are JSON.
    { type: "toolCall", id: "pi-lens-lean", name: tool.name, arguments: args as never },
  ) as Args;
}

function helpResult(
  facade: string,
  ops: readonly string[],
  topic: string,
  tools: Map<string, CapturedTool>,
) {
  if (!ops.includes(topic)) {
    const text = `${facade} ops: ${ops.join(", ")}. Call help with input set to one op for its upstream description, JSON schema and recipes.`;
    return { content: [{ type: "text" as const, text }], details: { op: "help" } };
  }
  const tool = tools.get(topic);
  if (!tool) throw new Error(`${topic} is disabled in the pi-lens config`);
  const text = [
    tool.description,
    "Upstream arguments (fields path/paths/query/symbol/line/source map by name; pass the rest as JSON in input):",
    JSON.stringify(tool.parameters),
    GUIDES[topic],
  ].filter(Boolean).join("\n\n");
  return { content: [{ type: "text" as const, text }], details: { op: "help", topic } };
}

function createFacade(
  name: string,
  label: string,
  description: string,
  parameters: typeof CODE_PARAMETERS | typeof CHECK_PARAMETERS,
  ops: readonly string[],
  tools: Map<string, CapturedTool>,
): ToolDefinition<any, unknown, unknown> {
  return {
    name,
    label,
    description,
    parameters,
    async execute(callId, params: FacadeParams, signal, onUpdate, ctx) {
      if (params.op === "help") {
        return helpResult(name, ops, (params.input ?? "").trim(), tools);
      }
      if (!ops.includes(params.op)) {
        throw new Error(`${name} has no op ${params.op}. Ops: ${ops.join(", ")}`);
      }
      const tool = tools.get(params.op);
      if (!tool) throw new Error(`${params.op} is disabled in the pi-lens config`);
      return tool.execute(callId, mapArguments(name, tool, params), signal, onUpdate, ctx);
    },
  };
}

export function createLensFacade(
  upstream: UpstreamExtension = piLens as UpstreamExtension,
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const tools = new Map<string, CapturedTool>();
    upstream(capturePi(pi, tools));
    pi.registerTool(decorateWithCollapsedDisplay(createFacade(
      "lens_code",
      "Lens Code",
      "Find, outline or read code by symbol. Bodies have no edit anchors. help: input=op.",
      CODE_PARAMETERS,
      CODE_OPS,
      tools,
    )));
    pi.registerTool(decorateWithCollapsedDisplay(createFacade(
      "lens",
      "Lens",
      "LSP diagnostics and navigation, ast-grep, project report and config. source=session reads the cache; empty is not clean, use source=lsp. help: input=op.",
      CHECK_PARAMETERS,
      CHECK_OPS,
      tools,
    )));
  };
}

export default createLensFacade();
