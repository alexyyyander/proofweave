import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { createRemoteLibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { loadEnvironmentFile } from "./lib/environment-file.mjs";

const git = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
export const oddSumTargetId = "problem-revision:proofweave:odd-sum-square:1";
export const oddSumTargetSlug = "odd-sum-square";
const snapshotId = "snapshot:proofweave:odd-sum-square:1";
const projectId = "project:proofweave:odd-sum-square";
const declarationId = "declaration:proofweave:odd-sum-square:1";
const poolId = "pool:proofweave:odd-sum-square:practice-v1";
const mathlibRevision = "9a9483a92959bc92bd6a60176dd1fe597298c1f8";
const names = ["OddSum.lean", "lean-toolchain", "lakefile.toml", "lake-manifest.json", "LICENSE", "README.md", ".gitignore"];
const claims = ["bundle_reproducible", "kernel_accepted", "statement_faithful", "novelty_reviewed", "project_accepted"];

export async function prepareOddSumIntake({ sourceCommit, verifyCommittedFiles = true, now = new Date().toISOString() }) {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) throw new Error("Supply the full pushed source commit.");
  const files = {};
  for (const name of names) {
    const bytes = await readFile(new URL(`../examples/odd-sum-square/${name}`, import.meta.url));
    if (verifyCommittedFiles) {
      const committed = (await git("git", ["show", `${sourceCommit}:examples/odd-sum-square/${name}`], { cwd: root, encoding: "buffer" })).stdout;
      if (!bytes.equals(committed)) throw new Error(`The selected commit differs from the local example: ${name}`);
    }
    files[name] = bytes;
  }
  const lean = files["OddSum.lean"].toString("utf8");
  if (files["lean-toolchain"].toString("utf8").trim() !== "leanprover/lean4:v4.31.0") throw new Error("The example must use Lean 4.31.0.");
  if (!lean.includes("theorem oddSum_eq_square (n : Nat) : oddSum n = n * n := by") || /\bsorry\b/.test(lean)) throw new Error("The bounded example declaration is missing or contains sorry.");
  const fileHashes = Object.fromEntries(names.map((name) => [name, sha(files[name])]));
  const contentHash = fileHashes["OddSum.lean"];
  const manifestHash = await sha256Canonical({ sourceCommit, files: fileHashes });
  const sourceUrl = `https://github.com/alexyyyander/proofweave/tree/${sourceCommit}/examples/odd-sum-square`;
  const declarationLine = lean.split("\n").findIndex((line) => line.startsWith("theorem oddSum_eq_square")) + 1;
  const declarationEnd = lean.split("\n").findIndex((line) => line.startsWith("#print axioms")) - 1;
  const statements = [];
  const insert = (table, columns, args) => statements.push({ sql: `INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, args });
  insert("source_snapshots", ["id","upstream_name","source_url","revision_tag","revision_commit","retrieved_at","content_hash","manifest_hash","source_license","lean_toolchain","mathlib_revision"],
    [snapshotId,"Proofweave classical practice",sourceUrl,"odd-sum-square-lean4.31.0",sourceCommit,now,contentHash,manifestHash,"Apache-2.0; classical identity; no mathematical novelty claimed.","leanprover/lean4:v4.31.0",mathlibRevision]);
  insert("projects", ["id","slug","kind","title","summary","visibility"],
    [projectId,"proofweave-odd-sum-square","practice","Sum of the first positive odd numbers","A classical identity used to test a small, reproducible contribution. The proof uses Lean Core; the approved image also contains pinned Mathlib. Local compilation, Runner evidence, independent review, and attribution remain separate.","public"]);
  insert("problem_revisions", ["id","project_id","source_snapshot_id","target_key","slug","revision_number","title","domain","research_status","informal_statement","lean_statement","source_correspondence","proof_state","priority"],
    [oddSumTargetId,projectId,snapshotId,"odd-sum-square",oddSumTargetSlug,1,"The first n positive odd numbers sum to n²","Elementary number theory","research_solved","For every natural number n, the sum 1 + 3 + ... + (2n - 1) equals n². This is a classical identity, not a new mathematical result.",lean,"imported_unreviewed","proved",5]);
  insert("declarations", ["id","problem_revision_id","qualified_name","declaration_kind","source_path","source_url","source_line_start","source_line_end","source_content_hash","is_primary"],
    [declarationId,oddSumTargetId,"ProofweaveJourney.oddSum_eq_square","theorem","OddSum.lean",`${sourceUrl.replace("/tree/","/blob/")}/OddSum.lean#L${declarationLine}-L${declarationEnd}`,declarationLine,declarationEnd,contentHash,1]);
  for (const claim of claims) insert("verification_claims", ["id","problem_revision_id","claim_type","status","evidence_url","recorded_at"],
    [`claim:odd-sum-square:${claim}`,oddSumTargetId,claim,"not_submitted",null,now]);
  insert("problem_subjects", ["problem_revision_id","subject_id","is_primary"], [oddSumTargetId,"subject:ams-11",1]);
  insert("catalog_imports", ["id","source_snapshot_id","input_hash","imported_at","record_count"], ["import:proofweave:odd-sum-square:1",snapshotId,manifestHash,now,1]);
  insert("problem_credit_pools", ["id","problem_revision_id","policy_version","unit","total_credits","sponsor_label","created_at"],
    [poolId,oddSumTargetId,"pw-credit-market-v1","non_transferable_research_credit",100,"Proofweave classical practice; non-financial",now]);
  const created = { protocolVersion:"pw-credit-pool-event-v1",poolId,problemRevisionId:oddSumTargetId,policyVersion:"pw-credit-market-v1",unit:"non_transferable_research_credit",totalCredits:100,sponsorLabel:"Proofweave classical practice; non-financial",sequence:1,eventType:"created",occurredAt:now };
  const activated = { protocolVersion:"pw-credit-pool-event-v1",poolId,sequence:2,eventType:"activated",occurredAt:now };
  for (const event of [created,activated]) insert("problem_credit_pool_events", ["id","pool_id","sequence","event_type","payload_hash","canonical_payload","occurred_at","created_at"],
    [`pool-event:odd-sum-square:${event.eventType}`,poolId,event.sequence,event.eventType,await sha256Canonical(event),canonicalJson(event),now,now]);
  return { sourceCommit,slug:oddSumTargetSlug,problemRevisionId:oddSumTargetId,sourceUrl,contentHash,manifestHash,fileHashes,environment:{leanToolchain:"leanprover/lean4:v4.31.0",mathlibRevision},reviewPool:{id:poolId,state:"active",financial:false},statements };
}

export async function applyOddSumIntake(database, intake) {
  const existing = await database.prepare("SELECT s.revision_commit,s.content_hash,s.manifest_hash FROM problem_revisions p JOIN source_snapshots s ON s.id=p.source_snapshot_id WHERE p.slug=?").bind(oddSumTargetSlug).first();
  if (existing) {
    if (existing.revision_commit !== intake.sourceCommit || existing.content_hash !== intake.contentHash || existing.manifest_hash !== intake.manifestHash) throw new Error("The existing target pins different source bytes; no records were changed.");
    return { created:false,slug:oddSumTargetSlug,problemRevisionId:oddSumTargetId };
  }
  await database.batch(intake.statements.map(({sql,args})=>database.prepare(sql).bind(...args)));
  const verified = await database.prepare("SELECT p.id,s.revision_commit,d.source_content_hash FROM problem_revisions p JOIN source_snapshots s ON s.id=p.source_snapshot_id JOIN declarations d ON d.problem_revision_id=p.id WHERE p.slug=? AND d.is_primary=1").bind(oddSumTargetSlug).first();
  if (verified?.id !== oddSumTargetId || verified?.revision_commit !== intake.sourceCommit || verified?.source_content_hash !== intake.contentHash) throw new Error("Target read-back did not match the pinned source.");
  return { created:true,slug:oddSumTargetSlug,problemRevisionId:oddSumTargetId };
}

function sha(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const sourceCommit = args[args.indexOf("--source-commit")+1];
  const apply = args.includes("--apply");
  try {
    const intake = await prepareOddSumIntake({sourceCommit});
    if (!apply) console.log(JSON.stringify({...intake,mutatesDatabase:false},null,2));
    else {
      const envPath = args[args.indexOf("--env-file")+1];
      if (!args.includes("--env-file") || !envPath) throw new Error("Apply requires an explicit ignored operator environment file.");
      await loadEnvironmentFile(envPath);
      const database = createRemoteLibsqlD1Database({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
      try { console.log(JSON.stringify(await applyOddSumIntake(database,intake))); }
      finally { database.close(); }
    }
  } catch(error) { console.error(error instanceof Error ? error.message : "The intake failed."); process.exitCode=1; }
}
