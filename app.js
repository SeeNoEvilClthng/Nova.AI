const agents = [
  ["Founder Agent", "Defines the customer, offer, pricing and launch priorities.", "✦"],
  ["Research Agent", "Validates competitors, demand and risky assumptions.", "⌕"],
  ["Builder Agent", "Turns the approved plan into a launch-ready experience.", "⌘"],
  ["Marketing Agent", "Creates positioning, launch content and experiments.", "↗"],
  ["Reviewer Agent", "Independently challenges quality, evidence and safety.", "✓"],
  ["Analytics Agent", "Measures results and recommends the next best action.", "◫"]
];
let state = { plan: null, approved: false, activities: [] };
let currentWorkspaceId = null;
let workspaces = [];
let currentWorkspaceName = "New venture";
let onboardingStep = 0;
let draftSaveTimer = null;
let publishingLeads = [];
let publishingPage = null;
let leadFilter = "all";
let selectedRunIndex = 0;
let officeBusy = null;
const onboardingSteps = [
  {eyebrow:"WELCOME TO NOVA.AI",title:"Build your company one approved step at a time.",text:"Nova.Ai turns a rough business idea into a focused launch plan while keeping every important decision under your control.",points:["Describe the idea","Review the strategy","Approve each launch step"]},
  {eyebrow:"YOUR SUPERVISED TEAM",title:"Specialized agents do the work. You make the calls.",text:"The Founder Agent builds the strategy, the Reviewer challenges assumptions, and the Builder prepares a launch page. Nothing publishes without approval.",points:["Founder Agent","Independent review","Human approval"]},
  {eyebrow:"YOUR FIRST MILESTONE",title:"Start with one clear customer and one painful problem.",text:"A focused brief produces a stronger plan. You can request revisions, collect customer evidence, and refine the launch before sharing it publicly.",points:["About 2 minutes","Free demo engine","Editable results"]}
];

const $ = (id) => document.getElementById(id);
const titles = {home:"Mission Control",builder:"Business Builder",studio:"Launch Studio",validation:"Customer Validation",team:"AI Team",office:"AI Office",approvals:"Approvals",usage:"AI Activity",billing:"Billing & plans",settings:"Settings"};
function show(view){document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===view));document.querySelectorAll(".nav-item").forEach(v=>{const active=v.dataset.view===view;v.classList.toggle("active",active);if(active)v.setAttribute("aria-current","page");else v.removeAttribute("aria-current")});$("pageTitle").textContent=titles[view];if(view==="billing"&&window.loadBilling)window.loadBilling();if(view==="validation"&&window.loadValidation)window.loadValidation();if(view==="studio"&&window.loadPublishing)window.loadPublishing();if(view==="settings")loadSettings();window.scrollTo(0,0)}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>show(b.dataset.view));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>show(b.dataset.go));

const commandItems=[...document.querySelectorAll(".nav-item[data-view]")].map(button=>({view:button.dataset.view,title:button.querySelector("strong")?.textContent||titles[button.dataset.view],description:button.querySelector("em")?.textContent||"Open page",icon:button.querySelector(".nav-icon")?.textContent||"→"}));
let commandSelection=0,visibleCommands=[...commandItems];
function renderCommandMenu(query=""){
  const term=query.trim().toLowerCase();visibleCommands=commandItems.filter(item=>!term||`${item.title} ${item.description}`.toLowerCase().includes(term));commandSelection=Math.min(commandSelection,Math.max(0,visibleCommands.length-1));
  $("commandResults").innerHTML=visibleCommands.length?visibleCommands.map((item,index)=>`<button type="button" role="option" aria-selected="${index===commandSelection}" class="${index===commandSelection?"selected":""}" data-command-view="${escapeHtml(item.view)}"><span>${escapeHtml(item.icon)}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></div><kbd>↵</kbd></button>`).join(""):`<div class="command-empty"><b>No page found</b><span>Try a different name or description.</span></div>`;
  $("commandResults").querySelectorAll("[data-command-view]").forEach((button,index)=>{button.onmouseenter=()=>{commandSelection=index;$("commandResults").querySelectorAll("[data-command-view]").forEach((item,itemIndex)=>{item.classList.toggle("selected",itemIndex===index);item.setAttribute("aria-selected",String(itemIndex===index));});};button.onclick=()=>openCommandView(button.dataset.commandView);});
}
function openCommandMenu(){$("commandPalette").hidden=false;document.body.classList.add("command-open");commandSelection=0;$("commandInput").value="";renderCommandMenu();requestAnimationFrame(()=>$("commandInput").focus());}
function closeCommandMenu(){$("commandPalette").hidden=true;document.body.classList.remove("command-open");$("openCommand").focus();}
function openCommandView(view){closeCommandMenu();show(view);}
$("openCommand").onclick=openCommandMenu;$("commandInput").oninput=event=>{commandSelection=0;renderCommandMenu(event.target.value)};$("commandPalette").onclick=event=>{if(event.target===$("commandPalette"))closeCommandMenu();};
document.addEventListener("keydown",event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();$("commandPalette").hidden?openCommandMenu():closeCommandMenu();return;}if($("commandPalette").hidden)return;if(event.key==="Escape"){event.preventDefault();closeCommandMenu();}else if((event.key==="ArrowDown"||event.key==="ArrowUp")&&visibleCommands.length){event.preventDefault();const direction=event.key==="ArrowDown"?1:-1;commandSelection=(commandSelection+direction+visibleCommands.length)%visibleCommands.length;renderCommandMenu($("commandInput").value);$("commandResults").querySelector(".selected")?.scrollIntoView({block:"nearest"});}else if(event.key==="Enter"&&visibleCommands[commandSelection]){event.preventDefault();openCommandView(visibleCommands[commandSelection].view);}});

$("agentGrid").innerHTML=agents.map(a=>`<article class="agent-card"><div class="agent-top"><span class="agent-orb">${a[2]}</span><span class="agent-state">Ready</span></div><h3>${a[0]}</h3><p>${a[1]}</p></article>`).join("");

function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
function recordUsage(contribution,type){
  if(!contribution)return;const usage=contribution.usage||{},id=contribution.id||`${Date.now()}-${type}`;
  state.aiUsage=state.aiUsage||{inputTokens:0,outputTokens:0,totalTokens:0,generations:0,liveGenerations:0,fallbackGenerations:0,events:[]};
  if(state.aiUsage.events.some(event=>event.id===id))return;
  const event={id,type,provider:contribution.provider,model:contribution.model,inputTokens:Number(usage.inputTokens||0),outputTokens:Number(usage.outputTokens||0),totalTokens:Number(usage.totalTokens||0),createdAt:contribution.createdAt||new Date().toISOString()};
  state.aiUsage.inputTokens+=event.inputTokens;state.aiUsage.outputTokens+=event.outputTokens;state.aiUsage.totalTokens+=event.totalTokens;state.aiUsage.generations+=1;if(contribution.model==="Demo engine")state.aiUsage.fallbackGenerations=(state.aiUsage.fallbackGenerations||0)+1;else state.aiUsage.liveGenerations=(state.aiUsage.liveGenerations||0)+1;state.aiUsage.events=[event,...state.aiUsage.events].slice(0,50);
}
async function save(){
  const response = await authFetch(`/api/state?workspace=${encodeURIComponent(currentWorkspaceId)}`, {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(state)});
  if(!response.ok) throw new Error("Could not save workspace");
}
function toast(message){$("toast").textContent=message;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2300)}
function onboardingKey(){return `nova.onboarding.${currentWorkspaceId}`}
function renderOnboarding(){
  const item=onboardingSteps[onboardingStep];$("onboardingEyebrow").textContent=item.eyebrow;$("onboardingTitle").textContent=item.title;$("onboardingText").textContent=item.text;
  $("onboardingPoints").innerHTML=item.points.map(point=>`<span>${escapeHtml(point)}</span>`).join("");
  $("onboardingDots").innerHTML=onboardingSteps.map((_,index)=>`<i class="${index===onboardingStep?"active":""}"></i>`).join("");
  $("nextOnboarding").textContent=onboardingStep===onboardingSteps.length-1?"Start building →":"Continue →";
}
function openOnboarding(){if(state.plan||localStorage.getItem(onboardingKey()))return;onboardingStep=0;renderOnboarding();$("onboarding").classList.add("open");$("nextOnboarding").focus();}
function closeOnboarding(start=false){localStorage.setItem(onboardingKey(),"complete");$("onboarding").classList.remove("open");if(start){show("builder");$("idea").focus();}}
$("skipOnboarding").onclick=()=>closeOnboarding(false);
$("nextOnboarding").onclick=()=>{if(onboardingStep<onboardingSteps.length-1){onboardingStep++;renderOnboarding();}else closeOnboarding(true);};
const briefFields=["idea","customer","revenue","budget","goal"];
const briefDefaults=Object.fromEntries(briefFields.map(id=>[id,$(id).value]));
function readBrief(){return Object.fromEntries(briefFields.map(id=>[id,$(id).value.trim()]));}
function restoreBrief(){const brief=state.briefDraft||state.brief||briefDefaults;briefFields.forEach(id=>{$(id).value=brief[id]??briefDefaults[id];});}
function scheduleBriefSave(){
  if(!currentWorkspaceId)return;state.briefDraft=readBrief();const target=currentWorkspaceId;clearTimeout(draftSaveTimer);$("briefSaveStatus").textContent="Saving draft…";$("briefSaveStatus").className="builder-save-state saving";
  draftSaveTimer=setTimeout(async()=>{if(target!==currentWorkspaceId)return;try{await save();$("briefSaveStatus").textContent="Draft saved";$("briefSaveStatus").className="builder-save-state saved";}catch{$("briefSaveStatus").textContent="Draft could not be saved";$("briefSaveStatus").className="builder-save-state";}},700);
}
briefFields.forEach(id=>{$(id).addEventListener("input",scheduleBriefSave);$(id).addEventListener("change",scheduleBriefSave);});
$("showTour").onclick=()=>{localStorage.removeItem(onboardingKey());openOnboarding();};
$("exportWorkspace").onclick=()=>{
  const backup={product:"Nova.Ai",version:1,exportedAt:new Date().toISOString(),workspace:{id:currentWorkspaceId,name:currentWorkspaceName,state}};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`nova-ai-${currentWorkspaceName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"workspace"}-backup.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("Workspace backup downloaded");
};
function render(){
  const p=state.plan;
  $("workspaceName").textContent=p?p.name:currentWorkspaceName;
  $("health").textContent=p?(state.approved?"82":"68"):"—";
  const executionTasks=state.executionTasks||[],openTasks=executionTasks.filter(task=>task.status!=="done"),blockedTasks=openTasks.filter(task=>task.status==="blocked");$("agentCount").textContent=p?"3":"0";$("taskCount").textContent=String(openTasks.length);$("taskSummary").textContent=blockedTasks.length?`${blockedTasks.length} blocked · founder attention needed`:openTasks.length?`${openTasks.filter(task=>task.status==="in_progress").length} in progress`:"Nothing awaiting execution";
  const aiUsage=state.aiUsage||{};$("aiUsageTotal").textContent=Number(aiUsage.totalTokens||0).toLocaleString();$("aiUsageMode").textContent=aiUsage.liveGenerations?`${aiUsage.liveGenerations} live generation${aiUsage.liveGenerations===1?"":"s"} · tokens`:aiUsage.fallbackGenerations?`${aiUsage.fallbackGenerations} safe fallback run${aiUsage.fallbackGenerations===1?"":"s"}`:"No generations yet";
  renderSettingsSummary();
  renderUsage();
  const progress=p?(state.approved?100:75):0;$("progressText").textContent=progress+"%";$("progressBar").style.width=progress+"%";
  const employeePending=(state.agentRuns||[]).filter(run=>run.needsApproval&&!run.approvalStatus).length;
  $("approvalBadge").textContent=String((p&&!state.approved?1:0)+employeePending);
  $("activity").className=state.activities.length?"":"empty";
  $("activity").innerHTML=state.activities.length?state.activities.slice().reverse().map(x=>`<div class="activity-item"><i>●</i><div><b>${escapeHtml(x.title)}</b><br><span>${escapeHtml(x.detail)}</span></div></div>`).join(""):`<b>No activity yet</b><span>Start with a business idea and your AI team will get to work.</span>`;
  renderWorkforce();
  renderWorkQueue();
  renderExecutionBoard();
  renderNotifications();
  renderOffice();
  renderEmployeeApprovals();
  if(!p){
    $("approvalContent").innerHTML=`<div class="approval-icon">⌁</div><h3>No launch plan yet</h3><p>Generate a strategy and its reviewed output will appear here.</p><button class="primary" id="emptyCreateStrategy">Create strategy</button>`;
    $("emptyCreateStrategy").onclick=()=>show("builder");
    renderStudio();return;
  }
  const evaluation=state.evaluation?`<div class="evaluation"><div><small>QUALITY GATE</small><strong>${state.evaluation.score}%</strong><span>${escapeHtml(state.evaluation.verdict)}</span></div><ul>${state.evaluation.checks.map(check=>`<li class="${check.pass?"pass":"fail"}">${check.pass?"✓":"○"} ${escapeHtml(check.label)}</li>`).join("")}</ul></div>`:"";
  $("approvalContent").innerHTML=`<p class="eyebrow">REVIEWED LAUNCH PLAN</p><h3>${escapeHtml(p.name)}</h3><p>The Founder Agent created this plan and Nova.Ai evaluated it against measurable quality requirements. Review it before the team builds.</p>${evaluation}<div class="strategy"><div><small>IDEAL CUSTOMER</small>${escapeHtml(p.customer)}</div><div><small>CORE OFFER</small>${escapeHtml(p.offer)}</div><div><small>REVENUE MODEL</small>${escapeHtml(p.revenue)}</div><div><small>FIRST MILESTONE</small>${escapeHtml(p.milestone)}</div><div><small>POSITIONING</small>${escapeHtml(p.positioning)}</div><div><small>REVIEWER NOTE</small>${escapeHtml(p.review)}</div></div>${state.approved?`<span class="status-pill" style="color:#16815c;background:#e8f8f2">✓ APPROVED FOR BUILD</span>`:`<div id="revisionPanel" class="revision-panel" hidden><label>What should the Founder Agent change?<textarea id="revisionFeedback" maxlength="1000" placeholder="Example: Narrow the customer to solo accounting firms and make the first milestone achievable in 14 days."></textarea></label><div><button class="secondary" id="cancelRevision">Cancel</button><button class="primary" id="applyRevision">Generate revision →</button></div></div><div class="approval-actions"><button class="secondary" id="requestChanges">Request changes</button><button class="primary" id="approvePlan">Approve launch plan →</button></div>`}`;
  if(!state.approved){
    $("approvePlan").onclick=async()=>{state.approved=true;state.activities.push({title:"Launch plan approved",detail:"Builder Agent is ready to create the landing page."});await save();render();toast("Plan approved");};
    $("requestChanges").onclick=()=>{$("revisionPanel").hidden=false;$("revisionFeedback").focus();};
    $("cancelRevision").onclick=()=>{$("revisionPanel").hidden=true;$("revisionFeedback").value="";};
    $("applyRevision").onclick=async()=>{
      const feedback=$("revisionFeedback").value.trim();if(!feedback)return toast("Describe what should change");
      const button=$("applyRevision");button.disabled=true;button.textContent="Revising…";
      try{
        const brief=state.brief||{idea:p.offer,customer:p.customer,revenue:p.revenue,goal:p.goal||"Validate the idea",budget:"Under $1,000"};
        const response=await authFetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...brief,feedback,currentPlan:p,workspaceId:currentWorkspaceId})});
        const result=await response.json();if(!response.ok)throw new Error(result.error||"Revision failed");
        state.plan=result.plan;state.evaluation=result.evaluation;state.revisions=(state.revisions||0)+1;(result.contributions||[]).forEach(item=>recordUsage(item,"strategy_revision"));state.activities.push({title:"Launch plan revised",detail:`Revision ${state.revisions}: ${feedback.slice(0,90)}`});
        await save();render();toast("Revised plan ready for review");
      }catch(error){toast(error.message)}finally{if(button.isConnected){button.disabled=false;button.textContent="Generate revision →";}}
    };
  }
  renderStudio();
}

function renderSettingsSummary(){if(!$("settingsCompanyName"))return;$("settingsCompanyName").textContent=currentWorkspaceName;$("settingsEmail").textContent=$("authEmail").textContent||"Founder account";const usage=state.aiUsage||{},budget=state.aiBudget||{};$("settingsAiState").textContent=budget.paused?"AI employees paused":"AI runs allowed";$("settingsAiState").className=budget.paused?"paused":"";$("settingsAiUsage").textContent=`${Number(usage.totalTokens||0).toLocaleString()} tokens used`;}
async function loadSettings(){renderSettingsSummary();const list=$("settingsConnections");list.innerHTML='<div class="connection-loading">Checking services…</div>';try{const [configResponse,providerResponse,billingResponse]=await Promise.all([fetch("/api/config"),fetch("/api/providers"),fetch("/api/billing/status")]),config=await configResponse.json(),providers=await providerResponse.json(),billingState=await billingResponse.json(),provider=Object.values(providers).find(item=>item.ready),connections=[{name:"Workspace database",detail:config.supabase?.enabled?"Supabase Auth and protected workspace storage":"Local development storage",ready:true},{name:"AI workforce",detail:provider?`${provider.label} · ${provider.model}`:"Safe fallback engine",ready:Boolean(provider)},{name:"Subscription billing",detail:billingState.enabled?billingState.webhookReady?"Stripe checkout and webhooks ready":"Stripe checkout ready · webhook pending":"Safety-disabled until Stripe is configured",ready:Boolean(billingState.enabled&&billingState.webhookReady)},{name:"Launch publishing",detail:config.supabase?.enabled?"Public pages and lead capture ready":"Requires Supabase in production",ready:Boolean(config.supabase?.enabled)}];list.innerHTML=connections.map(item=>`<div><i class="${item.ready?"ready":"waiting"}"></i><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span><b>${item.ready?"Connected":"Pending"}</b></div>`).join("");const ready=connections.filter(item=>item.ready).length;$("settingsStatus").textContent=`${ready} of ${connections.length} services ready`;$("settingsStatus").className=ready===connections.length?"ready":"";}catch(error){list.innerHTML=`<div class="connection-loading">Could not check services. ${escapeHtml(error.message)}</div>`;$("settingsStatus").textContent="Status unavailable";}}
$("refreshSettings").onclick=loadSettings;$("settingsRename").onclick=()=>$("renameWorkspace").click();$("settingsExport").onclick=()=>$("exportWorkspace").click();$("settingsDelete").onclick=()=>$("deleteWorkspace").click();$("settingsResetPassword").onclick=async()=>{const email=$("authEmail").textContent.trim();if(!email.includes("@"))return toast("Password reset is available for signed-in accounts");const button=$("settingsResetPassword");button.disabled=true;try{await requestPasswordReset(email);toast("Password-reset email sent");}catch(error){toast(error.message)}finally{button.disabled=false;}};

function renderUsage(){
  const usage=state.aiUsage||{},events=Array.isArray(usage.events)?usage.events:[],format=value=>Number(value||0).toLocaleString();
  $("usageTotal").textContent=format(usage.totalTokens);$("usageInput").textContent=format(usage.inputTokens);$("usageOutput").textContent=format(usage.outputTokens);$("usageRuns").textContent=`${format(usage.liveGenerations)} / ${format(usage.fallbackGenerations)}`;
  const budget=state.aiBudget||{},personalLimit=Number(budget.tokenLimit||100000),planLimit=Number(window.novaEntitlement?.tokenCeiling||Infinity),limit=Math.min(personalLimit,planLimit),used=Number(usage.totalTokens||0),percent=Math.min(100,Math.round(used/limit*100));$("aiTokenLimit").value=String(personalLimit);[...$("aiTokenLimit").options].forEach(option=>option.disabled=Number(option.value)>planLimit);$("budgetUsedLabel").textContent=`${format(used)} of ${format(limit)} tokens used`;$("budgetPercent").textContent=`${percent}%`;$("budgetProgress").value=percent;$("budgetStatus").textContent=budget.paused?"AI runs are paused by the founder":used>=limit?"Token limit reached — new runs are blocked":personalLimit>planLimit?`Limited by the ${window.novaEntitlement?.label||"current plan"}`:"AI runs are allowed";$("budgetStatus").className=budget.paused||used>=limit?"blocked":"";$("toggleAiRuns").textContent=budget.paused?"Resume AI runs":"Pause AI runs";
  const ledger=$("usageLedger");
  if(!events.length){ledger.className="usage-empty";ledger.innerHTML=`<b>No AI activity yet</b><span>Generate a strategy or assign work to an AI employee to begin the audit trail.</span><button class="primary" data-go="builder">Start building →</button>`;ledger.querySelector("[data-go]").onclick=()=>show("builder");return;}
  const labels={strategy:"Launch strategy",strategy_revision:"Strategy revision",workforce:"Employee assignment"};
  ledger.className="usage-rows";ledger.innerHTML=events.map(event=>{const fallback=event.model==="Demo engine",date=new Date(event.createdAt),time=Number.isNaN(date.getTime())?"Time unavailable":date.toLocaleString();return `<div class="usage-row"><div><span class="run-state ${fallback?"fallback":"live"}">${fallback?"Fallback":"Live"}</span><strong>${escapeHtml(labels[event.type]||"AI generation")}</strong><small>ID ${escapeHtml(String(event.id||"unknown").slice(0,12))}</small></div><div><strong>${escapeHtml(event.provider||"Unknown provider")}</strong><small>${escapeHtml(event.model||"Unknown model")}</small></div><div><strong>${format(event.totalTokens)}</strong><small>${format(event.inputTokens)} in · ${format(event.outputTokens)} out</small></div><time datetime="${escapeHtml(event.createdAt||"")}">${escapeHtml(time)}</time></div>`}).join("");
}

$("aiTokenLimit").onchange=async event=>{state.aiBudget={...(state.aiBudget||{}),tokenLimit:Number(event.target.value)};try{await save();renderUsage();toast("AI token limit saved");}catch(error){toast(error.message)}};
$("toggleAiRuns").onclick=async()=>{state.aiBudget={...(state.aiBudget||{}),tokenLimit:Number(state.aiBudget?.tokenLimit||100000),paused:!state.aiBudget?.paused};try{await save();renderUsage();toast(state.aiBudget.paused?"AI runs paused":"AI runs resumed");}catch(error){state.aiBudget.paused=!state.aiBudget.paused;toast(error.message)}};
window.addEventListener("nova-entitlement",()=>renderUsage());

function notificationItems(){
  const items=[],runs=state.agentRuns||[],pending=runs.filter(run=>run.needsApproval&&!run.approvalStatus),queued=state.workQueue||[],blocked=(state.executionTasks||[]).filter(task=>task.status==="blocked"),usage=state.aiUsage||{},budget=state.aiBudget||{},personalLimit=Number(budget.tokenLimit||100000),planLimit=Number(window.novaEntitlement?.tokenCeiling||Infinity),limit=Math.min(personalLimit,planLimit),ratio=limit?Number(usage.totalTokens||0)/limit:0;
  if(state.plan&&!state.approved)items.push({tone:"approval",icon:"✓",title:"Launch plan needs approval",detail:"Review the strategy before the Builder Agent continues.",view:"approvals",action:"Review plan"});
  if(pending.length)items.push({tone:"approval",icon:"◉",title:`${pending.length} employee assignment${pending.length===1?"":"s"} awaiting review`,detail:"No external action has been taken. Approve or request changes.",view:"approvals",action:"Review work"});
  if(queued.length)items.push({tone:"queue",icon:"→",title:`${queued.length} assignment${queued.length===1?" is":"s are"} queued`,detail:"Launch queued work when you are ready to use AI capacity.",view:"team",action:"Open queue"});
  if(blocked.length)items.push({tone:"warning",icon:"!",title:`${blocked.length} approved task${blocked.length===1?" is":"s are"} blocked`,detail:blocked[0].blockerNote||"Review the blocker and decide how the team should proceed.",view:"team",action:"Resolve blockers"});
  if(budget.paused)items.push({tone:"warning",icon:"Ⅱ",title:"AI employees are paused",detail:"Resume AI work from the Activity guardrail when you are ready.",view:"usage",action:"View guardrail"});
  else if(ratio>=1)items.push({tone:"warning",icon:"!",title:"AI token limit reached",detail:"Raise the workspace limit or upgrade the plan to continue generating.",view:"usage",action:"Review usage"});
  else if(ratio>=.8)items.push({tone:"warning",icon:"!",title:"AI usage is above 80%",detail:`${Math.round(ratio*100)}% of this workspace’s effective token ceiling has been used.`,view:"usage",action:"Review usage"});
  if(state.approved&&state.site?.approved&&!publishingPage?.published)items.push({tone:"launch",icon:"▱",title:"Launch page is approved",detail:"The page is ready for the final publishing step.",view:"studio",action:"Open Launch Studio"});
  return items;
}
function renderNotifications(){const items=notificationItems(),count=$("notificationCount");count.textContent=String(items.length);count.hidden=!items.length;$("notificationSummary").innerHTML=items.length?`<strong>${items.length}</strong><span>action${items.length===1?"":"s"} for ${escapeHtml(currentWorkspaceName)}</span>`:`<strong>✓</strong><span>Nothing needs your attention</span>`;$("notificationList").innerHTML=items.length?items.map((item,index)=>`<button type="button" data-notification-view="${escapeHtml(item.view)}"><span class="notification-icon ${item.tone}">${item.icon}</span><div><small>${item.tone}</small><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p><em>${escapeHtml(item.action)} →</em></div></button>`).join(""):`<div class="notification-empty"><span>✓</span><b>You’re all caught up</b><p>Nova.Ai will notify you when a decision, limit, or queued assignment needs attention.</p></div>`;$("notificationList").querySelectorAll("[data-notification-view]").forEach(button=>button.onclick=()=>{closeNotifications();show(button.dataset.notificationView);});}
function openNotifications(){renderNotifications();$("notificationOverlay").hidden=false;document.body.classList.add("notifications-open");$("closeNotifications").focus();}
function closeNotifications(){$("notificationOverlay").hidden=true;document.body.classList.remove("notifications-open");}
$("openNotifications").onclick=openNotifications;$("closeNotifications").onclick=closeNotifications;$("notificationOverlay").onclick=event=>{if(event.target===$("notificationOverlay"))closeNotifications();};document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("notificationOverlay").hidden)closeNotifications();});

const officeDefaults = [
  ["Founder Agent","Planning the next company milestone"],
  ["Research Agent","Reviewing customer evidence"],
  ["Builder Agent","Building the launch experience"],
  ["Reviewer Agent","Checking quality and safety"],
  ["Marketing Agent","Drafting the next experiment"],
  ["Analytics Agent","Watching company performance"]
];
function renderOffice(){
  const cards=[...document.querySelectorAll("#office .worker-card")];if(!cards.length)return;
  const latest=(state.agentRuns||[])[0],deliveries=latest?.employees||[];
  cards.forEach((card,index)=>{
    const task=card.querySelector(".worker-info p"),status=card.querySelector(".worker-info span"),thought=card.querySelector(".thought"),delivery=deliveries[index];
    card.classList.toggle("is-working",Boolean(officeBusy));card.classList.toggle("is-complete",!officeBusy&&Boolean(delivery));
    if(officeBusy){task.textContent=index===0?officeBusy.goal:`Supporting the ${officeBusy.department||"company"} assignment`;status.textContent="● Working";if(thought)thought.textContent=index===0?"Breaking down the goal":"Coordinating handoff";}
    else if(delivery){task.textContent=delivery.deliverable||officeDefaults[index][1];status.textContent="✓ Delivered";if(thought)thought.textContent=delivery.handoff||"Handoff complete";}
    else{task.textContent=officeDefaults[index][1];status.textContent="● Ready";if(thought)thought.textContent=index===0?"Waiting for a goal":index===2?"Ready to build":index===4?"Ready to grow":"";}
  });
  const working=officeBusy?cards.length:0,delivered=officeBusy?0:Math.min(deliveries.length,cards.length),ready=cards.length-working;
  $("officeWorkingCount").textContent=String(working);$("officeReadyCount").textContent=String(ready);$("officeDeliveredCount").textContent=String(delivered);
  $("officeOnlineLabel").textContent=officeBusy?`${working} employees working`:`${cards.length} employees online`;
  $("officeRunSummary").textContent=officeBusy?`Working on: ${officeBusy.goal}`:latest?`Latest run: ${latest.goal}`:"Assign a goal and watch the office respond";
}

function renderWorkforce(){
  const runs=state.agentRuns||[],run=runs[selectedRunIndex]||runs[0],container=$("workforceResults");if(!container)return;
  $("workforceHistoryCount").textContent=`${runs.length} run${runs.length===1?"":"s"}`;
  $("workforceHistory").className=runs.length?"history-list":"history-empty";
  $("workforceHistory").innerHTML=runs.length?runs.map((item,index)=>`<button type="button" data-run-index="${index}" class="${index===selectedRunIndex?"active":""}"><span><b>${escapeHtml(item.goal)}</b><small>${new Date(item.createdAt).toLocaleDateString()} · ${escapeHtml(item.department||"company")}</small></span><em class="${item.approvalStatus||"pending"}">${item.approvalStatus==="approved"?"Approved":item.approvalStatus==="changes_requested"?"Changes requested":item.needsApproval?"Review":"Complete"}</em></button>`).join(""):"Completed employee runs will be retained here.";
  document.querySelectorAll("[data-run-index]").forEach(button=>button.onclick=()=>{selectedRunIndex=Number(button.dataset.runIndex);renderWorkforce();});
  if(!run){container.className="workforce-empty";container.innerHTML="<b>No assignment running</b><span>Your employees’ work and handoffs will appear here.</span>";$("workforceStatus").textContent="Ready";return;}
  container.className="employee-results";$("workforceStatus").textContent=run.approvalStatus==="approved"?"Approved":run.approvalStatus==="changes_requested"?"Revise":run.needsApproval?"Founder review":"Complete";
  const review=run.review,reviewCard=review?`<section class="agent-review ${review.ready?"ready":"blocked"}"><header><div><small>INDEPENDENT REVIEW</small><h4>${escapeHtml(review.verdict)}</h4></div><strong>${Number(review.score||0)}<em>/100</em></strong></header><div><span>${review.ready?"✓ Ready for founder review":"○ Resolve blockers before approval"}</span><p>${escapeHtml(review.recommendation)}</p></div>${(review.blockers||[]).length?`<ul>${review.blockers.map(item=>`<li>${escapeHtml(item)}</li>`).join("")}</ul>`:""}</section>`:"";
  container.innerHTML=`<div class="run-summary"><small>${escapeHtml(run.department||"company")} · ${escapeHtml(run.priority||"normal")} priority</small><strong>${escapeHtml(run.goal)}</strong><p>${escapeHtml(run.summary)}</p>${run.approvalStatus==="approved"?'<span class="approved">✓ Founder approved</span>':run.approvalStatus==="changes_requested"?'<span>↻ Changes requested</span>':run.needsApproval?'<span>◉ External actions require your approval</span>':''}</div><div class="employee-list">${(run.employees||[]).map((employee,index)=>`<article><i>${index+1}</i><div><small>${escapeHtml(employee.department)}</small><h4>${escapeHtml(employee.role)}</h4><p>${escapeHtml(employee.deliverable)}</p><footer><b>HANDOFF</b> ${escapeHtml(employee.handoff)}</footer></div><span>✓ Done</span></article>`).join("")}</div>${reviewCard}`;
}
function renderWorkQueue(){
  const queue=state.workQueue||[],container=$("workQueue");if(!container)return;$("workQueueCount").textContent=`${queue.length} queued`;
  container.className=queue.length?"queue-list":"queue-empty";container.innerHTML=queue.length?queue.map(item=>`<article><span class="queue-priority ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span><div><strong>${escapeHtml(item.goal)}</strong><small>${escapeHtml(item.department)} · added ${new Date(item.createdAt).toLocaleDateString()}</small></div><div><button class="secondary" type="button" data-queue-remove="${escapeHtml(item.id)}" aria-label="Remove queued assignment">Remove</button><button class="primary" type="button" data-queue-run="${escapeHtml(item.id)}">Run now →</button></div></article>`).join(""):`<b>No work queued</b><span>Save an assignment for later or run it immediately.</span>`;
  container.querySelectorAll("[data-queue-remove]").forEach(button=>button.onclick=async()=>{state.workQueue=(state.workQueue||[]).filter(item=>item.id!==button.dataset.queueRemove);await save();renderWorkQueue();toast("Assignment removed from queue");});
  container.querySelectorAll("[data-queue-run]").forEach(button=>button.onclick=()=>{const item=(state.workQueue||[]).find(task=>task.id===button.dataset.queueRun);if(item)executeWorkforce(item.goal,item.department,item.priority,item.id);});
}
function renderExecutionBoard(){
  const tasks=state.executionTasks||[],container=$("executionBoard");if(!container)return;const done=tasks.filter(task=>task.status==="done").length;$("executionCount").textContent=tasks.length?`${done}/${tasks.length} done`:"0 tasks";
  const statusLabel=task=>task.status==="done"?"✓ Done":task.status==="in_progress"?"● In progress":task.status==="blocked"?"! Blocked":"○ Ready";
  container.className=tasks.length?"execution-list":"execution-empty";container.innerHTML=tasks.length?tasks.map(task=>`<article><span class="execution-state ${escapeHtml(task.status)}">${statusLabel(task)}</span><div><small>${escapeHtml(task.department||"Company")} · ${escapeHtml(task.owner||"AI employee")}</small><h4>${escapeHtml(task.title)}</h4><p>${escapeHtml(task.status==="done"&&task.completionNote?`Confirmed: ${task.completionNote}`:task.status==="blocked"&&task.blockerNote?`Blocker: ${task.blockerNote}`:task.handoff||"")}</p><div class="task-confirmation" data-task-confirmation="${escapeHtml(task.id)}" hidden><label>Founder update<textarea maxlength="1000" data-task-note="${escapeHtml(task.id)}" placeholder="Describe the result, evidence, or blocker."></textarea></label><div><button class="secondary" type="button" data-task-cancel="${escapeHtml(task.id)}">Cancel</button><button class="primary" type="button" data-task-confirm="${escapeHtml(task.id)}">Save update →</button></div></div></div><div class="task-actions">${task.status==="in_progress"?`<button class="secondary" type="button" data-task-update="block" data-task-id="${escapeHtml(task.id)}">Block</button><button class="primary" type="button" data-task-update="complete" data-task-id="${escapeHtml(task.id)}">Confirm done</button>`:`<button class="secondary" type="button" data-task-start="${escapeHtml(task.id)}">${task.status==="done"?"Reopen":task.status==="blocked"?"Resume":"Start task"}</button>`}</div></article>`).join(""):`<b>No approved tasks yet</b><span>Approve an employee assignment to create an execution checklist.</span>`;
  container.querySelectorAll("[data-task-start]").forEach(button=>button.onclick=async()=>{const task=tasks.find(item=>item.id===button.dataset.taskStart);if(!task)return;task.status=task.status==="done"?"todo":"in_progress";task.updatedAt=new Date().toISOString();if(task.status==="in_progress")task.blockerNote="";state.activities=state.activities||[];state.activities.push({title:task.status==="in_progress"?"Approved task started":"Approved task reopened",detail:task.title.slice(0,100)});await save();render();toast("Task status updated");});
  container.querySelectorAll("[data-task-update]").forEach(button=>button.onclick=()=>{const panel=container.querySelector(`[data-task-confirmation="${CSS.escape(button.dataset.taskId)}"]`);panel.dataset.action=button.dataset.taskUpdate;panel.hidden=false;panel.querySelector("textarea").focus();});
  container.querySelectorAll("[data-task-cancel]").forEach(button=>button.onclick=()=>{container.querySelector(`[data-task-confirmation="${CSS.escape(button.dataset.taskCancel)}"]`).hidden=true;});
  container.querySelectorAll("[data-task-confirm]").forEach(button=>button.onclick=async()=>{const task=tasks.find(item=>item.id===button.dataset.taskConfirm),panel=container.querySelector(`[data-task-confirmation="${CSS.escape(button.dataset.taskConfirm)}"]`),note=panel.querySelector("textarea").value.trim();if(!task||note.length<8)return toast("Add a short result or blocker note");const complete=panel.dataset.action==="complete";task.status=complete?"done":"blocked";task.completionNote=complete?note:"";task.blockerNote=complete?"":note;task.updatedAt=new Date().toISOString();state.activities=state.activities||[];state.activities.push({title:complete?"Approved task completion confirmed":"Approved task blocked",detail:`${task.title.slice(0,70)} · ${note.slice(0,80)}`});await save();render();toast(complete?"Completion saved with evidence":"Blocker saved for founder review");});
}
function createExecutionTasks(run){
  const existing=new Set((state.executionTasks||[]).map(task=>task.sourceRunId));if(existing.has(run.id))return 0;const createdAt=new Date().toISOString(),tasks=(run.employees||[]).map((employee,index)=>({id:crypto.randomUUID?.()||`execution-${Date.now()}-${index}`,sourceRunId:run.id,owner:employee.role,department:employee.department,title:employee.deliverable,handoff:employee.handoff,status:"todo",createdAt,updatedAt:createdAt}));state.executionTasks=[...tasks,...(state.executionTasks||[])].slice(0,100);return tasks.length;
}
function renderEmployeeApprovals(){
  const container=$("employeeApprovals"),pending=(state.agentRuns||[]).map((run,index)=>({run,index})).filter(item=>item.run.needsApproval&&!item.run.approvalStatus);container.hidden=!pending.length;if(!pending.length){container.innerHTML="";return;}
  container.innerHTML=`<div class="approval-queue-head"><div><small>EMPLOYEE ACTIONS</small><h3>${pending.length} assignment${pending.length===1?"":"s"} awaiting review</h3></div><span>Nothing has been sent or purchased</span></div>${pending.map(({run,index})=>`<article><div><small>${escapeHtml(run.department||"company")} · ${new Date(run.createdAt).toLocaleDateString()}</small><h4>${escapeHtml(run.goal)}</h4><p>${escapeHtml(run.summary)}</p>${run.review&&!run.review.ready?`<p class="approval-review-note"><b>Reviewer:</b> ${escapeHtml(run.review.recommendation)}</p>`:""}<div class="workforce-revision" data-revision-panel="${index}" hidden><label>What should the team change?<textarea maxlength="1000" data-revision-feedback="${index}" placeholder="Add your instructions, or use the reviewer’s blockers below.">${escapeHtml((run.review?.blockers||[]).join("\n"))}</textarea></label><div><button class="secondary" type="button" data-revision-cancel="${index}">Cancel</button><button class="primary" type="button" data-revision-submit="${index}">Revise and review again →</button></div></div></div><div class="approval-buttons"><button class="secondary" data-workforce-approval="changes" data-approval-index="${index}">Request changes</button><button class="primary" data-workforce-approval="approve" data-approval-index="${index}">Approve proposed actions</button></div></article>`).join("")}`;
  container.querySelectorAll("[data-workforce-approval]").forEach(button=>button.onclick=async()=>{const index=Number(button.dataset.approvalIndex),run=state.agentRuns[index];if(!run)return;if(button.dataset.workforceApproval==="changes"){const panel=container.querySelector(`[data-revision-panel="${index}"]`);panel.hidden=false;panel.querySelector("textarea").focus();return;}run.id=run.id||crypto.randomUUID?.()||`run-${Date.now()}`;run.approvalStatus="approved";run.reviewedAt=new Date().toISOString();const taskTotal=createExecutionTasks(run);state.activities=state.activities||[];state.activities.push({title:"Employee assignment approved",detail:`${taskTotal} supervised tasks created for ${run.goal.slice(0,80)}`});await save();render();toast(`${taskTotal} approved tasks added to execution`);});
  container.querySelectorAll("[data-revision-cancel]").forEach(button=>button.onclick=()=>{container.querySelector(`[data-revision-panel="${button.dataset.revisionCancel}"]`).hidden=true;});
  container.querySelectorAll("[data-revision-submit]").forEach(button=>button.onclick=async()=>{const index=Number(button.dataset.revisionSubmit),run=state.agentRuns[index],feedback=container.querySelector(`[data-revision-feedback="${index}"]`).value.trim();if(!run||feedback.length<8)return toast("Describe what the team should improve");show("team");const revised=await executeWorkforce(run.goal,run.department,run.priority,null,{revision:{founderFeedback:feedback,reviewerBlockers:run.review?.blockers||[],previousSummary:run.summary,previousEmployees:run.employees||[]}});if(revised){run.approvalStatus="changes_requested";run.reviewedAt=new Date().toISOString();state.activities=state.activities||[];state.activities.push({title:"Employee assignment replaced by a revised run",detail:feedback.slice(0,100)});await save();render();}});
}
const quickJobs={validation:{goal:"Create today’s customer-validation work plan: identify the riskiest assumption, prepare five interview questions, and define the evidence needed to continue or stop.",department:"research"},launch:{goal:"Review our current company stage and prepare the single highest-impact launch task for today, including acceptance criteria and a founder approval checkpoint.",department:"product"},leads:{goal:"Prepare a respectful follow-up plan for interested leads, including message drafts, qualification questions, and tracking metrics. Do not send messages.",department:"marketing"}};
document.querySelectorAll("[data-quick-job]").forEach(button=>button.onclick=()=>{const job=quickJobs[button.dataset.quickJob];$("workforceGoal").value=job.goal;$("workforceDepartment").value=job.department;$("workforcePriority").value="high";$("workforceGoal").focus();});
$("queueWorkforce").onclick=async()=>{const goal=$("workforceGoal").value.trim(),department=$("workforceDepartment").value,priority=$("workforcePriority").value;if(goal.length<12)return toast("Give the team a more specific objective");const task={id:crypto.randomUUID?.()||`task-${Date.now()}`,goal,department,priority,createdAt:new Date().toISOString()};state.workQueue=[task,...(state.workQueue||[])].slice(0,25);state.activities=state.activities||[];state.activities.push({title:"Assignment added to work queue",detail:goal.slice(0,100)});try{await save();$("workforceGoal").value="";render();toast("Assignment queued without using AI tokens");}catch(error){state.workQueue=state.workQueue.filter(item=>item.id!==task.id);toast(error.message)}};
$("workforceForm").onsubmit=async event=>{
  event.preventDefault();const button=$("runWorkforce"),goal=$("workforceGoal").value.trim(),department=$("workforceDepartment").value,priority=$("workforcePriority").value;
  await executeWorkforce(goal,department,priority);
};
async function executeWorkforce(goal,department,priority,queuedId=null,additionalContext=null){
  if(goal.length<12)return toast("Give the team a more specific objective");const button=$("runWorkforce"),queuedButton=queuedId?document.querySelector(`[data-queue-run="${CSS.escape(queuedId)}"]`):null;
  officeBusy={goal,department};renderOffice();
  button.disabled=true;if(queuedButton)queuedButton.disabled=true;button.textContent="Employees are working…";$("workforceStatus").textContent="Working";$("workforceResults").className="workforce-running";$("workforceResults").innerHTML='<i></i><b>Building specialist deliverables, then reviewing them independently</b><span>Strategy → Research → Product → Growth → Operations → Review</span>';
  try{const response=await authFetch("/api/workforce/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({goal,department,priority,company:currentWorkspaceName,workspaceId:currentWorkspaceId,context:{plan:state.plan||null,evaluation:state.evaluation||null,...additionalContext}})}),result=await response.json();if(!response.ok)throw new Error(result.error||"The workforce could not start");const run={...result.run,id:crypto.randomUUID?.()||`run-${Date.now()}`,goal,department,priority,revisionOf:additionalContext?.revision?goal:null,createdAt:new Date().toISOString()};(run.contributions||[run.contribution]).filter(Boolean).forEach((item,index)=>recordUsage(item,index?"workforce_review":"workforce"));if(queuedId)state.workQueue=(state.workQueue||[]).filter(item=>item.id!==queuedId);state.agentRuns=[run,...(state.agentRuns||[])].slice(0,10);selectedRunIndex=0;state.activities=state.activities||[];state.activities.push({title:additionalContext?.revision?"AI workforce completed the requested revision":"AI workforce completed an independently reviewed assignment",detail:`${run.employees?.length||0} employees delivered work · reviewer score ${Number(run.review?.score||0)}/100`});await save();render();toast((run.contributions||[]).every(item=>item.model==="Demo engine")?"Safe fallback completed and reviewed the assignment":"Live employee run independently reviewed");return true;}
  catch(error){renderWorkforce();toast(error.message);return false;}finally{officeBusy=null;renderOffice();button.disabled=false;button.innerHTML='Assign to AI employees <span>→</span>';if(queuedButton?.isConnected)queuedButton.disabled=false;}
}

function createSiteDraft(){
  const p=state.plan;
  return {eyebrow:`Introducing ${p.name}`,headline:p.positioning,subhead:p.offer,cta:"Join the early access list",trust:`Built for ${p.customer}`,approved:false,updatedAt:new Date().toISOString()};
}
function renderStudio(){
  const ready=Boolean(state.plan&&state.approved),empty=$("studioEmpty"),workspace=$("studioWorkspace");
  empty.hidden=ready;workspace.hidden=!ready;$("studioStatus").textContent=!state.plan?"Waiting for plan":!state.approved?"Approval required":state.site?.approved?"Page approved":"Draft mode";
  if(!ready)return;if(!state.site)state.site=createSiteDraft();
  const fields={siteEyebrow:"eyebrow",siteHeadline:"headline",siteSubhead:"subhead",siteCta:"cta",siteTrust:"trust"};
  Object.entries(fields).forEach(([id,key])=>{const input=$(id);if(document.activeElement!==input)input.value=state.site[key]||"";input.oninput=()=>{state.site[key]=input.value;state.site.approved=false;renderSitePreview();};});
  renderSitePreview();
}
function renderSitePreview(){
  if(!state.site||!state.plan)return;const s=state.site;
  $("sitePreview").innerHTML=`<nav><b>${escapeHtml(state.plan.name)}</b><span>Product &nbsp;·&nbsp; About &nbsp;·&nbsp; Contact</span></nav><div class="preview-hero"><small>${escapeHtml(s.eyebrow)}</small><h2>${escapeHtml(s.headline)}</h2><p>${escapeHtml(s.subhead)}</p><button>${escapeHtml(s.cta)} <b>→</b></button><em>✓ ${escapeHtml(s.trust)}</em></div><div class="proof-row"><span>Clear outcome</span><span>Human supervised</span><span>Built to validate</span></div>`;
  $("publishTitle").textContent=s.approved?"Approved for publishing":"Draft not approved";$("approveSite").textContent=s.approved?"✓ Launch page approved":"Approve launch page →";$("studioStatus").textContent=s.approved?"Page approved":"Draft mode";
}
$("saveSite").onclick=async()=>{state.site.updatedAt=new Date().toISOString();state.activities.push({title:"Launch page draft saved",detail:"Builder Agent prepared the customer-facing message."});await save();render();toast("Launch page saved");};
$("regenerateSite").onclick=()=>{state.site=createSiteDraft();renderStudio();toast("Fresh launch draft generated");};
$("approveSite").onclick=async()=>{state.site.approved=true;state.site.updatedAt=new Date().toISOString();state.activities.push({title:"Launch page approved",detail:"Publishing remains offline until hosting is connected."});await save();render();toast("Launch page approved");};
function renderLeadInbox(){
  $("exportLeads").disabled=!publishingLeads.length;
  const visible=publishingLeads.filter(lead=>leadFilter==="all"||(lead.status||"new")===leadFilter);
  $("leadList").innerHTML=visible.length?visible.slice(0,50).map(lead=>`<div class="lead-row"><div><strong>${escapeHtml(lead.email)}</strong><time datetime="${escapeHtml(lead.created_at)}">${new Date(lead.created_at).toLocaleString()}</time></div><div class="lead-actions"><select data-lead-status="${escapeHtml(lead.id)}" aria-label="Status for ${escapeHtml(lead.email)}"><option value="new" ${lead.status==="new"||!lead.status?"selected":""}>New</option><option value="contacted" ${lead.status==="contacted"?"selected":""}>Contacted</option><option value="qualified" ${lead.status==="qualified"?"selected":""}>Qualified</option><option value="archived" ${lead.status==="archived"?"selected":""}>Archived</option></select><a class="lead-email" href="mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(`Thanks for joining ${currentWorkspaceName}`)}&body=${encodeURIComponent(`Hi there,\n\nThanks for joining the early-access list for ${currentWorkspaceName}. I would love to learn what brought you here and what problem you are hoping to solve.\n\nWould you be open to a short conversation?\n\nBest,\nThe ${currentWorkspaceName} team`)}">Write email</a></div></div>`).join(""):`<div class="lead-empty">${publishingLeads.length?"No leads match this filter.":"No signups yet. Share the published page to begin building your early-access list."}</div>`;
  document.querySelectorAll("[data-lead-status]").forEach(select=>select.onchange=async()=>{const previous=publishingLeads.find(lead=>lead.id===select.dataset.leadStatus)?.status||"new";select.disabled=true;try{const response=await authFetch(`/api/leads/${encodeURIComponent(select.dataset.leadStatus)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:select.value})}),result=await response.json();if(!response.ok)throw new Error(result.error||"Could not update lead");const index=publishingLeads.findIndex(lead=>lead.id===result.lead.id);if(index>=0)publishingLeads[index]=result.lead;toast("Lead status updated");}catch(error){select.value=previous;toast(error.message);}finally{select.disabled=false;}});
}
$("leadFilter").onchange=event=>{leadFilter=event.target.value;renderLeadInbox();};
function csvCell(value){const text=String(value??"");const safe=/^[=+\-@]/.test(text)?`'${text}`:text;return `"${safe.replace(/"/g,'""')}"`;}
$("exportLeads").onclick=()=>{
  if(!publishingLeads.length)return;const rows=[["email","status","signed_up_at","updated_at"],...publishingLeads.map(lead=>[lead.email,lead.status||"new",lead.created_at,lead.updated_at||lead.created_at])],csv=rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${currentWorkspaceName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"nova-ai"}-leads.csv`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("Lead list exported");
};
async function loadPublishing(){try{if(!currentWorkspaceId)return;const response=await authFetch(`/api/publishing?workspace=${encodeURIComponent(currentWorkspaceId)}`),result=await response.json();if(!response.ok)throw new Error(result.error||"Could not load publishing status");const page=result.page,stats=result.stats||{};publishingPage=page;publishingLeads=stats.leads||[];renderLeadInbox();renderNotifications();$("publicPageStatus").textContent=page?.published?"Published":"Not published";$("publicPageLink").hidden=!page?.published;if(page?.published){$("publicPageLink").href=`/p/${page.slug}`;$("publicPageLink").textContent=`${location.origin}/p/${page.slug}`;}$("publishSite").hidden=Boolean(page?.published);$("unpublishSite").hidden=!page?.published;$("pageViews").textContent=stats.views||0;$("pageSignups").textContent=stats.signups||0;$("pageConversion").textContent=(stats.views?Math.round((stats.signups/stats.views)*100):0)+"%";}catch(error){publishingPage=null;publishingLeads=[];renderLeadInbox();renderNotifications();toast(error.message)}}
$("publishSite").onclick=async()=>{if(!state.site?.approved)return toast("Approve this launch page first");$("publishSite").disabled=true;try{const response=await authFetch("/api/publishing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId})}),result=await response.json();if(!response.ok)throw new Error(result.error||"Could not publish page");await loadPublishing();toast("Launch page published");}catch(error){toast(error.message)}finally{$("publishSite").disabled=false}};
$("unpublishSite").onclick=async()=>{$("unpublishSite").disabled=true;try{const response=await authFetch("/api/publishing",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId})});if(!response.ok)throw new Error("Could not unpublish page");await loadPublishing();toast("Launch page unpublished");}catch(error){toast(error.message)}finally{$("unpublishSite").disabled=false}};
window.loadPublishing=loadPublishing;

$("ideaForm").onsubmit=async(event)=>{
  event.preventDefault();
  const idea=$("idea").value.trim(), customer=$("customer").value.trim(), revenue=$("revenue").value, goal=$("goal").value, budget=$("budget").value;
  $("generateBtn").disabled=true;$("generateBtn").textContent="Agents are working…";
  try{
    const response=await authFetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idea,customer,revenue,goal,budget,workspaceId:currentWorkspaceId})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||"Generation failed");
    const activities=(result.contributions||[]).map(item=>({title:`${item.role} completed work`,detail:`${item.provider} · ${item.model}`}));
    state={approved:false,activities:activities.length?activities:[{title:"Founder Agent completed strategy",detail:`Created the initial ${goal.toLowerCase()} plan.`}],plan:result.plan,evaluation:result.evaluation,brief:{idea,customer,revenue,goal,budget},revisions:0,aiUsage:{inputTokens:0,outputTokens:0,totalTokens:0,generations:0,liveGenerations:0,fallbackGenerations:0,events:[]}};(result.contributions||[]).forEach(item=>recordUsage(item,"strategy"));
    await save();render();show("approvals");toast("Strategy and independent review complete");
  }catch(error){toast(error.message)}finally{$("generateBtn").disabled=false;$("generateBtn").innerHTML="Generate launch strategy <span>→</span>";}
};
async function init(){
  await authReady;
  try{
    const response=await authFetch("/api/workspaces"), result=await response.json();
    if(!response.ok)throw new Error(result.error||"Could not load workspaces");
    if(!result.workspaces.length){const created=await authFetch("/api/workspaces",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"My first venture"})});result.workspaces=[await created.json()];}
    workspaces=result.workspaces;currentWorkspaceId=workspaces[0]?.id||result.defaultId;
    await loadWorkspace(currentWorkspaceId);openOnboarding();
  }catch{}
  try{
    const response=await fetch("/api/providers"), providers=await response.json();
    $("providerGrid").innerHTML=Object.values(providers).map(item=>`<div class="provider-row ${item.ready?"connected":""}"><i></i><div><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.role)} · ${item.ready?escapeHtml(item.model):"Adapter ready"}</span></div></div>`).join("");
  }catch{$("providerGrid").textContent="Provider status unavailable";}
  render();
  const initialView=new URLSearchParams(location.search).get("view");if(initialView&&titles[initialView])show(initialView);
}
function renderWorkspaceOptions(){
  $("workspaceSelect").innerHTML=workspaces.map(workspace=>`<option value="${escapeHtml(workspace.id)}" ${workspace.id===currentWorkspaceId?"selected":""}>${escapeHtml(workspace.name)}</option>`).join("");
}
async function loadWorkspace(id){
  clearTimeout(draftSaveTimer);const response=await authFetch(`/api/state?workspace=${encodeURIComponent(id)}`);if(!response.ok)throw new Error("Could not load workspace");
  const workspace=await response.json();currentWorkspaceId=workspace.id;currentWorkspaceName=workspace.name;state=workspace.state;publishingPage=null;restoreBrief();$("briefSaveStatus").textContent=state.briefDraft?"Draft restored":"Your unfinished brief saves automatically.";$("briefSaveStatus").className=`builder-save-state${state.briefDraft?" saved":""}`;renderWorkspaceOptions();render();if(document.getElementById("validation").classList.contains("active")&&window.loadValidation)window.loadValidation();if(window.loadPublishing)window.loadPublishing();
}
$("workspaceSelect").onchange=async event=>{try{await loadWorkspace(event.target.value);toast("Workspace switched");}catch(error){toast(error.message)}};
$("newWorkspace").onclick=async()=>{
  try{
    const response=await authFetch("/api/workspaces",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:`New company ${workspaces.length+1}`})});
    if(!response.ok)throw new Error("Could not create workspace");
    const workspace=await response.json();workspaces.unshift(workspace);await loadWorkspace(workspace.id);openOnboarding();toast("New company workspace created");
  }catch(error){toast(error.message)}
};
$("renameWorkspace").onclick=async()=>{
  const name=prompt("Rename this company",currentWorkspaceName);if(name===null)return;
  const clean=name.trim();if(!clean)return toast("Company name cannot be empty");
  try{
    const response=await authFetch(`/api/workspaces/${encodeURIComponent(currentWorkspaceId)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:clean})});
    const workspace=await response.json();if(!response.ok)throw new Error(workspace.error||"Could not rename company");
    const index=workspaces.findIndex(item=>item.id===currentWorkspaceId);if(index>=0)workspaces[index]={...workspaces[index],name:workspace.name};
    currentWorkspaceName=workspace.name;renderWorkspaceOptions();render();toast("Company renamed");
  }catch(error){toast(error.message)}
};
$("deleteWorkspace").onclick=async()=>{
  if(workspaces.length<=1)return toast("Keep at least one company workspace");
  if(!confirm(`Delete “${currentWorkspaceName}” and all of its saved plans, evidence, leads and pages? This cannot be undone.`))return;
  try{
    const response=await authFetch(`/api/workspaces/${encodeURIComponent(currentWorkspaceId)}`,{method:"DELETE"});
    const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not delete company");
    workspaces=workspaces.filter(item=>item.id!==currentWorkspaceId);await loadWorkspace(workspaces[0].id);show("home");toast("Company deleted");
  }catch(error){toast(error.message)}
};
init();
