const $ = (id) => document.getElementById(id);

const MAX_TOTAL_CHARS = 320;  // full SMS budget

// Rules:
// 1) Blank input => use data-default (matches placeholder)
// 2) "-" => treat as blank and OMIT the field from payload (ONLY for optional fields)
// 3) Otherwise => use typed value
const getField = (id) => {
  const el = $(id);
  if (!el) return { has: false, value: "" };

  const raw = (el.value || "").trim();
  if (raw === "-") return { has: false, value: "" };
  if (raw !== "") return { has: true, value: raw };

  const def = (el.dataset.default || "").trim();
  if (def) return { has: true, value: def };

  return { has: false, value: "" };
};

const isDash = (id) => {
  const el = $(id);
  if (!el) return false;
  return ((el.value || "").trim() === "-");
};

const outEl = $("out");
const statusEl = $("statusText");
const lengthPill = $("lengthPill");
const generateBtn = $("generateBtn");
const sendBtn = $("sendBtn");

let generating = false;
let sending = false;

const adjustOutHeight = () => {
  if (!outEl) return;
  outEl.style.height = "auto";
  outEl.style.height = `${outEl.scrollHeight}px`;
};

const setStatus = (txt) => { if (statusEl) statusEl.textContent = txt; };
const setOut = (txt) => {
  if (outEl) outEl.value = txt;
  adjustOutHeight();
  updateLength();
  updateSendEnabled();
};
const getOut = () => (outEl?.value || "");
const countText = (s) => (s || "").replace(/\s+/g, " ").trim().length;

const updateLength = () => {
  if (!lengthPill) return;
  const len = countText(getOut());
  if (!len) {
    lengthPill.textContent = "No text yet";
    return;
  }
  lengthPill.textContent = `Length ${len}/${MAX_TOTAL_CHARS}${len > MAX_TOTAL_CHARS ? " too long" : ""}`;
};

const updateSendEnabled = () => {
  if (!sendBtn) return;
  const hasText = !!getOut().trim();
  sendBtn.disabled = sending || generating || !hasText;
};

const setGenerating = (state) => {
  generating = state;
  if (generateBtn) {
    generateBtn.disabled = state;
    generateBtn.textContent = state ? "Generating..." : "Generate new text";
  }
  updateSendEnabled();
};

const setSending = (state) => {
  sending = state;
  if (sendBtn) {
    sendBtn.textContent = state ? "Sending..." : "Send it";
  }
  updateSendEnabled();
};

outEl?.addEventListener("input", () => {
  adjustOutHeight();
  updateLength();
  updateSendEnabled();
});

generateBtn.onclick = async () => {
  if (generating) return;
  setStatus("");
  setGenerating(true);

  try {
    const demoPass = ($("demoPass")?.value || "").trim();
    if (!demoPass) {
      setStatus("Passcode required");
      return;
    }

    // Required fields cannot be "-"
    if (isDash("customerName")) return setStatus("Customer name is required");
    if (isDash("companyName")) return setStatus("Business name is required");
    if (isDash("phone")) return setStatus("Customer phone is required");

    const customer = getField("customerName");
    const company = getField("companyName");
    const phone = getField("phone");

    if (!customer.has) return setStatus("Customer name is required");
    if (!company.has) return setStatus("Business name is required");
    if (!phone.has) return setStatus("Customer phone is required");

    const payload = {
      demoPass,
      customerName: customer.value,
      companyName: company.value,
      phone: phone.value,
      flavor: $("flavor")?.value || "",
    };

    const repName = getField("repName");
    if (repName.has) payload.repName = repName.value;

    const items = getField("items");
    if (items.has) payload.items = items.value;

    const r = await fetch("/generateDemo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { msg: text }; }

    if (!r.ok) {
      setStatus(`Error ${r.status} ${data.msg || "Request failed"}`);
      return;
    }

    const msg = data.msg || "";
    if (!msg) {
      setStatus("No message returned");
      return;
    }

    setOut(msg);
    setStatus("Generated");
  } catch (e) {
    setStatus(`Error ${e.message}`);
  } finally {
    setGenerating(false);
  }
};

sendBtn.onclick = async () => {
  if (sending) return;
  setStatus("");

  const msg = getOut().trim();
  if (!msg) return setStatus("Message is required");

  try {
    const demoPass = ($("demoPass")?.value || "").trim();
    if (!demoPass) return setStatus("Passcode required");

    if (isDash("phone")) return setStatus("Customer phone is required");
    const phone = getField("phone");
    if (!phone.has) return setStatus("Customer phone is required");

    setSending(true);

    const payload = {
      demoPass,
      phone: phone.value,
      msg,
    };

    const r = await fetch("/sendDemoSms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { msg: text }; }

    if (!r.ok) {
      setStatus(`Error ${r.status} ${data.msg || "Request failed"}`);
      return;
    }

    const displayTo = data.to || phone.value || "recipient";
    setStatus(`Sent text to ${displayTo}`);
  } catch (e) {
    setStatus(`Error ${e.message}`);
  } finally {
    setSending(false);
  }
};

updateLength();
adjustOutHeight();
updateSendEnabled();
