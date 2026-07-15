import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const architectureDocument = path.join(
  repoRoot,
  "docs/technical/14_DOMAIN_DRIVEN_ARCHITECTURE.md",
);
const sourceRoots = [
  "packages/gameplay/src",
  "packages/room-domain/src",
  "apps/game-service/src/contexts",
  "apps/web/src",
];
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

async function collectSourceFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repoRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(relativePath)));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }
  return files;
}

function importsOf(source, filename) {
  const scriptKind = filename.endsWith("x")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const imports = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return imports;
}

function assertAllowedImport(filename, specifier) {
  const normalized = filename.split(path.sep).join("/");
  const pureDomain =
    normalized.startsWith("packages/gameplay/src/") ||
    normalized.startsWith("packages/room-domain/src/");
  if (pureDomain) {
    assert.ok(
      specifier.startsWith("."),
      `${normalized} domain code must use only package-local imports, not ${specifier}`,
    );
  }

  const serviceDomain = normalized.includes("/domain/");
  const serviceApplication = normalized.includes("/application/");
  const infrastructureImport =
    /(^|\/)(adapters|delivery|platform)(\/|$)/.test(specifier) ||
    ["fastify", "next", "pg", "react", "redis"].some(
      (dependency) =>
        specifier === dependency || specifier.startsWith(`${dependency}/`),
    );
  if (serviceDomain || serviceApplication) {
    assert.equal(
      infrastructureImport,
      false,
      `${normalized} cannot depend on infrastructure module ${specifier}`,
    );
  }

  if (normalized.startsWith("apps/web/src/")) {
    assert.equal(
      [
        "@three-zero-four/game-engine",
        "@three-zero-four/gameplay",
        "@three-zero-four/room-domain",
      ].some(
        (domainPackage) =>
          specifier === domainPackage ||
          specifier.startsWith(`${domainPackage}/`),
      ),
      false,
      `${normalized} must consume wire projections instead of ${specifier}`,
    );

    const featureCore = normalized.match(
      /^apps\/web\/src\/features\/[^/]+\/(model|application)\//,
    );
    if (featureCore) {
      const layer = featureCore[1];
      const outwardLayer = new RegExp(
        `(^|/)(api|hooks|ui${layer === "model" ? "|application" : ""})(/|$)`,
      );
      const frameworkImport = ["next", "react"].some(
        (framework) =>
          specifier === framework || specifier.startsWith(`${framework}/`),
      );
      assert.equal(
        outwardLayer.test(specifier) || frameworkImport,
        false,
        `${normalized} ${layer} core cannot depend outward on ${specifier}`,
      );
    }
  }
}

function resolveRelativeImport(filename, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;
  const base = path.normalize(path.join(path.dirname(filename), specifier));
  const candidates = [
    base,
    ...[".js", ".jsx", ".ts", ".tsx"].map((extension) => `${base}${extension}`),
    ...["index.js", "index.jsx", "index.ts", "index.tsx"].map((entry) =>
      path.join(base, entry),
    ),
  ];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

function assertAcyclic(graph) {
  const visiting = new Set();
  const visited = new Set();
  const pathStack = [];

  function visit(filename) {
    if (visited.has(filename)) return;
    if (visiting.has(filename)) {
      const cycleStart = pathStack.indexOf(filename);
      assert.fail(
        `source dependency cycle: ${[...pathStack.slice(cycleStart), filename].join(" -> ")}`,
      );
    }
    visiting.add(filename);
    pathStack.push(filename);
    for (const dependency of graph.get(filename) ?? []) visit(dependency);
    pathStack.pop();
    visiting.delete(filename);
    visited.add(filename);
  }

  for (const filename of graph.keys()) visit(filename);
}

test("documents and enforces the DDD dependency direction", async () => {
  const documentation = await readFile(architectureDocument, "utf8");
  for (const requiredText of [
    "Gameplay",
    "Room Management",
    "Player Access",
    "adapters → application → domain",
    "Frontend feature cores",
  ]) {
    assert.match(documentation, new RegExp(requiredText));
  }

  const files = (
    await Promise.all(sourceRoots.map((root) => collectSourceFiles(root)))
  ).flat();
  const knownFiles = new Set(files.map((filename) => path.normalize(filename)));
  const genericWebComponents = files.filter((filename) =>
    filename.startsWith("apps/web/src/components/"),
  );
  assert.deepEqual(
    genericWebComponents,
    [],
    `web components need an owning feature: ${genericWebComponents.join(", ")}`,
  );
  const graph = new Map();

  for (const filename of knownFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    const imports = importsOf(source, filename);
    for (const specifier of imports) {
      assertAllowedImport(filename, specifier);
    }
    graph.set(
      filename,
      imports
        .map((specifier) =>
          resolveRelativeImport(filename, specifier, knownFiles),
        )
        .filter(Boolean),
    );
  }

  assertAcyclic(graph);
});

test("room maintenance depends on an application-owned persistence port", async () => {
  const legacyDomainFiles = await collectSourceFiles(
    "apps/game-service/src/domain",
  );
  assert.equal(
    legacyDomainFiles.includes(
      "apps/game-service/src/domain/room-maintenance.ts",
    ),
    false,
  );
  const maintenanceSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/application/room-maintenance.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(maintenanceSource, /from ["'].+room-store\.js["']/);
  assert.match(maintenanceSource, /\.\/room-maintenance-ports\.js/);
});

test("Rooms application errors do not carry transport status", async () => {
  const applicationSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/application/room-application-error.ts",
    ),
    "utf8",
  );
  const deliverySource = await readFile(
    path.join(repoRoot, "apps/game-service/src/delivery/http/http-app.ts"),
    "utf8",
  );

  assert.doesNotMatch(applicationSource, /statusCode/);
  assert.match(applicationSource, /readonly kind: RoomApplicationErrorKind/);
  assert.match(deliverySource, /roomApplicationStatus\(error\.kind\)/);
});

test("Gameplay application errors do not carry transport status", async () => {
  const applicationSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/application/gameplay-application-error.ts",
    ),
    "utf8",
  );
  const deliverySource = await readFile(
    path.join(repoRoot, "apps/game-service/src/delivery/http/http-app.ts"),
    "utf8",
  );

  assert.doesNotMatch(applicationSource, /statusCode/);
  assert.match(
    applicationSource,
    /readonly kind: GameplayApplicationErrorKind/,
  );
  assert.match(deliverySource, /gameplayApplicationStatus\(error\.kind\)/);
});

test("the game action presenter raises Gameplay application errors", async () => {
  const presenterSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/delivery/game-action-presenter.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(presenterSource, /shared\/service-error\.js/);
  assert.match(presenterSource, /application\/gameplay-application-error\.js/);
});

test("the Gameplay room presenter raises application errors", async () => {
  const presenterSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/delivery/gameplay-room-presenter.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(presenterSource, /shared\/service-error\.js/);
  assert.match(presenterSource, /application\/gameplay-application-error\.js/);
});

test("gameplay recovery errors belong to the Gameplay application", async () => {
  const recoverySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/persistence/legacy-gameplay-recovery.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(recoverySource, /class RecoveryError/);
  assert.match(recoverySource, /application\/gameplay-recovery-error\.js/);
});

test("legacy gameplay snapshot replay belongs to a Gameplay adapter", async () => {
  const recoverySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/persistence/legacy-gameplay-recovery.ts",
    ),
    "utf8",
  );

  assert.match(recoverySource, /export class LegacyGameplayRecovery/);
});

test("legacy gameplay automation scheduling belongs to an Automation adapter", async () => {
  const schedulerSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/automation/adapters/scheduling/legacy-gameplay-automation-scheduler.ts",
    ),
    "utf8",
  );

  assert.match(
    schedulerSource,
    /export class LegacyGameplayAutomationScheduler/,
  );
  assert.match(schedulerSource, /implements AutomationScheduler/);
});

test("legacy gameplay automation executes through an Automation adapter", async () => {
  const executorSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/automation/adapters/execution/legacy-gameplay-automation-executor.ts",
    ),
    "utf8",
  );
  const workerSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/worker-runtime.ts"),
    "utf8",
  );

  assert.match(executorSource, /export class LegacyGameplayAutomationExecutor/);
  assert.doesNotMatch(executorSource, /shared\/service-error\.js/);
  assert.match(executorSource, /application\/automation-execution-error\.js/);
  assert.match(workerSource, /new LegacyGameplayAutomationExecutor/);
});

test("legacy gameplay commands execute through a Gameplay adapter", async () => {
  const executorSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/orchestration/legacy-gameplay-command-executor.ts",
    ),
    "utf8",
  );
  const serverSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/server-runtime.ts"),
    "utf8",
  );

  assert.match(executorSource, /export class LegacyGameplayCommandExecutor/);
  assert.doesNotMatch(executorSource, /shared\/service-error\.js/);
  assert.match(executorSource, /application\/gameplay-application-error\.js/);
  assert.match(serverSource, /new LegacyGameplayCommandExecutor/);
  assert.match(
    serverSource,
    /new SubmitGameplayCommandHandler\(gameplayCommands/,
  );
});

test("gameplay orchestration depends on application behavioral ports", async () => {
  const orchestrationFiles = await collectSourceFiles(
    "apps/game-service/src/contexts/gameplay/adapters/orchestration",
  );
  for (const filename of orchestrationFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(
      source,
      /persistence\/legacy-gameplay-recovery\.js|\.\/legacy-gameplay-automation-scheduler\.js/,
      filename,
    );
  }
  const [recoveryPortSource, schedulerPortSource] = await Promise.all([
    readFile(
      path.join(
        repoRoot,
        "apps/game-service/src/contexts/gameplay/application/gameplay-recovery.ts",
      ),
      "utf8",
    ),
    readFile(
      path.join(
        repoRoot,
        "apps/game-service/src/contexts/automation/application/automation-scheduler.ts",
      ),
      "utf8",
    ),
  ]);
  assert.match(recoveryPortSource, /export interface GameplayRecovery/);
  assert.match(schedulerPortSource, /export interface AutomationScheduler/);
});

test("automation policy belongs to the Automation capability", async () => {
  const automationPolicySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/automation/application/automation-policy.ts",
    ),
    "utf8",
  );
  const gameplayStatusSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/application/gameplay-room-status.ts",
    ),
    "utf8",
  );

  assert.match(automationPolicySource, /export function automationSeatIndex/);
  assert.match(automationPolicySource, /export function phaseTimeoutMs/);
  assert.doesNotMatch(automationPolicySource, /activeRoomStatus/);
  assert.match(gameplayStatusSource, /export function activeRoomStatus/);
});

test("Automation execution errors do not carry transport status", async () => {
  const errorSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/automation/application/automation-execution-error.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(errorSource, /statusCode/);
  assert.match(errorSource, /export class AutomationExecutionError/);
});

test("the web server composes realtime connections without a room coordinator", async () => {
  const connectionsSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/orchestration/legacy-gameplay-connections.ts",
    ),
    "utf8",
  );
  const serverSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/server-runtime.ts"),
    "utf8",
  );

  assert.match(connectionsSource, /export class LegacyGameplayConnections/);
  assert.doesNotMatch(connectionsSource, /shared\/service-error\.js/);
  assert.match(
    connectionsSource,
    /application\/gameplay-application-error\.js/,
  );
  assert.match(serverSource, /new LegacyGameplayConnections/);
  assert.doesNotMatch(serverSource, /new RoomCoordinator/);
});

test("the server entrypoint delegates composition to bootstrap", async () => {
  const entrypointSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/server.ts"),
    "utf8",
  );
  const bootstrapSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/server-runtime.ts"),
    "utf8",
  );

  assert.match(
    entrypointSource,
    /import ["']\.\/bootstrap\/server-runtime\.js["']/,
  );
  assert.doesNotMatch(entrypointSource, /\bnew\s+/);
  assert.match(bootstrapSource, /await buildApp/);
  assert.match(bootstrapSource, /await app\.listen/);
});

test("room projection reads use a dedicated query adapter", async () => {
  const querySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/orchestration/room-projection-query-adapter.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(querySource, /shared\/service-error\.js/);
  assert.match(querySource, /application\/room-application-error\.js/);
  const presenterSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/delivery/lobby-room-presenter.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(presenterSource, /shared\/service-error\.js/);
  assert.match(presenterSource, /application\/room-application-error\.js/);

  assert.match(querySource, /export class RoomProjectionQueryAdapter/);
  assert.match(querySource, /implements RoomProjectionQueries/);
  assert.match(querySource, /ActiveRoomProjectionReader/);
  assert.doesNotMatch(
    querySource,
    /contexts\/gameplay|\.\.\/\.\.\/\.\.\/gameplay/,
  );
});

test("legacy room creation translates Gameplay through an integration adapter", async () => {
  const creationSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/integration/legacy-room-creation-repository.ts",
    ),
    "utf8",
  );

  assert.match(creationSource, /implements RoomCreationRepository/);
  assert.match(creationSource, /gameplay\/adapters\/engine/);
});

test("the PostgreSQL room store is a Rooms persistence adapter", async () => {
  const legacyDomainFiles = await collectSourceFiles(
    "apps/game-service/src/domain",
  );
  assert.equal(
    legacyDomainFiles.includes("apps/game-service/src/domain/room-store.ts"),
    false,
  );
  const adapterSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/persistence/postgres-room-store.ts",
    ),
    "utf8",
  );
  assert.match(adapterSource, /export class PostgresRoomStore/);
  assert.doesNotMatch(adapterSource, /DomainError/);
  assert.doesNotMatch(adapterSource, /shared\/service-error\.js/);
  assert.match(adapterSource, /application\/room-application-error\.js/);
});

test("the automation worker depends on behavioral ports", async () => {
  const workerSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/workers/automation-worker.ts",
    ),
    "utf8",
  );
  const bootstrapSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/worker-runtime.ts"),
    "utf8",
  );

  assert.doesNotMatch(workerSource, /postgres-room-store\.js/);
  assert.doesNotMatch(workerSource, /domain\/room-coordinator\.js/);
  assert.match(workerSource, /export interface AutomationStore/);
  assert.match(workerSource, /export interface AutomationExecutor/);
  assert.doesNotMatch(workerSource, /coordinator/i);
  assert.doesNotMatch(bootstrapSource, /RoomCoordinator/);
});

test("the worker entrypoint delegates composition to bootstrap", async () => {
  const entrypointSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/worker.ts"),
    "utf8",
  );
  const bootstrapSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/worker-runtime.ts"),
    "utf8",
  );

  assert.match(
    entrypointSource,
    /import ["']\.\/bootstrap\/worker-runtime\.js["']/,
  );
  assert.doesNotMatch(entrypointSource, /\bnew\s+/);
  assert.match(bootstrapSource, /new AutomationWorker/);
  assert.match(bootstrapSource, /new RoomMaintenanceWorker/);
});

test("the room maintenance poller belongs to worker delivery", async () => {
  const workerSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/workers/room-maintenance-worker.ts",
    ),
    "utf8",
  );

  assert.match(workerSource, /export interface MaintenanceRunner/);
  assert.match(workerSource, /application\/room-maintenance\.js/);
  assert.doesNotMatch(workerSource, /postgres-room-store\.js/);
});

test("the outbox publisher depends on a behavioral store port", async () => {
  const publisherSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/workers/outbox-publisher.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(publisherSource, /postgres-room-store\.js/);
  assert.match(publisherSource, /export interface OutboxStore/);
  assert.match(publisherSource, /export interface PendingRoomNotification/);
});

test("room change notifications belong to the Rooms application", async () => {
  const notificationSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/application/room-change-notification.ts",
    ),
    "utf8",
  );
  const hubSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/realtime/room-socket-hub.ts",
    ),
    "utf8",
  );
  const publisherSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/workers/outbox-publisher.ts",
    ),
    "utf8",
  );
  const redisAdapterSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/platform/redis/redis-room-change-bus.ts",
    ),
    "utf8",
  );

  assert.match(notificationSource, /export interface RoomChangedNotice/);
  assert.match(notificationSource, /export interface RoomChangePublisher/);
  assert.doesNotMatch(notificationSource, /from ["'](?:redis|zod)["']/);
  assert.match(hubSource, /application\/room-change-notification\.js/);
  assert.match(publisherSource, /application\/room-change-notification\.js/);
  assert.match(redisAdapterSource, /implements RoomChangePublisher/);
  assert.match(redisAdapterSource, /from ["']redis["']/);
});

test("the websocket hub separates snapshot queries from connection mutations", async () => {
  const hubSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/realtime/room-socket-hub.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(hubSource, /domain\/room-coordinator\.js/);
  assert.match(hubSource, /export interface RoomSocketSnapshotQuery/);
  assert.match(hubSource, /export interface RoomSocketConnections/);
  assert.doesNotMatch(hubSource, /RoomSocketCoordinator/);
});

test("the web realtime hook uses React effect events for current callbacks", async () => {
  const realtimeSource = await readFile(
    path.join(
      repoRoot,
      "apps/web/src/features/room/hooks/use-room-realtime.ts",
    ),
    "utf8",
  );

  assert.match(realtimeSource, /useEffectEvent/);
  assert.doesNotMatch(realtimeSource, /optionsRef/);
});

test("the room client loads gameplay UI only after the lobby", async () => {
  const roomClientSource = await readFile(
    path.join(repoRoot, "apps/web/src/features/room/ui/room-client.tsx"),
    "utf8",
  );

  assert.match(roomClientSource, /dynamic\(/);
  assert.match(roomClientSource, /import\(["']\.\/game-table["']\)/);
  assert.doesNotMatch(
    roomClientSource,
    /import \{ GameTable \} from ["']\.\/game-table["']/,
  );
});

test("HTTP v1 delivery depends on application use cases instead of a coordinator", async () => {
  const routesSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/delivery/http/v1-routes.ts"),
    "utf8",
  );

  assert.doesNotMatch(routesSource, /domain\/room-coordinator\.js/);
  assert.doesNotMatch(routesSource, /V1RoomCoordinator/);
  assert.doesNotMatch(routesSource, /player-access\/adapters\/delivery/);
  assert.match(routesSource, /player-access\/application\/player-access\.js/);
  assert.doesNotMatch(routesSource, /infra\/redis-coordination\.js/);
  assert.match(routesSource, /\.\/request-rate-limiter\.js/);
  assert.match(routesSource, /SubmitGameplayCommandHandler/);
});

test("Fastify application assembly belongs to HTTP delivery", async () => {
  const httpAppSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/delivery/http/http-app.ts"),
    "utf8",
  );
  const serviceSourceFiles = await collectSourceFiles("apps/game-service/src");
  const bootstrapSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/server-runtime.ts"),
    "utf8",
  );

  assert.match(httpAppSource, /export async function buildApp/);
  assert.match(httpAppSource, /from ["']fastify["']/);
  assert.equal(
    serviceSourceFiles.includes("apps/game-service/src/app.ts"),
    false,
  );
  assert.match(bootstrapSource, /delivery\/http\/http-app\.js/);
  assert.match(bootstrapSource, /platform\/config\/service-config\.js/);
});

test("service configuration belongs to the platform layer", async () => {
  const configSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/platform/config/service-config.ts",
    ),
    "utf8",
  );
  const serviceSourceFiles = await collectSourceFiles("apps/game-service/src");

  assert.match(configSource, /export function loadConfig/);
  assert.match(configSource, /from ["']zod["']/);
  assert.equal(
    serviceSourceFiles.includes("apps/game-service/src/config.ts"),
    false,
  );
});

test("realtime delivery owns a narrow application runtime contract", async () => {
  const realtimeSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/realtime/realtime-routes.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(realtimeSource, /delivery\/http/);
  assert.match(realtimeSource, /player-access\/application\/player-access\.js/);
  assert.match(realtimeSource, /rooms\/application\/get-room-projection\.js/);
  assert.match(realtimeSource, /interface RealtimeGameRuntime/);
});

test("player access delivery is composed at the service bootstrap boundary", async () => {
  const deliverySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/player-access/adapters/delivery/player-access-service.ts",
    ),
    "utf8",
  );
  const bootstrapSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/bootstrap/player-access.ts"),
    "utf8",
  );

  assert.doesNotMatch(deliverySource, /infra\/database\.js/);
  assert.doesNotMatch(deliverySource, /adapters\/persistence/);
  assert.doesNotMatch(deliverySource, /adapters\/security/);
  assert.doesNotMatch(deliverySource, /shared\/service-error\.js/);
  assert.match(deliverySource, /AuthenticateSession/);
  assert.match(deliverySource, /CreateGuestSession/);
  const applicationSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/player-access/application/player-access.ts",
    ),
    "utf8",
  );
  assert.match(applicationSource, /export class PlayerAccessError/);
  assert.doesNotMatch(applicationSource, /statusCode/);
  assert.match(bootstrapSource, /PostgresPlayerSessionReader/);
  assert.match(bootstrapSource, /PostgresPlayerSessionWriter/);
  assert.match(bootstrapSource, /NodeSessionSecrets/);
});

test("Player Access persistence uses the platform database contract", async () => {
  const persistenceFiles = await collectSourceFiles(
    "apps/game-service/src/contexts/player-access/adapters/persistence",
  );

  for (const filename of persistenceFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /infra\/database\.js/, filename);
    assert.match(source, /platform\/postgres\/database\.js/, filename);
  }
});

test("Gameplay persistence uses the platform database contract", async () => {
  const persistenceFiles = await collectSourceFiles(
    "apps/game-service/src/contexts/gameplay/adapters/persistence",
  );

  for (const filename of persistenceFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /infra\/database\.js/, filename);
  }
  const postgresReader = persistenceFiles.find((filename) =>
    filename.endsWith("postgres-gameplay-snapshot-reader.ts"),
  );
  assert.ok(postgresReader);
  assert.match(
    await readFile(path.join(repoRoot, postgresReader), "utf8"),
    /platform\/postgres\/database\.js/,
  );
});

test("Rooms query persistence uses the platform database contract", async () => {
  const querySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/persistence/postgres-room-query-repository.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(querySource, /infra\/database\.js/);
  assert.match(querySource, /platform\/postgres\/database\.js/);
});

test("Rooms command writing uses the platform database contract", async () => {
  const writerSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/persistence/postgres-room-command-writer.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(writerSource, /infra\/database\.js/);
  assert.match(writerSource, /platform\/postgres\/database\.js/);
});

test("Rooms command persistence uses the platform database contract", async () => {
  const repositorySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/persistence/postgres-room-command-repository.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(repositorySource, /infra\/database\.js/);
  assert.match(repositorySource, /platform\/postgres\/database\.js/);
});

test("Rooms persistence adapters do not use the database compatibility shim", async () => {
  const persistenceFiles = await collectSourceFiles(
    "apps/game-service/src/contexts/rooms/adapters/persistence",
  );

  for (const filename of persistenceFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /infra\/database\.js/, filename);
  }
});

test("Redis room leasing is a Rooms coordination adapter", async () => {
  const leaseSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/coordination/redis-room-lease.ts",
    ),
    "utf8",
  );
  const portSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/application/room-coordination-ports.ts",
    ),
    "utf8",
  );
  assert.match(leaseSource, /export class RedisRoomLease/);
  assert.match(leaseSource, /application\/room-coordination-ports\.js/);
  assert.match(leaseSource, /RoomLeaseBusyError/);
  assert.doesNotMatch(leaseSource, /shared\/service-error\.js/);
  assert.match(portSource, /export class RoomLeaseBusyError/);
  assert.doesNotMatch(portSource, /statusCode/);
});

test("Redis room presence is a Rooms coordination adapter", async () => {
  const presenceSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/coordination/redis-room-presence.ts",
    ),
    "utf8",
  );
  assert.match(presenceSource, /export class RedisRoomPresence/);
  assert.match(presenceSource, /application\/room-coordination-ports\.js/);
});

test("durability integration coverage composes room application handlers", async () => {
  const integrationSource = await readFile(
    path.join(repoRoot, "apps/game-service/test/room-coordinator.test.ts"),
    "utf8",
  );
  const runtimeSource = await readFile(
    path.join(repoRoot, "apps/game-service/test/support/room-test-runtime.ts"),
    "utf8",
  );
  const recoverySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/test/recovery-fuzz.integration.test.ts",
    ),
    "utf8",
  );
  const automationSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/test/room-automation.integration.test.ts",
    ),
    "utf8",
  );

  assert.match(integrationSource, /RoomTestRuntime/);
  assert.doesNotMatch(integrationSource, /new RoomCoordinator/);
  assert.match(runtimeSource, /new CreateRoomHandler/);
  assert.match(runtimeSource, /new ExecuteRoomCommandHandler/);
  assert.match(runtimeSource, /new GetRoomSnapshotHandler/);
  assert.match(recoverySource, /RoomTestRuntime/);
  assert.doesNotMatch(recoverySource, /RoomCoordinator/);
  assert.match(automationSource, /RoomTestRuntime/);
  assert.doesNotMatch(automationSource, /RoomCoordinator/);
});

test("room persistence records are owned by the Rooms application", async () => {
  const portSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/application/room-persistence-store.ts",
    ),
    "utf8",
  );
  const storeSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/persistence/postgres-room-store.ts",
    ),
    "utf8",
  );

  assert.match(portSource, /\.\/room-persistence-model\.js/);
  assert.doesNotMatch(storeSource, /export interface StoredRoom/);
  assert.doesNotMatch(storeSource, /export interface StoredSeat/);
});

test("started room initialization contracts belong to the Rooms application", async () => {
  const portSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/application/started-room-initialization.ts",
    ),
    "utf8",
  );
  const writerSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/persistence/postgres-room-command-writer.ts",
    ),
    "utf8",
  );
  const automationFactorySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/automation/adapters/integration/legacy-started-room-automation-factory.ts",
    ),
    "utf8",
  );
  const snapshotFactorySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/integration/legacy-started-room-snapshot-factory.ts",
    ),
    "utf8",
  );

  assert.match(portSource, /export interface StartedRoomSnapshotFactory/);
  assert.match(portSource, /export interface StartedRoomAutomationFactory/);
  assert.doesNotMatch(
    writerSource,
    /export interface StartedRoom(?:Snapshot|Automation)Factory/,
  );
  assert.match(
    automationFactorySource,
    /implements StartedRoomAutomationFactory/,
  );
  assert.match(snapshotFactorySource, /implements StartedRoomSnapshotFactory/);
});

test("automation adapters depend on an application-owned room store port", async () => {
  const executorSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/automation/adapters/execution/legacy-gameplay-automation-executor.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(executorSource, /postgres-room-store\.js/);
  assert.match(executorSource, /application\/room-persistence-store\.js/);
});

test("the legacy room coordinator is retired", async () => {
  const orchestrationFiles = await collectSourceFiles(
    "apps/game-service/src/contexts/rooms/adapters/orchestration",
  );
  assert.equal(
    orchestrationFiles.includes(
      "apps/game-service/src/contexts/rooms/adapters/orchestration/room-coordinator.ts",
    ),
    false,
  );
});

test("application and domain errors remain transport agnostic", async () => {
  const legacyDomainFiles = await collectSourceFiles(
    "apps/game-service/src/domain",
  );
  assert.deepEqual(legacyDomainFiles, []);
  const sharedFiles = await collectSourceFiles("apps/game-service/src/shared");
  assert.deepEqual(sharedFiles, []);
  const contextFiles = await collectSourceFiles(
    "apps/game-service/src/contexts",
  );
  for (const filename of contextFiles.filter(
    (candidate) =>
      candidate.includes("/application/") || candidate.includes("/domain/"),
  )) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /statusCode/, filename);
  }
});

test("context delivery adapters do not import shared errors", async () => {
  const deliveryFiles = (
    await Promise.all(
      ["gameplay", "player-access", "rooms"].map((context) =>
        collectSourceFiles(
          `apps/game-service/src/contexts/${context}/adapters/delivery`,
        ),
      ),
    )
  ).flat();
  for (const filename of deliveryFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /DomainError/, filename);
    assert.doesNotMatch(source, /shared\/service-error\.js/, filename);
  }
});

test("bootstrap and platform adapters do not import shared errors", async () => {
  const runtimeFiles = (
    await Promise.all(
      ["bootstrap", "platform"].map((directory) =>
        collectSourceFiles(`apps/game-service/src/${directory}`),
      ),
    )
  ).flat();
  for (const filename of runtimeFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /DomainError/, filename);
    assert.doesNotMatch(source, /shared\/service-error\.js/, filename);
  }
});

test("transport delivery owns transport-aware errors", async () => {
  const deliveryFiles = await collectSourceFiles(
    "apps/game-service/src/delivery",
  );
  for (const filename of deliveryFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /DomainError/, filename);
    assert.doesNotMatch(source, /shared\/service-error\.js/, filename);
  }
  const errorSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/delivery/delivery-error.ts"),
    "utf8",
  );
  assert.match(errorSource, /export class DeliveryError/);
  assert.match(errorSource, /readonly statusCode: number/);
});

test("dependency readiness is a platform health adapter", async () => {
  const readinessSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/platform/health/dependency-readiness.ts",
    ),
    "utf8",
  );

  assert.match(readinessSource, /database\.health\(\)/);
  assert.match(readinessSource, /redis\.ping\(\)/);
});

test("Redis connection creation is a platform adapter", async () => {
  const redisSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/platform/redis/redis-client.ts"),
    "utf8",
  );

  assert.match(redisSource, /createClient/);
  assert.match(redisSource, /reconnectStrategy/);
  assert.match(redisSource, /client\.connect\(\)/);
});

test("request rate limiting is a dedicated Redis platform adapter", async () => {
  const rateLimiterSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/platform/redis/request-rate-limiter.ts",
    ),
    "utf8",
  );
  const portSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/delivery/http/request-rate-limiter.ts",
    ),
    "utf8",
  );
  assert.match(rateLimiterSource, /export class RateLimiter/);
  assert.match(rateLimiterSource, /FIXED_WINDOW_INCREMENT_SCRIPT/);
  assert.doesNotMatch(rateLimiterSource, /shared\/service-error\.js/);
  assert.match(portSource, /export class RequestRateLimitError/);
  assert.doesNotMatch(portSource, /statusCode/);
});

test("service metrics belong to platform observability", async () => {
  const metricsSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/platform/observability/service-metrics.ts",
    ),
    "utf8",
  );
  const serviceSourceFiles = await collectSourceFiles("apps/game-service/src");

  assert.match(metricsSource, /export function createMetrics/);
  assert.match(metricsSource, /from ["']prom-client["']/);
  assert.equal(
    serviceSourceFiles.includes("apps/game-service/src/metrics.ts"),
    false,
  );
});

test("Redis service telemetry is a platform observability adapter", async () => {
  const telemetrySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/platform/observability/redis-service-telemetry.ts",
    ),
    "utf8",
  );
  const infraFiles = await collectSourceFiles("apps/game-service/src/infra");

  assert.match(telemetrySource, /class AutomationTelemetry/);
  assert.match(telemetrySource, /class MaintenanceTelemetry/);
  assert.match(telemetrySource, /class WorkerTelemetry/);
  assert.equal(
    infraFiles.includes("apps/game-service/src/infra/redis-coordination.ts"),
    false,
  );
});

test("PostgreSQL connection management is a platform adapter", async () => {
  const databaseSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/platform/postgres/database.ts"),
    "utf8",
  );
  const infraFiles = await collectSourceFiles("apps/game-service/src/infra");

  assert.match(databaseSource, /new Pool/);
  assert.match(databaseSource, /transaction<T>/);
  assert.equal(
    infraFiles.includes("apps/game-service/src/infra/database.ts"),
    false,
  );
});

test("migration tooling uses the platform database adapter", async () => {
  const migrationSource = await readFile(
    path.join(repoRoot, "apps/game-service/scripts/migrate.ts"),
    "utf8",
  );

  assert.doesNotMatch(migrationSource, /infra\/database\.js/);
  assert.match(migrationSource, /platform\/postgres\/database\.js/);
});

test("realtime integration fixtures use the platform database adapter", async () => {
  for (const filename of [
    "realtime-multiclient.integration.test.ts",
    "realtime-store.integration.test.ts",
  ]) {
    const source = await readFile(
      path.join(repoRoot, "apps/game-service/test", filename),
      "utf8",
    );
    assert.doesNotMatch(source, /infra\/database\.js/, filename);
    assert.match(source, /platform\/postgres\/database\.js/, filename);
  }
});

test("worker integration fixtures use the platform database adapter", async () => {
  for (const filename of [
    "room-automation.integration.test.ts",
    "room-maintenance.integration.test.ts",
  ]) {
    const source = await readFile(
      path.join(repoRoot, "apps/game-service/test", filename),
      "utf8",
    );
    assert.doesNotMatch(source, /infra\/database\.js/, filename);
    assert.match(source, /platform\/postgres\/database\.js/, filename);
  }
});

test("durability fixtures use the platform database adapter", async () => {
  for (const filename of [
    "durable-rooms.integration.test.ts",
    "recovery-fuzz.integration.test.ts",
    "room-coordinator.test.ts",
    "support/room-test-runtime.ts",
  ]) {
    const source = await readFile(
      path.join(repoRoot, "apps/game-service/test", filename),
      "utf8",
    );
    assert.doesNotMatch(source, /infra\/database\.js/, filename);
    assert.match(source, /platform\/postgres\/database\.js/, filename);
  }
});
