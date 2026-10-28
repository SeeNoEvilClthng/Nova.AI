(()=>{
  // Action Center on the Autopilot screen: approve or reject concrete actions,
  // then see the provider evidence and receipt for what actually ran.
  let actionList=[],actionPoll=null;
  const statusLabel={proposed:"Needs your approval",approved:"Starting",executing:"Running",succeeded:"Done · verified",failed:"Failed",rejected:"Rejected"};
  const money=(amount,currency="USD")=>new Intl.NumberFormat(undefined,{style:"currency",currency}).format(Number(amount||0));
  async function actionRequest(path,options={}){const response=await authFetch(path,options),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Action request failed");return result;}

  async function loadActions(){
    if(!currentWorkspaceId||!$("actionList"))return;
    try{actionList=(await actionRequest(`/api/actions?workspace=${encodeURIComponent(currentWorkspaceId)}`)).actions||[];renderActions();}
    catch(error){$("actionCenterState").textContent="Unavailable";$("actionList").className="action-empty";$("actionList").textContent=error.message;}
    clearTimeout(actionPoll);if(actionList.some(action=>["approved","executing"].includes(action.status)))actionPoll=setTimeout(loadActions,3000);
  }

  function preview(action){
    const p=action.payload||{};
    if(action.kind==="lead_followup")return `<div class="action-preview"><small>To ${Number(p.leadCount||0)} new lead${p.leadCount===1?"":"s"} · subject</small><b>${escapeHtml(p.subject)}</b><pre>${escapeHtml(p.body)}</pre><small>An unsubscribe link and the reason they're receiving it are added to every email. Replies go to you.</small></div>`;
    if(action.kind==="offer_go_live")return `<div class="action-preview"><small>Offer</small><b>${escapeHtml(p.name)} · ${money(p.price,p.currency)} ${p.billing==="one_time"?"one-time":`per ${String(p.billing).replace("ly","")}`}</b></div>`;
    return "";
  }

  function evidence(action){
    const e=action.evidence;if(!e)return"";
    const receipt=action.receipt?`<span class="${action.receiptVerified?"verified":"unverified"}">Receipt ${escapeHtml(action.receipt)}… ${action.receiptVerified?"✓ signature valid":"⚠ signature check failed"}</span>`:"";
    if(action.kind==="lead_followup")return `<div class="action-evidence"><b>Sent ${e.sent} email${e.sent===1?"":"s"}${e.failed?`, ${e.failed} rejected`:""}${e.heldForDailyLimit?`, ${e.heldForDailyLimit} held for the daily limit`:""}</b><small>Resend message IDs: ${(e.messageIds||[]).slice(0,3).map(escapeHtml).join(", ")}${(e.messageIds||[]).length>3?` +${e.messageIds.length-3} more`:""}</small>${receipt}</div>`;
    if(action.kind==="offer_go_live")return `<div class="action-evidence"><b>Live in Stripe (${escapeHtml(e.mode)} mode)</b><small>Payment link ${escapeHtml(e.paymentLinkId)} · <a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.url)}</a></small>${receipt}</div>`;
    return "";
  }

  function renderActions(){
    const waiting=actionList.filter(action=>action.status==="proposed").length;
    $("actionCenterState").textContent=waiting?`${waiting} waiting`:"Up to date";$("actionCenterState").className=waiting?"waiting":"";
    $("actionList").className=actionList.length?"action-list":"action-empty";
    $("actionList").innerHTML=actionList.length?actionList.map(action=>`<article class="action-card ${action.status}"><header><small>${escapeHtml(action.kindLabel)} · ${new Date(action.createdAt).toLocaleString()}</small><em>${escapeHtml(statusLabel[action.status]||action.status)}</em></header><h4>${escapeHtml(action.title)}</h4>${action.summary?`<p>${escapeHtml(action.summary)}</p>`:""}${action.status==="proposed"?preview(action):""}${evidence(action)}${action.status==="failed"?`<p class="action-error">${escapeHtml(action.error||"The action failed")}</p>`:""}<div class="action-buttons">${action.status==="proposed"?`<button class="secondary" type="button" data-action-decide="reject" data-action-id="${escapeHtml(action.id)}">Reject</button><button class="primary" type="button" data-action-decide="approve" data-action-id="${escapeHtml(action.id)}">Approve & run →</button>`:action.status==="failed"?`<button class="secondary" type="button" data-action-retry="${escapeHtml(action.id)}">Retry</button>`:""}</div></article>`).join(""):"No actions yet. Run an operating cycle to get proposals.";
    $("actionList").querySelectorAll("[data-action-decide]").forEach(button=>button.onclick=async()=>{
      const action=actionList.find(item=>item.id===button.dataset.actionId);if(!action)return;const approved=button.dataset.actionDecide==="approve";
      if(approved&&!confirm(action.kind==="lead_followup"?`Send this email to ${action.payload.leadCount} new lead${action.payload.leadCount===1?"":"s"} now?\n\nSubject: ${action.payload.subject}\n\nThis can't be undone.`:`Take “${action.payload.name}” live?\n\nNova will create a product, price and public checkout link in this company's Stripe account. Customers who use the link will be charged.`))return;
      button.disabled=true;try{await actionRequest(`/api/actions/${encodeURIComponent(action.id)}/decision`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId,approved})});toast(approved?"Approved. Running now…":"Action rejected");await loadActions();}catch(error){toast(error.message);button.disabled=false;}
    });
    $("actionList").querySelectorAll("[data-action-retry]").forEach(button=>button.onclick=async()=>{button.disabled=true;try{await actionRequest(`/api/actions/${encodeURIComponent(button.dataset.actionRetry)}/retry`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId})});toast("Retrying…");await loadActions();}catch(error){toast(error.message);button.disabled=false;}});
  }

  window.loadActions=loadActions;
  const showBeforeActions=show;show=view=>{showBeforeActions(view);if(view==="autopilot")loadActions();else clearTimeout(actionPoll);};
})();
