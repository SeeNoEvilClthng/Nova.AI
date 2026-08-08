const test=require("node:test");
const assert=require("node:assert/strict");
const {resolveEntitlement,assertGenerationAccess,assertWorkspaceAccess}=require("./entitlements");

test("keeps founder preview usable while Stripe billing is disabled",()=>{const access=resolveEntitlement({billingEnabled:false});assert.equal(access.tier,"preview");assert.equal(access.canGenerate,true);});
test("grants plan rules for an active subscription",()=>{const access=resolveEntitlement({billingEnabled:true,subscription:{tier:"builder",status:"active"}});assert.equal(access.workspaceLimit,5);assert.equal(access.tokenCeiling,500000);});
test("grants a fourteen day trial before requiring payment",()=>{const now=Date.parse("2026-08-01T00:00:00Z"),access=resolveEntitlement({billingEnabled:true,user:{created_at:"2026-07-25T00:00:00Z"},now});assert.equal(access.tier,"trial");assert.equal(access.canGenerate,true);});
test("blocks generation and extra workspaces after entitlement limits",()=>{const expired=resolveEntitlement({billingEnabled:true,user:{created_at:"2026-01-01T00:00:00Z"},now:Date.parse("2026-08-01T00:00:00Z")});assert.throws(()=>assertGenerationAccess(expired),error=>error.status===402);assert.throws(()=>assertWorkspaceAccess({label:"Starter",workspaceLimit:1},1),error=>error.status===402);});
