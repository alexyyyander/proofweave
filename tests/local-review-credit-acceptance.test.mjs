import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { assertLocalReviewAcceptanceContext, runLocalReviewCreditAcceptance, seedLocalAcceptanceCatalog } from '../scripts/lib/local-review-credit-acceptance.mjs';
import { D1VerificationMarketStore } from '../services/verification/d1-verification-market-store.mjs';

const context = {origin:'http://127.0.0.1:12345',syntheticOwner:true,ownerPersonId:'person:acceptance-author',reviewerPersonId:'person:acceptance-reviewer'};
test('local acceptance allows only explicit synthetic HTTP or HTTPS loopback origins', () => {
  for (const origin of ['http://127.0.0.1:12345','https://127.0.0.1:12345','http://[::1]:12345','https://[::1]:12345']) {
    assert.equal(assertLocalReviewAcceptanceContext({...context,origin}),origin);
  }
  for (const origin of ['https://proofweave.org','http://192.0.2.1:8080','https://192.0.2.1:8080','http://proofweave.org','https://localhost:12345','ftp://127.0.0.1:12345','http://user:password@127.0.0.1:12345','https://user:password@[::1]:12345',context.origin+'/api/mcp','https://127.0.0.1:12345/?token=private','https://[::1]:12345/#private']) {
    assert.throws(()=>assertLocalReviewAcceptanceContext({...context,origin}));
  }
  for (const patch of [{syntheticOwner:false},{reviewerPersonId:context.ownerPersonId}]) assert.throws(()=>assertLocalReviewAcceptanceContext({...context,...patch}));
});
test('invalid local acceptance context fails before any Person or Connector request', async () => {
  let calls=0;
  await assert.rejects(runLocalReviewCreditAcceptance({...context,origin:'https://proofweave.org',personRequest:()=>{calls++;},callReviewerTool:()=>{calls++;}}));
  assert.equal(calls,0);
});
test('synthetic catalog seed creates real inspectable D1 target and canonical active pool without Run evidence', async t => {
  const mf = new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-05-22',d1Databases:['DB']});
  t.after(()=>mf.dispose());
  const database=await mf.getD1Database('DB');
  const root=new URL('../drizzle/',import.meta.url);
  for(const name of (await readdir(root)).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort()) {
    const source=await readFile(new URL(name,root),'utf8');
    for(const sql of source.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean)) await database.prepare(sql).run();
  }
  const suffix=randomUUID();const ids={projectId:`project:acceptance:${suffix}`,revisionId:`revision:acceptance:${suffix}`,snapshotId:`snapshot:acceptance:${suffix}`,poolId:`pool:acceptance:${suffix}`,slug:`acceptance-${suffix}`};
  const leanStatement='theorem identity (n : Nat) : n = n := rfl';
  const target={declaration:'ProofweaveAcceptance.identity',leanStatement,leanToolchain:'leanprover/lean4:v4.35.0',mathlibRevision:'none',sourceUrl:`https://example.test/acceptance/${suffix}`,statementHash:`sha256:${createHash('sha256').update(leanStatement).digest('hex')}`};
  await assert.rejects(seedLocalAcceptanceCatalog({database,ids,target}));
  await assert.rejects(seedLocalAcceptanceCatalog({database,ids,target:{...target,statementHash:'sha256:'+'0'.repeat(64)},environment:'isolated_test'}));
  const result=await seedLocalAcceptanceCatalog({database,ids,target,environment:'isolated_test'});
  assert.equal(result.syntheticIdentities,true);
  const market=new D1VerificationMarketStore(database);
  assert.equal(await market.hasInspectablePublicTarget(ids.revisionId),true);
  assert.equal(await market.requirePoolState(ids.poolId),'active');
  assert.ok(await database.prepare('SELECT id FROM catalog_browse WHERE id = ?').bind(ids.revisionId).first());
  assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM runs WHERE attempt_id IN (SELECT id FROM agent_attempts WHERE problem_revision_id = ?)').bind(ids.revisionId).first('count'),0);
  assert.equal(await database.prepare('SELECT COUNT(*) AS count FROM contribution_receipts WHERE problem_revision_id = ?').bind(ids.revisionId).first('count'),0);
});
