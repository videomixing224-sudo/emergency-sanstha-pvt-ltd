const app=document.getElementById("app");
let token=localStorage.getItem("es_token");
let me=JSON.parse(localStorage.getItem("es_user")||"null");

async function api(url,opt={}){
  opt.headers={...(opt.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};
  if(opt.body && !(opt.body instanceof FormData)) {opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(opt.body)}
  const r=await fetch(url,opt); const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Request failed");
  return data;
}
function money(v){return "₹"+Number(v||0).toLocaleString("en-IN")}
function logout(){localStorage.clear();token=null;me=null;renderLogin()}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

function renderLogin(){
app.innerHTML=`<div class="login-page">
  <div class="login-brand"><img src="/logo.png" alt="Emergency Sanstha Loan PVT LTD logo"><div class="login-brand-title">Emergency Sanstha PVT LTD</div><div class="login-brand-subtitle">Loan & Customer Management Portal</div></div>
  <div class="login-cards">
    <section class="login-card admin-card">
      <img class="login-card-logo" src="/logo.png" alt="Emergency Sanstha logo">
      <h1>Admin Login</h1>
      <p class="muted">Sign in to access admin panel</p>
      <form onsubmit="adminLogin(event)" class="form">
        <div class="field full"><label>Admin Email</label><input id="ae" type="email" autocomplete="username" required></div>
        <div class="field full"><label>Password</label><input id="ap" type="password" autocomplete="current-password" required></div>
        <div class="field full"><button class="btn login-btn admin-login-btn">Login as Admin →</button></div>
      </form>
      <div class="secure-login">🔒 Secure Admin Access</div>
    </section>
    <section class="login-card customer-card">
      <img class="login-card-logo" src="/logo.png" alt="Emergency Sanstha logo">
      <h1>Customer Login</h1>
      <p class="muted">Sign in to access your account</p>
      <div class="notice">Customer User ID = registered mobile number. Password is given by Admin when the loan is created.</div>
      <form onsubmit="customerLogin(event)" class="form">
        <div class="field full"><label>Mobile Number / User ID</label><input id="clogin" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number" autocomplete="username" required></div>
        <div class="field full"><label>Password</label><input id="cpass" type="password" placeholder="Customer password" autocomplete="current-password" required></div>
        <div class="field full"><button class="btn login-btn customer-login-btn">Login as Customer →</button></div>
      </form>
      <div class="secure-login">🛡️ Secure Customer Access</div>
    </section>
  </div>
</div>`;
}
function loginMode(mode){ return; }

async function adminLogin(e){e.preventDefault();try{const d=await api("/api/auth/admin-login",{method:"POST",body:{email:ae.value,password:ap.value}});setSession(d)}catch(e){alert(e.message)}}
async function customerLogin(e){e.preventDefault();try{const d=await api("/api/auth/customer-login",{method:"POST",body:{login_id:clogin.value,password:cpass.value}});setSession(d)}catch(e){alert(e.message)}}
async function requestOtp(){try{const d=await api("/api/auth/request-otp",{method:"POST",body:{mobile:mobile.value}});document.getElementById("otpmsg").textContent=d.demo_otp?`Demo OTP: ${d.demo_otp}`:d.message}catch(e){alert(e.message)}}
async function verifyOtp(){try{const d=await api("/api/auth/verify-otp",{method:"POST",body:{mobile:mobile.value,otp:otp.value,role:role.value}});setSession(d)}catch(e){alert(e.message)}}
function setSession(d){token=d.token;me=d.user;localStorage.setItem("es_token",token);localStorage.setItem("es_user",JSON.stringify(me));renderApp()}

async function renderApp(){
 if(!token){renderLogin();return}
 if(me.role==="admin") renderAdmin(); else renderCustomer();
}

function shell(title,buttons,body){
app.innerHTML=`<header class="top"><div class="brand">Emergency Sanstha PVT LTD</div><div class="row"><span>${esc(me?.name||"User")}</span><button class="btn secondary" onclick="logout()">Logout</button></div></header>
<div class="wrap"><aside class="side">${buttons}</aside><main class="main"><div id="content"><h1>${title}</h1>${body||""}</div></main></div>`;
}
function nav(label,fn,active=""){return `<button class="${active}" onclick="${fn}">${label}</button>`}

async function renderAdmin(){
shell("Admin Dashboard",[
nav("📊 Dashboard","adminDash()","active"),nav("👥 Customers","adminCustomers()"),nav("💰 Loan Management","adminLoans()"),nav("💵 Payment Collection","adminPayments()"),nav("📋 Loan Payments & History","adminLoanPayments()"),nav("📈 Investment Management","adminInvestments()"),nav("📞 Service Requests","adminRequests()"),nav("🏦 Account Mandates","adminMandates()"),nav("🔒 Loan Closure","adminClosures()"),nav("📄 Documents","adminDocs()")
].join(""),`<p class="muted">Loading...</p>`);adminDash();
}
async function adminDash(){
const d=await api("/api/admin/stats"); document.getElementById("content").innerHTML=`<div class="title"><h1>Dashboard</h1><span class="badge">Admin</span></div>
<div class="grid"><div class="card">Customers<div class="stat">${d.customers}</div></div><div class="card">Loans<div class="stat">${d.loans}</div></div><div class="card">Total Investment<div class="stat">${money(d.investments)}</div></div><div class="card">Outstanding Loan<div class="stat">${money(d.outstanding)}</div></div></div>
<div class="card" style="margin-top:18px"><h2>Quick Actions</h2><div class="row"><button class="btn" onclick="adminCustomers();setTimeout(()=>openCustomerForm(),100)">Add Customer</button><button class="btn" onclick="adminLoans();setTimeout(()=>openLoanForm(),100)">Add Loan</button><button class="btn" onclick="adminInvestments();setTimeout(()=>openInvestmentForm(),100)">Add Investment</button><button class="btn" onclick="adminPayments();setTimeout(()=>openQuickPaymentForm(),100)">Collect Payment</button></div></div>`;
}
async function adminCustomers(){
const rows=await api("/api/admin/customers");document.getElementById("content").innerHTML=`<div class="title"><h1>Customers</h1><div class="row"><button class="btn" onclick="openCustomerForm()">+ Add Customer</button><button class="btn secondary" onclick="location.href='/api/admin/export/customers'">Export CSV</button></div></div>
<div class="table-wrap"><table class="table"><tr><th>Name</th><th>Type</th><th>User ID</th><th>Mobile</th><th>Father/Husband</th><th>Language</th><th>Status</th><th>Action</th></tr>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.role}</td><td>${esc(r.login_id||r.mobile)}</td><td>${esc(r.mobile)}</td><td>${esc(r.father_husband)}</td><td>${esc(r.language)}</td><td>${r.status}</td><td><button class="btn secondary" onclick='openCustomerForm(${JSON.stringify(r)})'>Edit</button> <button class="btn secondary danger-btn" onclick='deleteCustomer(${r.id},${JSON.stringify(r.name)})'>Delete</button></td></tr>`).join("")}</table></div>`;
}
async function deleteCustomer(id,name){
  if(!confirm(`Kya aap customer "${name}" ko delete karna chahte hain?\n\nSirf wahi customer delete hoga jiska loan cleared/closed hai ya outstanding 0 hai.`)) return;
  try{
    const result=await api(`/api/admin/customers/${id}`,{method:"DELETE"});
    alert(result.message||"Customer deleted successfully");
    adminCustomers();
  }catch(e){alert(e.message)}
}
function openCustomerForm(r=null){
const x=r||{};showModal(`<h2>${r?"Edit":"Add"} Customer</h2><form onsubmit="saveCustomer(event,${r?x.id:"null"})" class="form">
<div class="field"><label>Name</label><input id="cn" value="${esc(x.name)}" required></div><div class="field"><label>Father/Husband Name</label><input id="cf" value="${esc(x.father_husband)}"></div>
<div class="field"><label>Registered Mobile</label><input id="cm" value="${esc(x.mobile)}" inputmode="numeric" maxlength="10" required></div><div class="field"><label>Email</label><input id="ce" value="${esc(x.email)}"></div><div class="field"><label>Password (optional)</label><input id="cpw" type="password" placeholder="Blank = auto generate"></div>
<div class="field"><label>Type</label><select id="cr"><option value="customer" ${x.role==="customer"?"selected":""}>Customer</option><option value="investor" ${x.role==="investor"?"selected":""}>Investor Customer</option></select></div>
<div class="field"><label>Language</label><select id="cl"><option>Hindi</option><option>English</option><option>Bhojpuri</option><option>Bengali</option><option>Marathi</option></select></div>
<div class="field full"><label>Address</label><textarea id="ca">${esc(x.address)}</textarea></div><div class="field full"><button class="btn">Save</button></div></form>`);
}
async function saveCustomer(e,id){e.preventDefault();try{const body={name:cn.value,father_husband:cf.value,mobile:cm.value,email:ce.value,role:cr.value,language:cl.value,address:ca.value,password:cpw.value};const result=await api(id?`/api/admin/customers/${id}`:"/api/admin/customers",{method:id?"PUT":"POST",body});closeModal();adminCustomers();if(!id)alert(result.message+(result.temporary_password?`\\n\\nUser ID: ${result.customer_user_id}\\nPassword: ${result.temporary_password}`:""))}catch(e){alert(e.message)}}

async function adminLoans(){
const rows=await api("/api/admin/loans");
document.getElementById("content").innerHTML=`<div class="title"><h1>Loan Management</h1><div class="row">
<button class="btn" onclick="openLoanForm()">+ New Loan</button>
<button class="btn" onclick="openLoanAdjustmentForm('interest')">+ Interest</button>
<button class="btn danger" onclick="openLoanAdjustmentForm('penalty')">+ Penalty</button>
<button class="btn secondary" onclick="openLoanAdjustmentForm('add')">Loan +</button>
<button class="btn secondary" onclick="openLoanAdjustmentForm('subtract')">Loan −</button>
<button class="btn secondary" onclick="location.href='/api/admin/export/loans'">Export CSV</button>
</div></div>
<div class="table-wrap"><table class="table"><tr><th>Loan ID</th><th>Customer</th><th>Principal</th><th>Interest</th><th>Penalty</th><th>Added</th><th>Paid</th><th>Reduced</th><th>Remaining</th><th>EMI</th><th>Date</th><th>Status</th><th>Action</th></tr>
${rows.map(r=>`<tr><td><b>${esc(r.loan_id)}</b></td><td>${esc(r.customer_name)}<br><small>${esc(r.mobile||"")}</small></td>
<td>${money(r.principal)}</td><td>${money(r.total_interest)}</td><td>${money(r.total_penalty)}</td><td>${money(r.total_added)}</td>
<td>${money(r.total_paid)}</td><td>${money(r.total_subtracted)}</td><td><b>${money(r.outstanding)}</b></td><td>${money(r.emi)}</td>
<td>${esc(r.start_date||"")}</td><td>${esc(r.status)}</td><td>
<button class="btn" onclick="openPaymentForm(${r.id})">+ Payment</button>
<button class="btn secondary" onclick="openLoanAdjustmentForm('interest',${r.id})">Interest</button>
<button class="btn danger" onclick="openLoanAdjustmentForm('penalty',${r.id})">Penalty</button>
<button class="btn secondary" onclick="openLoanAdjustmentForm('add',${r.id})">+</button>
<button class="btn secondary" onclick="openLoanAdjustmentForm('subtract',${r.id})">−</button>
<button class="btn secondary" onclick="openLoanTransactions(${r.id})">History</button>
<button class="btn secondary" onclick="openAgreement(${r.id})">Agreement</button>
<button class="btn secondary" onclick="markLoanClear(${r.id})">Clear</button>
<button class="btn secondary" onclick="deleteLoan(${r.id},${JSON.stringify(r.status)})">Delete</button>
</td></tr>`).join("")||"<tr><td colspan=13>No loans found</td></tr>"}</table></div>`;
}
async function markLoanClear(id){try{await api(`/api/admin/loans/${id}/clear`,{method:"POST"});adminLoans()}catch(e){alert(e.message)}}
async function deleteLoan(id,status){if(!["cleared","closed"].includes(String(status).toLowerCase())){alert("Pehle loan ko Clear karein. Sirf cleared/closed loan delete ho sakta hai.");return}if(!confirm("Kya aap is cleared loan ko permanently delete karna chahte hain?"))return;try{await api(`/api/admin/loans/${id}`,{method:"DELETE"});adminLoans()}catch(e){alert(e.message)}}
async function openAgreement(id){
  try{
    const status=await api(`/api/admin/loans/${id}/agreement-status`);
    showModal(`<h2>Loan Agreement</h2>
      <div class="notice"><b>Loan ID:</b> ${esc(status.loan_id)}<br>
      <b>Agreement:</b> Generated<br>
      <b>Customer Signature:</b> ${status.signed ? "Signed on "+esc(status.signed_at||"") : "Not signed yet"}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn" onclick="window.open('/api/admin/loans/${id}/agreement.pdf','_blank')">Open / Print PDF</button>
        <button class="btn secondary" onclick="closeModal()">Close</button>
      </div>`);
  }catch(e){alert(e.message)}
}
async function openLoanForm(){
const customers=await api("/api/admin/customers");showModal(`<h2>Create Loan</h2><form onsubmit="saveLoan(event)" class="form">
<div class="field"><label>Customer</label><select id="lc">${customers.map(c=>`<option value="${c.id}">${esc(c.name)} - ${esc(c.mobile)}</option>`).join("")}</select></div>
<div class="field"><label>Loan Product</label><select id="lp"><option>Personal Loan</option><option>Home Loan</option><option>Loan Against Property</option><option>Gold Loan</option><option>Product Loan</option></select></div>
<div class="field"><label>Principal Amount</label><input id="lpr" type="number" required></div><div class="field"><label>Outstanding Amount</label><input id="lo" type="number"></div>
<div class="field"><label>Interest Rate %</label><input id="li" type="number" step="0.01"></div><div class="field"><label>EMI</label><input id="le" type="number"></div>
<div class="field"><label>DPD</label><input id="ld" type="number" min="0"></div><div class="field"><label>Start Date</label><input id="ls" type="date"></div>
<div class="field"><label>Loan Duration (Days)</label><input id="ldays" type="number" min="1" required></div><div class="field"><label>Payment Frequency</label><select id="lf"><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select></div>
<div class="field full"><label>Customer Password (optional)</label><input id="lpw" type="password" placeholder="Blank = auto generate"></div>
<div class="field full"><button class="btn">Create Loan</button></div></form>`);
}
async function saveLoan(e){e.preventDefault();try{const result=await api("/api/admin/loans",{method:"POST",body:{customer_id:lc.value,product:lp.value,principal:lpr.value,outstanding:lo.value,interest_rate:li.value,emi:le.value,dpd:ld.value,start_date:ls.value,duration_days:ldays.value,payment_frequency:lf.value,password:lpw.value}});closeModal();adminLoans();alert(result.message+(result.temporary_password?`\\n\\nUser ID: ${result.customer_user_id}\\nPassword: ${result.temporary_password}`:""))}catch(e){alert(e.message)}}

async function openLoanAdjustmentForm(type, loanId){
const loans=await api("/api/admin/loans");
const selected=loanId ? loans.find(x=>Number(x.id)===Number(loanId)) : loans[0];
if(!selected){alert("Loan not found");return}
const title={interest:"Add Interest",penalty:"Add Penalty",add:"Loan Amount +",subtract:"Loan Amount −"}[type];
showModal(`<h2>${title}</h2>
<div class="notice"><b>Loan:</b> ${esc(selected.loan_id)}<br><b>Customer:</b> ${esc(selected.customer_name)}<br><b>Current Remaining:</b> ${money(selected.outstanding)}</div>
<form onsubmit="saveLoanAdjustment(event,'${type}')" class="form">
<div class="field full"><label>Loan</label><select id="adjLoan" required>
${loans.map(r=>`<option value="${r.id}" ${Number(r.id)===Number(selected.id)?"selected":""}>${esc(r.loan_id)} — ${esc(r.customer_name)} — Remaining ${money(r.outstanding)}</option>`).join("")}
</select></div>
<div class="field"><label>Amount</label><input id="adjAmount" type="number" min="0.01" step="0.01" max="${type==="subtract"?Number(selected.outstanding)||0:""}" required></div>
<div class="field"><label>Date</label><input id="adjDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></div>
<div class="field full"><label>Note</label><textarea id="adjNote" rows="3" placeholder="Reason / details"></textarea></div>
<div class="field full"><button class="btn ${type==="penalty"||type==="subtract"?"danger":""}">Save ${title}</button></div>
</form>`);
}
async function saveLoanAdjustment(e,type){
e.preventDefault();
try{
const result=await api(`/api/admin/loans/${adjLoan.value}/adjustments`,{method:"POST",body:{type,amount:adjAmount.value,transaction_date:adjDate.value,note:adjNote.value}});
closeModal();adminLoans();alert(`${result.message}\nLoan ID: ${result.loan_id}\nRemaining: ${money(result.outstanding)}`);
}catch(e){alert(e.message)}
}
async function openLoanTransactions(id){
try{
const [loans,tx]=await Promise.all([api("/api/admin/loans"),api(`/api/admin/loans/${id}/transactions`)]);
const loan=loans.find(x=>Number(x.id)===Number(id));
showModal(`<h2>Loan Transaction History</h2><div class="notice"><b>${esc(loan?.loan_id||"")}</b> — ${esc(loan?.customer_name||"")}<br>Remaining: <b>${money(loan?.outstanding)}</b></div>
<div class="table-wrap"><table class="table"><tr><th>Type</th><th>Amount</th><th>Date</th><th>Note</th></tr>
${tx.map(t=>`<tr><td><span class="badge">${t.type==="payment"?"Payment":t.type==="interest"?"Interest":t.type==="penalty"?"Penalty":t.type==="add"?"Loan +":"Loan −"}</span></td><td>${money(t.amount)}</td><td>${esc(t.transaction_date)}</td><td>${esc(t.note||"")}</td></tr>`).join("")||"<tr><td colspan=4>No transactions found</td></tr>"}</table></div>
<div class="row" style="margin-top:12px"><button class="btn secondary" onclick="closeModal()">Close</button></div>`);
}catch(e){alert(e.message)}
}

async function openPaymentForm(loanId){
  const loans=await api("/api/admin/loans");
  const loan=loans.find(x=>Number(x.id)===Number(loanId));
  if(!loan){alert("Loan not found");return}
  showModal(`<h2>Add Loan Payment</h2>
  <div class="notice">Loan ID: <b>${esc(loan.loan_id)}</b><br>Customer: <b>${esc(loan.customer_name)}</b><br>Current Outstanding: <b>${money(loan.outstanding)}</b></div>
  <form onsubmit="savePayment(event,${loan.id})" class="form">
    <div class="field"><label>Payment Amount</label><input id="pamt" type="number" min="0.01" max="${Number(loan.outstanding)||0}" step="0.01" required></div>
    <div class="field"><label>Payment Date</label><input id="pdate" type="date" value="${new Date().toISOString().slice(0,10)}" required></div>
    <div class="field full"><label>Note</label><input id="pnote" placeholder="Cash / UPI / Bank / other"></div>
    <div class="field full"><button class="btn">Save Payment</button></div>
  </form>`);
}
async function savePayment(e,loanId){
  e.preventDefault();
  try{
    const result=await api(`/api/admin/loans/${loanId}/payments`,{method:"POST",body:{amount:pamt.value,payment_date:pdate.value,note:pnote.value}});
    closeModal(); adminLoans();
    alert(`${result.message}\nLoan ID: ${result.loan_id}\nJama: ${money(result.amount)}\nBaki: ${money(result.outstanding)}`);
  }catch(e){alert(e.message)}
}
async function openQuickPaymentForm(){
  const loans=await api("/api/admin/loans");
  const active=loans.filter(r=>Number(r.outstanding||0)>0 && !["cleared","closed"].includes(String(r.status||"").toLowerCase()));
  if(!active.length){alert("Koi active loan payment ke liye available nahi hai.");return}
  showModal(`<h2>💵 Collect Loan Payment</h2>
  <form onsubmit="saveQuickPayment(event)" class="form">
    <div class="field full"><label>Loan / Customer</label><select id="qpLoan" required onchange="updateQuickPaymentLimit()">
      ${active.map(r=>`<option value="${r.id}" data-outstanding="${Number(r.outstanding)||0}">${esc(r.loan_id)} — ${esc(r.customer_name)} — Baki ${money(r.outstanding)}</option>`).join("")}
    </select></div>
    <div class="field"><label>Payment Amount</label><input id="qpAmount" type="number" min="0.01" step="0.01" required></div>
    <div class="field"><label>Payment Date</label><input id="qpDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></div>
    <div class="field"><label>Payment Mode</label><select id="qpMode"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option><option>Other</option></select></div>
    <div class="field"><label>Reference No. (optional)</label><input id="qpRef" placeholder="UPI / cheque / transaction no."></div>
    <div class="field full"><label>Note</label><textarea id="qpNote" rows="2" placeholder="Payment details"></textarea></div>
    <div class="field full"><button class="btn">Save Payment</button></div>
  </form>`);
  updateQuickPaymentLimit();
}
function updateQuickPaymentLimit(){
  const opt=document.querySelector("#qpLoan option:checked");
  const input=document.getElementById("qpAmount");
  if(opt&&input) input.max=opt.dataset.outstanding||"";
}
async function saveQuickPayment(e){
  e.preventDefault();
  try{
    const loanId=qpLoan.value;
    const note=[qpMode.value,qpRef.value.trim()?`Ref: ${qpRef.value.trim()}`:"",qpNote.value.trim()].filter(Boolean).join(" | ");
    const result=await api(`/api/admin/loans/${loanId}/payments`,{method:"POST",body:{amount:qpAmount.value,payment_date:qpDate.value,note}});
    closeModal();
    adminPayments();
    alert(`${result.message}\nLoan ID: ${result.loan_id}\nJama: ${money(result.amount)}\nBaki: ${money(result.outstanding)}`);
  }catch(e){alert(e.message)}
}
async function adminPayments(){
  const rows=await api("/api/admin/payments");
  document.getElementById("content").innerHTML=`<div class="title"><h1>Payment Collection</h1><div class="row"><button class="btn" onclick="openQuickPaymentForm()">+ Collect Payment</button><button class="btn secondary" onclick="adminLoans()">Loan Management</button></div></div>
  <div class="card" style="margin-bottom:16px"><b>Payment Entry:</b> Customer/Loan select करें, amount, date और payment mode भरें। Payment save होते ही loan का outstanding automatic कम होगा और transaction history में date के साथ दिखेगा।</div>
  <div class="table-wrap"><table class="table"><tr><th>Loan ID</th><th>Customer</th><th>Amount Jama</th><th>Date</th><th>Note</th></tr>
  ${rows.map(r=>`<tr><td><b>${esc(r.loan_code)}</b></td><td>${esc(r.customer_name)}<br><small>${esc(r.mobile||"")}</small></td><td>${money(r.amount)}</td><td>${esc(r.payment_date)}</td><td>${esc(r.note||"")}</td></tr>`).join("")||"<tr><td colspan=5>No payments found</td></tr>"}
  </table></div>`;
}
async function adminLoanPayments(){
  try{
    const [loans,txns]=await Promise.all([api("/api/admin/loans"),api("/api/admin/loan-transactions")]);
    const byLoan={};
    txns.forEach(t=>(byLoan[t.loan_id]??=[]).push(t));
    document.getElementById("content").innerHTML=`<div class="title"><h1>Loan Payments & History</h1><div class="row"><button class="btn" onclick="openQuickPaymentForm()">+ Collect Payment</button><button class="btn secondary" onclick="adminLoans()">Loan Management</button></div></div>
    <div class="card" style="margin-bottom:16px"><b>Admin Loan View:</b> यहाँ सभी customers के loan, payment, interest, penalty और Loan + / Loan − transactions date के साथ दिखाई देंगे।</div>
    <div class="table-wrap"><table class="table"><tr><th>Loan ID</th><th>Customer</th><th>Loan Amount</th><th>Total Jama</th><th>Outstanding</th><th>Interest</th><th>EMI</th><th>Status</th><th>Action</th></tr>
    ${loans.map(r=>{
      const list=byLoan[r.id]||[];
      const paid=list.filter(t=>t.type==="payment").reduce((a,t)=>a+Number(t.amount||0),0);
      return `<tr><td><b>${esc(r.loan_id)}</b></td><td>${esc(r.customer_name)}<br><small>${esc(r.mobile||"")}</small></td><td>${money(r.principal)}</td><td>${money(paid)}</td><td><b>${money(r.outstanding)}</b></td><td>${money(r.total_interest)}</td><td>${money(r.emi)}</td><td>${esc(r.status)}</td><td><button class="btn" onclick="openPaymentForm(${r.id})">+ Payment</button> <button class="btn secondary" onclick="openAdminLoanHistory(${r.id})">History</button></td></tr>`
    }).join("")||"<tr><td colspan=9>No loan found</td></tr>"}</table></div>`;
  }catch(e){alert(e.message)}
}
async function openAdminLoanHistory(id){
  try{
    const [loans,tx]=await Promise.all([api("/api/admin/loans"),api(`/api/admin/loans/${id}/transactions`)]);
    const loan=loans.find(x=>Number(x.id)===Number(id));
    showModal(`<h2>Loan Payment & Transaction History</h2><div class="notice"><b>Loan ID:</b> ${esc(loan?.loan_id||"")}<br><b>Customer:</b> ${esc(loan?.customer_name||"")}<br><b>Loan Amount:</b> ${money(loan?.principal)}<br><b>Remaining:</b> <b>${money(loan?.outstanding)}</b></div>
    <div class="row" style="margin:12px 0"><button class="btn" onclick="openPaymentForm(${id})">+ Collect Payment</button><button class="btn secondary" onclick="openLoanAdjustmentForm('interest',${id})">+ Interest</button><button class="btn danger" onclick="openLoanAdjustmentForm('penalty',${id})">+ Penalty</button><button class="btn secondary" onclick="openLoanAdjustmentForm('add',${id})">Loan +</button><button class="btn secondary" onclick="openLoanAdjustmentForm('subtract',${id})">Loan −</button></div>
    <div class="table-wrap"><table class="table"><tr><th>Type</th><th>Amount</th><th>Date</th><th>Note</th></tr>${tx.map(t=>`<tr><td><span class="badge">${t.type==="payment"?"Payment":t.type==="interest"?"Interest":t.type==="penalty"?"Penalty":t.type==="add"?"Loan +":"Loan −"}</span></td><td>${money(t.amount)}</td><td>${esc(t.transaction_date)}</td><td>${esc(t.note||"")}</td></tr>`).join("")||"<tr><td colspan=4>No transactions found</td></tr>"}</table></div><div class="row" style="margin-top:12px"><button class="btn secondary" onclick="closeModal()">Close</button></div>`);
  }catch(e){alert(e.message)}
}

async function adminInvestments(){
const [rows,txns]=await Promise.all([
  api("/api/admin/investments"),
  api("/api/admin/investment-transactions")
]);
document.getElementById("content").innerHTML=`<div class="title"><h1>Investment Management</h1>
<div class="row">
<button class="btn" onclick="openInvestmentForm()">+ New Investment</button>
<button class="btn" onclick="openInvestmentTransactionForm('deposit')">💰 Deposit</button>
<button class="btn danger" onclick="openInvestmentTransactionForm('withdrawal')">↘️ निकासी</button>
<button class="btn secondary" onclick="location.href='/api/admin/export/investments'">Export CSV</button>
</div></div>

<div class="grid">
<div class="card">Total Investments<div class="stat">${money(rows.reduce((x,r)=>x+Number(r.amount||0),0))}</div></div>
<div class="card">Total Deposits<div class="stat">${money(rows.reduce((x,r)=>x+Number(r.deposit_total||0),0))}</div></div>
<div class="card">Total निकासी<div class="stat">${money(rows.reduce((x,r)=>x+Number(r.withdrawal_total||0),0))}</div></div>
<div class="card">Current Balance<div class="stat">${money(rows.reduce((x,r)=>x+Number(r.balance||0),0))}</div></div>
</div>

<div class="card" style="margin-top:18px"><h2>Investment Accounts</h2>
<div class="table-wrap"><table class="table"><tr>
<th>Investment ID</th><th>Customer</th><th>Mobile</th><th>New Investment</th><th>Deposit</th><th>निकासी</th><th>Balance</th><th>Date</th><th>Relation</th><th>Status</th>
</tr>${rows.map(r=>`<tr>
<td><b>${esc(r.investment_id)}</b></td><td>${esc(r.customer_name)}</td><td>${esc(r.mobile||"")}</td>
<td>${money(r.amount)}</td><td>${money(r.deposit_total)}</td><td>${money(r.withdrawal_total)}</td><td><b>${money(r.balance)}</b></td>
<td>${esc(r.investment_date)}</td><td>${esc(r.relation_name||"")}</td><td>${esc(r.status)}</td>
</tr>`).join("")||"<tr><td colspan=10>No investment found</td></tr>"}</table></div></div>

<div class="card" style="margin-top:18px"><h2>Deposit / निकासी History</h2>
<div class="table-wrap"><table class="table"><tr><th>Investment ID</th><th>Customer</th><th>Type</th><th>Amount</th><th>Date</th><th>Note</th></tr>
${txns.map(r=>`<tr><td>${esc(r.investment_code)}</td><td>${esc(r.customer_name)}<br><small>${esc(r.mobile||"")}</small></td>
<td><span class="badge">${r.type==="deposit"?"Deposit":"निकासी"}</span></td><td>${money(r.amount)}</td><td>${esc(r.transaction_date)}</td><td>${esc(r.note||"")}</td></tr>`).join("")||"<tr><td colspan=6>No transactions found</td></tr>"}
</table></div></div>`;
}

async function openInvestmentForm(){
const customers=await api("/api/admin/customers");
showModal(`<h2>New Investment</h2><form onsubmit="saveInvestment(event)" class="form">
<div class="field full"><label>Investor Customer</label><select id="ic" required>
${customers.filter(c=>c.role==="investor").map(c=>`<option value="${c.id}">${esc(c.name)} - ${esc(c.mobile||"")}</option>`).join("")}
</select></div>
<div class="field"><label>निवेश राशि</label><input id="ia" type="number" min="1" step="0.01" required></div>
<div class="field"><label>निवेश की तिथि</label><input id="idate" type="date" required></div>
<div class="field full"><label>रिश्ते का नाम</label><input id="ir"></div>
<div class="field full"><button class="btn">Save New Investment</button></div></form>`);
}

async function openInvestmentTransactionForm(type){
const rows=await api("/api/admin/investments");
const label=type==="deposit"?"Deposit / जमा":"निकासी / Withdrawal";
showModal(`<h2>${label}</h2><form onsubmit="saveInvestmentTransaction(event,'${type}')" class="form">
<div class="field full"><label>Investment Account</label><select id="ti" required>
${rows.filter(r=>r.status==="active").map(r=>`<option value="${r.id}">${esc(r.investment_id)} — ${esc(r.customer_name)} — Balance ${money(r.balance)}</option>`).join("")}
</select></div>
<div class="field"><label>${type==="deposit"?"जमा राशि":"निकासी राशि"}</label><input id="ta" type="number" min="1" step="0.01" required></div>
<div class="field"><label>तारीख</label><input id="tdate" type="date" required></div>
<div class="field full"><label>नोट</label><textarea id="tnote" rows="3" placeholder="Transaction note"></textarea></div>
<div class="field full"><button class="btn ${type==="withdrawal"?"danger":""}">${label} Save</button></div></form>`);
}

async function saveInvestment(e){
e.preventDefault();
try{
const result=await api("/api/admin/investments",{method:"POST",body:{
customer_id:ic.value,amount:ia.value,investment_date:idate.value,relation_name:ir.value
}});
closeModal();adminInvestments();alert(`${result.message}\nInvestment ID: ${result.investment_id}`);
}catch(e){alert(e.message)}
}

async function saveInvestmentTransaction(e,type){
e.preventDefault();
try{
const result=await api("/api/admin/investment-transactions",{method:"POST",body:{
investment_id:ti.value,type,amount:ta.value,transaction_date:tdate.value,note:tnote.value
}});
closeModal();adminInvestments();alert(`${result.message}\nCurrent Balance: ${money(result.balance)}`);
}catch(e){alert(e.message)}
}

async function adminRequests(){
const rows=await api("/api/admin/requests");document.getElementById("content").innerHTML=`<div class="title"><h1>Service Requests</h1></div><div class="table-wrap"><table class="table"><tr><th>ID</th><th>Customer</th><th>Subject</th><th>Message</th><th>Status</th><th>Update</th></tr>${rows.map(r=>`<tr><td>${r.id}</td><td>${esc(r.customer_name)}<br>${r.mobile}</td><td>${esc(r.subject)}</td><td>${esc(r.message)}</td><td>${r.status}</td><td><select onchange="updateRequest(${r.id},this.value)"><option ${r.status==="open"?"selected":""}>open</option><option ${r.status==="in_progress"?"selected":""}>in_progress</option><option ${r.status==="closed"?"selected":""}>closed</option></select></td></tr>`).join("")}</table></div>`;
}
async function updateRequest(id,status){await api("/api/admin/requests/"+id,{method:"PUT",body:{status}})}
async function adminMandates(){
const rows=await api("/api/admin/mandates");document.getElementById("content").innerHTML=`<div class="title"><h1>Account Mandates</h1></div><div class="table-wrap"><table class="table"><tr><th>Customer</th><th>Mobile</th><th>Bank</th><th>A/C Last 4</th><th>Status</th><th>Update</th></tr>${rows.map(r=>`<tr><td>${esc(r.customer_name)}</td><td>${r.mobile}</td><td>${esc(r.bank_name)}</td><td>••••${esc(r.account_last4)}</td><td>${r.status}</td><td><select onchange="updateMandate(${r.id},this.value)"><option>pending</option><option>approved</option><option>rejected</option></select></td></tr>`).join("")}</table></div>`;
}
async function updateMandate(id,status){await api("/api/admin/mandates/"+id,{method:"PUT",body:{status}})}
async function adminClosures(){
const rows=await api("/api/admin/closures");document.getElementById("content").innerHTML=`<div class="title"><h1>Loan Closure</h1></div><div class="table-wrap"><table class="table"><tr><th>Customer</th><th>Loan ID</th><th>Reason</th><th>Status</th><th>Update</th></tr>${rows.map(r=>`<tr><td>${esc(r.customer_name)}<br>${r.mobile}</td><td>${esc(r.loan_id)}</td><td>${esc(r.reason)}</td><td>${r.status}</td><td><select onchange="updateClosure(${r.id},this.value)"><option>pending</option><option>approved</option><option>rejected</option><option>closed</option></select></td></tr>`).join("")}</table></div>`;
}
async function updateClosure(id,status){await api("/api/admin/closures/"+id,{method:"PUT",body:{status}})}
async function adminDocs(){
const rows=await api("/api/admin/documents");document.getElementById("content").innerHTML=`<div class="title"><h1>Documents</h1></div><div class="table-wrap"><table class="table"><tr><th>Customer</th><th>Type</th><th>File</th><th>Date</th></tr>${rows.map(r=>`<tr><td>${esc(r.customer_name)}<br>${r.mobile}</td><td>${esc(r.doc_type)}</td><td>${esc(r.file_name)}</td><td>${r.created_at}</td></tr>`).join("")}</table></div>`;
}

async function renderCustomer(){
const d=await api("/api/customer/dashboard");const investor=me.role==="investor";
shell("Customer Dashboard",[
nav("🏠 Dashboard","custDash()","active"),nav("🆔 Loan ID","custLoans()"),nav("💰 My Loan","custLoans()"),nav("🛡️ Insurance","custInsurance()"),nav("🏦 Account Mandate","custMandate()"),nav("📄 My Documents","custDocs()"),...(investor?[nav("📈 Customer Invest Plan","custInvest()")]:[]),nav("🔒 Loan Closure","custClosure()"),nav("📞 Service Request","custRequest()"),nav("⚙️ Setting","custSettings()")
].join(""),"");custDash();
}
async function custDash(){
const d=await api("/api/customer/dashboard");document.getElementById("content").innerHTML=`<div class="title"><h1>Welcome, ${esc(d.user.name)}</h1><span class="badge">${me.role==="investor"?"Investor Customer":"Customer"}</span></div>
<div class="grid"><div class="card">Loans<div class="stat">${d.loans.length}</div></div><div class="card">Outstanding<div class="stat">${money(d.loans.reduce((a,b)=>a+Number(b.outstanding||0),0))}</div></div><div class="card">Investments<div class="stat">${money(d.investments.reduce((a,b)=>a+Number(b.amount||0),0))}</div></div><div class="card">Service Requests<div class="stat">${d.requests.length}</div></div></div>
<div class="card" style="margin-top:18px"><h2>Customer Details</h2><p><b>Customer Name:</b> ${esc(d.user.name)}</p><p><b>Father/Husband:</b> ${esc(d.user.father_husband)}</p><p><b>Registered Mobile:</b> ${esc(d.user.mobile)}</p><p><b>Address:</b> ${esc(d.user.address)}</p><p><b>Language:</b> ${esc(d.user.language)}</p></div>`;
}
async function custLoans(){
const d=await api("/api/customer/dashboard");
const payments=d.payments||[];
document.getElementById("content").innerHTML=`<div class="title"><h1>My Loan & Payments</h1></div>
<div class="table-wrap"><table class="table"><tr><th>Loan ID</th><th>Product</th><th>Loan Amount</th><th>Total Jama</th><th>Outstanding</th><th>Interest</th><th>EMI</th><th>Duration</th><th>Payment</th><th>Status</th><th>Agreement</th></tr>
${d.loans.map(r=>{
 const paid=payments.filter(p=>Number(p.loan_id)===Number(r.id)).reduce((sum,p)=>sum+Number(p.amount||0),0);
 return `<tr><td>${esc(r.loan_id)}</td><td>${esc(r.product)}</td><td>${money(r.principal)}</td><td>${money(paid)}</td><td>${money(r.outstanding)}</td><td>${r.interest_rate}%</td><td>${money(r.emi)}</td><td>${r.duration_days||0} days</td><td>${r.payment_frequency||"monthly"}</td><td>${r.status}</td><td><button class="btn secondary" onclick="openCustomerAgreement(${r.id},${JSON.stringify(r.loan_id)})">Agreement</button></td></tr>`;
}).join("")||"<tr><td colspan=10>No loan found</td></tr>"}</table></div>
<div class="card" style="margin-top:16px"><h2>All Loan Transactions</h2>
<div class="table-wrap"><table class="table"><tr><th>Loan ID</th><th>Type</th><th>Amount</th><th>Date</th><th>Note</th></tr>
${(d.loanTransactions||[]).map(t=>`<tr><td><b>${esc(t.loan_code)}</b></td><td><span class="badge">${t.type==="payment"?"Payment":t.type==="interest"?"Interest":t.type==="penalty"?"Penalty":t.type==="add"?"Loan +":"Loan −"}</span></td><td>${money(t.amount)}</td><td>${esc(t.transaction_date)}</td><td>${esc(t.note||"")}</td></tr>`).join("")||"<tr><td colspan=5>No loan transaction recorded</td></tr>"}
</table></div></div>`;
}
async function openCustomerAgreement(id,loanCode){
  try{
    const d=await api("/api/customer/dashboard");
    const loan=d.loans.find(x=>Number(x.id)===Number(id));
    if(!loan){alert("Loan not found");return}
    showModal(`<h2>Loan Agreement - ${esc(loanCode)}</h2>
      <div class="notice">Please read the agreement PDF before signing. Your signature will be stored with this loan record.</div>
      <div class="row" style="margin:12px 0">
        <button class="btn" onclick="window.open('/api/customer/loans/${id}/agreement.pdf','_blank')">View Agreement PDF</button>
      </div>
      <h3>Customer Signature</h3>
      <canvas id="sigCanvas" width="520" height="180" style="width:100%;max-width:520px;border:1px solid #bbb;border-radius:8px;background:#fff;touch-action:none"></canvas>
      <div class="row" style="margin-top:10px">
        <button type="button" class="btn secondary" onclick="clearSignature()">Clear Signature</button>
        <button type="button" class="btn" onclick="submitSignature(${id})">Sign & Generate Signed PDF</button>
      </div>
      <p class="muted" style="margin-top:8px">Sign inside the box using mouse or touch.</p>`);
    initSignatureCanvas();
  }catch(e){alert(e.message)}
}
let signaturePadState=null;
function initSignatureCanvas(){
  const c=document.getElementById("sigCanvas"); if(!c)return;
  const ctx=c.getContext("2d"); ctx.lineWidth=2; ctx.lineCap="round"; ctx.strokeStyle="#111";
  let drawing=false,has=false;
  const point=e=>{const r=c.getBoundingClientRect(); const p=e.touches?e.touches[0]:e; return {x:(p.clientX-r.left)*c.width/r.width,y:(p.clientY-r.top)*c.height/r.height}};
  const start=e=>{e.preventDefault();drawing=true;has=true;const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y)};
  const move=e=>{if(!drawing)return;e.preventDefault();const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke()};
  const stop=e=>{drawing=false};
  c.onmousedown=start;c.onmousemove=move;c.onmouseup=stop;c.onmouseleave=stop;
  c.ontouchstart=start;c.ontouchmove=move;c.ontouchend=stop;
  signaturePadState={c,ctx,get has(){return has},clear:()=>{ctx.clearRect(0,0,c.width,c.height);has=false}};
}
function clearSignature(){signaturePadState?.clear()}
async function submitSignature(id){
  if(!signaturePadState?.has){alert("Please sign in the signature box first.");return}
  try{
    const signature_data=signaturePadState.c.toDataURL("image/png");
    const result=await api(`/api/customer/loans/${id}/sign-agreement`,{method:"POST",body:{signature_data}});
    alert(result.message);
    window.open(`/api/customer/loans/${id}/agreement.pdf`,"_blank");
    closeModal();
  }catch(e){alert(e.message)}
}
function custInsurance(){document.getElementById("content").innerHTML=`<div class="card"><h1>Insurance</h1><div class="notice">Insurance is currently <b>Not Available</b>.</div></div>`}
function custRequest(){document.getElementById("content").innerHTML=`<div class="card"><h1>Service Request</h1><p class="muted">Support: 06479451097</p><form onsubmit="sendRequest(event)" class="form"><div class="field"><label>Subject</label><input id="rs" required></div><div class="field"><label>Message</label><textarea id="rm" required></textarea></div><div class="field full"><button class="btn">Submit Request</button></div></form></div>`}
async function sendRequest(e){e.preventDefault();try{await api("/api/customer/service-request",{method:"POST",body:{subject:rs.value,message:rm.value}});alert("Service request submitted");custDash()}catch(e){alert(e.message)}}
function custMandate(){document.getElementById("content").innerHTML=`<div class="card"><h1>Account Mandate</h1><form onsubmit="sendMandate(event)" class="form"><div class="field"><label>Bank Name</label><input id="mb" required></div><div class="field"><label>Account Last 4 Digits</label><input id="ml" maxlength="4" required></div><div class="field full"><button class="btn">Submit Mandate</button></div></form></div>`}
async function sendMandate(e){e.preventDefault();try{await api("/api/customer/mandate",{method:"POST",body:{bank_name:mb.value,account_last4:ml.value}});alert("Mandate request submitted")}catch(e){alert(e.message)}}
async function custDocs(){
const rows=await api("/api/customer/documents");document.getElementById("content").innerHTML=`<div class="title"><h1>My Documents</h1></div><div class="card"><form onsubmit="uploadDoc(event)" enctype="multipart/form-data"><div class="form"><div class="field"><label>Document Type</label><select id="dt"><option>Aadhaar Card</option><option>PAN Card</option><option>Bank Passbook</option><option>Other</option></select></div><div class="field"><label>File</label><input id="df" type="file" required></div><div class="field full"><button class="btn">Upload</button></div></div></form></div><div class="table-wrap" style="margin-top:14px"><table class="table"><tr><th>Type</th><th>File</th><th>Date</th></tr>${rows.map(r=>`<tr><td>${esc(r.doc_type)}</td><td>${esc(r.file_name)}</td><td>${r.created_at}</td></tr>`).join("")}</table></div>`;
}
async function uploadDoc(e){e.preventDefault();const fd=new FormData();fd.append("doc_type",dt.value);fd.append("file",df.files[0]);try{await api("/api/customer/document",{method:"POST",body:fd});alert("Uploaded");custDocs()}catch(e){alert(e.message)}}
async function custInvest(){
const d=await api("/api/customer/dashboard");document.getElementById("content").innerHTML=`<div class="title"><h1>Customer Invest Plan</h1></div><div class="card"><h2>Investor Customer Details</h2><p><b>Customer Name:</b> ${esc(d.user.name)}</p><p><b>Father/Husband Name:</b> ${esc(d.user.father_husband)}</p><p><b>Reg. Mobile No.:</b> ${esc(d.user.mobile)}</p><p><b>Address:</b> ${esc(d.user.address)}</p></div><div class="table-wrap" style="margin-top:14px"><table class="table"><tr><th>Investment ID</th><th>Initial Investment</th><th>Deposit</th><th>निकासी</th><th>Current Balance</th><th>निवेश की तिथि</th><th>रिश्ते का नाम</th><th>Status</th></tr>${d.investments.map(r=>`<tr><td>${r.investment_id}</td><td>${money(r.amount)}</td><td>${money(r.deposit_total)}</td><td>${money(r.withdrawal_total)}</td><td><b>${money(r.balance)}</b></td><td>${r.investment_date}</td><td>${esc(r.relation_name)}</td><td>${r.status}</td></tr>`).join("")||"<tr><td colspan=8>No investment found</td></tr>"}</table></div>`}
function custClosure(){document.getElementById("content").innerHTML=`<div class="card"><h1>Loan Closure</h1><form onsubmit="sendClosure(event)" class="form"><div class="field"><label>Loan ID</label><input id="clid" required></div><div class="field"><label>Reason</label><input id="clr"></div><div class="field full"><button class="btn">Request Closure</button></div></form></div>`}
async function sendClosure(e){e.preventDefault();try{await api("/api/customer/closure",{method:"POST",body:{loan_id:clid.value,reason:clr.value}});alert("Closure request submitted")}catch(e){alert(e.message)}}
async function custSettings(){const d=await api("/api/me");document.getElementById("content").innerHTML=`<div class="card"><h1>Setting</h1><form onsubmit="saveProfile(event)" class="form"><div class="field"><label>Name</label><input id="pn" value="${esc(d.user.name)}"></div><div class="field"><label>Father/Husband</label><input id="pf" value="${esc(d.user.father_husband)}"></div><div class="field"><label>Email</label><input id="pe" value="${esc(d.user.email)}"></div><div class="field"><label>Language</label><select id="pl"><option>Hindi</option><option>English</option><option>Bhojpuri</option><option>Bengali</option><option>Marathi</option></select></div><div class="field full"><label>Address</label><textarea id="pa">${esc(d.user.address)}</textarea></div><div class="field full"><button class="btn">Save Settings</button></div></form></div>`}
async function saveProfile(e){e.preventDefault();try{const d=await api("/api/customer/profile",{method:"PUT",body:{name:pn.value,father_husband:pf.value,email:pe.value,language:pl.value,address:pa.value}});me=d.user;localStorage.setItem("es_user",JSON.stringify(me));alert("Settings saved")}catch(e){alert(e.message)}}

function showModal(html){const m=document.createElement("div");m.id="modal";m.className="modal";m.innerHTML=`<div class="modalbox"><div class="title"><span></span><button class="btn secondary" onclick="closeModal()">Close</button></div>${html}</div>`;document.body.appendChild(m)}
function closeModal(){document.getElementById("modal")?.remove()}

if(token && me) renderApp(); else renderLogin();
