const ENDPOINT = ""; // Add Zapier/Make/CRM/backend webhook here when ready.

const reveals = document.querySelectorAll(".reveal");
const observer = new IntersectionObserver(
  entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    }
  },
  { threshold: 0.14 }
);

reveals.forEach(element => observer.observe(element));

const form = document.querySelector("#intakeForm");

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function getUtmPayload() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_term: params.get("utm_term") || "",
    utm_content: params.get("utm_content") || ""
  };
}

function setInvalid(field, invalid) {
  const wrapper = field.closest("label") || field.parentElement;
  wrapper?.classList.toggle("invalid", invalid);
}

function validateForm(formElement) {
  let valid = true;
  const data = new FormData(formElement);
  const fullName = String(data.get("fullName") || "").trim();
  const email = formElement.elements.email;
  const phone = formElement.elements.phone;
  const state = formElement.elements.state;
  const issueType = formElement.elements.issueType;
  const summary = formElement.elements.summary;
  const consent = formElement.elements.consent;

  const nameInvalid = fullName.split(/\s+/).length < 2;
  setInvalid(formElement.elements.fullName, nameInvalid);
  if (nameInvalid) valid = false;

  const emailInvalid = !email.checkValidity();
  setInvalid(email, emailInvalid);
  if (emailInvalid) valid = false;

  const phoneInvalid = digitsOnly(phone.value).length !== 10;
  setInvalid(phone, phoneInvalid);
  if (phoneInvalid) valid = false;

  const stateInvalid = !state.value;
  setInvalid(state, stateInvalid);
  if (stateInvalid) valid = false;

  const issueInvalid = !issueType.value;
  setInvalid(issueType, issueInvalid);
  if (issueInvalid) valid = false;

  const summaryInvalid = String(summary.value || "").trim().length < 12;
  setInvalid(summary, summaryInvalid);
  if (summaryInvalid) valid = false;

  document.querySelector(".consent-error").style.display = consent.checked ? "none" : "block";
  if (!consent.checked) valid = false;

  return valid;
}

form?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!validateForm(form)) return;

  const data = new FormData(form);
  const payload = {
    source: "brent-sites-roblox-intake",
    fullName: String(data.get("fullName") || "").trim(),
    email: String(data.get("email") || "").trim(),
    phone: digitsOnly(data.get("phone")),
    state: data.get("state"),
    issueType: data.get("issueType"),
    summary: String(data.get("summary") || "").trim(),
    consent: data.get("consent") === "on",
    pageUrl: window.location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    submittedAt: new Date().toISOString(),
    utm: getUtmPayload()
  };

  const button = form.querySelector("button[type='submit']");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Submitting...";

  try {
    if (ENDPOINT) {
      await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } else {
      console.info("Intake payload ready. Add ENDPOINT in assets/app.js to send it.", payload);
    }

    form.innerHTML = `
      <div class="form-header success-state">
        <h3>Request received</h3>
        <p>Thank you. Your review request was captured on this page. A configured backend can now route this to your intake team.</p>
      </div>
      <p class="form-disclaimer">For production, connect ENDPOINT in assets/app.js to your CRM, webhook, or secure backend.</p>
    `;
  } catch (error) {
    console.error("Submission failed", error);
    button.disabled = false;
    button.textContent = originalText;
    alert("Submission could not be completed. Please try again or contact the intake team directly.");
  }
});
