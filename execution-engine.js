titles.autopilot="Autopilot";

function executionRisk(task){
  const text=`${task.title||""} ${task.handoff||""}`.toLowerCase();
  const rules=[
    ["money",/buy|purchase|payment|refund|price|pricing|budget|spend|invoice|contract/],
    ["communication",/send|email|message|post|publish|social|outreach|customer|ad campaign/],
    ["production",/deploy|production|delete|remove data|domain|release|ship code/]
  ];
  const match=rules.find(([,pattern])=>pattern.test(text));
  return match?{level:"gated",label:`Founder gate · ${match[0]}`}:{level:"safe",label:"Safe internal work"};
}

function taskProof(task){return (state.executionProofs||[]).find(item=>item.taskId===task.id)}

function renderAutopilot(){
  if(!$("missionList"))return;
  const tasks=state.executionTasks||[],proofs=state.executionProofs||[],verified=proofs.filter(item=>item.status==="verified"),open=tasks.filter(task=>task.status!=="done"),awaiting=tasks.filter(task=>task.status==="done"&&!taskProof(task)),gated=tasks.filter(task=>executionRisk(task).level==="gated"&&task.status!=="done");
  $("missionCount").textContent=String(open.length);$("evidenceCount").textContent=String(awaiting.length);$("verifiedCount").textContent=String(verified.length);$("gateCount").textContent=String(gated.length);
  const rate=tasks.length?Math.round(verified.length/tasks.length*100):0;$("missionProgress").textContent=`${rate}% verified`;$("autopilotState").textContent=gated.length?`${gated.length} founder gate${gated.length===1?"":"s"}`:"Founder supervised";
  $("missionList").className=tasks.length?"mission-list":"engine-empty";
  $("missionList").innerHTML=tasks.length?tasks.map(task=>{
    const proof=taskProof(task),risk=executionRisk(task),verifiedResult=proof?.status==="verified",status=verifiedResult?"Verified":proof?"Evidence submitted":task.status==="done"?"Evidence required":task.status==="in_progress"?"Executing":task.status==="blocked"?"Blocked":"Approved";
    const proofForm=task.status==="done"&&!verifiedResult?`<form class="proof-form" data-proof-form="${escapeHtml(task.id)}"><label>RESULT SUMMARY<textarea required maxlength="1200" data-proof-summary placeholder="What happened? State the observable result, not the activity.">${escapeHtml(proof?.summary||task.completionNote||"")}</textarea></label><label>EVIDENCE SOURCE<input required maxlength="500" data-proof-source placeholder="URL, analytics report, commit, interview note, or artifact reference" value="${escapeHtml(proof?.source||"")}"></label><div class="proof-fields"><label>METRIC<input required maxlength="80" data-proof-metric placeholder="Qualified leads" value="${escapeHtml(proof?.metric||"")}"></label><label>OBSERVED VALUE<input required maxlength="80" data-proof-value placeholder="7" value="${escapeHtml(proof?.value||"")}"></label></div><div class="proof-form-actions"><small>Independent verification runs before this counts as an outcome.</small><button class="primary" type="submit">Verify evidence →</button></div></form>`:"";
    return `<article class="mission-card"><header><small>${escapeHtml(task.department||"Company")} · ${escapeHtml(task.owner||"AI employee")}</small><em class="risk-${risk.level}">${escapeHtml(risk.label)}</em></header><h4>${escapeHtml(task.title)}</h4><p>${escapeHtml(task.handoff||"Complete the approved assignment and attach an observable result.")}</p>${verifiedResult?`<p class="verification-note"><b>Independent reviewer · ${proof.score}/100:</b> ${escapeHtml(proof.review)}</p>`:""}<footer><span>${task.updatedAt?new Date(task.updatedAt).toLocaleString():"Not started"}</span><em class="status-${verifiedResult?"verified":proof?"proof":"open"}">${status}</em></footer>${proofForm}</article>`;
  }).join(""):`<b>No active mission yet</b><span>Assign work to your AI Team, review it, then approve the tasks you want Nova to execute.</span><button class="primary" type="button" data-engine-go="team">Assign a mission →</button>`;
  $("missionList").querySelectorAll("[data-engine-go]").forEach(button=>button.onclick=()=>show(button.dataset.engineGo));
  $("missionList").querySelectorAll("[data-proof-form]").forEach(form=>form.onsubmit=async event=>{
    event.preventDefault();const task=tasks.find(item=>item.id===form.dataset.proofForm),button=form.querySelector("button[type=submit]");if(!task)return;
    const submitted={workspaceId:currentWorkspaceId,taskId:task.id,summary:form.querySelector("[data-proof-summary]").value.trim(),source:form.querySelector("[data-proof-source]").value.trim(),metric:form.querySelector("[data-proof-metric]").value.trim(),value:form.querySelector("[data-proof-value]").value.trim()};
    button.disabled=true;button.textContent="Independent reviewer checking…";
    try{
      const response=await authFetch("/api/execution/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(submitted)}),result=await response.json();if(!response.ok)throw new Error(result.error||"Evidence could not be verified");
      const proof=result.proof;state.executionProofs=result.executionProofs;state.activities=result.activities;render();toast(proof.status==="verified"?"Outcome verified and saved with a trusted receipt":proof.review);
    }catch(error){toast(error.message)}finally{if(button.isConnected){button.disabled=false;button.textContent="Verify evidence →";}}
  });
  $("vaultStatus").textContent=verified.length?`${verified.length} verified result${verified.length===1?"":"s"}`:"No evidence yet";$("evidenceVault").className=verified.length?"vault-list":"engine-empty";$("evidenceVault").innerHTML=verified.length?verified.map(proof=>{const task=tasks.find(item=>item.id===proof.taskId)||{};const source=/^https?:\/\//i.test(proof.source)?`<a href="${escapeHtml(proof.source)}" target="_blank" rel="noopener">Open source ↗</a>`:`<span>${escapeHtml(proof.source)}</span>`;return `<article class="vault-item"><header><small>${escapeHtml(task.department||"Company")}</small><span>✓ ${proof.score}/100 VERIFIED</span></header><h4>${escapeHtml(task.title||"Verified outcome")}</h4><p>${escapeHtml(proof.summary)}</p><footer><b>${escapeHtml(proof.metric)} · ${escapeHtml(proof.value)}</b>${source}</footer></article>`}).join(""):`<b>Nothing has been verified</b><span>Completed tasks appear here after their evidence passes independent review.</span>`;
}

const renderBeforeExecutionEngine=render;
render=()=>{renderBeforeExecutionEngine();renderAutopilot();};
