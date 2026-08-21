const defaults={
  github:{read:true,write:false,deploy:false},
  email:{draft:true,send:false},
  payments:{read:true,refund:false,spend:false},
  marketing:{draft:true,publish:false}
};
const allowed=Object.fromEntries(Object.entries(defaults).map(([tool,value])=>[tool,new Set(Object.keys(value))]));

function normalizePermissions(input={}){
  return Object.fromEntries(Object.entries(defaults).map(([tool,base])=>[tool,Object.fromEntries(Object.entries(base).map(([capability,fallback])=>[capability,allowed[tool].has(capability)&&typeof input?.[tool]?.[capability]==="boolean"?input[tool][capability]:fallback]))]));
}
function isAllowed(permissions,tool,capability){return normalizePermissions(permissions)?.[tool]?.[capability]===true}
module.exports={defaults,normalizePermissions,isAllowed};
