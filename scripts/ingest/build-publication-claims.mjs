import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLICATION_CLAIMS_BOUNDARY,
  PUBLICATION_CLAIMS_SCHEMA_VERSION,
  validatePublicationClaims,
} from "../../packages/domain/publication-claims.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(process.argv[2] ?? join(repositoryRoot, "data/publications/openai-math.json"));
const curatedDirectory = resolve(process.argv[3] ?? join(repositoryRoot, "data/publications/claims"));
const outputPath = resolve(process.argv[4] ?? join(curatedDirectory, "openai-math-claims.json"));

async function build() {
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  if (!Array.isArray(source.families)) {
    throw new Error(`Source collection ${displayPath(sourcePath)} does not contain a families array.`);
  }

  let entries;
  try {
    entries = await readdir(curatedDirectory);
  } catch (error) {
    throw new Error(`No curated claim inputs found: cannot read ${displayPath(curatedDirectory)} (${error.message}).`);
  }
  const curatedFiles = entries.filter((name) => name.endsWith(".curated.json")).sort();
  if (curatedFiles.length === 0) {
    throw new Error(`No curated claim inputs found in ${displayPath(curatedDirectory)}. Add at least one *.curated.json file.`);
  }

  const familyByNumber = new Map(source.families.map((family) => [family.number, family]));
  const seenFamilies = new Set();
  const families = [];
  const curatedInputs = [];

  for (const name of curatedFiles) {
    const inputPath = join(curatedDirectory, name);
    const curated = JSON.parse(await readFile(inputPath, "utf8"));
    if (!curated || typeof curated !== "object" || Array.isArray(curated)) {
      throw new Error(`${displayPath(inputPath)} must contain a JSON object.`);
    }
    if (curated.schemaVersion !== PUBLICATION_CLAIMS_SCHEMA_VERSION) {
      throw new Error(`${displayPath(inputPath)} schemaVersion must be "${PUBLICATION_CLAIMS_SCHEMA_VERSION}".`);
    }
    const family = familyByNumber.get(curated.familyNumber);
    if (!family) {
      throw new Error(`${displayPath(inputPath)} references family ${JSON.stringify(curated.familyNumber)}, which does not exist in ${displayPath(sourcePath)}.`);
    }
    if (seenFamilies.has(curated.familyNumber)) {
      throw new Error(`${displayPath(inputPath)} duplicates curated claims for family ${curated.familyNumber}.`);
    }
    seenFamilies.add(curated.familyNumber);
    families.push({ familyNumber: family.number, familyTitle: family.title, claims: curated.claims });
    curatedInputs.push(displayPath(inputPath));
  }

  // File names and claim order come from the curated inputs; sorting family
  // numbers keeps the generated artifact stable across filesystem orders.
  families.sort((left, right) => left.familyNumber.localeCompare(right.familyNumber));
  curatedInputs.sort();

  const collection = {
    schemaVersion: PUBLICATION_CLAIMS_SCHEMA_VERSION,
    boundary: PUBLICATION_CLAIMS_BOUNDARY,
    source: {
      collection: source.id,
      repository: source.source.repository,
      revision: source.source.revision,
      releaseDate: source.releaseDate,
      license: source.source.license,
      dataset: displayPath(sourcePath),
      curatedInputs,
    },
    families,
  };

  validatePublicationClaims(collection, { sourceCollection: source });

  await writeFile(outputPath, `${JSON.stringify(collection, null, 2)}\n`);
  console.log(JSON.stringify({
    output: displayPath(outputPath),
    families: collection.families.length,
    claims: collection.families.reduce((count, family) => count + family.claims.length, 0),
  }));
}

function displayPath(path) {
  const fromRoot = relative(repositoryRoot, path);
  if (fromRoot !== "" && !fromRoot.startsWith("..")) return fromRoot.split(sep).join("/");
  return path;
}

build().catch((error) => {
  console.error(`build-publication-claims: ${error.message}`);
  process.exitCode = 1;
});
