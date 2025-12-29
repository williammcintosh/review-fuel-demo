const $ = (id) => document.getElementById(id);

// Defaults / limits
const REVIEW_URL = "https://bit.ly/4jcuCf0";
const OPT_OUT_TEXT = "Reply STOP to opt out";
const MAX_BODY_CHARS = 270;   // target before opt-out
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

const setOut = (txt) => { $("out").textContent = txt; };
const countText = (s) => (s || "").replace(/\s+/g, " ").trim().length;

$("sendBtn").onclick = async () => {
  setOut("Sending...");

  try {
    const demoPass = ($("demoPass")?.value || "").trim();
    if (!demoPass) return setOut("Passcode required");

    // Required fields cannot be "-"
    if (isDash("customerName")) return setOut("Customer name is required");
    if (isDash("companyName")) return setOut("Business name is required");
    if (isDash("phone")) return setOut("Customer phone is required");

    const customer = getField("customerName");
    const company = getField("companyName");
    const phone = getField("phone");

    // Required fields must resolve to a value (typed or default)
    if (!customer.has) return setOut("Customer name is required");
    if (!company.has) return setOut("Business name is required");
    if (!phone.has) return setOut("Customer phone is required");

    const payload = {
      demoPass,
      customerName: customer.value,
      companyName: company.value,
      phone: phone.value,
      flavor: $("flavor")?.value || "",

      // Backend controls
      reviewUrl: REVIEW_URL,
      optOutText: OPT_OUT_TEXT,
      maxBodyChars: MAX_BODY_CHARS,
      maxTotalChars: MAX_TOTAL_CHARS
    };

    // Optional fields only included if present
    const repName = getField("repName");
    if (repName.has) payload.repName = repName.value;

    const items = getField("items");
    if (items.has) payload.items = items.value;

    const r = await fetch("/sendDemo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { msg: text }; }

    const msg = data.msg || "";
    if (!r.ok) return setOut(`Error ${r.status} ${msg || "Request failed"}`);

    const totalLen = countText(msg);
    const budgetNote = totalLen
      ? `\n\nLength ${totalLen}/${MAX_TOTAL_CHARS}${totalLen > MAX_TOTAL_CHARS ? " too long" : ""}`
      : "";

    setOut((msg || "Sent") + budgetNote);
  } catch (e) {
    setOut(`Error ${e.message}`);
  }
};

