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
app.innerHTML=`<div class="login"><div class="loginbox">
<h1>Emergency Sanstha Pvt Ltd</h1><p class="muted">Loan & Customer Management Portal</p>
<div class="tabs"><button class="btn" onclick="loginMode('customer')">Customer / Investor</button><button class="btn secondary" onclick="loginMode('admin')">Admin</button></div>
<div id="loginarea"></div></div></div>`; loginMode("customer");
}
function loginMode(mode){
const el=document.getElementById("loginarea");
if(mode==="admin") el.innerHTML=`<form onsubmit="adminLogin(event)" class="form">
<div class="field full"><label>Admin Email</label><input id="ae" type="email" required></div>
<div class="field full"><label>Password</label><input id="ap" type="password" required></div>
<div class="field full"><button class="btn">Login</button></div></form>`;
else el.innerHTML=`<div class="notice">Customer User ID = registered mobile number. Password is given by Admin when the loan is created.</div>
<form onsubmit="customerLogin(event)" class="form">
<div class="field full"><label>User ID / Mobile Number</label><input id="clogin" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number" required></div>
<div class="field full"><label>Password</label><input id="cpass" type="password" placeholder="Customer password" required></div>
<div class="field full"><button class="btn">Customer Login</button></div></form>
<div class="notice" style="margin-top:12px">New customer? Admin must create the customer and loan first.</div>`;
}

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
nav("📊 Dashboard","adminDash()","active"),nav("👥 Customers","adminCustomers()"),nav("💰 Loan Management","adminLoans()"),nav("📈 Investment Management","adminInvestments()"),nav("📞 Service Requests","adminRequests()"),nav("🏦 Account Mandates","adminMandates()"),nav("🔒 Loan Closure","adminClosures()"),nav("📄 Documents","adminDocs()")
].join(""),`<p class="muted">Loading...</p>`);adminDash();
}
async function adminDash(){
const d=await api("/api/admin/stats"); document.getElementById("content").innerHTML=`<div class="title"><h1>Dashboard</h1><span class="badge">Admin</span></div>
<div class="grid"><div class="card">Customers<div class="stat">${d.customers}</div></div><div class="card">Loans<div class="stat">${d.loans}</div></div><div class="card">Total Investment<div class="stat">${money(d.investments)}</div></div><div class="card">Outstanding Loan<div class="stat">${money(d.outstanding)}</div></div></div>
<div class="card" style="margin-top:18px"><h2>Quick Actions</h2><div class="row"><button class="btn" onclick="adminCustomers();setTimeout(()=>openCustomerForm(),100)">Add Customer</button><button class="btn" onclick="adminLoans();setTimeout(()=>openLoanForm(),100)">Add Loan</button><button class="btn" onclick="adminInvestments();setTimeout(()=>openInvestmentForm(),100)">Add Investment</button></div></div>`;
}
async function adminCustomers(){
const rows=await api("/api/admin/customers");document.getElementById("content").innerHTML=`<div class="title"><h1>Customers</h1><div class="row"><button class="btn" onclick="openCustomerForm()">+ Add Customer</button><button class="btn secondary" onclick="location.href='/api/admin/export/customers'">Export CSV</button></div></div>
<div class="table-wrap"><table class="table"><tr><th>Name</th><th>Type</th><th>User ID</th><th>Mobile</th><th>Father/Husband</th><th>Language</th><th>Status</th><th>Action</th></tr>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.role}</td><td>${esc(r.login_id||r.mobile)}</td><td>${esc(r.mobile)}</td><td>${esc(r.father_husband)}</td><td>${esc(r.language)}</td><td>${r.status}</td><td><button class="btn secondary" onclick='openCustomerForm(${JSON.stringify(r)})'>Edit</button></td></tr>`).join("")}</table></div>`;
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
const rows=await api("/api/admin/loans");document.getElementById("content").innerHTML=`<div class="title"><h1>Loan Management</h1><div class="row"><button class="btn" onclick="openLoanForm()">+ New Loan</button><button class="btn secondary" onclick="location.href='/api/admin/export/loans'">Export CSV</button></div></div>
<div class="table-wrap"><table class="table"><tr><th>Loan ID</th><th>Customer</th><th>Product</th><th>Principal</th><th>Outstanding</th><th>Interest</th><th>EMI</th><th>Duration</th><th>Payment</th><th>DPD</th><th>Status</th><th>Action</th></tr>${rows.map(r=>`<tr><td>${r.loan_id}</td><td>${esc(r.customer_name)}<br><small>${r.mobile}</small></td><td>${esc(r.product)}</td><td>${money(r.principal)}</td><td>${money(r.outstanding)}</td><td>${r.interest_rate}%</td><td>${money(r.emi)}</td><td>${r.duration_days||0} days</td><td>${r.payment_frequency||"monthly"}</td><td>${r.dpd}</td><td>${r.status}</td><td><button class="btn secondary" onclick="markLoanClear(${r.id})">Clear</button> <button class="btn secondary" onclick="deleteLoan(${r.id},${JSON.stringify(r.status)})">Delete</button></td></tr>`).join("")}</table></div>`;
}
async function markLoanClear(id){try{await api(`/api/admin/loans/${id}/clear`,{method:"POST"});adminLoans()}catch(e){alert(e.message)}}
async function deleteLoan(id,status){if(!["cleared","closed"].includes(String(status).toLowerCase())){alert("Pehle loan ko Clear karein. Sirf cleared/closed loan delete ho sakta hai.");return}if(!confirm("Kya aap is cleared loan ko permanently delete karna chahte hain?"))return;try{await api(`/api/admin/loans/${id}`,{method:"DELETE"});adminLoans()}catch(e){alert(e.message)}}
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

async function adminInvestments(){
const rows=await api("/api/admin/investments");document.getElementById("content").innerHTML=`<div class="title"><h1>Investment Management</h1><div class="row"><button class="btn" onclick="openInvestmentForm()">+ Add Investment</button><button class="btn secondary" onclick="location.href='/api/admin/export/investments'">Export CSV</button></div></div>
<div class="table-wrap"><table class="table"><tr><th>Investment ID</th><th>Customer</th><th>Mobile</th><th>Amount</th><th>Date</th><th>Relation</th><th>Status</th></tr>${rows.map(r=>`<tr><td>${r.investment_id}</td><td>${esc(r.customer_name)}</td><td>${r.mobile}</td><td>${money(r.amount)}</td><td>${r.investment_date}</td><td>${esc(r.relation_name)}</td><td>${r.status}</td></tr>`).join("")}</table></div>`;
}
async function openInvestmentForm(){
const customers=await api("/api/admin/customers");showModal(`<h2>Customer Invest Plan</h2><form onsubmit="saveInvestment(event)" class="form">
<div class="field full"><label>Investor Customer</label><select id="ic">${customers.filter(c=>c.role==="investor").map(c=>`<option value="${c.id}">${esc(c.name)} - ${c.mobile}</option>`).join("")}</select></div>
<div class="field"><label>जमा राशि</label><input id="ia" type="number" required></div><div class="field"><label>निवेश की तिथि</label><input id="idate" type="date" required></div>
<div class="field full"><label>रिश्ते का नाम</label><input id="ir"></div><div class="field full"><button class="btn">Save Investment</button></div></form>`);
}
async function saveInvestment(e){e.preventDefault();try{await api("/api/admin/investments",{method:"POST",body:{customer_id:ic.value,amount:ia.value,investment_date:idate.value,relation_name:ir.value}});closeModal();adminInvestments()}catch(e){alert(e.message)}}

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
const d=await api("/api/customer/dashboard");document.getElementById("content").innerHTML=`<div class="title"><h1>My Loan</h1></div><div class="table-wrap"><table class="table"><tr><th>Loan ID</th><th>Product</th><th>Loan Amount</th><th>Outstanding</th><th>Interest</th><th>EMI</th><th>Duration</th><th>Payment</th><th>DPD</th><th>Status</th></tr>${d.loans.map(r=>`<tr><td>${r.loan_id}</td><td>${esc(r.product)}</td><td>${money(r.principal)}</td><td>${money(r.outstanding)}</td><td>${r.interest_rate}%</td><td>${money(r.emi)}</td><td>${r.duration_days||0} days</td><td>${r.payment_frequency||"monthly"}</td><td>${r.dpd}</td><td>${r.status}</td></tr>`).join("")||"<tr><td colspan=8>No loan found</td></tr>"}</table></div>`;
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
const d=await api("/api/customer/dashboard");document.getElementById("content").innerHTML=`<div class="title"><h1>Customer Invest Plan</h1></div><div class="card"><h2>Investor Customer Details</h2><p><b>Customer Name:</b> ${esc(d.user.name)}</p><p><b>Father/Husband Name:</b> ${esc(d.user.father_husband)}</p><p><b>Reg. Mobile No.:</b> ${esc(d.user.mobile)}</p><p><b>Address:</b> ${esc(d.user.address)}</p></div><div class="table-wrap" style="margin-top:14px"><table class="table"><tr><th>Investment ID</th><th>जमा राशि</th><th>निवेश की तिथि</th><th>रिश्ते का नाम</th><th>Status</th></tr>${d.investments.map(r=>`<tr><td>${r.investment_id}</td><td>${money(r.amount)}</td><td>${r.investment_date}</td><td>${esc(r.relation_name)}</td><td>${r.status}</td></tr>`).join("")||"<tr><td colspan=5>No investment found</td></tr>"}</table></div>`}
function custClosure(){document.getElementById("content").innerHTML=`<div class="card"><h1>Loan Closure</h1><form onsubmit="sendClosure(event)" class="form"><div class="field"><label>Loan ID</label><input id="clid" required></div><div class="field"><label>Reason</label><input id="clr"></div><div class="field full"><button class="btn">Request Closure</button></div></form></div>`}
async function sendClosure(e){e.preventDefault();try{await api("/api/customer/closure",{method:"POST",body:{loan_id:clid.value,reason:clr.value}});alert("Closure request submitted")}catch(e){alert(e.message)}}
async function custSettings(){const d=await api("/api/me");document.getElementById("content").innerHTML=`<div class="card"><h1>Setting</h1><form onsubmit="saveProfile(event)" class="form"><div class="field"><label>Name</label><input id="pn" value="${esc(d.user.name)}"></div><div class="field"><label>Father/Husband</label><input id="pf" value="${esc(d.user.father_husband)}"></div><div class="field"><label>Email</label><input id="pe" value="${esc(d.user.email)}"></div><div class="field"><label>Language</label><select id="pl"><option>Hindi</option><option>English</option><option>Bhojpuri</option><option>Bengali</option><option>Marathi</option></select></div><div class="field full"><label>Address</label><textarea id="pa">${esc(d.user.address)}</textarea></div><div class="field full"><button class="btn">Save Settings</button></div></form></div>`}
async function saveProfile(e){e.preventDefault();try{const d=await api("/api/customer/profile",{method:"PUT",body:{name:pn.value,father_husband:pf.value,email:pe.value,language:pl.value,address:pa.value}});me=d.user;localStorage.setItem("es_user",JSON.stringify(me));alert("Settings saved")}catch(e){alert(e.message)}}

function showModal(html){const m=document.createElement("div");m.id="modal";m.className="modal";m.innerHTML=`<div class="modalbox"><div class="title"><span></span><button class="btn secondary" onclick="closeModal()">Close</button></div>${html}</div>`;document.body.appendChild(m)}
function closeModal(){document.getElementById("modal")?.remove()}

if(token && me) renderApp(); else renderLogin();
