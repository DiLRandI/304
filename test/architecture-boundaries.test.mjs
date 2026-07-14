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
const roomCoordinatorFile = path.join(
  repoRoot,
  "apps/game-service/src/contexts/rooms/adapters/orchestration/room-coordinator.ts",
);
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

test("room coordination depends on application-owned lease and presence ports", async () => {
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");

  assert.doesNotMatch(coordinatorSource, /infra\/redis-coordination\.js/);
  assert.match(coordinatorSource, /application\/room-coordination-ports\.js/);
});

test("gameplay recovery errors belong to the Gameplay application", async () => {
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");

  assert.doesNotMatch(coordinatorSource, /class RecoveryError/);
  assert.match(
    coordinatorSource,
    /gameplay\/application\/gameplay-recovery-error\.js/,
  );
});

test("legacy gameplay snapshot replay belongs to a Gameplay adapter", async () => {
  const recoverySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/persistence/legacy-gameplay-recovery.ts",
    ),
    "utf8",
  );
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");

  assert.match(recoverySource, /export class LegacyGameplayRecovery/);
  assert.match(coordinatorSource, /LegacyGameplayRecovery/);
  assert.doesNotMatch(coordinatorSource, /private async recoverLockedRoom/);
});

test("legacy gameplay automation scheduling belongs to a Gameplay adapter", async () => {
  const schedulerSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/gameplay/adapters/orchestration/legacy-gameplay-automation-scheduler.ts",
    ),
    "utf8",
  );
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");

  assert.match(
    schedulerSource,
    /export class LegacyGameplayAutomationScheduler/,
  );
  assert.match(coordinatorSource, /LegacyGameplayAutomationScheduler/);
  assert.doesNotMatch(
    coordinatorSource,
    /private async scheduleNextAutomation/,
  );
  assert.doesNotMatch(
    coordinatorSource,
    /private async scheduleDisconnectGraceJobs/,
  );
});

test("room projection reads use a dedicated query adapter", async () => {
  const querySource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/orchestration/legacy-room-projection-queries.ts",
    ),
    "utf8",
  );
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");

  assert.match(querySource, /export class LegacyRoomProjectionQueries/);
  assert.match(coordinatorSource, /LegacyRoomProjectionQueries/);
  assert.doesNotMatch(coordinatorSource, /private async projectCurrent/);
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
});

test("the automation worker depends on behavioral ports", async () => {
  const workerSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/worker/automation-worker.ts"),
    "utf8",
  );

  assert.doesNotMatch(workerSource, /postgres-room-store\.js/);
  assert.doesNotMatch(workerSource, /domain\/room-coordinator\.js/);
  assert.match(workerSource, /export interface AutomationStore/);
  assert.match(workerSource, /export interface AutomationCoordinator/);
});

test("the outbox publisher depends on a behavioral store port", async () => {
  const publisherSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/realtime/outbox-publisher.ts"),
    "utf8",
  );

  assert.doesNotMatch(publisherSource, /postgres-room-store\.js/);
  assert.match(publisherSource, /export interface OutboxStore/);
  assert.match(publisherSource, /export interface PendingRoomNotification/);
});

test("the websocket hub separates snapshot queries from connection mutations", async () => {
  const hubSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/realtime/room-socket-hub.ts"),
    "utf8",
  );

  assert.doesNotMatch(hubSource, /domain\/room-coordinator\.js/);
  assert.match(hubSource, /export interface RoomSocketSnapshotQuery/);
  assert.match(hubSource, /export interface RoomSocketConnections/);
  assert.doesNotMatch(hubSource, /RoomSocketCoordinator/);
});

test("the v1 routes depend on application use cases instead of a coordinator", async () => {
  const routesSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/routes/v1.ts"),
    "utf8",
  );

  assert.doesNotMatch(routesSource, /domain\/room-coordinator\.js/);
  assert.doesNotMatch(routesSource, /V1RoomCoordinator/);
  assert.match(routesSource, /SubmitGameplayCommandHandler/);
});

test("room persistence records are owned by the Rooms application", async () => {
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");
  const storeSource = await readFile(
    path.join(
      repoRoot,
      "apps/game-service/src/contexts/rooms/adapters/persistence/postgres-room-store.ts",
    ),
    "utf8",
  );

  assert.match(coordinatorSource, /application\/room-persistence-model\.js/);
  assert.doesNotMatch(storeSource, /export interface StoredRoom/);
  assert.doesNotMatch(storeSource, /export interface StoredSeat/);
});

test("the room coordinator depends on an application-owned store port", async () => {
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");

  assert.doesNotMatch(coordinatorSource, /postgres-room-store\.js/);
  assert.match(coordinatorSource, /application\/room-coordinator-store\.js/);
});

test("room coordination belongs to a Rooms orchestration adapter", async () => {
  const legacyDomainFiles = await collectSourceFiles(
    "apps/game-service/src/domain",
  );
  assert.equal(
    legacyDomainFiles.includes(
      "apps/game-service/src/domain/room-coordinator.ts",
    ),
    false,
  );
  const coordinatorSource = await readFile(roomCoordinatorFile, "utf8");
  assert.match(coordinatorSource, /export class RoomCoordinator/);
  assert.doesNotMatch(coordinatorSource, /DomainError/);
});

test("transport-aware service errors are not modeled as domain code", async () => {
  const legacyDomainFiles = await collectSourceFiles(
    "apps/game-service/src/domain",
  );
  assert.deepEqual(legacyDomainFiles, []);
  const errorSource = await readFile(
    path.join(repoRoot, "apps/game-service/src/shared/service-error.ts"),
    "utf8",
  );
  assert.match(errorSource, /readonly statusCode: number/);
  assert.match(errorSource, /export class ServiceError/);
  const serviceFiles = await collectSourceFiles("apps/game-service/src");
  for (const filename of serviceFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /DomainError/, filename);
  }
});

test("delivery adapters use the shared service error name", async () => {
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
  }
});

test("runtime adapters use the shared service error name", async () => {
  const runtimeFiles = (
    await Promise.all(
      ["infra", "realtime"].map((directory) =>
        collectSourceFiles(`apps/game-service/src/${directory}`),
      ),
    )
  ).flat();
  for (const filename of runtimeFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /DomainError/, filename);
  }
});

test("HTTP delivery uses the shared service error name", async () => {
  const deliveryFiles = [
    "apps/game-service/src/app.ts",
    ...(await collectSourceFiles("apps/game-service/src/routes")),
  ];
  for (const filename of deliveryFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    assert.doesNotMatch(source, /DomainError/, filename);
  }
});
