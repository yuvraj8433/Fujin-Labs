/* Builds a form from its field list and reads the answers back. Used by index.html (real form) and admin.html (live preview).
   Field shape: { id, type, label, help, required, options[] }. Types: short, long, email, phone, number, date, dropdown, radio, checkbox, consent. */
const FormKit = (() => {
  const TYPES = [["short","Short answer"],["long","Paragraph"],["email","Email"],["phone","Phone"],["number","Number"],["date","Date"],
    ["dropdown","Dropdown"],["radio","Multiple choice"],["checkbox","Checkboxes"],["consent","Consent checkbox"]];
  const CHOICE = ["dropdown","radio","checkbox"];
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const PHONE = /^[+\d][\d\s\-()]{5,19}$/;

  function el(tag, props, ...kids){
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => { if(k === "class") n.className = v; else if(typeof v === "function" && k.startsWith("on")) n.addEventListener(k.slice(2), v); else if(v === true) n.setAttribute(k, ""); else if(v !== false && v != null) n.setAttribute(k, v); });
    kids.flat().forEach(c => { if(c != null) n.append(c.nodeType ? c : document.createTextNode(c)); });
    return n;
  }

  function control(f, id){
    const base = {id, name:id};
    if(f.type === "long") return el("textarea", {...base, maxlength:2000});
    if(f.type === "dropdown") return el("select", base, el("option", {value:""}, "Choose one"), f.options.map(o => el("option", {value:o}, o)));
    const attrs = {short:{type:"text", maxlength:300}, email:{type:"email", inputmode:"email", autocomplete:"email"}, phone:{type:"tel", inputmode:"tel", autocomplete:"tel"},
      number:{type:"number", inputmode:"decimal", step:"any"}, date:{type:"date"}}[f.type] || {type:"text"};
    return el("input", {...base, ...attrs});
  }

  function build(f, prefix){
    const id = prefix + f.id, err = el("p", {class:"hint bad", id:"err_" + id, role:"alert"});
    const help = f.help ? el("span", {class:"help"}, f.help) : null;
    const opt = f.required ? null : el("small", {}, " (optional)");
    let body;
    if(f.type === "consent"){
      body = el("label", {class:"consent", for:id}, el("input", {type:"checkbox", id, name:id}), el("span", {}, f.label, help ? el("br") : null, help));
    } else if(f.type === "radio" || f.type === "checkbox"){
      const kind = f.type === "radio" ? "radio" : "checkbox";
      body = el("fieldset", {class:"group"}, el("legend", {}, f.label, opt, help ? el("br") : null, help),
        f.options.map((o, i) => el("label", {class:"opt", for:id + "_" + i}, el("input", {type:kind, id:id + "_" + i, name:id, value:o}), el("span", {}, o))));
    } else {
      body = el("label", {for:id}, el("span", {}, f.label, opt), help, control(f, id));
    }
    return el("div", {class:"q"}, body, err);
  }

  function render(container, fields, prefix = "f_"){
    container.textContent = "";
    fields.forEach(f => container.append(build(f, prefix)));
  }

  /* Reads and checks every answer. Returns { answers } or { error: { id, message } }. The server checks again. */
  function collect(fields, container, prefix = "f_"){
    const answers = {};
    container.querySelectorAll(".hint.bad").forEach(p => p.textContent = "");
    for(const f of fields){
      const id = prefix + f.id; let v;
      if(f.type === "consent") v = container.querySelector("#" + id).checked;
      else if(f.type === "checkbox") v = [...container.querySelectorAll('input[name="' + id + '"]:checked')].map(i => i.value);
      else if(f.type === "radio"){ const c = container.querySelector('input[name="' + id + '"]:checked'); v = c ? c.value : ""; }
      else v = container.querySelector("#" + id).value.trim();
      const empty = v === "" || v === false || (Array.isArray(v) && !v.length);
      let message = "";
      if(empty){ if(f.required) message = f.type === "consent" ? "Please tick this box to continue." : "This question is required."; }
      else if(f.type === "email" && !EMAIL.test(v)) message = "Enter a valid email address.";
      else if(f.type === "phone" && !PHONE.test(v)) message = "Enter a valid phone number.";
      else if(f.type === "number" && !isFinite(Number(v))) message = "Enter a number.";
      if(message){
        const box = container.querySelector("#err_" + id); if(box) box.textContent = message;
        const focus = container.querySelector("#" + id) || container.querySelector('input[name="' + id + '"]');
        if(focus){ focus.focus(); focus.scrollIntoView({block:"center", behavior:"smooth"}); }
        return {error:{id:f.id, message}};
      }
      if(!empty) answers[f.id] = v;
    }
    return {answers};
  }

  return {TYPES, CHOICE, render, collect, el};
})();
