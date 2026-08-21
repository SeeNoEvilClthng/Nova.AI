const pageGuides={
  home:{label:"Company overview",purpose:"See what needs attention and choose the next best action.",action:"Show me what to do",target:()=>founderFocus().view},
  autopilot:{label:"Verified execution",purpose:"Track approved work and require proof before counting a result.",action:"Review active missions",target:"autopilot"},
  team:{label:"AI employees",purpose:"Give the team one concrete outcome or run queued work.",action:"Assign one outcome",target:"team"},
  approvals:{label:"Founder decisions",purpose:"Approve, revise, or stop proposed actions before anything external happens.",action:"Review decisions",target:"approvals"},
  revenue:{label:"Company revenue",purpose:"Create sellable offers and monitor verified customer payments.",action:"Review revenue readiness",target:"revenue"},
  builder:{label:"Company strategy",purpose:"Turn the business idea into a focused, reviewable plan.",action:"Complete the company brief",target:"builder"},
  studio:{label:"Customer experience",purpose:"Create and approve the page customers will see.",action:"Review the launch page",target:"studio"},
  validation:{label:"Customer evidence",purpose:"Record what real customers say and separate facts from assumptions.",action:"Add customer evidence",target:"validation"},
  memory:{label:"Shared context",purpose:"Control the facts, voice, and boundaries every AI employee uses.",action:"Review company memory",target:"memory"},
  goals:{label:"Company scoreboard",purpose:"Define success and monitor the few numbers that matter.",action:"Review goals and KPIs",target:"goals"},
  office:{label:"Live team view",purpose:"See which AI employees are working, ready, or delivering results.",action:"Open employee assignments",target:"team"},
  usage:{label:"AI audit trail",purpose:"Understand model usage, costs, and every generation made for this company.",action:"Review AI safeguards",target:"usage"},
  billing:{label:"Nova subscription",purpose:"Manage the plan that pays for Nova.Ai—not your company’s customer revenue.",action:"Review subscription",target:"billing"},
  settings:{label:"Platform controls",purpose:"Manage the company, account, connections, and AI safeguards.",action:"Review connections",target:"settings"}
};

function renderPageGuide(view){
  const guide=pageGuides[view]||pageGuides.home;if(!$("guideStep"))return;
  $("guideStep").textContent=`YOU ARE HERE · ${guide.label.toUpperCase()}`;$("guidePurpose").textContent=guide.purpose;$("guideAction").textContent=`${guide.action} →`;
  $("guideAction").onclick=()=>{const target=typeof guide.target==="function"?guide.target():guide.target;if(target&&target!==view)show(target);else document.querySelector(`#${CSS.escape(view)} button.primary, #${CSS.escape(view)} input, #${CSS.escape(view)} textarea`)?.focus();};
  const more=$("navMore"),insideMore=Boolean(more?.querySelector(`[data-view="${CSS.escape(view)}"]`));if(more&&insideMore)more.open=true;
}

const showBeforeMinimalUi=show;
show=view=>{showBeforeMinimalUi(view);renderPageGuide(view);};
renderPageGuide(document.querySelector(".view.active")?.id||"home");

const workspaceMenu=$("workspaceMenu");
workspaceMenu?.querySelectorAll("button").forEach(button=>button.addEventListener("click",()=>{workspaceMenu.open=false;}));
document.addEventListener("click",event=>{if(workspaceMenu?.open&&!workspaceMenu.contains(event.target))workspaceMenu.open=false;});
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&workspaceMenu?.open){workspaceMenu.open=false;workspaceMenu.querySelector("summary")?.focus();}});

// Make every visible control self-describing without changing its existing action.
document.querySelectorAll("button, a[href]").forEach(control=>{
  const label=(control.getAttribute("aria-label")||control.textContent||"").replace(/\s+/g," ").trim();
  if(label&&!control.getAttribute("aria-label")&&!control.textContent.trim())control.setAttribute("aria-label",label);
  if(label&&!control.title&&control.matches("button"))control.title=label;
});
