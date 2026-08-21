const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizePermissions,isAllowed}=require("./tool-permissions");

test("keeps high-impact tool capabilities disabled by default",()=>{
  const permissions=normalizePermissions();
  assert.equal(permissions.github.read,true);
  assert.equal(permissions.github.write,false);
  assert.equal(permissions.email.send,false);
  assert.equal(permissions.payments.refund,false);
  assert.equal(permissions.marketing.publish,false);
});

test("drops unknown tools and capabilities",()=>{
  const permissions=normalizePermissions({github:{read:false,write:true,delete_repository:true},shell:{execute:true}});
  assert.deepEqual(Object.keys(permissions).sort(),["email","github","marketing","payments"]);
  assert.equal("delete_repository" in permissions.github,false);
  assert.equal(isAllowed(permissions,"github","write"),true);
});
