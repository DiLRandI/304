import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(repositoryRoot, "assets");
const destinationRoot = path.join(
  repositoryRoot,
  "apps/web/public/generated/card-art",
);

await rm(destinationRoot, { force: true, recursive: true });
await mkdir(destinationRoot, { recursive: true });

for (const directory of ["backs/svg", "cards/standard_304/svg", "cards/variant_extras/svg"]) {
  await cp(path.join(sourceRoot, directory), path.join(destinationRoot, directory), {
    recursive: true,
  });
}
