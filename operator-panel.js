(()=>{
  // Autonomous Operator panel on the Autopilot screen. All numbers shown here
  // come from the server's run log, which records what each cycle actually saw.
  let operatorSettings={mode:"copilot",paused:false,dailyTokenCap:30000},operatorRuns=[],operatorPoll=null;
  const modeLabel={copilot:"Copilot",supervised:"Supervised",autopilot:"Autopilot"};
  const ownerDepartment={Strategy:"strategy",Research:"research",Product:"product",Growth:"marketing",Sales:"marketing",Operations:"operations",Finance:"operations",Compliance:"operations"};
  const minorMoney=(amount,currency)=>new Intl.NumberFormat(undefined,{style:"currency",currency:currency||"USD"}).format(Number(amount||0)/100);
  async function operatorRequest(path,options={}){const response=await authFetch(path,options),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Operator request failed");return result;}
  const operatorPost=(path,body)=>operatorRequest(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId,...body})});

  async function loadOperator(){
    if(!currentWorkspaceId)return;
    try{const result=await operatorRequest(`/api/operator/runs?workspace=${encodeURIComponent(currentWorkspaceId)}`);operatorSettings=result.settings;operatorRuns=result.runs||[];renderOperator();}
    catch(error){$("operatorState").textContent="Unavailable";$("operatorLatest").className="operator-empty";$("operatorLatest").innerHTML=`<b>Operator unavailable</b><span>${escapeHtml(error.message)}</span>`;}
    const running=operatorRuns.some(run=>run.status==="running");clearTimeout(operatorPoll);if(running)operatorPoll=setTimeout(loadOperator,4000);
  }

  function metricStrip(metrics){
    if(!metrics)return"";const r=metrics.revenue||{},f=metrics.funnel||{};
    const items=[["Net revenue",minorMoney(r.netMinor,r.currency)],["Verified orders",r.orders||0],["Page visits",f.views||0],["Signups",f.signups||0],["Interviews",metrics.evidence?.customerInterviews||0],["Live offers",metrics.offers?.live||0]];
    return `<div class="operator-metrics">${items.map(([label,value])=>`<span><small>${label}</small><b>${escapeHtml(String(value))}</b></span>`).join("")}</div>`;
  }

  function renderLatest(run){
    if(!run){$("operatorLatest").className="operator-empty";$("operatorLatest").innerHTML=`<b>No operating cycles yet</b><span>Run a cycle to get a CEO brief based on this company’s real numbers.</span>`;return;}
    if(run.status==="running"){$("operatorLatest").className="operator-empty running";$("operatorLatest").innerHTML=`<b>Cycle in progress…</b><span>Syncing revenue, reading metrics and preparing the CEO brief. This usually takes under a minute.</span>`;return;}
    if(run.status!=="completed"){$("operatorLatest").className="operator-empty";$("operatorLatest").innerHTML=`<b>Last cycle ${escapeHtml(run.status)}</b><span>${escapeHtml(run.error||"No details recorded")}</span>`;return;}
    const brief=run.brief||{},ruleBased=run.model==="Demo engine";
    const actions=(brief.recommendedActions||[]).map((item,index)=>`<li><div><em class="${item.kind==="external"?"external":"internal"}">${item.kind==="external"?"Needs your approval":"Internal"}</em><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.owner)} · ${escapeHtml(item.why)}</span><small>Expected: ${escapeHtml(item.expectedImpact)}</small></div><button class="secondary" type="button" data-operator-assign="${index}">${item.kind==="external"?"Approve and plan →":"Assign to AI team →"}</button></li>`).join("");
    const drafts=(run.drafts||[]).map(draft=>`<article><header><b>${escapeHtml(draft.title||draft.action)}</b><em>${draft.status==="template"?"Template":"AI draft · review before use"}</em></header><pre>${escapeHtml(draft.deliverable)}</pre>${(draft.checklist||[]).length?`<ul>${draft.checklist.map(item=>`<li>${escapeHtml(item)}</li>`).join("")}</ul>`:""}<small>Next: ${escapeHtml(draft.nextStep||"")}</small></article>`).join("");
    const warnings=(brief.warnings||[]).map(item=>`<li>${escapeHtml(item)}</li>`).join("");
    $("operatorLatest").className="operator-brief";
    $("operatorLatest").innerHTML=`<header><small>${new Date(run.finished_at||run.started_at).toLocaleString()} · ${run.trigger==="scheduled"?"Daily cycle":"Manual cycle"} · ${ruleBased?"Rule-based (no AI model configured)":escapeHtml(run.model||"")}</small><h4>${escapeHtml(brief.headline)}</h4><p>${escapeHtml(brief.summary)}</p></header>${metricStrip(run.metrics)}${(brief.risks||[]).length?`<div class="operator-risks"><b>Risks</b><ul>${brief.risks.map(item=>`<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`:""}${actions?`<div class="operator-actions"><b>Recommended next actions</b><ol>${actions}</ol></div>`:""}${drafts?`<div class="operator-drafts"><b>Autopilot drafts</b>${drafts}</div>`:""}${warnings?`<ul class="operator-warnings">${warnings}</ul>`:""}`;
    $("operatorLatest").querySelectorAll("[data-operator-assign]").forEach(button=>button.onclick=async()=>{const item=brief.recommendedActions[Number(button.dataset.operatorAssign)];if(!item)return;if(item.kind==="external"&&!confirm(`“${item.title}” affects people or systems outside Nova.\n\nThe AI team will only prepare a plan and drafts. Nothing is published, sent or charged without a separate approval. Continue?`))return;button.disabled=true;show("team");await executeWorkforce(`${item.title}. Why: ${item.why}`,ownerDepartment[item.owner]||"company","high",null,{operatorAction:item});});
  }

  function renderOperator(){
    const settings=operatorSettings;
    document.querySelectorAll('input[name="operatorMode"]').forEach(input=>{input.checked=input.value===settings.mode;});
    $("operatorTokenCap").value=String(settings.dailyTokenCap);
    $("operatorState").textContent=settings.paused?"Paused":modeLabel[settings.mode];$("operatorState").className=settings.paused?"paused":settings.mode;
    $("operatorPause").textContent=settings.paused?"Resume operator":"Pause operator";
    $("operatorRunNow").disabled=settings.paused||operatorRuns.some(run=>run.status==="running");
    if($("autopilotState"))$("autopilotState").textContent=settings.paused?"Operator paused":`${modeLabel[settings.mode]} mode`;
    renderLatest(operatorRuns.find(run=>run.status!=="skipped")||operatorRuns[0]);
    $("operatorHistory").innerHTML=operatorRuns.length?`<table><thead><tr><th>Started</th><th>Trigger</th><th>Mode</th><th>Status</th><th>Tokens</th><th>Notes</th></tr></thead><tbody>${operatorRuns.map(run=>`<tr><td>${new Date(run.started_at).toLocaleString()}</td><td>${escapeHtml(run.trigger)}</td><td>${escapeHtml(run.mode)}</td><td>${escapeHtml(run.status)}</td><td>${Number(run.tokens||0).toLocaleString()}</td><td>${escapeHtml(run.error||run.brief?.headline||"")}</td></tr>`).join("")}</tbody></table>`:"<p>No cycles recorded yet.</p>";
  }

  async function saveOperatorSettings(changes,message){try{const result=await operatorPost("/api/operator/settings",{settings:changes});operatorSettings=result.settings;renderOperator();toast(message);}catch(error){toast(error.message);}}
  $("operatorSave").onclick=()=>{const mode=document.querySelector('input[name="operatorMode"]:checked')?.value||"copilot";saveOperatorSettings({mode,dailyTokenCap:Number($("operatorTokenCap").value)},`${modeLabel[mode]} mode saved`);};
  $("operatorPause").onclick=()=>saveOperatorSettings({paused:!operatorSettings.paused},operatorSettings.paused?"Operator resumed":"Operator paused. No cycles will run until you resume it.");
  $("operatorRunNow").onclick=async()=>{const button=$("operatorRunNow");button.disabled=true;try{await operatorPost("/api/operator/run",{});toast("Operating cycle started");operatorRuns=[{status:"running",started_at:new Date().toISOString(),trigger:"manual",mode:operatorSettings.mode,tokens:0},...operatorRuns];renderOperator();setTimeout(loadOperator,3000);}catch(error){toast(error.message);button.disabled=false;}};

  window.loadOperator=loadOperator;
  const showBeforeOperator=show;show=view=>{showBeforeOperator(view);if(view==="autopilot")loadOperator();else clearTimeout(operatorPoll);};
})();
