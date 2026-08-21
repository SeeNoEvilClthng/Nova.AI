import express from "express";
import crypto from "node:crypto";
import {start,getRun,resumeHook} from "workflow/api";
import {novaMissionWorkflow} from "../workflows/nova-mission.js";
import legacyApp from "../server.js";
import supabase from "../supabase.js";
import database from "../database.js";
import toolPermissions from "../tool-permissions.js";
import {getToken} from "@vercel/connect";

type MissionRecord={id:string;runId:string;workspaceId:string;objective:string;approvalToken:string;status:string;createdAt:string;updatedAt:string};
const app=express();
const json=express.json({limit:"32kb"});

async function workspaceFor(req:express.Request,id:string){return supabase.configured()?await supabase.getWorkspace(req,id):database.getWorkspace(id)}
async function saveWorkspace(req:express.Request,id:string,state:Record<string,unknown>){return supabase.configured()?await supabase.saveWorkspace(req,id,state):database.saveWorkspace(id,state)}
function missionList(workspace:any):MissionRecord[]{return Array.isArray(workspace?.state?.durableMissions)?workspace.state.durableMissions:[]}
function metaConfig(platform:string){const graphVersion=String(process.env.META_GRAPH_VERSION||"v26.0").trim();if(!/^v\d+\.\d+$/.test(graphVersion))return null;const pageId=String(process.env.META_FACEBOOK_PAGE_ID||"").trim();if(platform==="facebook")return process.env.VERCEL_CONNECT_FACEBOOK_CONNECTOR&&pageId?{connector:process.env.VERCEL_CONNECT_FACEBOOK_CONNECTOR,graphVersion,pageId,accountId:pageId}:null;if(platform==="instagram"){const accessToken=String(process.env.INSTAGRAM_ACCESS_TOKEN||"").trim(),accountId=String(process.env.META_INSTAGRAM_USER_ID||"").trim(),username=String(process.env.META_INSTAGRAM_USERNAME||"").trim().replace(/^@/,"").toLowerCase();return accessToken?{accessToken,graphVersion,accountId,username}:null}return null}
async function metaPageToken(userToken:string,pageId:string,graphVersion:string){const response=await fetch(`https://graph.facebook.com/${graphVersion}/me/accounts?fields=id,access_token&limit=100`,{headers:{Authorization:`Bearer ${userToken}`}}),result:any=await response.json();if(!response.ok)throw new Error(result?.error?.message||"Meta rejected the connected account");const page=(result.data||[]).find((item:any)=>String(item.id)===pageId);if(!page?.access_token)throw new Error("The connected Meta account does not manage the configured Facebook Page");return page.access_token}
async function publishMeta(platform:string,campaign:any,userId:string){const meta:any=metaConfig(platform);if(!meta)throw Object.assign(new Error(`Finish the ${platform} connection settings before publishing`),{status:503});if(!/^https:\/\//.test(String(campaign.mediaUrl||"")))throw Object.assign(new Error("Approve this content again to prepare its public graphic"),{status:409});if(platform==="facebook"){const userToken=await getToken(meta.connector,{subject:{type:"user",id:userId}}),pageToken=await metaPageToken(userToken,meta.pageId,meta.graphVersion),base=`https://graph.facebook.com/${meta.graphVersion}`,body=new URLSearchParams({url:campaign.mediaUrl,caption:String(campaign.caption||"").slice(0,5000),access_token:pageToken}),response=await fetch(`${base}/${meta.pageId}/photos`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body}),result:any=await response.json();if(!response.ok)throw new Error(result?.error?.message||"Facebook rejected the approved post");return String(result.post_id||result.id||"")}
  const base=`https://graph.instagram.com/${meta.graphVersion}`,headers={Authorization:`Bearer ${meta.accessToken}`},identityResponse=await fetch(`${base}/me?fields=user_id,username`,{headers}),identity:any=await identityResponse.json();if(!identityResponse.ok)throw new Error(identity?.error?.message||"Instagram rejected the saved access token");const accountId=String(meta.accountId||identity.user_id||identity.id||"");if(!accountId)throw new Error("Instagram did not return a professional account ID");if(meta.username&&String(identity.username||"").toLowerCase()!==meta.username)throw new Error(`The saved Instagram token belongs to @${identity.username||"another account"}, not @${meta.username}`);const createBody=new URLSearchParams({image_url:campaign.mediaUrl,caption:String(campaign.caption||"").slice(0,2200),is_ai_generated:"true"}),createResponse=await fetch(`${base}/${accountId}/media`,{method:"POST",headers:{...headers,"Content-Type":"application/x-www-form-urlencoded"},body:createBody}),created:any=await createResponse.json();if(!createResponse.ok||!created.id)throw new Error(created?.error?.message||"Instagram could not prepare the approved post");const publishBody=new URLSearchParams({creation_id:String(created.id)}),publishResponse=await fetch(`${base}/${accountId}/media_publish`,{method:"POST",headers:{...headers,"Content-Type":"application/x-www-form-urlencoded"},body:publishBody}),published:any=await publishResponse.json();if(!publishResponse.ok)throw new Error(published?.error?.message||"Instagram rejected the approved post");return String(published.id||"")
}
const connectionCatalog=[
  {id:"github",name:"GitHub",purpose:"Repositories, branches, and pull requests",connectorEnv:"VERCEL_CONNECT_GITHUB_CONNECTOR",capabilities:["read","write","deploy"]},
  {id:"email",name:"Email",purpose:"Draft and send founder-approved messages",connectorEnv:"VERCEL_CONNECT_EMAIL_CONNECTOR",capabilities:["draft","send"]},
  {id:"payments",name:"Stripe",purpose:"Revenue visibility, refunds, and spending",connectorEnv:"STRIPE_SECRET_KEY",capabilities:["read","refund","spend"]},
  {id:"marketing",name:"Marketing",purpose:"Draft and publish campaigns",connectorEnv:"VERCEL_CONNECT_MARKETING_CONNECTOR",capabilities:["draft","publish"]}
];

app.post("/api/durable-missions",json,async(req,res)=>{
  try{
    const workspaceId=String(req.body.workspaceId||"").trim(),objective=String(req.body.objective||"").trim().slice(0,1200),workspace=await workspaceFor(req,workspaceId);
    if(!workspace)return res.status(404).json({error:"Workspace not found"});
    if(objective.length<12)return res.status(400).json({error:"Give the durable mission a specific outcome"});
    const id=crypto.randomUUID(),run=await start(novaMissionWorkflow,[{missionId:id,workspaceId,company:workspace.name,objective}]),now=new Date().toISOString();
    const mission:MissionRecord={id,runId:run.runId,workspaceId,objective,approvalToken:`nova-mission:${id}:approval`,status:"running",createdAt:now,updatedAt:now};
    const state={...(workspace.state||{}),durableMissions:[mission,...missionList(workspace)].slice(0,30)};await saveWorkspace(req,workspaceId,state);
    return res.status(201).json({mission});
  }catch(error:any){return res.status(error.status||500).json({error:error.message||"Mission could not start"})}
});

app.get("/api/durable-missions",async(req,res)=>{
  try{
    const workspaceId=String(req.query.workspace||""),workspace=await workspaceFor(req,workspaceId);if(!workspace)return res.status(404).json({error:"Workspace not found"});
    const missions=await Promise.all(missionList(workspace).map(async mission=>{try{const run=getRun(mission.runId),status=await run.status;return {...mission,status,updatedAt:new Date().toISOString()}}catch{return {...mission,status:"unavailable"}}}));
    return res.json({missions});
  }catch(error:any){return res.status(error.status||500).json({error:error.message||"Missions could not load"})}
});

app.post("/api/durable-missions/:id/decision",json,async(req,res)=>{
  try{
    const workspaceId=String(req.body.workspaceId||""),workspace=await workspaceFor(req,workspaceId);if(!workspace)return res.status(404).json({error:"Workspace not found"});
    const mission=missionList(workspace).find(item=>item.id===req.params.id);if(!mission)return res.status(404).json({error:"Mission not found"});
    const approved=req.body.approved===true,comment=String(req.body.comment||"").trim().slice(0,500),result=await resumeHook(mission.approvalToken,{approved,comment});
    mission.status=approved?"resuming":"rejected";mission.updatedAt=new Date().toISOString();await saveWorkspace(req,workspaceId,{...(workspace.state||{}),durableMissions:missionList(workspace)});
    return res.json({resumed:true,runId:result.runId,mission});
  }catch(error:any){return res.status(error.status||409).json({error:"The approval checkpoint is not ready yet. Wait a moment and try again."})}
});

app.get("/api/tool-connections",async(req,res)=>{
  try{const workspaceId=String(req.query.workspace||""),workspace=await workspaceFor(req,workspaceId);if(!workspace)return res.status(404).json({error:"Workspace not found"});const permissions=toolPermissions.normalizePermissions(workspace.state?.toolPermissions);return res.json({connections:connectionCatalog.map(item=>({id:item.id,name:item.name,purpose:item.purpose,configured:Boolean(process.env[item.connectorEnv]),capabilities:Object.fromEntries(item.capabilities.map(capability=>[capability,permissions[item.id][capability]]))}))})}catch(error:any){return res.status(error.status||500).json({error:error.message||"Connections could not load"})}
});

app.patch("/api/tool-connections/permissions",json,async(req,res)=>{
  try{const workspaceId=String(req.body.workspaceId||""),workspace=await workspaceFor(req,workspaceId);if(!workspace)return res.status(404).json({error:"Workspace not found"});const permissions=toolPermissions.normalizePermissions(req.body.permissions),state={...(workspace.state||{}),toolPermissions:permissions};await saveWorkspace(req,workspaceId,state);return res.json({permissions})}catch(error:any){return res.status(error.status||500).json({error:error.message||"Permissions could not be saved"})}
});

app.post("/api/tool-connections/github/verify",json,async(req,res)=>{
  try{const workspaceId=String(req.body.workspaceId||""),workspace=await workspaceFor(req,workspaceId);if(!workspace)return res.status(404).json({error:"Workspace not found"});const connector=process.env.VERCEL_CONNECT_GITHUB_CONNECTOR;if(!connector)return res.status(503).json({error:"Add a GitHub connector to Vercel Connect first"});const token=await getToken(connector,{subject:{type:"app"}}),response=await fetch("https://api.github.com/installation/repositories?per_page=1",{headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"}});if(!response.ok)return res.status(502).json({error:"GitHub rejected the scoped connection"});const data:any=await response.json();return res.json({connected:true,repositories:Number(data.total_count||0),scope:"GitHub App installation"})}catch(error:any){return res.status(error.status||502).json({error:error.message||"GitHub connection could not be verified"})}
});

app.get("/api/reseller/social/status",async(req,res)=>{
  try{const workspaceId=String(req.query.workspace||""),workspace=await workspaceFor(req,workspaceId);if(!workspace)return res.status(404).json({error:"Workspace not found"});const permissions=toolPermissions.normalizePermissions(workspace.state?.toolPermissions),facebookReady=Boolean(metaConfig("facebook")),instagramReady=Boolean(metaConfig("instagram"));return res.json({publishAllowed:permissions.marketing.publish,networks:[{id:"x",name:"X",configured:Boolean(process.env.VERCEL_CONNECT_X_CONNECTOR),publishing:true},{id:"facebook",name:"Facebook",configured:facebookReady,publishing:facebookReady,reason:"Connect Meta and add the Page settings"},{id:"instagram",name:"Instagram",configured:instagramReady,publishing:instagramReady,reason:"Connect Meta and add the professional account settings"}]})}catch(error:any){return res.status(error.status||500).json({error:error.message||"Social connections could not load"})}
});

app.post("/api/reseller/social/publish",json,async(req,res)=>{
  try{
    const workspaceId=String(req.body.workspaceId||""),campaignId=String(req.body.campaignId||""),platform=String(req.body.platform||""),workspace=await workspaceFor(req,workspaceId);if(!workspace)return res.status(404).json({error:"Workspace not found"});
    const permissions=toolPermissions.normalizePermissions(workspace.state?.toolPermissions);if(!permissions.marketing.publish)return res.status(403).json({error:"Enable Marketing publish permission in Connections before posting"});
    const campaigns=Array.isArray(workspace.state?.resellerStudio?.contentCampaigns)?workspace.state.resellerStudio.contentCampaigns:[],campaign=campaigns.find((item:any)=>item.id===campaignId);if(!campaign)return res.status(404).json({error:"Content item not found"});if(!["approved","published"].includes(campaign.status))return res.status(409).json({error:"Approve this content before publishing"});if(!Array.isArray(campaign.platforms)||!campaign.platforms.includes(platform))return res.status(400).json({error:"This network is not selected for the content"});if(!["x","facebook","instagram"].includes(platform))return res.status(400).json({error:"This social network is not supported"});if((campaign.receipts||[]).some((item:any)=>item.platform===platform))return res.status(409).json({error:`This content has already been published to ${platform}`});
    const user=supabase.configured()?await supabase.verifyUser(req):null;if(!user?.id)return res.status(401).json({error:"A signed-in account is required for social publishing"});let postId="";if(platform==="x"){const connector=process.env.VERCEL_CONNECT_X_CONNECTOR;if(!connector)return res.status(503).json({error:"Connect an X account before publishing"});const token=await getToken(connector,{subject:{type:"user",id:user.id}}),response=await fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({text:String(campaign.caption||"").slice(0,280),made_with_ai:true})}),result:any=await response.json();if(!response.ok)return res.status(502).json({error:result?.detail||result?.title||"X rejected the approved post"});postId=String(result.data?.id||"")}else postId=await publishMeta(platform,campaign,user.id);
    const publishedAt=new Date().toISOString();campaign.receipts=[...(campaign.receipts||[]),{platform,postId:postId||null,publishedAt}];campaign.status=campaign.platforms.every((network:string)=>campaign.receipts.some((item:any)=>item.platform===network))?"published":"approved";if(campaign.status==="published")campaign.publishedAt=publishedAt;await saveWorkspace(req,workspaceId,{...(workspace.state||{}),resellerStudio:{...(workspace.state?.resellerStudio||{}),contentCampaigns:campaigns}});return res.json({published:true,platform,postId:postId||null,campaign});
  }catch(error:any){return res.status(error.status||502).json({error:error.message||"Approved content could not be published"})}
});

app.use(legacyApp);
export default app;
