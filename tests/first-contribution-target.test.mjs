import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { applyProofweaveMigrations, loadProofweaveMigrations } from "../services/database/libsql-migrations.mjs";
import { prepareOddSumIntake, applyOddSumIntake, oddSumTargetId } from "../scripts/seed-first-contribution-target.mjs";

test("the classical target is pinned, retry-safe, and never gains verification from intake", async(t)=>{
  const database=new LibsqlD1Database(createClient({url:"file::memory:"}));
  t.after(()=>database.close());
  await applyProofweaveMigrations({database,migrations:await loadProofweaveMigrations()});
  const intake=await prepareOddSumIntake({sourceCommit:"a".repeat(40),verifyCommittedFiles:false,now:"2026-10-13T09:00:00.000Z"});
  assert.equal((await applyOddSumIntake(database,intake)).created,true);
  assert.equal((await applyOddSumIntake(database,intake)).created,false);
  assert.equal(await database.prepare("SELECT count(*) AS n FROM verification_claims WHERE problem_revision_id=? AND status='not_submitted'").bind(oddSumTargetId).first("n"),5);
  assert.equal(await database.prepare("SELECT count(*) AS n FROM contribution_receipts").first("n"),0);
  const target=await database.prepare("SELECT p.research_status,pr.kind,s.lean_toolchain,s.mathlib_revision FROM problem_revisions p JOIN projects pr ON pr.id=p.project_id JOIN source_snapshots s ON s.id=p.source_snapshot_id WHERE p.id=?").bind(oddSumTargetId).first();
  assert.deepEqual(target,{research_status:"research_solved",kind:"practice",lean_toolchain:"leanprover/lean4:v4.31.0",mathlib_revision:intake.environment.mathlibRevision});
  await assert.rejects(applyOddSumIntake(database,{...intake,sourceCommit:"b".repeat(40)}),/different source bytes/);
  assert.equal(await database.prepare("SELECT count(*) AS n FROM problem_revisions WHERE id=?").bind(oddSumTargetId).first("n"),1);
});
