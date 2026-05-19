const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sampleDir = path.join(root, "samples");

const css = `
@page { size: Letter; margin: 0; }
* { box-sizing: border-box; }
body { background:#e8eef4; color:#101827; font-family: Inter, Arial, sans-serif; margin:0; }
.page { background:#fff; display:flex; flex-direction:column; height:11in; overflow:hidden; padding:.48in; page-break-after:always; position:relative; width:8.5in; }
.cover { background:radial-gradient(circle at 78% 18%, rgba(20,184,166,.26), transparent 28%), linear-gradient(135deg,#071527 0%,#0b2b38 56%,#123f48 100%); color:#fff; }
.brand { align-items:center; display:flex; gap:12px; }
.mark { align-items:center; background:#fff; border-radius:10px; color:#071527; display:flex; font-size:18px; font-weight:900; height:48px; justify-content:center; width:48px; }
.brand strong { display:block; font-size:20px; }
.brand span { color:#d9f7f3; display:block; font-size:12px; margin-top:3px; }
.cover-title { margin-top:.86in; max-width:6.8in; }
.label { color:#16d7c2; font-size:12px; font-weight:900; letter-spacing:0; text-transform:uppercase; }
h1 { font-size:50px; line-height:1.0; margin:18px 0; }
h2 { font-size:29px; line-height:1.07; margin:0 0 12px; }
h3 { font-size:16px; margin:0 0 8px; }
p { line-height:1.46; margin:0 0 12px; }
.cover-copy { color:#e7f4f7; font-size:18px; line-height:1.45; max-width:6.5in; }
.cover-meta { bottom:.52in; display:grid; gap:12px; grid-template-columns:1fr 1fr 1fr; left:.52in; position:absolute; right:.52in; }
.meta-card { background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.18); border-radius:12px; min-height:92px; padding:15px; }
.meta-card span { color:#9ee7dd; display:block; font-size:11px; font-weight:900; margin-bottom:8px; text-transform:uppercase; }
.meta-card strong { color:#fff; display:block; font-size:16px; line-height:1.25; }
.topbar { align-items:center; border-bottom:2px solid #e1e8ef; display:flex; justify-content:space-between; margin-bottom:20px; padding-bottom:12px; }
.topbar .brand .mark { background:#071527; color:#fff; height:36px; width:36px; }
.topbar .brand strong { color:#071527; font-size:15px; }
.topbar .brand span { color:#64748b; font-size:10px; }
.page-num { color:#64748b; font-size:11px; font-weight:800; }
.grid { display:grid; gap:14px; }
.two { grid-template-columns:1fr 1fr; }
.three { grid-template-columns:repeat(3,1fr); }
.four { grid-template-columns:repeat(4,1fr); }
.card { background:#f8fbfc; border:1px solid #d9e5ec; border-radius:12px; padding:14px; }
.dark-card { background:#071527; color:#fff; }
.teal-card { background:#e6f7f4; border-color:#9bded5; }
.gold-card { background:#fff7e6; border-color:#f2d38a; }
.blue-card { background:#eef5ff; border-color:#b9d4f5; }
.muted { color:#526173; }
.kpi { color:#071527; display:block; font-size:32px; font-weight:900; line-height:1; }
.tiny { color:#526173; display:block; font-size:10px; font-weight:900; margin-bottom:6px; text-transform:uppercase; }
table { border-collapse:collapse; font-size:10px; width:100%; }
th { background:#071527; color:#fff; font-size:9px; padding:7px; text-align:left; text-transform:uppercase; }
td { border-bottom:1px solid #d9e5ec; line-height:1.3; padding:7px; vertical-align:top; }
.pill { border-radius:999px; display:inline-block; font-size:9px; font-weight:900; padding:4px 7px; }
.green { background:#dff8ee; color:#08735f; }
.amber { background:#fff0c2; color:#8a5700; }
.red { background:#ffe3e3; color:#9d1b1b; }
.score-ring { align-items:center; background:conic-gradient(#118577 0 68%, #dfe8ef 68% 100%); border-radius:999px; display:flex; height:140px; justify-content:center; margin:0 auto; width:140px; }
.score-ring span { align-items:center; background:#fff; border-radius:999px; color:#071527; display:flex; flex-direction:column; font-size:13px; font-weight:900; height:100px; justify-content:center; text-align:center; width:100px; }
.score-ring b { display:block; font-size:32px; }
.matrix { background:linear-gradient(90deg, transparent 49.5%, #cbd5e1 49.5%, #cbd5e1 50.5%, transparent 50.5%), linear-gradient(0deg, transparent 49.5%, #cbd5e1 49.5%, #cbd5e1 50.5%, transparent 50.5%), #f8fbfc; border:1px solid #d9e5ec; border-radius:12px; height:300px; position:relative; }
.axis { color:#526173; font-size:9px; font-weight:900; position:absolute; text-transform:uppercase; }
.axis.y { left:10px; top:10px; }
.axis.x { bottom:10px; right:12px; }
.bubble { align-items:center; border-radius:999px; color:#fff; display:flex; font-size:9px; font-weight:900; height:58px; justify-content:center; line-height:1.1; padding:7px; position:absolute; text-align:center; width:58px; }
.flow { display:grid; gap:10px; grid-template-columns:repeat(5,1fr); margin-top:12px; }
.flow div { background:#eef8f6; border:1px solid #9bded5; border-radius:12px; min-height:96px; padding:12px; position:relative; }
.flow div strong { display:block; font-size:14px; margin-bottom:7px; }
.phase-grid { display:grid; gap:10px; grid-template-columns:repeat(4,1fr); }
.phase { background:#f8fbfc; border:1px solid #d9e5ec; border-radius:12px; min-height:210px; padding:12px; }
.phase strong { color:#071527; display:block; font-size:15px; margin-bottom:8px; }
.slide-grid { display:grid; gap:12px; grid-template-columns:1fr 1fr; }
.slide { background:linear-gradient(135deg,#071527,#0e3f48); border-radius:14px; color:#fff; min-height:230px; padding:16px; position:relative; }
.slide h3 { color:#fff; font-size:19px; margin-bottom:8px; }
.slide p { color:#dceff2; font-size:11px; line-height:1.32; margin-bottom:10px; }
.slide .stripe { background:#16d7c2; border-radius:999px; bottom:14px; height:6px; left:16px; position:absolute; width:42%; }
.mini-heat { display:grid; gap:4px; grid-template-columns:repeat(4,1fr); margin-top:10px; }
.mini-heat span { border-radius:6px; color:#071527; font-size:8px; font-weight:900; min-height:31px; padding:5px; }
.mini-heat .low { background:#b7efe7; }
.mini-heat .med { background:#ffe2a6; }
.mini-heat .high { background:#ffb4b4; }
.mini-option { margin-top:8px; }
.mini-option div { align-items:center; display:grid; gap:6px; grid-template-columns:54px 1fr 26px; margin:6px 0; }
.mini-option span { background:rgba(255,255,255,.17); border-radius:999px; height:8px; overflow:hidden; }
.mini-option b { background:#16d7c2; display:block; height:100%; }
.mini-option small { color:#dceff2; font-size:8px; font-weight:900; }
.mini-road { border-left:2px solid #16d7c2; margin:10px 0 0 8px; padding-left:11px; }
.mini-road div { margin-bottom:8px; position:relative; }
.mini-road div:before { background:#16d7c2; border-radius:999px; content:""; height:8px; left:-16px; position:absolute; top:3px; width:8px; }
.mini-road strong { color:#fff; display:block; font-size:10px; }
.mini-road small { color:#dceff2; font-size:9px; }
.decision-chips { display:grid; gap:6px; grid-template-columns:1fr 1fr; margin-top:10px; }
.decision-chips span { background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.18); border-radius:8px; color:#fff; font-size:9px; font-weight:900; min-height:32px; padding:7px; }
.bars div { align-items:center; display:grid; gap:8px; grid-template-columns:92px 1fr; margin:8px 0; }
.bars span { background:#e7eef4; border-radius:999px; height:9px; overflow:hidden; }
.bars b { background:#118577; display:block; height:100%; }
.callout { background:#071527; border-radius:14px; color:#fff; margin-top:auto; padding:15px; }
.footer-note { bottom:.27in; color:#64748b; font-size:9px; left:.48in; position:absolute; right:.48in; }
ul { margin:8px 0 0 16px; padding:0; }
li { line-height:1.34; margin-bottom:6px; }
`;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function brandTop(page) {
  return `<div class="topbar"><div class="brand"><div class="mark">BA</div><div><strong>BA Advisory Desk</strong><span>Business Analysis Services</span></div></div><div class="page-num">${page}</div></div>`;
}

function cover(doc) {
  return `<section class="page cover">
    <div class="brand"><div class="mark">BA</div><div><strong>BA Advisory Desk</strong><span>Business Analysis Services</span></div></div>
    <div class="cover-title"><div class="label">Sample Deliverable</div><h1>${esc(doc.title)}</h1><p class="cover-copy">${esc(doc.summary)}</p></div>
    <div class="cover-meta">
      <div class="meta-card"><span>Client privacy</span><strong>Client names and identifying details are anonymized.</strong></div>
      <div class="meta-card"><span>Deliverable type</span><strong>${esc(doc.deliverableType)}</strong></div>
      <div class="meta-card"><span>Typical buyer</span><strong>${esc(doc.buyer)}</strong></div>
    </div>
  </section>`;
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function slideVisual(slide, index) {
  const visuals = [
    `<div class="mini-heat">
      <span class="low">Scope<br>Green</span><span class="med">Data<br>Amber</span><span class="high">Adoption<br>Red</span><span class="med">Owner<br>Amber</span>
      <span class="low">Process<br>Green</span><span class="med">Training<br>Amber</span><span class="high">Controls<br>Red</span><span class="low">Funding<br>Green</span>
    </div>`,
    `<div class="mini-option">
      <div><small>Option A</small><span><b style="width:58%"></b></span><small>58</small></div>
      <div><small>Option B</small><span><b style="width:82%"></b></span><small>82</small></div>
      <div><small>Option C</small><span><b style="width:64%"></b></span><small>64</small></div>
    </div>`,
    `<div class="mini-road">
      <div><strong>Gate 1</strong><small>Approve scope and owner model.</small></div>
      <div><strong>Gate 2</strong><small>Release pilot funding.</small></div>
      <div><strong>Gate 3</strong><small>Scale after benefit evidence.</small></div>
    </div>`,
    `<div class="decision-chips"><span>Approve first wave</span><span>Assign executive sponsor</span><span>Confirm risk guardrails</span><span>Set 60 day review</span></div>`,
  ];
  return `<div class="slide"><span class="label">${esc(slide.label)}</span><h3>${esc(slide.title)}</h3><p>${esc(slide.copy)}</p>${visuals[index] || ""}<div class="stripe"></div></div>`;
}

function snapshot(doc) {
  return `<section class="page">${brandTop("01 Executive Snapshot")}
    <div class="grid two">
      <div>
        <div class="label">Situation</div>
        <h2>${esc(doc.snapshotTitle)}</h2>
        <p class="muted">${esc(doc.situation)}</p>
        <div class="grid two">${doc.snapshotCards.map((c) => `<div class="card ${c.className}"><span class="tiny">${esc(c.label)}</span><strong>${esc(c.text)}</strong></div>`).join("")}</div>
      </div>
      <div class="card"><span class="tiny">${esc(doc.scoreLabel)}</span><div class="score-ring"><span><b>${esc(doc.score)}</b>${esc(doc.scoreNote)}</span></div><p class="muted" style="text-align:center;margin-top:14px;">${esc(doc.scoreCopy)}</p></div>
    </div>
    <div class="grid four" style="margin-top:18px;">${doc.kpis
      .map((k) => `<div class="card"><span class="tiny">${esc(k.label)}</span><span class="kpi">${esc(k.value)}</span><p class="muted">${esc(k.copy)}</p></div>`)
      .join("")}</div>
    <div class="callout">${esc(doc.recommendation)}</div>
    <div class="footer-note">Sample deliverable. Client names and identifying details are anonymized to respect client privacy.</div>
  </section>`;
}

function coreTable(doc) {
  return `<section class="page">${brandTop("02 Detailed Analysis")}
    <h2>${esc(doc.coreTitle)}</h2>
    <p class="muted">${esc(doc.coreIntro)}</p>
    ${table(doc.coreHeaders, doc.coreRows)}
    <div class="grid two" style="margin-top:14px;">
      <div class="card teal-card"><h3>How this creates value</h3>${list(doc.valuePoints)}</div>
      <div class="card gold-card"><h3>What this prevents</h3>${list(doc.prevents)}</div>
    </div>
    <div class="footer-note">Sample deliverable. Tables show representative structure and depth.</div>
  </section>`;
}

function visualPage(doc) {
  const visual =
    doc.visualType === "slides"
      ? `<div class="slide-grid">${doc.slides.map((s, index) => slideVisual(s, index)).join("")}</div>`
      : doc.visualType === "flow"
      ? `<div class="flow">${doc.flow.map((f) => `<div><strong>${esc(f.title)}</strong><p class="muted">${esc(f.copy)}</p></div>`).join("")}</div>`
      : `<div class="matrix"><div class="axis y">${esc(doc.matrixY)}</div><div class="axis x">${esc(doc.matrixX)}</div>${doc.bubbles
          .map((b) => `<div class="bubble" style="left:${b.left}%;top:${b.top}%;background:${b.color};">${esc(b.text)}</div>`)
          .join("")}</div>`;
  return `<section class="page">${brandTop("03 Visual Framework")}
    <h2>${esc(doc.visualTitle)}</h2>
    <p class="muted">${esc(doc.visualIntro)}</p>
    <div class="grid two" style="align-items:start;margin-top:12px;">
      <div>${visual}</div>
      <div class="card">${table(doc.visualHeaders, doc.visualRows)}</div>
    </div>
    <div class="callout">${esc(doc.visualCallout)}</div>
    <div class="footer-note">Sample visual structure. Final layouts are tailored to the client context.</div>
  </section>`;
}

function controlsPage(doc) {
  return `<section class="page">${brandTop("04 Risks, Controls, And Actions")}
    <h2>${esc(doc.controlsTitle)}</h2>
    <p class="muted">${esc(doc.controlsIntro)}</p>
    ${table(doc.controlHeaders, doc.controlRows)}
    <div class="grid three" style="margin-top:14px;">${doc.controlCards
      .map((c) => `<div class="card ${c.className}"><h3>${esc(c.title)}</h3>${list(c.items)}</div>`)
      .join("")}</div>
    <div class="footer-note">Sample control structure. Final risks and controls depend on client policy, data, system, and operating context.</div>
  </section>`;
}

function roadmapPage(doc) {
  return `<section class="page">${brandTop("05 Roadmap And Decisions")}
    <h2>${esc(doc.roadmapTitle)}</h2>
    <div class="phase-grid" style="margin-top:12px;">${doc.roadmap
      .map((p) => `<div class="phase"><span class="tiny">${esc(p.label)}</span><strong>${esc(p.title)}</strong>${list(p.items)}</div>`)
      .join("")}</div>
    <div class="grid two" style="margin-top:16px;">
      <div class="card"><h3>Decision log</h3>${table(["Decision", "Recommendation", "Status"], doc.decisions)}</div>
      <div class="card"><h3>Open questions</h3>${list(doc.questions)}</div>
    </div>
    <div class="callout">${esc(doc.close)}</div>
    <div class="footer-note">Sample deliverable. Decisions, timelines, and priorities are tailored during intake.</div>
  </section>`;
}

function html(doc) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>BA Advisory Desk Sample ${esc(doc.title)}</title><style>${css}</style></head><body>${[
    cover(doc),
    snapshot(doc),
    coreTable(doc),
    visualPage(doc),
    controlsPage(doc),
    roadmapPage(doc),
  ].join("")}</body></html>`;
}

function pill(text, color = "green") {
  return `<span class="pill ${color}">${esc(text)}</span>`;
}

const docs = [
  {
    file: "sample_requirements_pack",
    title: "Requirements Clarity Pack",
    summary: "A polished requirements package that turns unclear scope, stakeholder notes, policy rules, and delivery questions into usable business, functional, and non functional requirements.",
    deliverableType: "Requirements baseline, traceability, assumptions, risks, and delivery handoff.",
    buyer: "Product owners, delivery leads, transformation teams, and consulting firms.",
    snapshotTitle: "The project had business intent, but no stable requirements baseline.",
    situation: "Stakeholders had shared notes, process fragments, and policy constraints. Delivery teams needed a clear requirements baseline before sprint planning, vendor estimation, and signoff.",
    snapshotCards: [
      { label: "Primary issue", text: "Scope was scattered across notes, emails, and workshop outputs.", className: "teal-card" },
      { label: "Business risk", text: "Delivery could start before assumptions, exceptions, and ownership were clear.", className: "gold-card" },
    ],
    scoreLabel: "Clarity index",
    score: "74",
    scoreNote: "Structured baseline",
    scoreCopy: "The package moves the work from unclear input to a delivery ready baseline with manageable open questions.",
    kpis: [
      { label: "Requirements captured", value: "42", copy: "Business, functional, and non functional requirements." },
      { label: "Open questions", value: "18", copy: "Grouped by decision owner and delivery impact." },
      { label: "High risk gaps", value: "7", copy: "Raised before development work begins." },
      { label: "Traceability links", value: "31", copy: "Mapped to goals, rules, and process steps." },
    ],
    recommendation: "Use this pack as the requirements baseline for estimation, backlog shaping, vendor alignment, and business signoff.",
    coreTitle: "Requirements baseline with business value, acceptance signal, and delivery notes.",
    coreIntro: "The table structure keeps requirements precise enough for delivery, while still readable for business stakeholders.",
    coreHeaders: ["ID", "Requirement", "Type", "Acceptance signal", "Delivery note"],
    coreRows: [
      ["BR 01", "The system must capture the business reason for each submitted request.", "Business", "Reason is visible in request summary.", "Supports triage and reporting."],
      ["BR 02", "Users must be able to save a request before all supporting files are ready.", "Business", "Draft status is available.", "Avoids lost work."],
      ["BR 03", "Each request must identify target audience and expected decision use.", "Business", "Audience and output purpose are mandatory.", "Improves output fit."],
      ["FR 01", "The intake form must support multiple file uploads in one submission.", "Functional", "PDF, Word, Excel, PowerPoint, PNG, and JPG accepted.", "Store file records by request."],
      ["FR 02", "A request must show status, expected credit use, due target, and next action.", "Functional", "Dashboard row displays all fields.", "Client and admin see same state."],
      ["FR 03", "Admin users must be able to mark a deliverable delivered and record credits used.", "Functional", "Credit ledger updates after delivery action.", "Prevents manual credit drift."],
      ["FR 04", "Clients must see payment and credit history in the workspace.", "Functional", "History tables display purchase and usage events.", "Improves trust and transparency."],
      ["NFR 01", "Client files must remain private to the client workspace and authorized operations users.", "Non functional", "Access checks prevent cross workspace access.", "Requires storage policy review."],
      ["NFR 02", "Every credit change must produce an audit event.", "Non functional", "Ledger and audit row created for each change.", "Supports dispute review."],
      ["NFR 03", "Low credit reminders must be sent when balance reaches threshold.", "Non functional", "Email event is logged.", "Threshold defaults to two credits."],
      ["BR 04", "A request with insufficient credits must pause before delivery work proceeds.", "Business", "Paused status appears to client.", "Top up path is shown."],
      ["FR 05", "Custom scope requests must capture goals, budget range, country, company type, and pain points.", "Functional", "Custom request appears in admin queue.", "Used for proposal follow up."],
    ],
    valuePoints: ["Creates a shared language between business, delivery, and vendors.", "Makes assumptions explicit before development spend increases.", "Improves backlog quality and reduces rework.", "Supports signoff with a clear requirements baseline."],
    prevents: ["Starting delivery from scattered notes.", "Losing decisions in email threads.", "Treating policy exceptions as late defects.", "Confusing business requirements with technical design."],
    visualType: "matrix",
    visualTitle: "Requirements decision matrix.",
    visualIntro: "Requirements are grouped by business value and delivery certainty so leaders can resolve the right items first.",
    matrixY: "Higher business impact",
    matrixX: "Higher delivery certainty",
    bubbles: [
      { text: "Mandatory intake", left: 68, top: 18, color: "#118577" },
      { text: "Credit ledger", left: 58, top: 38, color: "#118577" },
      { text: "File access", left: 42, top: 16, color: "#f2a61d" },
      { text: "Custom scope", left: 74, top: 56, color: "#64748b" },
      { text: "Email alerts", left: 28, top: 62, color: "#64748b" },
    ],
    visualHeaders: ["Priority", "Decision needed", "Owner"],
    visualRows: [
      ["1", "Confirm minimum intake fields before request acceptance.", "Business owner"],
      ["2", "Agree which requests consume one credit versus custom scope.", "Operations lead"],
      ["3", "Confirm file access rules for client and admin users.", "Security owner"],
      ["4", "Define refund, credit, and missed target handling.", "Commercial owner"],
      ["5", "Confirm email notification language and trigger thresholds.", "Operations lead"],
    ],
    visualCallout: "The strongest requirements packs do not just list needs. They show what must be decided, who owns it, and what delivery risk remains.",
    controlsTitle: "Open questions, assumptions, and delivery controls.",
    controlsIntro: "This section separates requirements from unresolved decisions so delivery teams do not mistake unknowns for approved scope.",
    controlHeaders: ["Theme", "Risk or question", "Impact", "Recommended action"],
    controlRows: [
      ["Credit model", "Some larger outputs may exceed one credit.", "Billing friction", "Confirm credit estimate before work starts."],
      ["File quality", "Uploaded notes may be incomplete or duplicated.", "Analysis delay", "Use minimum input checklist."],
      ["Stakeholder access", "Decision owners may not be available.", "Open questions linger", "Assign named owner for each question."],
      ["Security", "Client files may contain sensitive material.", "Privacy risk", "Use private workspace and NDA where needed."],
      ["Turnaround", "Clock depends on complete inputs.", "Expectation mismatch", "State target timing after intake completeness check."],
      ["Traceability", "Rules may not map cleanly to user stories.", "Defect risk", "Maintain traceability from rule to requirement."],
    ],
    controlCards: [
      { title: "Quality gate", items: ["Completeness check", "Ambiguity review", "Risk review"], className: "teal-card" },
      { title: "Client gate", items: ["Open question signoff", "Priority confirmation", "Scope boundary"], className: "gold-card" },
      { title: "Delivery gate", items: ["Backlog readiness", "Acceptance criteria", "Traceability"], className: "blue-card" },
    ],
    roadmapTitle: "Requirements handoff roadmap.",
    roadmap: [
      { label: "Step 1", title: "Intake", items: ["Collect files", "Confirm goal", "Identify audience"] },
      { label: "Step 2", title: "Structure", items: ["Group requirements", "Separate gaps", "Map business rules"] },
      { label: "Step 3", title: "Validate", items: ["Review assumptions", "Confirm priorities", "Resolve blockers"] },
      { label: "Step 4", title: "Handoff", items: ["Package baseline", "Prepare signoff view", "Support delivery planning"] },
    ],
    decisions: [
      ["Scope baseline", "Use this pack as the controlled baseline.", pill("Approve")],
      ["Open questions", "Assign owners before sprint planning.", pill("Action")],
      ["Credit use", "Confirm multi credit items before delivery.", pill("Control", "amber")],
      ["Vendor handoff", "Share only approved baseline and assumptions.", pill("Ready")],
    ],
    questions: ["Which requirements are mandatory for launch?", "Which policy exceptions are in scope?", "Who approves open business rules?", "What must be deferred to later phases?"],
    close: "The output gives teams a clean baseline for signoff, planning, vendor discussions, and future traceability.",
  },
  {
    file: "sample_business_case_brief",
    title: "Business Case Brief",
    summary: "A decision ready business case that frames the problem, evaluates options, clarifies benefits, identifies risks, and gives leaders a practical recommendation.",
    deliverableType: "Options analysis, benefits model, risk view, recommendation, and approval brief.",
    buyer: "Executives, transformation leaders, product leaders, and finance partners.",
    snapshotTitle: "Leaders needed a decision, not another long discussion.",
    situation: "The team had a strong business problem but weak decision material. Leaders needed options, cost logic, value drivers, implementation risk, and a concise recommendation.",
    snapshotCards: [
      { label: "Decision need", text: "Approve, defer, or redesign the investment path.", className: "teal-card" },
      { label: "Main risk", text: "Proceeding without a clear benefits case and adoption plan.", className: "gold-card" },
    ],
    scoreLabel: "Decision readiness",
    score: "81",
    scoreNote: "Ready for review",
    scoreCopy: "Options, risks, benefits, and implementation path are structured for executive decision making.",
    kpis: [
      { label: "Options assessed", value: "3", copy: "Do nothing, targeted improvement, full transformation." },
      { label: "Benefit categories", value: "6", copy: "Speed, quality, cost, risk, service, employee effort." },
      { label: "Key risks", value: "11", copy: "Grouped with mitigation and decision impact." },
      { label: "Roadmap phases", value: "4", copy: "Sequenced for controlled delivery." },
    ],
    recommendation: "Approve the targeted improvement option. It produces meaningful value, limits delivery risk, and preserves future scale options.",
    coreTitle: "Business case analysis table.",
    coreIntro: "The brief uses structured criteria to compare options in language that executives, finance, and delivery teams can review together.",
    coreHeaders: ["Area", "Finding", "Impact", "Evidence needed", "Recommendation"],
    coreRows: [
      ["Problem", "Manual review creates repeated delays and inconsistent decisions.", "Service speed and stakeholder confidence decline.", "Baseline cycle time by request type.", "Confirm current state metrics."],
      ["Option 1", "Do nothing keeps spend low but leaves root causes unresolved.", "Backlog and frustration continue.", "Current rework and escalation cost.", "Not recommended."],
      ["Option 2", "Targeted improvement fixes the highest volume process gaps first.", "Fast value with manageable change load.", "Volume, pain points, and readiness data.", "Recommended."],
      ["Option 3", "Full transformation offers scale but requires more change capacity.", "Higher potential value and higher risk.", "Operating model and funding detail.", "Defer until foundation is proven."],
      ["Benefit", "Standardized intake improves completeness and routing.", "Reduced rework and fewer escalations.", "Before and after completeness rate.", "Track monthly."],
      ["Benefit", "Clear decision rules reduce exception handling.", "Better consistency and auditability.", "Exception types and repeat causes.", "Build rules catalog."],
      ["Cost", "Implementation requires process design, workflow changes, training, and reporting.", "Moderate investment and adoption effort.", "Vendor estimate and internal time.", "Use phased rollout."],
      ["Risk", "Stakeholders may resist standardized intake.", "Low adoption could reduce value.", "User feedback and training needs.", "Run pilot with champions."],
      ["Risk", "Data quality may not support reporting needs.", "Benefit tracking may be weak.", "Source system data review.", "Define metrics early."],
      ["Assumption", "Leadership can assign a process owner.", "Ownership is required for benefit capture.", "Named owner and mandate.", "Confirm before approval."],
      ["Decision", "Approve pilot before enterprise rollout.", "Limits risk and proves value.", "Pilot success criteria.", "Approve controlled first phase."],
    ],
    valuePoints: ["Gives leaders a clear recommendation.", "Links business pain to benefits and delivery path.", "Separates assumptions from evidence.", "Creates a practical basis for approval."],
    prevents: ["Approving spend based on vague urgency.", "Comparing options without common criteria.", "Ignoring change readiness.", "Launching without benefit measures."],
    visualType: "matrix",
    visualTitle: "Option value and feasibility view.",
    visualIntro: "The options are compared by business value and implementation feasibility to keep the decision practical.",
    matrixY: "Higher value",
    matrixX: "Higher feasibility",
    bubbles: [
      { text: "Targeted improvement", left: 66, top: 22, color: "#118577" },
      { text: "Full transformation", left: 35, top: 18, color: "#f2a61d" },
      { text: "Do nothing", left: 20, top: 70, color: "#9d1b1b" },
      { text: "Pilot first", left: 74, top: 45, color: "#118577" },
    ],
    visualHeaders: ["Option", "Value", "Delivery view"],
    visualRows: [
      ["Do nothing", pill("Low", "red"), "Avoids near term cost but leaves pain unresolved."],
      ["Targeted improvement", pill("High"), "Best balance of value, risk, and speed."],
      ["Full transformation", pill("High", "amber"), "Good later option after foundation is proven."],
      ["Pilot first", pill("Recommended"), "Confirms benefits before broader investment."],
    ],
    visualCallout: "A strong business case does not just say yes or no. It gives leaders a risk aware path to a better decision.",
    controlsTitle: "Risks, assumptions, and mitigation plan.",
    controlsIntro: "Each risk is translated into a control or decision so the recommendation stays credible.",
    controlHeaders: ["Risk", "Likelihood", "Impact", "Mitigation"],
    controlRows: [
      ["Stakeholder adoption is lower than expected.", pill("Medium", "amber"), "Benefits delayed.", "Pilot with champions and measure usage."],
      ["Process owner is not assigned.", pill("Medium", "amber"), "Decisions drift.", "Assign owner before funding release."],
      ["Source data is incomplete.", pill("High", "red"), "Weak benefit tracking.", "Define minimum data set."],
      ["Training effort is underestimated.", pill("Medium", "amber"), "Poor rollout experience.", "Create quick reference material."],
      ["Vendor estimate expands.", pill("Medium", "amber"), "Budget pressure.", "Use fixed scope first phase."],
      ["Leadership requests broader scope too soon.", pill("Medium", "amber"), "Risk increases.", "Use phase gate approval."],
    ],
    controlCards: [
      { title: "Approval conditions", items: ["Named owner", "Pilot scope", "Success measures"], className: "teal-card" },
      { title: "Finance checks", items: ["Cost range", "Benefit owner", "Tracking method"], className: "gold-card" },
      { title: "Delivery checks", items: ["Resource plan", "Change plan", "Risk controls"], className: "blue-card" },
    ],
    roadmapTitle: "Business case approval roadmap.",
    roadmap: [
      { label: "Phase 1", title: "Confirm evidence", items: ["Baseline metrics", "Pain point validation", "Owner assigned"] },
      { label: "Phase 2", title: "Approve pilot", items: ["Scope first wave", "Set budget guardrail", "Define success"] },
      { label: "Phase 3", title: "Deliver and measure", items: ["Implement process changes", "Track adoption", "Review benefits"] },
      { label: "Phase 4", title: "Scale decision", items: ["Compare results", "Approve scale", "Close gaps"] },
    ],
    decisions: [
      ["Recommended option", "Approve targeted improvement.", pill("Approve")],
      ["Funding release", "Release pilot funding first.", pill("Controlled", "amber")],
      ["Scale", "Decide after benefit review.", pill("Hold", "amber")],
      ["Ownership", "Assign process owner before start.", pill("Required")],
    ],
    questions: ["What baseline metric will define success?", "Who owns benefit tracking?", "What scope must stay out of phase one?", "What decision date is needed?"],
    close: "The package converts a broad investment discussion into a decision ready brief with evidence, options, and a controlled path forward.",
  },
];

function addDoc(doc) {
  docs.push(doc);
}

addDoc({
  file: "sample_board_presentation",
  title: "Board Presentation Pack",
  summary: "A high impact board style package that turns complex program issues into a clear executive storyline, risks, decision requests, roadmap, and governance view.",
  deliverableType: "Board ready slides, executive narrative, decision asks, risk view, and roadmap.",
  buyer: "Executives, board sponsors, CIOs, CTOs, transformation leaders, and advisory teams.",
  snapshotTitle: "The board needed a sharp storyline, not a status dump.",
  situation: "Multiple workstreams had progress, risk, and decision needs. The leadership team needed a concise board ready story with clear asks and visual evidence.",
  snapshotCards: [
    { label: "Presentation issue", text: "Inputs were detailed but not shaped into an executive story.", className: "teal-card" },
    { label: "Decision risk", text: "Board time could be spent on background instead of the decisions needed.", className: "gold-card" },
  ],
  scoreLabel: "Board readiness",
  score: "86",
  scoreNote: "Decision ready",
  scoreCopy: "The package provides a clean story, visual risk view, and specific decision requests.",
  kpis: [
    { label: "Core slides", value: "12", copy: "Board ready storyline with speaker logic." },
    { label: "Decision asks", value: "4", copy: "Clear approvals or direction needed." },
    { label: "Risk themes", value: "8", copy: "Grouped for executive action." },
    { label: "Roadmap horizon", value: "90", copy: "Day action view for follow up." },
  ],
  recommendation: "Use a decision led structure: context, why now, options, risks, recommendation, and requested board direction.",
  coreTitle: "Board narrative structure.",
  coreIntro: "Each slide has one message, one purpose, and one intended executive takeaway.",
  coreHeaders: ["Slide", "Message", "Visual treatment", "Decision value"],
  coreRows: [
    ["1", "Why this matters now.", "Executive headline with urgency drivers.", "Frames the conversation."],
    ["2", "Current state is creating decision drag.", "Pain point map with operating impacts.", "Shows business relevance."],
    ["3", "Program progress is uneven by workstream.", "Heatmap across scope, people, process, data, tech.", "Focuses governance attention."],
    ["4", "The largest risk is not technology, it is unclear ownership.", "Risk stack with ownership gaps.", "Shifts discussion to accountable action."],
    ["5", "Three options are available.", "Option comparison with value and feasibility.", "Creates executive choice."],
    ["6", "Recommended path balances speed and control.", "Recommendation card with rationale.", "Supports approval."],
    ["7", "Dependencies determine delivery confidence.", "Dependency network with critical path.", "Shows what must be resolved."],
    ["8", "Financial view is staged by decision gate.", "Investment bands and benefit timing.", "Reduces funding ambiguity."],
    ["9", "Change readiness needs active sponsorship.", "Adoption risk map.", "Clarifies leadership role."],
    ["10", "90 day plan is actionable.", "Roadmap with milestones.", "Shows momentum."],
    ["11", "Governance decisions are required.", "Decision log and owner view.", "Enables direction."],
    ["12", "Board ask is specific.", "Four requested decisions.", "Closes with clarity."],
  ],
  valuePoints: ["Reduces executive noise.", "Creates a decision led narrative.", "Makes risks visible without overloading the board.", "Gives leaders a usable follow up roadmap."],
  prevents: ["Slide decks that read like status reports.", "Unclear asks at the end of the meeting.", "Hidden dependencies.", "Over detailed material that slows board decisions."],
  visualType: "slides",
  visualTitle: "Sample board slide snapshots.",
  visualIntro: "The pack uses visual slide patterns that help leaders scan, decide, and remember the message.",
  slides: [
    { label: "Slide 03", title: "Program Readiness Heatmap", copy: "Scope is strong. Ownership, adoption, and data readiness need active attention." },
    { label: "Slide 05", title: "Option Decision View", copy: "Targeted improvement is the best balance of value, cost, and risk." },
    { label: "Slide 08", title: "Investment Timing", copy: "Funding is staged against milestones and decision gates." },
    { label: "Slide 12", title: "Board Decision Ask", copy: "Approve first wave, assign sponsor, confirm guardrails, and set review date." },
  ],
  visualHeaders: ["Visual", "Purpose", "Why it works"],
  visualRows: [
    ["Heatmap", "Shows uneven readiness quickly.", "Executives can see where attention is needed."],
    ["Option cards", "Compares choices.", "Avoids debate without criteria."],
    ["Roadmap", "Shows time phased action.", "Links approval to next steps."],
    ["Decision log", "Names the ask.", "Prevents vague meeting outcomes."],
  ],
  visualCallout: "The best board materials do not try to show everything. They show the right things in the right order.",
  controlsTitle: "Board pack quality controls.",
  controlsIntro: "The deck is checked for executive clarity, decision logic, and evidence discipline.",
  controlHeaders: ["Control", "Question", "Risk reduced", "Action"],
  controlRows: [
    ["Message test", "Can the slide headline stand alone?", "Weak narrative", "Use action headline."],
    ["Decision test", "Does the deck ask for a clear decision?", "No outcome", "Add decision page."],
    ["Evidence test", "Is every key claim supported?", "Credibility risk", "Add source note."],
    ["Length test", "Can it be reviewed within board time?", "Overload", "Move detail to appendix."],
    ["Risk test", "Are risks grouped by decision relevance?", "Unfocused concern", "Use risk themes."],
    ["Follow up test", "Does the roadmap name owners?", "No execution path", "Add owner view."],
  ],
  controlCards: [
    { title: "Storyline", items: ["Why now", "What changed", "What decision"], className: "teal-card" },
    { title: "Evidence", items: ["Facts", "Risks", "Options"], className: "gold-card" },
    { title: "Action", items: ["Decision ask", "Owner", "Timeline"], className: "blue-card" },
  ],
  roadmapTitle: "Board preparation roadmap.",
  roadmap: [
    { label: "Step 1", title: "Shape story", items: ["Clarify audience", "Confirm decision ask", "Build storyline"] },
    { label: "Step 2", title: "Build visuals", items: ["Create heatmap", "Summarize options", "Design roadmap"] },
    { label: "Step 3", title: "Validate", items: ["Check evidence", "Review risks", "Test flow"] },
    { label: "Step 4", title: "Finalize", items: ["Prepare speaker notes", "Package appendix", "Confirm next steps"] },
  ],
  decisions: [
    ["Board ask", "Approve first wave and governance model.", pill("Approve")],
    ["Sponsor", "Assign named executive sponsor.", pill("Required")],
    ["Risk review", "Review high risks monthly.", pill("Control", "amber")],
    ["Next meeting", "Set progress checkpoint.", pill("Schedule")],
  ],
  questions: ["What is the single decision the board must make?", "Which details belong in appendix?", "Which risks require board direction?", "What happens immediately after approval?"],
  close: "The package turns complex program material into a board ready story with clear decisions and follow through.",
});

addDoc({
  file: "sample_sop_process_package",
  title: "SOP And Process Package",
  summary: "A practical operating package that documents the process, roles, steps, rules, exceptions, controls, and handoffs needed for repeatable work.",
  deliverableType: "SOP, process map, RACI, control checklist, exceptions, and rollout guide.",
  buyer: "Operations leaders, service teams, delivery managers, and process owners.",
  snapshotTitle: "The work was getting done, but not consistently.",
  situation: "Teams followed different handoffs, used different templates, and interpreted exceptions differently. Leaders needed one clear operating standard.",
  snapshotCards: [
    { label: "Operating issue", text: "Repeatable work depended too much on individual knowledge.", className: "teal-card" },
    { label: "Control risk", text: "Inconsistent handoffs created delays, rework, and avoidable escalation.", className: "gold-card" },
  ],
  scoreLabel: "Process discipline",
  score: "72",
  scoreNote: "Standardized",
  scoreCopy: "The package creates one agreed process view, with steps, owners, controls, and exception handling.",
  kpis: [
    { label: "Process steps", value: "16", copy: "Sequenced from intake to closure." },
    { label: "Roles clarified", value: "8", copy: "Mapped in RACI and handoff rules." },
    { label: "Control points", value: "12", copy: "Added at high risk handoffs." },
    { label: "Exceptions", value: "10", copy: "Documented with routing rules." },
  ],
  recommendation: "Adopt the SOP as the controlled operating baseline and review exceptions after the first 30 days of use.",
  coreTitle: "SOP step table.",
  coreIntro: "The SOP table gives teams the operating detail needed to execute consistently.",
  coreHeaders: ["Step", "Action", "Owner", "Input", "Output"],
  coreRows: [
    ["1", "Receive request and confirm channel.", "Intake coordinator", "Email, form, or portal request.", "Request record."],
    ["2", "Check minimum information.", "Intake coordinator", "Business goal, audience, due date.", "Complete or returned intake."],
    ["3", "Classify request type.", "Process lead", "Request summary.", "Category and priority."],
    ["4", "Assign owner.", "Team lead", "Category and workload.", "Named owner."],
    ["5", "Review supporting files.", "Assigned analyst", "Documents and notes.", "Input quality assessment."],
    ["6", "Identify missing context.", "Assigned analyst", "Input assessment.", "Clarification questions."],
    ["7", "Draft output.", "Assigned analyst", "Source materials.", "Draft deliverable."],
    ["8", "Perform quality check.", "Senior reviewer", "Draft deliverable.", "Reviewed output."],
    ["9", "Resolve open issues.", "Assigned analyst", "Review notes.", "Updated deliverable."],
    ["10", "Send client ready output.", "Delivery owner", "Final deliverable.", "Delivered package."],
    ["11", "Record status and credits.", "Operations admin", "Delivery record.", "Updated account history."],
    ["12", "Capture feedback.", "Client lead", "Client response.", "Improvement note."],
    ["13", "Close request.", "Operations admin", "Approved deliverable.", "Closed record."],
  ],
  valuePoints: ["Reduces variation across staff.", "Protects quality at handoff points.", "Makes training faster.", "Creates audit friendly evidence."],
  prevents: ["Unclear ownership.", "Hidden tribal knowledge.", "Repeated escalation.", "Inconsistent client experience."],
  visualType: "flow",
  visualTitle: "End to end operating flow.",
  visualIntro: "The process view keeps the SOP easy to understand before readers go into step detail.",
  flow: [
    { title: "Intake", copy: "Capture goal, audience, files, and urgency." },
    { title: "Triage", copy: "Classify request and confirm completeness." },
    { title: "Prepare", copy: "Draft output and resolve questions." },
    { title: "Review", copy: "Check quality, risks, and handoff fit." },
    { title: "Deliver", copy: "Send output and update records." },
  ],
  visualHeaders: ["Handoff", "Failure mode", "Control"],
  visualRows: [
    ["Intake to triage", "Incomplete request.", "Minimum input checklist."],
    ["Triage to analyst", "Wrong classification.", "Request type definitions."],
    ["Analyst to reviewer", "Inconsistent quality.", "QA checklist."],
    ["Reviewer to delivery", "Unresolved assumptions.", "Open question log."],
    ["Delivery to closure", "Credit record missed.", "Ledger update step."],
  ],
  visualCallout: "A useful SOP is not just a procedure. It is a practical operating model for consistent client delivery.",
  controlsTitle: "Controls and exception rules.",
  controlsIntro: "Exception rules tell staff what to do when the process cannot follow the happy path.",
  controlHeaders: ["Exception", "Trigger", "Owner", "Required action"],
  controlRows: [
    ["Incomplete intake", "No business goal or target audience.", "Intake coordinator", "Return for clarification."],
    ["Sensitive files", "Files appear confidential or regulated.", "Delivery owner", "Confirm NDA and handling path."],
    ["No credits", "Client balance is zero.", "Operations admin", "Pause request and send top up path."],
    ["Urgent work", "Client requests faster turnaround.", "Team lead", "Confirm feasibility and scope tradeoff."],
    ["Custom scope", "Request spans multiple teams or unclear outcomes.", "Senior reviewer", "Route to custom advisory."],
    ["Quality concern", "Client challenges output.", "Delivery owner", "Open revision review."],
  ],
  controlCards: [
    { title: "Training", items: ["Role guide", "Example requests", "Quality checklist"], className: "teal-card" },
    { title: "Governance", items: ["Owner", "Review cycle", "Exception log"], className: "gold-card" },
    { title: "Measurement", items: ["Cycle time", "Rework", "Client feedback"], className: "blue-card" },
  ],
  roadmapTitle: "SOP rollout roadmap.",
  roadmap: [
    { label: "Week 1", title: "Validate", items: ["Confirm process", "Review roles", "Check exceptions"] },
    { label: "Week 2", title: "Train", items: ["Walkthrough", "Publish job aid", "Answer questions"] },
    { label: "Week 3", title: "Use", items: ["Run first cycle", "Log exceptions", "Track gaps"] },
    { label: "Week 4", title: "Improve", items: ["Review metrics", "Update SOP", "Confirm baseline"] },
  ],
  decisions: [
    ["SOP owner", "Assign one accountable process owner.", pill("Required")],
    ["Exception log", "Track exceptions for 30 days.", pill("Approve")],
    ["Training", "Run walkthrough before rollout.", pill("Schedule")],
    ["Review cycle", "Review monthly during first quarter.", pill("Control", "amber")],
  ],
  questions: ["Who owns future SOP changes?", "Which exceptions require approval?", "What metrics show the process is working?", "Where is the approved SOP stored?"],
  close: "The SOP package gives teams a clear operating baseline that can be trained, measured, and improved.",
});

addDoc({
  file: "sample_uat_scenarios",
  title: "UAT Scenario Pack",
  summary: "A business focused UAT package that turns requirements into realistic scenarios, expected outcomes, data needs, signoff rules, and readiness checks.",
  deliverableType: "UAT strategy, scenarios, acceptance checks, test data notes, defect triage, and signoff pack.",
  buyer: "Product owners, business users, QA leads, project managers, and delivery teams.",
  snapshotTitle: "Business users needed confidence before signoff.",
  situation: "The team had requirements, but not enough business oriented validation scenarios. UAT needed to confirm real workflow outcomes, not just screen behavior.",
  snapshotCards: [
    { label: "Validation issue", text: "Test cases were too technical and did not reflect real business situations.", className: "teal-card" },
    { label: "Signoff risk", text: "Business acceptance could be delayed by missing data, roles, or edge cases.", className: "gold-card" },
  ],
  scoreLabel: "UAT readiness",
  score: "79",
  scoreNote: "Ready with gaps",
  scoreCopy: "Core scenarios are ready, with a small number of data and role dependencies still open.",
  kpis: [
    { label: "Scenarios", value: "18", copy: "Grouped by workflow and outcome." },
    { label: "Data sets", value: "9", copy: "Normal, exception, and boundary conditions." },
    { label: "Roles", value: "6", copy: "Mapped to test execution and signoff." },
    { label: "Open blockers", value: "5", copy: "Need resolution before start." },
  ],
  recommendation: "Use scenario based UAT with business owner signoff and daily defect triage during the validation window.",
  coreTitle: "UAT scenario table.",
  coreIntro: "Each scenario is written in business language so users can validate outcomes with confidence.",
  coreHeaders: ["ID", "Scenario", "Role", "Expected result", "Data need"],
  coreRows: [
    ["UAT 01", "Submit a complete request with all mandatory fields.", "Requester", "Request is accepted and status is new.", "Standard request data."],
    ["UAT 02", "Submit a request with missing business goal.", "Requester", "User receives clear validation message.", "Incomplete request."],
    ["UAT 03", "Upload multiple supporting files.", "Requester", "Files attach to the same request.", "PDF, Word, Excel."],
    ["UAT 04", "Classify request as custom scope.", "Client lead", "User is directed to custom scope path.", "Complex request example."],
    ["UAT 05", "View request status in workspace.", "Client user", "Status and due target are visible.", "Existing request."],
    ["UAT 06", "Purchase credit top up.", "Billing contact", "Payment confirmation appears and credits update.", "Payment account."],
    ["UAT 07", "Submit request with no credits.", "Client user", "Request is paused and top up message appears.", "Zero balance account."],
    ["UAT 08", "Admin marks deliverable delivered.", "Operations admin", "Status and credit history update.", "Approved deliverable."],
    ["UAT 09", "Receive low credit reminder.", "Client user", "Email shows balance and top up link.", "Balance at threshold."],
    ["UAT 10", "Cancel checkout before payment.", "Client user", "User returns to appropriate billing or pricing path.", "Checkout session."],
    ["UAT 11", "Access workspace after magic link.", "Client user", "Dashboard opens for signed in user.", "Valid email link."],
    ["UAT 12", "Attempt access after expired link.", "Client user", "User receives fresh link instruction.", "Expired link."],
  ],
  valuePoints: ["Tests real business outcomes.", "Shows signoff evidence clearly.", "Reduces late acceptance surprises.", "Improves alignment between business and delivery teams."],
  prevents: ["Technical tests replacing business validation.", "Missing data blocking UAT.", "Unclear defect severity.", "Signoff without evidence."],
  visualType: "flow",
  visualTitle: "UAT execution flow.",
  visualIntro: "A simple flow helps business users understand what happens before, during, and after UAT.",
  flow: [
    { title: "Prepare", copy: "Confirm scope, scenarios, data, and roles." },
    { title: "Execute", copy: "Run business scenarios with evidence capture." },
    { title: "Triage", copy: "Review defects and prioritize fixes." },
    { title: "Retest", copy: "Confirm fixes and update evidence." },
    { title: "Sign off", copy: "Approve with open item log." },
  ],
  visualHeaders: ["Stage", "Output", "Owner"],
  visualRows: [
    ["Prepare", "Scenario pack and readiness checklist.", "UAT lead"],
    ["Execute", "Completed scenarios and screenshots.", "Business users"],
    ["Triage", "Defect severity and ownership.", "Delivery lead"],
    ["Retest", "Fix confirmation.", "Business users"],
    ["Signoff", "Approval and open item log.", "Business owner"],
  ],
  visualCallout: "Good UAT proves that the business process works, not just that the screens load.",
  controlsTitle: "Defect triage and readiness controls.",
  controlsIntro: "The pack includes clear rules for severity, ownership, retesting, and signoff.",
  controlHeaders: ["Control", "Purpose", "Owner", "Evidence"],
  controlRows: [
    ["Readiness checklist", "Confirm data, users, and environment.", "UAT lead", "Checklist approved."],
    ["Severity rules", "Avoid debate during triage.", "Delivery lead", "Severity guide."],
    ["Daily triage", "Keep blockers moving.", "Project lead", "Triage log."],
    ["Retest evidence", "Prove fixes work.", "Business user", "Retest result."],
    ["Known issue log", "Protect signoff transparency.", "Business owner", "Open item register."],
    ["Final approval", "Record acceptance.", "Sponsor", "Signoff note."],
  ],
  controlCards: [
    { title: "Ready to start", items: ["Data loaded", "Users assigned", "Scope frozen"], className: "teal-card" },
    { title: "Ready to sign off", items: ["Critical defects closed", "Known issues accepted", "Evidence stored"], className: "gold-card" },
    { title: "Ready to release", items: ["Training complete", "Support path ready", "Rollback known"], className: "blue-card" },
  ],
  roadmapTitle: "UAT delivery roadmap.",
  roadmap: [
    { label: "Day 1", title: "Prepare", items: ["Confirm scope", "Load data", "Brief users"] },
    { label: "Days 2 to 4", title: "Execute", items: ["Run scenarios", "Log defects", "Track evidence"] },
    { label: "Days 5 to 6", title: "Retest", items: ["Confirm fixes", "Update signoff view", "Close blockers"] },
    { label: "Day 7", title: "Sign off", items: ["Review open items", "Approve release", "Archive evidence"] },
  ],
  decisions: [
    ["Start UAT", "Start after readiness checklist is complete.", pill("Approve")],
    ["Severity rules", "Use business impact to set severity.", pill("Approve")],
    ["Signoff", "Allow signoff with accepted minor open items.", pill("Controlled", "amber")],
    ["Release", "Block release if critical workflow fails.", pill("Required")],
  ],
  questions: ["Who can approve signoff?", "Which scenarios are release blockers?", "What data is needed for edge cases?", "Where will evidence be stored?"],
  close: "The UAT pack gives business users a structured way to validate outcomes and sign off with confidence.",
});

addDoc({
  file: "sample_gap_analysis",
  title: "Gap And Options Analysis",
  summary: "A structured analysis package that converts findings into capability gaps, root causes, risk themes, options, priorities, and a practical action plan.",
  deliverableType: "Gap register, maturity view, options analysis, action plan, and decision summary.",
  buyer: "Transformation leaders, program managers, CIO offices, and operational executives.",
  snapshotTitle: "The team knew there were gaps, but not what to fix first.",
  situation: "Findings were spread across workshops, interviews, incident notes, and delivery observations. Leaders needed a structured view of gaps, impacts, options, and priorities.",
  snapshotCards: [
    { label: "Analysis issue", text: "Findings were not grouped by root cause or business impact.", className: "teal-card" },
    { label: "Leadership risk", text: "Action could focus on visible symptoms instead of the highest value fixes.", className: "gold-card" },
  ],
  scoreLabel: "Action readiness",
  score: "77",
  scoreNote: "Prioritized",
  scoreCopy: "Gaps are grouped, scored, and connected to options and practical next steps.",
  kpis: [
    { label: "Gaps captured", value: "26", copy: "Grouped by capability and impact." },
    { label: "High priority", value: "8", copy: "Need leadership attention." },
    { label: "Options", value: "3", copy: "Stabilize, improve, transform." },
    { label: "Action owners", value: "12", copy: "Assigned by theme." },
  ],
  recommendation: "Start with stabilization gaps that reduce delivery risk, then move to process and operating model improvements.",
  coreTitle: "Gap register with priority and recommendation.",
  coreIntro: "The gap register converts observations into action oriented entries that can be owned and tracked.",
  coreHeaders: ["ID", "Gap", "Impact", "Priority", "Recommended action"],
  coreRows: [
    ["G 01", "No single intake standard.", "Incomplete work enters the pipeline.", pill("High", "red"), "Create minimum input checklist."],
    ["G 02", "Decision ownership is unclear.", "Open questions remain unresolved.", pill("High", "red"), "Assign decision owner by workstream."],
    ["G 03", "Process exceptions are not tracked.", "Repeat problems continue.", pill("High", "red"), "Create exception log and monthly review."],
    ["G 04", "Reporting metrics are inconsistent.", "Leaders cannot compare performance.", pill("Medium", "amber"), "Define metric catalog."],
    ["G 05", "Training material is outdated.", "Users rely on informal guidance.", pill("Medium", "amber"), "Refresh quick guides."],
    ["G 06", "Vendor handoff lacks approved scope.", "Estimate changes and rework increase.", pill("High", "red"), "Use vendor readiness checklist."],
    ["G 07", "Requirements are not traced to business goals.", "Low value scope can expand.", pill("Medium", "amber"), "Add traceability view."],
    ["G 08", "Risk reviews happen late.", "Controls are added after design.", pill("High", "red"), "Add early risk gate."],
    ["G 09", "Data ownership is fragmented.", "Reporting and automation are delayed.", pill("Medium", "amber"), "Assign data owners."],
    ["G 10", "No formal benefit tracking.", "Improvements cannot be defended.", pill("Medium", "amber"), "Create baseline and benefits dashboard."],
    ["G 11", "Escalation path is unclear.", "Teams lose time resolving blockers.", pill("Medium", "amber"), "Define escalation triggers."],
    ["G 12", "Closeout lessons are not captured.", "Improvement learning is lost.", pill("Low"), "Add closeout review."],
  ],
  valuePoints: ["Creates a prioritized action view.", "Connects gaps to business impact.", "Separates symptoms from root causes.", "Supports governance and progress tracking."],
  prevents: ["Action plans with no priorities.", "Fixing symptoms only.", "Ignoring ownership gaps.", "Losing findings after workshops."],
  visualType: "matrix",
  visualTitle: "Gap impact and urgency matrix.",
  visualIntro: "The visual makes it easier to see which gaps require immediate action and which can be sequenced later.",
  matrixY: "Higher impact",
  matrixX: "Higher urgency",
  bubbles: [
    { text: "Intake", left: 72, top: 18, color: "#9d1b1b" },
    { text: "Ownership", left: 64, top: 28, color: "#9d1b1b" },
    { text: "Risk gate", left: 54, top: 18, color: "#9d1b1b" },
    { text: "Metrics", left: 40, top: 45, color: "#f2a61d" },
    { text: "Training", left: 58, top: 62, color: "#64748b" },
    { text: "Lessons", left: 24, top: 70, color: "#64748b" },
  ],
  visualHeaders: ["Theme", "Immediate action", "Longer term move"],
  visualRows: [
    ["Intake", "Set minimum input standard.", "Automate intake validation."],
    ["Ownership", "Assign decision owners.", "Create governance cadence."],
    ["Risk", "Add early review gate.", "Embed control design."],
    ["Metrics", "Define core measures.", "Build dashboard."],
    ["Training", "Publish quick guide.", "Create role based learning."],
  ],
  visualCallout: "A gap analysis has value only when it creates clear choices about what to fix first.",
  controlsTitle: "Action controls and dependency view.",
  controlsIntro: "Each action needs an owner, dependency, and review rhythm so findings become progress.",
  controlHeaders: ["Action", "Dependency", "Owner", "Review"],
  controlRows: [
    ["Create intake checklist.", "Agreement on mandatory fields.", "Operations lead", "Weekly until launch."],
    ["Assign decision owners.", "Workstream map.", "Program sponsor", "Biweekly."],
    ["Define metric catalog.", "Reporting source review.", "Data lead", "Monthly."],
    ["Build vendor readiness checklist.", "Procurement input.", "Delivery lead", "Before vendor release."],
    ["Add risk gate.", "Risk criteria.", "Risk lead", "At intake and design."],
    ["Refresh training material.", "Updated SOP.", "Change lead", "Before rollout."],
  ],
  controlCards: [
    { title: "Priority rules", items: ["Impact", "Urgency", "Dependency"], className: "teal-card" },
    { title: "Governance", items: ["Owner", "Review date", "Escalation"], className: "gold-card" },
    { title: "Evidence", items: ["Baseline", "Progress", "Outcome"], className: "blue-card" },
  ],
  roadmapTitle: "Gap closure roadmap.",
  roadmap: [
    { label: "0 to 30 days", title: "Stabilize", items: ["Minimum intake", "Owners", "Risk gate"] },
    { label: "31 to 60 days", title: "Standardize", items: ["SOP updates", "Metrics", "Training"] },
    { label: "61 to 90 days", title: "Improve", items: ["Dashboard", "Vendor handoff", "Exception review"] },
    { label: "90 plus days", title: "Scale", items: ["Automation", "Operating model", "Benefits review"] },
  ],
  decisions: [
    ["Priority set", "Focus first wave on eight high priority gaps.", pill("Approve")],
    ["Governance", "Review gap register biweekly.", pill("Schedule")],
    ["Metrics", "Create benefit baseline.", pill("Required")],
    ["Scale", "Defer automation until process stabilizes.", pill("Hold", "amber")],
  ],
  questions: ["Which gaps are true blockers?", "Who owns each workstream?", "What evidence proves closure?", "Which actions need funding?"],
  close: "The analysis gives leaders a focused action plan instead of a long list of findings.",
});

addDoc({
  file: "sample_stakeholder_synthesis",
  title: "Stakeholder Synthesis Pack",
  summary: "A structured synthesis that turns stakeholder interviews, workshops, and written feedback into themes, needs, conflicts, decisions, and action priorities.",
  deliverableType: "Stakeholder map, themes, needs analysis, conflict view, decision log, and action register.",
  buyer: "Program leads, product owners, transformation offices, and consulting teams.",
  snapshotTitle: "Stakeholders were talking about the same problem in different ways.",
  situation: "Feedback was rich but fragmented. Leaders needed to know what stakeholders agreed on, where they disagreed, what decisions were needed, and what could move forward.",
  snapshotCards: [
    { label: "Synthesis issue", text: "Input volume was high, but themes and decisions were unclear.", className: "teal-card" },
    { label: "Delivery risk", text: "Unresolved stakeholder conflicts could appear later as scope changes.", className: "gold-card" },
  ],
  scoreLabel: "Alignment index",
  score: "69",
  scoreNote: "Needs decisions",
  scoreCopy: "Themes are clear, but several stakeholder conflicts require leadership direction.",
  kpis: [
    { label: "Stakeholder groups", value: "9", copy: "Grouped by influence and impact." },
    { label: "Themes", value: "11", copy: "Consolidated from interviews and notes." },
    { label: "Decision points", value: "14", copy: "Assigned to owner groups." },
    { label: "Conflicts", value: "6", copy: "Need resolution before final scope." },
  ],
  recommendation: "Use the synthesis to confirm shared priorities, resolve conflicts, and protect delivery scope before detailed build work.",
  coreTitle: "Stakeholder theme and decision table.",
  coreIntro: "The table separates themes, stakeholder needs, tensions, and required decisions.",
  coreHeaders: ["Theme", "Stakeholder need", "Tension", "Decision needed"],
  coreRows: [
    ["Speed", "Faster request review and clear status updates.", "Teams disagree on acceptable turnaround.", "Define service targets by request type."],
    ["Clarity", "Plain language requirements and decisions.", "Some teams prefer detailed technical notes.", "Agree deliverable format by audience."],
    ["Ownership", "Named owner for decisions and approvals.", "Current ownership crosses teams.", "Assign approval roles."],
    ["Traceability", "Ability to see why decisions were made.", "Notes are stored in different places.", "Set decision log standard."],
    ["Flexibility", "Support for unusual request types.", "Too much flexibility can create scope creep.", "Define custom scope trigger."],
    ["Security", "Confidence in file handling.", "Users vary in sensitivity expectations.", "Confirm private workspace and NDA path."],
    ["Reporting", "Visibility into demand and delivery progress.", "Metrics are not consistently defined.", "Approve dashboard measures."],
    ["Budget", "Predictable cost for recurring support.", "Large requests may exceed standard plan.", "Define credit and custom scope rules."],
    ["Adoption", "Easy process for busy teams.", "New intake can be seen as friction.", "Create quick start guidance."],
    ["Quality", "Senior review before outputs are sent.", "Turnaround expectations may pressure review.", "Protect quality gate."],
    ["Escalation", "Clear path when a request is blocked.", "Escalation rules are informal.", "Define blocker and escalation criteria."],
  ],
  valuePoints: ["Turns feedback into decisions.", "Shows alignment and conflict clearly.", "Protects delivery scope.", "Gives leaders a practical action list."],
  prevents: ["Confusing loud feedback with priority.", "Hiding stakeholder conflict.", "Starting build work before decisions.", "Losing interview insights."],
  visualType: "matrix",
  visualTitle: "Stakeholder influence and impact map.",
  visualIntro: "The map helps decide who must approve, who must be engaged, and who needs targeted communication.",
  matrixY: "Higher influence",
  matrixX: "Higher impact",
  bubbles: [
    { text: "Sponsor", left: 72, top: 18, color: "#118577" },
    { text: "Operations", left: 64, top: 36, color: "#118577" },
    { text: "Technology", left: 46, top: 26, color: "#f2a61d" },
    { text: "Finance", left: 54, top: 58, color: "#64748b" },
    { text: "End users", left: 28, top: 34, color: "#f2a61d" },
    { text: "Vendors", left: 20, top: 66, color: "#64748b" },
  ],
  visualHeaders: ["Group", "Engagement need", "Message"],
  visualRows: [
    ["Sponsor", "Decision approval.", "Resolve scope and funding choices."],
    ["Operations", "Workflow validation.", "Confirm real world fit."],
    ["Technology", "Feasibility review.", "Confirm integration and controls."],
    ["End users", "Adoption input.", "Make process easier to use."],
    ["Finance", "Cost and benefit review.", "Validate business case."],
  ],
  visualCallout: "Stakeholder synthesis is most valuable when it shows what must be decided, not just what people said.",
  controlsTitle: "Decision and conflict management.",
  controlsIntro: "The pack identifies conflicts early and translates them into decision items.",
  controlHeaders: ["Conflict", "Why it matters", "Owner", "Recommended action"],
  controlRows: [
    ["Speed versus quality", "Fast turnaround can weaken review.", "Sponsor", "Set targets by complexity."],
    ["Flexible intake versus scope control", "Open requests can expand effort.", "Operations lead", "Define custom scope trigger."],
    ["Detailed docs versus executive summaries", "Different audiences need different outputs.", "Delivery lead", "Use tiered deliverable format."],
    ["Security comfort levels", "Sensitive materials need clear handling.", "Security owner", "Publish file handling note."],
    ["Metrics ownership", "No one owns benefit tracking.", "Program lead", "Assign metric owners."],
    ["Approval authority", "Signoff delays can block delivery.", "Sponsor", "Confirm approval matrix."],
  ],
  controlCards: [
    { title: "Interview evidence", items: ["Themes", "Quotes summarized", "Needs"], className: "teal-card" },
    { title: "Conflict evidence", items: ["Tensions", "Tradeoffs", "Decision owners"], className: "gold-card" },
    { title: "Action evidence", items: ["Actions", "Owners", "Due dates"], className: "blue-card" },
  ],
  roadmapTitle: "Stakeholder alignment roadmap.",
  roadmap: [
    { label: "Step 1", title: "Capture", items: ["Review notes", "Group stakeholders", "Extract themes"] },
    { label: "Step 2", title: "Synthesize", items: ["Find patterns", "Separate conflicts", "Draft insights"] },
    { label: "Step 3", title: "Decide", items: ["Assign owners", "Resolve tradeoffs", "Confirm priorities"] },
    { label: "Step 4", title: "Communicate", items: ["Prepare summary", "Share actions", "Track decisions"] },
  ],
  decisions: [
    ["Priority themes", "Approve top five shared priorities.", pill("Approve")],
    ["Conflicts", "Resolve six conflict points before final scope.", pill("Required")],
    ["Communication", "Use audience specific summary.", pill("Approve")],
    ["Follow up", "Review unresolved items weekly.", pill("Schedule")],
  ],
  questions: ["Which stakeholders must approve final scope?", "Which needs are non negotiable?", "Which conflicts can be deferred?", "Who owns communication back to stakeholders?"],
  close: "The synthesis gives teams a clear picture of what stakeholders need, where alignment exists, and what must be decided next.",
});

addDoc({
  file: "sample_vendor_readiness",
  title: "Vendor Readiness Checklist",
  summary: "A vendor readiness package that prepares teams to engage vendors with clear scope, evaluation criteria, questions, risks, assumptions, and handoff material.",
  deliverableType: "Vendor scope, readiness checklist, evaluation criteria, RFP support, questions, and handoff pack.",
  buyer: "Procurement teams, delivery leaders, technology groups, and consulting firms.",
  snapshotTitle: "The team was ready to talk to vendors, but not ready to control the conversation.",
  situation: "Vendor engagement was approaching, but scope, assumptions, evaluation criteria, and business questions were not yet clear enough to support fair comparison or stable delivery.",
  snapshotCards: [
    { label: "Procurement issue", text: "Vendors could interpret the same need in different ways.", className: "teal-card" },
    { label: "Delivery risk", text: "Weak handoff could lead to change requests, pricing drift, and unclear accountability.", className: "gold-card" },
  ],
  scoreLabel: "Vendor readiness",
  score: "71",
  scoreNote: "Prepare before release",
  scoreCopy: "Core needs are known, but scope, assumptions, and evaluation criteria need sharpening before vendor release.",
  kpis: [
    { label: "Readiness checks", value: "28", copy: "Across scope, data, process, controls, and support." },
    { label: "Vendor questions", value: "34", copy: "Grouped by domain and risk." },
    { label: "Evaluation criteria", value: "12", copy: "Weighted for fair comparison." },
    { label: "High risk gaps", value: "6", copy: "Need resolution before release." },
  ],
  recommendation: "Do not release the vendor package until scope boundaries, evaluation criteria, and business acceptance measures are approved.",
  coreTitle: "Vendor readiness checklist.",
  coreIntro: "The checklist improves vendor comparison and reduces ambiguity before pricing and delivery commitments are made.",
  coreHeaders: ["Area", "Readiness question", "Status", "Why it matters"],
  coreRows: [
    ["Business goal", "Is the business outcome stated in measurable terms?", pill("Ready"), "Vendors need the purpose, not just tasks."],
    ["Scope", "Are in scope and out of scope items separated?", pill("Needs work", "amber"), "Prevents pricing ambiguity."],
    ["Requirements", "Are business, functional, and non functional needs documented?", pill("Needs work", "amber"), "Supports comparable responses."],
    ["Data", "Are source systems and data quality issues described?", pill("Gap", "red"), "Affects feasibility and integration."],
    ["Security", "Are privacy, access, and data handling needs stated?", pill("Needs work", "amber"), "Protects sensitive information."],
    ["Process", "Is the current workflow documented?", pill("Ready"), "Helps vendors understand operating fit."],
    ["Target state", "Is the desired future state clear?", pill("Needs work", "amber"), "Avoids solution guessing."],
    ["Evaluation", "Are scoring criteria and weights approved?", pill("Gap", "red"), "Supports fair selection."],
    ["Acceptance", "Are success and signoff criteria defined?", pill("Gap", "red"), "Reduces disputes after delivery."],
    ["Support", "Is post implementation support expectation stated?", pill("Needs work", "amber"), "Avoids hidden cost."],
    ["Timeline", "Are milestone expectations realistic?", pill("Ready"), "Supports delivery planning."],
    ["Commercial", "Are assumptions and pricing structure requested?", pill("Ready"), "Improves proposal comparison."],
  ],
  valuePoints: ["Improves vendor response quality.", "Reduces interpretation gaps.", "Supports fair scoring.", "Protects delivery scope."],
  prevents: ["Vendors pricing different scopes.", "Evaluation based on presentation polish only.", "Hidden assumptions.", "Change requests caused by weak handoff."],
  visualType: "matrix",
  visualTitle: "Vendor response quality matrix.",
  visualIntro: "The matrix shows where vendor responses should be compared by value and delivery confidence.",
  matrixY: "Higher strategic fit",
  matrixX: "Higher delivery confidence",
  bubbles: [
    { text: "Vendor A", left: 68, top: 20, color: "#118577" },
    { text: "Vendor B", left: 44, top: 28, color: "#f2a61d" },
    { text: "Vendor C", left: 58, top: 58, color: "#64748b" },
    { text: "Vendor D", left: 24, top: 62, color: "#9d1b1b" },
  ],
  visualHeaders: ["Evaluation area", "Weight", "Evidence expected"],
  visualRows: [
    ["Business fit", "20%", "Clear link to business outcomes."],
    ["Functional fit", "20%", "Response maps to requirements."],
    ["Implementation approach", "15%", "Credible plan, roles, and timeline."],
    ["Security and controls", "15%", "Data, access, privacy, and audit controls."],
    ["Support model", "10%", "Post launch support clarity."],
    ["Commercial value", "20%", "Transparent pricing and assumptions."],
  ],
  visualCallout: "A strong vendor package lets vendors compete on the same problem, the same evidence, and the same decision criteria.",
  controlsTitle: "Vendor questions and scope controls.",
  controlsIntro: "Good vendor questions expose assumptions before selection, not after contract award.",
  controlHeaders: ["Theme", "Question", "Expected response", "Risk reduced"],
  controlRows: [
    ["Scope", "What assumptions are included in your estimate?", "List of assumptions and exclusions.", "Hidden scope."],
    ["Delivery", "What client roles are required each week?", "Role and effort model.", "Resource surprises."],
    ["Data", "What source data quality is required?", "Data prerequisites and risks.", "Integration delay."],
    ["Security", "How will sensitive files be protected?", "Security and access approach.", "Privacy risk."],
    ["Acceptance", "How will completion be proven?", "Acceptance criteria and evidence.", "Signoff dispute."],
    ["Change", "How will change requests be managed?", "Change process and pricing logic.", "Cost drift."],
  ],
  controlCards: [
    { title: "Before release", items: ["Scope boundaries", "Criteria", "Questions"], className: "teal-card" },
    { title: "During evaluation", items: ["Scoring", "Clarifications", "Risk notes"], className: "gold-card" },
    { title: "After selection", items: ["Assumptions", "Handoff", "Acceptance"], className: "blue-card" },
  ],
  roadmapTitle: "Vendor readiness roadmap.",
  roadmap: [
    { label: "Step 1", title: "Clarify", items: ["Business goal", "Scope boundaries", "Requirements"] },
    { label: "Step 2", title: "Prepare", items: ["Questions", "Evaluation criteria", "Assumptions"] },
    { label: "Step 3", title: "Evaluate", items: ["Score responses", "Compare risks", "Clarify gaps"] },
    { label: "Step 4", title: "Handoff", items: ["Confirm scope", "Set acceptance", "Start governance"] },
  ],
  decisions: [
    ["Release package", "Release after high risk gaps are closed.", pill("Conditional", "amber")],
    ["Evaluation weights", "Approve weighted criteria before release.", pill("Required")],
    ["Clarification path", "Use structured clarification log.", pill("Approve")],
    ["Contract handoff", "Attach approved assumptions and acceptance criteria.", pill("Control")],
  ],
  questions: ["Which requirements are mandatory?", "What vendor assumptions are unacceptable?", "Who approves scoring?", "What evidence is needed before award?"],
  close: "The package helps teams enter vendor conversations with clarity, control, and a fair basis for selection.",
});

for (const doc of docs) {
  fs.writeFileSync(path.join(sampleDir, `${doc.file}.html`), html(doc), "utf8");
}

console.log(`Generated ${docs.length} sample HTML files.`);
