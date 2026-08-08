(() => {
  let entries=[];
  const questions=()=>state.plan?[
    `Tell me about the last time you experienced the problem ${state.plan.name} aims to solve.`,
    "What do you currently do to solve it, and what is frustrating about that approach?",
    "How often does this happen, and what does it cost you in time, money or missed opportunity?",
    `What would have to be true for a solution built for ${state.plan.customer} to feel essential?`,
    "Have you paid for a solution before? What would make this worth paying for now?",
    "Who else is involved in deciding whether to adopt or purchase this?"
  ]:["Generate a launch strategy first so Nova.Ai can tailor the interview guide."];
  const avg=key=>entries.length?entries.reduce((sum,item)=>sum+Number(item[key]),0)/entries.length:0;
  const fmt=value=>value?value.toFixed(1)+"/5":"—";
  function render(){
    const demand=avg("demand_score"),urgency=avg("urgency_score"),willingness=avg("willingness_score"),signal=(demand+urgency+willingness)/3;
    const confidence=Math.min(1,entries.length/10),score=Math.round((signal/5)*confidence*100);
    $("validationCount").textContent=`${entries.length} interview${entries.length===1?"":"s"}`;$("evidenceScore").textContent=score+"%";$("demandAverage").textContent=fmt(demand);$("urgencyAverage").textContent=fmt(urgency);$("willingnessAverage").textContent=fmt(willingness);
    let title="Collect five interviews",text="Evidence beats enthusiasm. Start by speaking with target customers.",icon="○",label="Not enough evidence";
    if(entries.length>=5&&signal>=4){title="Continue and test conversion";text="Customer signals are strong. Put the approved landing page in front of more prospects and measure signups.";icon="↗";label="Promising signal";}
    else if(entries.length>=5&&signal>=2.8){title="Revise the offer";text="The problem has some pull, but the urgency or willingness-to-pay signal needs a sharper offer.";icon="↻";label="Mixed signal";}
    else if(entries.length>=5){title="Stop and investigate";text="The current idea is not showing enough pull. Revisit the customer or problem before building more.";icon="!";label="Weak signal";}
    $("recommendationTitle").textContent=title;$("recommendationText").textContent=text;$("recommendationIcon").textContent=icon;$("evidenceLabel").textContent=label;
    $("interviewQuestions").innerHTML=questions().map(question=>`<li>${escapeHtml(question)}</li>`).join("");
    $("evidenceList").className=entries.length?"evidence-list":"empty";$("evidenceList").innerHTML=entries.length?entries.map(item=>`<div class="evidence-item"><div><b>${escapeHtml(item.respondent_name)}</b><span>${new Date(item.created_at).toLocaleDateString()} · Demand ${item.demand_score} · Urgency ${item.urgency_score} · Pay ${item.willingness_score}</span><p>${escapeHtml(item.notes)}</p></div><button data-delete-evidence="${item.id}" title="Delete evidence">×</button></div>`).join(""):`<b>No interviews yet</b><span>Your customer evidence will appear here.</span>`;
    document.querySelectorAll("[data-delete-evidence]").forEach(button=>button.onclick=async()=>{if(!confirm("Delete this validation entry?"))return;try{const response=await authFetch(`/api/validation/${button.dataset.deleteEvidence}`,{method:"DELETE"});if(!response.ok)throw new Error("Could not delete evidence");await loadValidation();toast("Evidence removed");}catch(error){toast(error.message)}});
  }
  async function loadValidation(){try{if(!currentWorkspaceId)return;const response=await authFetch(`/api/validation?workspace=${encodeURIComponent(currentWorkspaceId)}`),result=await response.json();if(!response.ok)throw new Error(result.error||"Could not load validation");entries=result.entries;render();}catch(error){toast(error.message)}}
  $("evidenceForm").onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const response=await authFetch("/api/validation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId,respondentName:$("respondentName").value,respondentEmail:$("respondentEmail").value,notes:$("validationNotes").value,demandScore:Number($("demandScore").value),urgencyScore:Number($("urgencyScore").value),willingnessScore:Number($("willingnessScore").value)})}),result=await response.json();if(!response.ok)throw new Error(result.error||"Could not save evidence");event.target.reset();await loadValidation();toast("Validation evidence saved");}catch(error){toast(error.message)}finally{button.disabled=false}};
  $("copyQuestions").onclick=async()=>{try{await navigator.clipboard.writeText(questions().map((q,i)=>`${i+1}. ${q}`).join("\n"));toast("Interview guide copied");}catch{toast("Could not copy questions")}};
  window.loadValidation=loadValidation;render();
})();
