/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { clearExplorerCache, cacheStatus } from "./lib/cache.ts";
import {
  buildHelpText,
  DEFAULT_ORG,
  modeLabel,
  parseCommandArgs,
  type ParsedCommandArgs,
} from "./lib/command.ts";
import { createData360SqlStrategy, type Data360ObjectMeta } from "./lib/modes/data360-sql.ts";
import { createSoqlStrategy, type CoreSObjectMeta } from "./lib/modes/soql.ts";
import { createSoslStrategy } from "./lib/modes/sosl.ts";
import {
  getSfDataExplorerTransport,
  resolveSfPiPath,
  type SfDataExplorerTransport,
} from "./lib/transport.ts";
import { ExplorerSpa, type ExplorerSpaResult } from "./lib/ui/explorer-spa.ts";
import type { ExplorerMode, ExplorerStrategy } from "./lib/types.ts";

const COMMAND = "sf-data-explorer";

type CommandCtx = {
  hasUI: boolean;
  cwd: string;
  ui: {
    notify: (message: string, level?: "info" | "warning" | "error") => void;
    select: (title: string, items: string[], options?: unknown) => Promise<string | undefined>;
    custom: <T>(
      factory: (
        tui: { requestRender: () => void },
        theme: any,
        keybindings: any,
        done: (value: T) => void,
      ) => any,
      options?: unknown,
    ) => Promise<T>;
    setEditorText: (text: string) => void;
    editor: (title: string, text: string) => Promise<string | undefined>;
  };
};

export default function sfDataExplorer(pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    clearExplorerCache();
    try {
      (await getSfDataExplorerTransport(pi)).clearCache();
    } catch {
      // Transport may not be available until sf-pi is installed; command will surface the real error.
    }
  });
  pi.on("session_shutdown", async () => {
    clearExplorerCache();
    try {
      (await getSfDataExplorerTransport(pi)).clearCache();
    } catch {
      // ignore
    }
  });

  pi.registerCommand(COMMAND, {
    description: "Read-only interactive SOQL, SOSL, and Data 360 SQL explorer",
    getArgumentCompletions: (prefix: string) =>
      ["soql", "sosl", "sql", DEFAULT_ORG, "refresh", "soql refresh", "sosl refresh", "sql refresh"]
        .filter((v) => v.startsWith(prefix))
        .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      await withSafeCommandHandlerCompat(pi, ctx as unknown as CommandCtx, () =>
        handleCommand(pi, ctx as unknown as CommandCtx, args || ""),
      );
    },
  });
}

async function handleCommand(pi: ExtensionAPI, ctx: CommandCtx, args: string): Promise<void> {
  const parsed = parseCommandArgs(args);
  if (parsed.help) {
    ctx.ui.setEditorText(buildHelpText());
    ctx.ui.notify("SF Data Explorer help copied to editor.", "info");
    return;
  }
  if (!ctx.hasUI) {
    ctx.ui.notify("/sf-data-explorer requires interactive pi TUI mode.", "error");
    return;
  }
  if (!parsed.mode && !args.trim()) {
    const panelMode = await openSfDataExplorerPanel(pi, ctx, parsed.org);
    if (!panelMode) return;
    parsed.mode = panelMode;
  }
  const mode = parsed.mode ?? (await pickMode(ctx));
  if (!mode) return;
  let current: ParsedCommandArgs & { mode: ExplorerMode } = { ...parsed, mode };
  for (;;) {
    const result = await launchExplorer(pi, ctx, current);
    if (result?.kind !== "switchMode") break;
    current = { ...current, mode: result.mode, object: undefined, forceRefresh: false };
  }
}

type PanelAction = "open.soql" | "open.sosl" | "open.sql" | "help" | "close" | "lifecycle.toggle";

type SfPiPanelModules = {
  openCommandPanel: (ctx: unknown, options: Record<string, unknown>) => Promise<PanelAction | null>;
  openInfoPanel: (ctx: unknown, options: Record<string, unknown>) => Promise<void>;
  buildToggleExtensionAction: (options: {
    extensionId: string;
    cwd: string;
  }) => { value: "lifecycle.toggle"; label: string; description: string; group: string } | null;
  performToggleExtension: (ctx: unknown, extensionId: string) => Promise<void>;
  isLifecycleToggleAction: (action: string) => boolean;
  LIFECYCLE_GROUP: string;
};

async function openSfDataExplorerPanel(
  pi: ExtensionAPI,
  ctx: CommandCtx,
  org: string,
): Promise<ExplorerMode | undefined> {
  const modules = await tryLoadSfPiPanelModules();
  if (!modules) return pickMode(ctx);

  const toggle = modules.buildToggleExtensionAction({
    extensionId: "sf-data-explorer",
    cwd: ctx.cwd,
  });
  const actions = [
    {
      value: "open.soql",
      label: "Open SOQL Explorer",
      description: "Browse queryable core Salesforce sObjects, select fields, edit/run SOQL.",
      group: "Open",
    },
    {
      value: "open.sosl",
      label: "Open SOSL Explorer",
      description: "Browse searchable sObjects, build/edit/run SOSL searches.",
      group: "Open",
    },
    {
      value: "open.sql",
      label: "Open Data 360 SQL Explorer",
      description: "Browse Data 360 DMO/DLO metadata, select fields, edit/run Data 360 SQL.",
      group: "Open",
    },
    {
      value: "help",
      label: "Show help",
      description: "Show command examples, keybindings, and read-only safety notes.",
      group: "Reference",
    },
    {
      value: "close",
      label: "Close",
      description: "Dismiss this panel.",
      group: modules.LIFECYCLE_GROUP,
    },
    ...(toggle ? [toggle] : []),
  ];

  const action = await modules.openCommandPanel(ctx, {
    title: "SF Data Explorer",
    subtitle: "Read-only SOQL, SOSL, and Data 360 SQL explorer.",
    statusLines: [
      `Target org: ${org}`,
      "Read-only: describe, query, search, and Data 360 SELECT SQL only.",
      "Tip: pass object/table deep links, e.g. /sf-data-explorer soql Account wh",
    ],
    actions,
    closeValue: "close",
    closeBeforeAction: modules.isLifecycleToggleAction,
    helpText: "↑↓ move · type filter · Enter select · Esc / type 'exit' close",
  });

  switch (action) {
    case "open.soql":
      return "soql";
    case "open.sosl":
      return "sosl";
    case "open.sql":
      return "sql";
    case "help":
      await modules.openInfoPanel(ctx, {
        title: "SF Data Explorer help",
        body: buildHelpText(),
        severity: "info",
      });
      return openSfDataExplorerPanel(pi, ctx, org);
    case "lifecycle.toggle":
      await modules.performToggleExtension(ctx, "sf-data-explorer");
      return undefined;
    default:
      return undefined;
  }
}

async function tryLoadSfPiPanelModules(): Promise<SfPiPanelModules | null> {
  try {
    const sfPiPath = await resolveSfPiPath();
    const url = (rel: string): string => `file://${sfPiPath}/${rel}`;
    const [commandPanel, infoPanel, extensionToggle] = await Promise.all([
      import(url("lib/common/command-panel.ts")),
      import(url("lib/common/info-panel.ts")),
      import(url("lib/common/extension-toggle.ts")),
    ]);
    return {
      openCommandPanel: commandPanel.openCommandPanel,
      openInfoPanel: infoPanel.openInfoPanel,
      buildToggleExtensionAction: extensionToggle.buildToggleExtensionAction,
      performToggleExtension: extensionToggle.performToggleExtension,
      isLifecycleToggleAction: extensionToggle.isLifecycleToggleAction,
      LIFECYCLE_GROUP: extensionToggle.LIFECYCLE_GROUP,
    };
  } catch {
    return null;
  }
}

async function withSafeCommandHandlerCompat(
  pi: ExtensionAPI,
  ctx: CommandCtx,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    const sfPiPath = await resolveSfPiPath();
    const mod = await import(`file://${sfPiPath}/lib/common/safe-command-handler.ts`);
    await mod.withSafeCommandHandler(ctx, COMMAND, fn);
  } catch (error) {
    // If sf-pi common helpers are unavailable in standalone development, run
    // the command body directly. If the body fails, surface the error visibly.
    try {
      await fn();
    } catch (inner) {
      const err = inner instanceof Error ? inner : error;
      ctx.ui.notify(
        `/${COMMAND} failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  }
}

async function pickMode(ctx: CommandCtx): Promise<ExplorerMode | undefined> {
  const picked = await ctx.ui.select("SF Data Explorer mode", [
    "SOQL Explorer",
    "SOSL Explorer",
    "Data 360 SQL Explorer",
    "Cancel",
  ]);
  if (!picked || picked === "Cancel") return undefined;
  if (picked.startsWith("SOQL")) return "soql";
  if (picked.startsWith("SOSL")) return "sosl";
  return "sql";
}

async function launchExplorer(
  pi: ExtensionAPI,
  ctx: CommandCtx,
  parsed: ParsedCommandArgs & { mode: ExplorerMode },
): Promise<ExplorerSpaResult> {
  const transport = await getSfDataExplorerTransport(pi);
  const strategy = await buildInitialStrategy(pi, ctx, transport, parsed);
  if (!strategy) return undefined;
  const result = await ctx.ui.custom<ExplorerSpaResult>((tui, theme, _keybindings, done) => {
    const spa = new ExplorerSpa({
      org: parsed.org,
      cwd: ctx.cwd,
      theme,
      strategy,
      transportInfo: transport.info,
      setEditorText: (text) => ctx.ui.setEditorText(text),
      notify: (message, level) => ctx.ui.notify(message, level),
      done: (result) => done(result),
      requestRender: () => tui.requestRender(),
    });
    if (parsed.object) void spa.selectObjectByName(parsed.object, parsed.forceRefresh);
    return spa;
  });
  if (result?.kind === "copyToEditor") {
    ctx.ui.setEditorText(result.text);
    ctx.ui.notify(`Copied ${result.label} to editor.`, "info");
  }
  return result;
}

async function buildInitialStrategy(
  pi: ExtensionAPI,
  ctx: CommandCtx,
  transport: SfDataExplorerTransport,
  parsed: ParsedCommandArgs & { mode: ExplorerMode },
): Promise<ExplorerStrategy<any, any> | undefined> {
  if (parsed.mode === "soql") {
    const empty = createSoqlStrategy({
      transport,
      org: parsed.org,
      initial: { objects: [], cacheLine: "Loading SOQL catalog…" },
    });
    const loaded = await runWithLoader(
      ctx,
      `${parsed.forceRefresh ? "Refreshing" : "Loading"} SOQL sObject catalog for ${parsed.org}…`,
      () => empty.loadCatalog(parsed.forceRefresh),
    );
    if (!loaded) return undefined;
    const cacheLine = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
    ctx.ui.notify(cacheLine, "info");
    return createSoqlStrategy({
      transport,
      org: parsed.org,
      initial: { objects: loaded.value as CoreSObjectMeta[], cacheLine },
    });
  }
  if (parsed.mode === "sosl") {
    const empty = createSoslStrategy({
      transport,
      org: parsed.org,
      initial: { objects: [], cacheLine: "Loading SOSL catalog…" },
    });
    const loaded = await runWithLoader(
      ctx,
      `${parsed.forceRefresh ? "Refreshing" : "Loading"} SOSL searchable catalog for ${parsed.org}…`,
      () => empty.loadCatalog(parsed.forceRefresh),
    );
    if (!loaded) return undefined;
    const cacheLine = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
    ctx.ui.notify(cacheLine, "info");
    return createSoslStrategy({
      transport,
      org: parsed.org,
      initial: { objects: loaded.value as CoreSObjectMeta[], cacheLine },
    });
  }
  const empty = createData360SqlStrategy({
    transport,
    org: parsed.org,
    initial: { objects: [], cacheLine: "Loading Data 360 catalog…" },
    requestRender: () => {},
  });
  const loaded = await runWithLoader(
    ctx,
    `${parsed.forceRefresh ? "Refreshing" : "Loading"} Data 360 DMO+DLO catalog for ${parsed.org}…`,
    () => empty.loadCatalog(parsed.forceRefresh),
  );
  if (!loaded) return undefined;
  const cacheLine = cacheStatus(loaded.kindLabel, loaded.cached, loaded.loadedAt);
  ctx.ui.notify(cacheLine, "info");
  return createData360SqlStrategy({
    transport,
    org: parsed.org,
    initial: { objects: loaded.value as Data360ObjectMeta[], cacheLine },
    requestRender: () => {},
  });
}

async function runWithLoader<T>(
  ctx: CommandCtx,
  label: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  const result = await ctx.ui.custom<T | { error: string } | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui as any, theme, label);
    loader.onAbort = () => done(null);
    work(loader.signal)
      .then(done)
      .catch((error: unknown) =>
        done({ error: error instanceof Error ? error.message : String(error) }),
      );
    return loader;
  });
  if (result === null) {
    ctx.ui.notify("Cancelled", "info");
    return undefined;
  }
  if (typeof result === "object" && result && "error" in result) {
    ctx.ui.notify(String((result as { error: string }).error), "error");
    return undefined;
  }
  return result as T;
}
