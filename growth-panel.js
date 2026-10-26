(()=>{
  // Growth panel in Launch Studio: source attribution and approved follow-up.
  let growthSummary=null;
  const money=(minor,currency="USD")=>new Intl.NumberFormat(undefined,{style:"currency",currency}).format(Number(minor||0)/100);
  async function growthRequest(path,options={}){const response=await authFetch(path,options),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Growth request failed");return result;}
  const growthPost=(path,body)=>growthRequest(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId,...body})});

  async function loadGrowth(){
    if(!currentWorkspaceId||!$("growthSources"))return;
    try{growthSummary=await growthRequest(`/api/growth/summary?workspace=${encodeURIComponent(currentWorkspaceId)}`);}
    catch(error){growthSummary={error:error.message};}
    renderGrowth();
  }

  function renderGrowth(){
    const summary=growthSummary||{},sources=summary.sources||[];
    if(summary.error){$("growthSources").className="growth-empty";$("growthSources").textContent=summary.error;}
    else if(summary.migrationNeeded){$("growthSources").className="growth-empty";$("growthSources").textContent="Run the growth SQL update in Supabase to start tracking sources.";}
    else if(!sources.length){$("growthSources").className="growth-empty";$("growthSources").textContent=summary.published?"No visits recorded yet. Share your page link to start.":"Publish your page to see traffic sources.";}
    else{$("growthSources").className="growth-table";$("growthSources").innerHTML=`<table><thead><tr><th>Source</th><th>Visitors</th><th>Signups</th><th>Signup rate</th><th>Paid orders</th><th>Net revenue</th></tr></thead><tbody>${sources.map(row=>`<tr><td>${escapeHtml(row.source)}</td><td>${row.visitors}</td><td>${row.signups}</td><td>${row.signupRate===null?"—":`${(row.signupRate*100).toFixed(1)}%`}</td><td>${row.orders}</td><td>${money(row.revenueMinor)}</td></tr>`).join("")}</tbody></table>`;}
    const leads=summary.leads||{new:0},email=summary.email||{};
    $("followupAudience").textContent=leads.new?`${leads.new} new lead${leads.new===1?"":"s"} ready for a follow-up`:"No new leads to email";
    $("followupEmailState").textContent=email.configured?`Sends up to ${email.maxPerBatch} per batch and ${email.maxPerDay} per day.${leads.unsubscribed?` ${leads.unsubscribed} unsubscribed.`:""}`:"Email sending isn't set up, so you can draft and copy messages but not send them from Nova.";
    $("sendFollowup").disabled=!email.configured||!leads.new;
  }

  $("refreshGrowth").onclick=loadGrowth;
  $("draftFollowup").onclick=async()=>{const button=$("draftFollowup");button.disabled=true;button.textContent="Drafting…";try{const result=await growthPost("/api/growth/followup/draft",{notes:$("followupNotes").value.trim()});$("followupSubject").value=result.draft.subject;$("followupBody").value=result.draft.body;toast(result.templated?"Template loaded (no AI model configured). Edit before sending.":"Draft ready. Edit it before sending.");}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent="✦ Draft follow-up";}};
  $("copyFollowup").onclick=async()=>{const text=`Subject: ${$("followupSubject").value}\n\n${$("followupBody").value}`;try{await navigator.clipboard.writeText(text);toast("Draft copied");}catch{prompt("Copy this draft",text);}};
  // Sending is an external action: the founder confirms the exact subject and
  // recipient count for every batch.
  $("sendFollowup").onclick=async()=>{
    const subject=$("followupSubject").value.trim(),body=$("followupBody").value.trim(),count=growthSummary?.leads?.new||0;
    if(subject.length<3||body.length<20)return toast("Write or draft the subject and message first");
    if(!confirm(`Send this email to ${Math.min(count,growthSummary?.email?.maxPerBatch||50)} new lead${count===1?"":"s"}?\n\nSubject: ${subject}\n\nEach message includes an unsubscribe link and replies go to you. This can't be undone.`))return;
    const button=$("sendFollowup");button.disabled=true;button.textContent="Sending…";
    try{const result=await growthPost("/api/growth/followup/send",{subject,body,confirm:true});toast(`Sent ${result.sent}${result.failed?`, ${result.failed} failed`:""}${result.skippedForLimits?`, ${result.skippedForLimits} held for the daily limit`:""}`);state.activities=state.activities||[];state.activities.push({title:"Lead follow-up sent",detail:`${result.sent} email${result.sent===1?"":"s"} · ${subject.slice(0,60)}`});await save();await loadGrowth();if(window.loadPublishing)window.loadPublishing();}
    catch(error){toast(error.message);}finally{button.textContent="Review and send →";renderGrowth();}
  };

  window.loadGrowth=loadGrowth;
  const showBeforeGrowth=show;show=view=>{showBeforeGrowth(view);if(view==="studio")loadGrowth();};
})();
