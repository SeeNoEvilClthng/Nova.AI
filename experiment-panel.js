(()=>{
  // Launch Studio A/B test panel: start a headline test, watch results, and
  // keep a version. Winners are only called by the server's statistics.
  let experimentData=null;
  const pct=value=>`${(Number(value||0)*100).toFixed(1)}%`;
  async function experimentRequest(path,options={}){const response=await authFetch(path,options),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"A/B test request failed");return result;}
  const experimentPost=(path,body)=>experimentRequest(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId,...body})});

  async function loadExperiments(){
    if(!currentWorkspaceId||!$("experimentBody"))return;
    try{experimentData=await experimentRequest(`/api/experiments?workspace=${encodeURIComponent(currentWorkspaceId)}`);}
    catch(error){experimentData={error:error.message};}
    renderExperiments();
  }

  function resultsTable(experiment){
    const results=experiment.results;if(!results)return"";
    return `<table class="experiment-table"><thead><tr><th>Version</th><th>Copy</th><th>Visitors</th><th>Signups</th><th>Signup rate</th><th>Paid orders</th></tr></thead><tbody>${results.variants.map(row=>`<tr class="${results.winner===row.variant?"winner":""}"><td>${row.variant.toUpperCase()}${results.winner===row.variant?" ✓":""}</td><td>${escapeHtml(experiment.variants[row.variant]?.headline||"")}</td><td>${row.visitors}</td><td>${row.signups}</td><td>${pct(row.signupRate)}</td><td>${row.orders}</td></tr>`).join("")}</tbody></table><p class="experiment-verdict ${escapeHtml(results.status)}">${escapeHtml(results.message)}</p>`;
  }

  function renderExperiments(){
    const data=experimentData||{},running=(data.experiments||[]).find(item=>item.status==="running"),last=(data.experiments||[]).find(item=>item.status==="completed");
    $("experimentForm").hidden=true;
    if(data.error){$("experimentState").textContent="Unavailable";$("experimentBody").className="growth-empty";$("experimentBody").textContent=data.error;return;}
    if(!data.published){$("experimentState").textContent="—";$("experimentBody").className="growth-empty";$("experimentBody").textContent="Publish your launch page to run a test.";return;}
    if(running){
      $("experimentState").textContent="Running";
      $("experimentBody").className="experiment-running";
      $("experimentBody").innerHTML=`${resultsTable(running)}${running.variants.b?.hypothesis?`<p class="growth-footer-note">Hypothesis: ${escapeHtml(running.variants.b.hypothesis)}</p>`:""}<div class="growth-actions"><button class="secondary" type="button" data-experiment-keep="a">End test · keep A</button><button class="${running.results?.winner==="b"?"primary":"secondary"}" type="button" data-experiment-keep="b">End test · use B</button></div>`;
      $("experimentBody").querySelectorAll("[data-experiment-keep]").forEach(button=>button.onclick=async()=>{
        const keep=button.dataset.experimentKeep,winner=running.results?.winner;
        const warning=keep==="b"&&winner!=="b"?"\n\nNova hasn't found that B is better yet, so this would be a judgment call rather than a tested result.":"";
        if(!confirm(`${keep==="b"?"Replace your live headline with version B":"Keep version A as your live headline"} and end the test?${warning}`))return;
        button.disabled=true;try{await experimentPost(`/api/experiments/${encodeURIComponent(running.id)}/end`,{keep,confirm:true});toast(keep==="b"?"Version B is now your live headline":"Test ended; version A stays live");if(window.loadPublishing)window.loadPublishing();await loadExperiments();}catch(error){toast(error.message);button.disabled=false;}
      });
      return;
    }
    $("experimentState").textContent=last?"Last test ended":"Ready";
    $("experimentBody").className=last?"experiment-running":"growth-empty";
    $("experimentBody").innerHTML=`${last?`<p class="growth-footer-note">Last test kept version ${escapeHtml(String(last.appliedVariant||"a").toUpperCase())}.</p>${resultsTable(last)}`:"Version A is your current live headline:"}<p class="experiment-current"><b>${escapeHtml(data.current?.headline||"")}</b><span>${escapeHtml(data.current?.subhead||"")}</span></p>`;
    $("experimentForm").hidden=false;
  }

  $("draftExperiment").onclick=async()=>{const button=$("draftExperiment");button.disabled=true;button.textContent="Drafting…";try{const result=await experimentPost("/api/experiments/draft",{});$("experimentHeadline").value=result.variant.headline;$("experimentSubhead").value=result.variant.subhead;$("experimentHypothesis").value=result.variant.hypothesis;$("experimentHypothesisText").textContent=result.templated?"No AI model is configured, so this is the current copy. Edit it into a real alternative.":`Hypothesis: ${result.variant.hypothesis}`;}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent="✦ Draft version B";}};
  $("experimentForm").onsubmit=async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;try{await experimentPost("/api/experiments",{headline:$("experimentHeadline").value,subhead:$("experimentSubhead").value,hypothesis:$("experimentHypothesis").value});event.target.reset();$("experimentHypothesisText").textContent="";toast("A/B test started. Half of new visitors now see version B.");await loadExperiments();}catch(error){toast(error.message);}finally{submit.disabled=false;}};

  window.loadExperiments=loadExperiments;
  const showBeforeExperiments=show;show=view=>{showBeforeExperiments(view);if(view==="studio")loadExperiments();};
})();
