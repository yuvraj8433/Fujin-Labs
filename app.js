/* Shared code for the public pages (index.html and refer.html): backend calls, icons, saved visitor. Needs config.js first. */

const $ = id => document.getElementById(id);
const DEFAULT_TIERS = [
  {need:3,  reward:"Rs 500 cash",           type:"Money", details:"Sent to your UPI or bank account"},
  {need:10, reward:"Fujin Labs gift hamper", type:"Gift",  details:"Delivered to your address"},
  {need:25, reward:"Rs 5,000 cash",          type:"Money", details:"Sent to your UPI or bank account"}
];
const ICONS = {
  money:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.4-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.7-2.5 1.8 0 2.5 5 1.2 5 3.7 0 1.1-1.1 1.8-2.5 1.8-1.2 0-2.2-.5-2.6-1.4M12 6.5V8m0 8v1.5"/></svg>',
  gift:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 1 1 0 5"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};
document.querySelectorAll("[data-icon]").forEach(el => el.innerHTML = ICONS[el.dataset.icon]);

/* ---- Backend: Google Sheet via Apps Script ---- */
async function rpc(action, body){
  if(!CONFIG.SHEET_API_URL) throw new Error("Set SHEET_API_URL in config.js first.");
  /* text/plain keeps this a "simple" request, so the browser sends no CORS preflight */
  const r = await fetch(CONFIG.SHEET_API_URL, {method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify({action, ...body})});
  if(!r.ok) throw new Error("Request failed (" + r.status + ")");
  const out = await r.json();
  if(out && out.error) throw new Error(out.error);
  return out;
}
const api = {
  config: () => rpc("config", {}),
  form: id => rpc("form", {id}),
  join: payload => rpc("join", payload),
  stats: email => rpc("stats", {email}),
  check: code => rpc("check", {code})
};

/* ---- The visitor on this device (set after they join, read on the Refer & Earn page) ---- */
function getUser(){ try{ return JSON.parse(localStorage.getItem("fujin_user") || "null"); }catch(e){ return null; } }
function setUser(u){ try{ localStorage.setItem("fujin_user", JSON.stringify(u)); }catch(e){} }
function clearUser(){ try{ localStorage.removeItem("fujin_user"); }catch(e){} }

/* ---- Small helpers ---- */
async function copyText(text, btn){
  const old = btn.textContent;
  try{ await navigator.clipboard.writeText(text); btn.textContent = "Copied!"; }
  catch(e){ btn.textContent = "Press and hold to copy"; }
  setTimeout(() => btn.textContent = old, 1600);
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
