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
  const scriptKind = filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
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
          specifier === domainPackage || specifier.startsWith(`${domainPackage}/`),
      ),
      false,
      `${normalized} must consume wire projections instead of ${specifier}`,
    );
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
  ]) {
    assert.match(documentation, new RegExp(requiredText));
  }

  const files = (
    await Promise.all(sourceRoots.map((root) => collectSourceFiles(root)))
  ).flat();
  const knownFiles = new Set(files.map((filename) => path.normalize(filename)));
  const graph = new Map();

  for (const filename of knownFiles) {
    const source = await readFile(path.join(repoRoot, filename), "utf8");
    const imports = importsOf(source, filename);
    imports.forEach((specifier) => assertAllowedImport(filename, specifier));
    graph.set(
      filename,
      imports
        .map((specifier) => resolveRelativeImport(filename, specifier, knownFiles))
        .filter(Boolean),
    );
  }

  assertAcyclic(graph);
});
