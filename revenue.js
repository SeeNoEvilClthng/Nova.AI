(()=>{
  titles.revenue="Revenue";
  // Revenue figures come only from the server's Stripe-synced order ledger.
  // Offers are drafts until the founder explicitly takes one live.
  let revenueStatus={connected:false},revenueSummary=null,revenueOrders=[];
  const money=(amount,currency="USD")=>new Intl.NumberFormat(undefined,{style:"currency",currency}).format(Number(amount||0));
  const minor=(amount,currency)=>money(Number(amount||0)/100,currency);
  const billingLabel=billing=>billing==="one_time"?"one-time":`per ${String(billing||"").replace("ly","")}`;
  async function revenueRequest(path,options={}){const response=await authFetch(path,options),result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Revenue request failed");return result;}
  const post=(path,body)=>revenueRequest(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({workspaceId:currentWorkspaceId,...body})});

  async function loadRevenue(){
    if(!currentWorkspaceId)return;
    try{const result=await revenueRequest(`/api/revenue/summary?workspace=${encodeURIComponent(currentWorkspaceId)}`);revenueStatus=result.status||{connected:false};revenueSummary=result.summary;revenueOrders=result.orders||[];}
    catch(error){revenueStatus={connected:false,unavailable:error.message};revenueSummary=null;revenueOrders=[];}
    renderRevenue();
  }
  window.loadRevenue=loadRevenue;

  function replaceOffer(offer){state.offers=(state.offers||[]).map(item=>item.id===offer.id?offer:item);}

  function renderRevenue(){
    if(!$("offerList"))return;
    const offers=state.offers||[],live=offers.filter(item=>item.status==="active"&&item.checkout?.url),connected=Boolean(revenueStatus.connected),summary=revenueSummary;
    const checks=[{label:"Launch plan generated",done:Boolean(state.plan)},{label:"At least one offer exists",done:Boolean(offers.length)},{label:"Company Stripe account connected",done:connected},{label:"An offer has a live checkout link",done:Boolean(live.length)},{label:"Launch page published",done:Boolean(window.publishingPage?.published||(typeof publishingPage!=="undefined"&&publishingPage?.published))}],score=Math.round(checks.filter(item=>item.done).length/checks.length*100);
    $("revenueReadinessScore").textContent=`${score}%`;$("revenueChecklist").innerHTML=checks.map(item=>`<li class="${item.done?"done":""}">${escapeHtml(item.label)}</li>`).join("");
    $("revenueReadinessTitle").textContent=score===100?"Customers can buy from this company.":live.length?"Checkout is live. Publish the launch page to send traffic.":connected?"Stripe connected. Take an offer live next.":offers.length?"Offer drafted. Connect Stripe next.":"Build the commercial foundation first.";
    $("revenueReadinessText").textContent=connected?`Stripe ${revenueStatus.mode==="live"?"live":"test"} mode. Paid orders sync automatically each day, or press Sync.`:"Draft an offer, connect this company’s own Stripe account with a restricted key, then take the offer live.";
    $("revenueStatus").textContent=connected?(revenueStatus.mode==="live"?"Live payments":"Test payments"):offers.length?"Offer ready · payments pending":"Setup required";$("revenueStatus").className=connected?"ready":"";
    const currency=summary?.currency||"USD";
    $("grossSales").textContent=minor(summary?.grossMinor,currency);
    $("grossNote").textContent=summary?.refundedMinor?`Net ${minor(summary.netMinor,currency)} after ${minor(summary.refundedMinor,currency)} refunded`:summary?.testModeOrders?`${summary.testModeOrders} test-mode order${summary.testModeOrders===1?"":"s"} included`:"Verified paid orders only";
    $("paidOrders").textContent=String(summary?.orders||0);$("activeOffers").textContent=String(live.length);
    $("paymentState").textContent=connected?(revenueStatus.mode==="live"?"Live":"Test mode"):"Not connected";
    $("configurePayments").textContent=connected?"Manage Stripe →":"Connect Stripe →";$("disconnectStripe").hidden=!connected;
    $("lastSynced").textContent=revenueStatus.lastSyncedAt?`Last synced ${new Date(revenueStatus.lastSyncedAt).toLocaleString()}.`:connected?"Not synced yet.":"";
    $("offerList").className=offers.length?"offer-list":"offer-empty";
    $("offerList").innerHTML=offers.length?offers.map(item=>{const hasLink=Boolean(item.checkout?.url),statusText=hasLink?(item.status==="active"?`live · ${item.checkout.mode==="live"?"live payments":"test payments"}`:"paused"):"draft";const actions=hasLink?`<button class="secondary" data-offer-copy="${escapeHtml(item.id)}">Copy link</button><button class="secondary" data-offer-active="${escapeHtml(item.id)}">${item.status==="active"?"Pause":"Resume"}</button>`:`<button class="primary" data-offer-live="${escapeHtml(item.id)}" ${connected?"":"disabled title=\"Connect Stripe first\""}>Go live →</button>`;return `<article class="offer-row"><div><small>${escapeHtml(item.type)} · ${escapeHtml(statusText)}</small><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.description)}</p></div><div class="offer-price"><strong>${money(item.price,item.currency)}</strong><span>${billingLabel(item.billing)}</span><div class="offer-actions">${actions}<button class="secondary" data-offer-delete="${escapeHtml(item.id)}">Remove</button></div></div></article>`}).join(""):`<b>No offers yet</b><span>Create the first product or service this company will sell, or let Nova draft one from your plan.</span>`;
    $("orderCount").textContent=`${summary?.orders||0} order${summary?.orders===1?"":"s"}`;
    $("orderList").className=revenueOrders.length?"order-list":"order-empty";
    $("orderList").innerHTML=revenueOrders.length?revenueOrders.map(order=>`<div class="order-row"><div><b>${escapeHtml(order.customer_email||"Customer")}</b><span>${new Date(order.paid_at).toLocaleDateString()}${order.mode==="test"?" · TEST":""}${(offers.find(offer=>offer.id===order.offer_id)||{}).name?` · ${escapeHtml(offers.find(offer=>offer.id===order.offer_id).name)}`:""}</span></div><strong>${minor(order.amount_minor,order.currency)}${order.refunded_minor?`<em>−${minor(order.refunded_minor,order.currency)} refunded</em>`:""}</strong></div>`).join(""):`<b>No paid orders yet</b><span>${connected?"Take an offer live, share the link or publish the launch page, then sync.":"Connect company payments and take an offer live to begin selling."}</span>`;
    bindOfferActions(offers);
  }

  function bindOfferActions(offers){
    $("offerList").querySelectorAll("[data-offer-live]").forEach(button=>button.onclick=async()=>{const offer=offers.find(item=>item.id===button.dataset.offerLive);if(!offer)return;const mode=revenueStatus.mode==="live"?"LIVE":"TEST";if(!confirm(`Take “${offer.name}” live?\n\nNova will create a product, a ${money(offer.price,offer.currency)} ${billingLabel(offer.billing)} price, and a public checkout link in this company’s Stripe account (${mode} mode). Customers who use the link will be charged by Stripe.`))return;button.disabled=true;try{const result=await post("/api/revenue/offers/checkout",{offerId:offer.id,confirm:true});replaceOffer(result.offer);state.activities=state.activities||[];state.activities.push({title:"Offer taken live with Stripe checkout",detail:`${offer.name} · ${mode} mode`});await save();render();toast("Checkout link created in Stripe");}catch(error){toast(error.message);button.disabled=false;}});
    $("offerList").querySelectorAll("[data-offer-copy]").forEach(button=>button.onclick=async()=>{const offer=offers.find(item=>item.id===button.dataset.offerCopy);try{await navigator.clipboard.writeText(offer.checkout.url);toast("Checkout link copied");}catch{prompt("Checkout link",offer.checkout.url);}});
    $("offerList").querySelectorAll("[data-offer-active]").forEach(button=>button.onclick=async()=>{const offer=offers.find(item=>item.id===button.dataset.offerActive);if(!offer)return;button.disabled=true;try{const result=await post("/api/revenue/offers/active",{offerId:offer.id,active:offer.status!=="active"});replaceOffer(result.offer);render();toast(result.offer.status==="active"?"Checkout link resumed":"Checkout link paused in Stripe");}catch(error){toast(error.message);button.disabled=false;}});
    $("offerList").querySelectorAll("[data-offer-delete]").forEach(button=>button.onclick=async()=>{const offer=offers.find(item=>item.id===button.dataset.offerDelete);if(!offer||!confirm(`Remove the “${offer.name}” offer?${offer.checkout?"\n\nIts Stripe checkout link will be deactivated first.":""}`))return;try{if(offer.checkout?.paymentLinkId&&offer.status==="active")await post("/api/revenue/offers/active",{offerId:offer.id,active:false});state.offers=(state.offers||[]).filter(item=>item.id!==offer.id);await save();render();toast("Offer removed");}catch(error){toast(error.message);}});
  }

  $("openOfferForm").onclick=()=>{$("offerForm").hidden=false;$("offerName").focus();};$("cancelOffer").onclick=()=>{$("offerForm").hidden=true;$("offerDraftNote").hidden=true;};
  $("offerForm").onsubmit=async event=>{event.preventDefault();const offer={id:crypto.randomUUID?.()||`offer-${Date.now()}`,name:$("offerName").value.trim(),type:$("offerType").value,price:Number($("offerPrice").value),currency:$("offerCurrency").value,billing:$("offerBilling").value,description:$("offerDescription").value.trim(),status:"draft",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};if(!offer.name||offer.description.length<12||offer.price<.5)return toast("Add a clear offer, customer promise, and valid price");state.offers=[offer,...(state.offers||[])].slice(0,25);state.activities=state.activities||[];state.activities.push({title:"Customer offer created",detail:`${offer.name} · ${money(offer.price,offer.currency)}`});await save();event.target.reset();$("offerPrice").value="99";$("offerForm").hidden=true;$("offerDraftNote").hidden=true;render();toast("Offer saved in draft mode");};

  // AI drafts fill the form for the founder to edit; nothing is saved or
  // published until they press Save, and economics are labelled as estimates.
  $("draftOfferAi").onclick=async()=>{const button=$("draftOfferAi");button.disabled=true;button.textContent="Drafting…";try{const result=await post("/api/revenue/offers/draft",{});const draft=result.draft;recordUsage(result.contribution,"offer");$("offerName").value=draft.name;$("offerType").value=draft.type;$("offerPrice").value=String(draft.price);$("offerCurrency").value=draft.currency;$("offerBilling").value=draft.billing;$("offerDescription").value=draft.description;$("offerForm").hidden=false;const economics=draft.unitEconomics||{},templated=result.contribution?.model==="Demo engine";$("offerDraftNote").hidden=false;$("offerDraftNote").innerHTML=`<small>${templated?"TEMPLATE · NO AI MODEL CONFIGURED":"AI DRAFT · REVIEW BEFORE SAVING"}</small><p>${escapeHtml(draft.pricingRationale)}</p><ul><li>Estimated cost per sale: ${money(economics.estimatedCostPerSale,draft.currency)}</li><li>Estimated gross margin: ${Number(economics.estimatedGrossMarginPercent||0)}%</li><li>Sales to reach the first goal: ${Number(economics.salesToFirstGoal||0)}</li>${(economics.assumptions||[]).map(item=>`<li>Assumption: ${escapeHtml(item)}</li>`).join("")}${(draft.risks||[]).map(item=>`<li>Risk: ${escapeHtml(item)}</li>`).join("")}</ul><span>These are estimates, not verified results.</span>`;await save();toast(templated?"Template offer loaded. Edit before saving.":"Offer drafted. Review and edit before saving.");}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent="✦ Draft with AI";}};

  $("configurePayments").onclick=()=>{$("stripeConnectForm").hidden=!$("stripeConnectForm").hidden;if(!$("stripeConnectForm").hidden)$("stripeKey").focus();};
  $("cancelStripe").onclick=()=>{$("stripeConnectForm").hidden=true;$("stripeKey").value="";};
  $("stripeConnectForm").onsubmit=async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;try{const result=await post("/api/revenue/stripe/connect",{apiKey:$("stripeKey").value.trim(),confirmOwnership:$("stripeOwnership").checked});$("stripeKey").value="";$("stripeConnectForm").hidden=true;toast(`Stripe connected in ${result.mode} mode`);await loadRevenue();}catch(error){toast(error.message);}finally{submit.disabled=false;}};
  $("disconnectStripe").onclick=async()=>{if(!confirm("Disconnect this company’s Stripe account? Existing checkout links keep working in Stripe, but Nova will stop syncing orders until you reconnect."))return;try{await post("/api/revenue/stripe/disconnect",{});$("stripeConnectForm").hidden=true;toast("Stripe disconnected");await loadRevenue();}catch(error){toast(error.message);}};
  $("syncRevenue").onclick=async()=>{const button=$("syncRevenue");button.disabled=true;button.textContent="Syncing…";try{const result=await post("/api/revenue/sync",{});toast(result.sync.warnings?.[0]||`Synced ${result.sync.ordersSeen} paid order${result.sync.ordersSeen===1?"":"s"} from Stripe`);await loadRevenue();}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent="Sync";}};

  const originalRender=render;render=()=>{originalRender();renderRevenue();};renderRevenue();
  const showBeforeRevenue=show;show=view=>{showBeforeRevenue(view);if(view==="revenue")loadRevenue();};
})();
