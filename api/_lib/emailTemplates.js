function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com";
}

function formatUsd(amountCents, currency) {
  const amount = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "usd").toUpperCase(),
  }).format(amount);
}

function wrapEmail({ heading, intro, paragraphs = [], actionLabel, actionUrl }) {
  const paragraphHtml = [intro, ...paragraphs]
    .filter(Boolean)
    .map((text) => `<p style="margin:0 0 14px;">${escapeHtml(text)}</p>`)
    .join("");

  const actionHtml =
    actionLabel && actionUrl
      ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(actionUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">${escapeHtml(actionLabel)}</a></p>`
      : "";

  return `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:620px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;">${escapeHtml(heading)}</h1>
      ${paragraphHtml}
      ${actionHtml}
      <p style="margin:24px 0 0;color:#5c6670;font-size:13px;">BA Advisory Desk</p>
    </div>
  `;
}

function paymentConfirmed({ order, balanceAfter }) {
  const workspaceUrl = `${publicBaseUrl()}/index.html#login`;
  const productType = order?.product_type;
  const credits = Number(order?.credits || 0);
  const amount = formatUsd(order?.amount_cents, order?.currency);

  if (productType === "rescue_sprint") {
    return {
      templateKey: "payment_confirmation",
      subject: "Requirements Rescue Sprint payment confirmed",
      body: `Your Requirements Rescue Sprint payment has been confirmed. Amount paid: ${amount}. Please use your checkout email to access BA Advisory Desk and share the material needed for your sprint.`,
      html: wrapEmail({
        heading: "Requirements Rescue Sprint payment confirmed",
        intro: `Your Requirements Rescue Sprint payment has been confirmed. Amount paid: ${amount}.`,
        paragraphs: ["Please use your checkout email to access BA Advisory Desk and share the material needed for your sprint."],
        actionLabel: "Open BA Advisory Desk",
        actionUrl: workspaceUrl,
      }),
    };
  }

  if (productType === "starter_monthly") {
    const balanceText = Number.isFinite(balanceAfter) ? ` Your current credit balance is ${balanceAfter}.` : "";
    return {
      templateKey: "payment_confirmation",
      subject: "BA Advisory Desk Monthly Support payment confirmed",
      body: `Your BA Advisory Desk Monthly Support payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.${balanceText}`,
      html: wrapEmail({
        heading: "BA Advisory Desk Monthly Support payment confirmed",
        intro: `Your BA Advisory Desk Monthly Support payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.`,
        paragraphs: [balanceText.trim(), "Use your workspace for requests, delivery updates, files, and credit history."],
        actionLabel: "Open your workspace",
        actionUrl: workspaceUrl,
      }),
    };
  }

  if (productType === "credit_top_up") {
    const balanceText = Number.isFinite(balanceAfter) ? ` Your current credit balance is ${balanceAfter}.` : "";
    return {
      templateKey: "payment_confirmation",
      subject: "3 Advisory Credit Top Up payment confirmed",
      body: `Your 3 Advisory Credit Top Up payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.${balanceText}`,
      html: wrapEmail({
        heading: "3 Advisory Credit Top Up payment confirmed",
        intro: `Your 3 Advisory Credit Top Up payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.`,
        paragraphs: [balanceText.trim()],
        actionLabel: "Open your workspace",
        actionUrl: workspaceUrl,
      }),
    };
  }

  return {
    templateKey: "payment_confirmation",
    subject: "BA Advisory Desk payment confirmed",
    body: `Your BA Advisory Desk payment has been confirmed. Amount paid: ${amount}.`,
    html: wrapEmail({
      heading: "Payment confirmed",
      intro: `Your BA Advisory Desk payment has been confirmed. Amount paid: ${amount}.`,
      actionLabel: "Open BA Advisory Desk",
      actionUrl: workspaceUrl,
    }),
  };
}

function lowCredit({ balance, threshold }) {
  const workspaceUrl = `${publicBaseUrl()}/index.html#pricing`;
  return {
    templateKey: "low_credit_reminder",
    subject: "BA Advisory Desk credits are running low",
    body: `Your workspace has ${balance} Advisory Credit${balance === 1 ? "" : "s"} remaining. The low credit threshold is ${threshold}. Please top up before starting new work.`,
    html: wrapEmail({
      heading: "Credits are running low",
      intro: `Your workspace has ${balance} Advisory Credit${balance === 1 ? "" : "s"} remaining.`,
      paragraphs: [`The low credit threshold is ${threshold}. Please top up before starting new work.`],
      actionLabel: "Review credit options",
      actionUrl: workspaceUrl,
    }),
  };
}

function depletedCredit() {
  const workspaceUrl = `${publicBaseUrl()}/index.html#pricing`;
  return {
    templateKey: "credits_depleted",
    subject: "BA Advisory Desk credits are depleted",
    body: "Your workspace has no Advisory Credits remaining. New credit based work should be paused until credits are topped up or a new plan is active.",
    html: wrapEmail({
      heading: "Credits are depleted",
      intro: "Your workspace has no Advisory Credits remaining.",
      paragraphs: ["New credit based work should be paused until credits are topped up or a new plan is active."],
      actionLabel: "Review credit options",
      actionUrl: workspaceUrl,
    }),
  };
}

function adminPaymentNotification({ order, customerEmail, source }) {
  const product = order?.product_type || "unknown product";
  const amount = formatUsd(order?.amount_cents, order?.currency);
  return {
    templateKey: "admin_payment_notification",
    subject: `BA Advisory Desk payment received: ${product}`,
    body: `Payment received for ${product}. Amount: ${amount}. Customer email: ${customerEmail || "not provided"}. Organization ID: ${order?.organization_id || "not linked"}. Source: ${source || "stripe"}.`,
    html: wrapEmail({
      heading: "Payment received",
      intro: `Payment received for ${product}.`,
      paragraphs: [
        `Amount: ${amount}.`,
        `Customer email: ${customerEmail || "not provided"}.`,
        `Organization ID: ${order?.organization_id || "not linked"}.`,
        `Source: ${source || "stripe"}.`,
      ],
    }),
  };
}

module.exports = {
  adminPaymentNotification,
  depletedCredit,
  lowCredit,
  paymentConfirmed,
};
