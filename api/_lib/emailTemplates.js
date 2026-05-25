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

function supportEmail() {
  return process.env.SUPPORT_EMAIL || "support@baadvisorydesk.com";
}

function formatUsd(amountCents, currency) {
  const amount = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "usd").toUpperCase(),
  }).format(amount);
}

function wrapEmail({ heading, intro, paragraphs = [], actionLabel, actionUrl, supportText }) {
  const paragraphHtml = [intro, ...paragraphs]
    .filter(Boolean)
    .map((text) => `<p style="margin:0 0 14px;">${escapeHtml(text)}</p>`)
    .join("");

  const actionHtml =
    actionLabel && actionUrl
      ? `<p style="margin:22px 0 0;"><a href="${escapeHtml(actionUrl)}" style="background:#17324d;color:#ffffff;padding:11px 16px;text-decoration:none;border-radius:6px;display:inline-block;">${escapeHtml(actionLabel)}</a></p>`
      : "";
  const supportHtml = supportText
    ? `<p style="margin:18px 0 0;color:#17324d;font-size:14px;">${escapeHtml(supportText)}</p>`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;color:#17212b;line-height:1.5;max-width:620px;">
      <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;">${escapeHtml(heading)}</h1>
      ${paragraphHtml}
      ${actionHtml}
      ${supportHtml}
      <p style="margin:24px 0 0;color:#5c6670;font-size:13px;">BA Advisory Desk</p>
    </div>
  `;
}

function paymentConfirmed({ order, balanceAfter }) {
  const workspaceUrl = `${publicBaseUrl()}/index.html#login`;
  const productType = order?.product_type;
  const credits = Number(order?.credits || 0);
  const amount = formatUsd(order?.amount_cents, order?.currency);
  const helpText = `Questions about payment, access, files, or next steps? Reply to this email or contact ${supportEmail()}.`;

  if (productType === "rescue_sprint") {
    return {
      templateKey: "payment_confirmation",
      subject: "Requirements Rescue Sprint payment confirmed",
      body: `Your Requirements Rescue Sprint payment has been confirmed. Amount paid: ${amount}. Your next step is to open BA Advisory Desk with the same checkout email, complete your profile if needed, and upload the material for your sprint. ${helpText}`,
      html: wrapEmail({
        heading: "Requirements Rescue Sprint payment confirmed",
        intro: `Your Requirements Rescue Sprint payment has been confirmed. Amount paid: ${amount}.`,
        paragraphs: [
          "Open BA Advisory Desk with the same checkout email so your payment, files, messages, and deliverables stay connected to the right workspace.",
          "Complete your profile if needed, then upload the material for your sprint.",
        ],
        actionLabel: "Open BA Advisory Desk",
        actionUrl: workspaceUrl,
        supportText: helpText,
      }),
    };
  }

  if (productType === "starter_monthly") {
    const balanceText = Number.isFinite(balanceAfter) ? ` Your current credit balance is ${balanceAfter}.` : "";
    return {
      templateKey: "payment_confirmation",
      subject: "BA Advisory Desk Monthly Support payment confirmed",
      body: `Your BA Advisory Desk Monthly Support payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.${balanceText} Use your workspace for requests, files, messages, delivery updates, and credit history. ${helpText}`,
      html: wrapEmail({
        heading: "BA Advisory Desk Monthly Support payment confirmed",
        intro: `Your BA Advisory Desk Monthly Support payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.`,
        paragraphs: [balanceText.trim(), "Use your workspace for requests, files, messages, delivery updates, deliverables, and credit history."],
        actionLabel: "Open your workspace",
        actionUrl: workspaceUrl,
        supportText: helpText,
      }),
    };
  }

  if (productType === "credit_top_up") {
    const balanceText = Number.isFinite(balanceAfter) ? ` Your current credit balance is ${balanceAfter}.` : "";
    return {
      templateKey: "payment_confirmation",
      subject: "3 Advisory Credit Top Up payment confirmed",
      body: `Your 3 Advisory Credit Top Up payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.${balanceText} ${helpText}`,
      html: wrapEmail({
        heading: "3 Advisory Credit Top Up payment confirmed",
        intro: `Your 3 Advisory Credit Top Up payment has been confirmed. ${credits} Advisory Credits have been added to your workspace.`,
        paragraphs: [balanceText.trim()],
        actionLabel: "Open your workspace",
        actionUrl: workspaceUrl,
        supportText: helpText,
      }),
    };
  }

  return {
    templateKey: "payment_confirmation",
    subject: "BA Advisory Desk payment confirmed",
    body: `Your BA Advisory Desk payment has been confirmed. Amount paid: ${amount}. ${helpText}`,
    html: wrapEmail({
      heading: "Payment confirmed",
      intro: `Your BA Advisory Desk payment has been confirmed. Amount paid: ${amount}.`,
      actionLabel: "Open BA Advisory Desk",
      actionUrl: workspaceUrl,
      supportText: helpText,
    }),
  };
}

function lowCredit({ balance, threshold }) {
  const workspaceUrl = `${publicBaseUrl()}/index.html#billing`;
  return {
    templateKey: "low_credit_reminder",
    subject: "BA Advisory Desk credits are running low",
    body: `Your workspace has ${balance} Advisory Credit${balance === 1 ? "" : "s"} remaining. The low credit threshold is ${threshold}. Please top up before starting new work.`,
    html: wrapEmail({
      heading: "Credits are running low",
      intro: `Your workspace has ${balance} Advisory Credit${balance === 1 ? "" : "s"} remaining.`,
      paragraphs: [`The low credit threshold is ${threshold}. Please top up before starting new work.`],
      actionLabel: "Open billing and top up",
      actionUrl: workspaceUrl,
      supportText: `Questions about your credit balance? Reply to this email or contact ${supportEmail()}.`,
    }),
  };
}

function depletedCredit() {
  const workspaceUrl = `${publicBaseUrl()}/index.html#billing`;
  return {
    templateKey: "credits_depleted",
    subject: "BA Advisory Desk credits are depleted",
    body: "Your workspace has no Advisory Credits remaining. New credit based work should be paused until credits are topped up or a new plan is active.",
    html: wrapEmail({
      heading: "Credits are depleted",
      intro: "Your workspace has no Advisory Credits remaining.",
      paragraphs: ["New credit based work should be paused until credits are topped up or a new plan is active."],
      actionLabel: "Open billing and top up",
      actionUrl: workspaceUrl,
      supportText: `Questions about your credit balance? Reply to this email or contact ${supportEmail()}.`,
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

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function subscriptionCancellation({ subscription, scheduled = false }) {
  const billingUrl = `${publicBaseUrl()}/index.html#billing`;
  const periodEnd = formatDate(subscription?.current_period_end);
  const effectiveText = periodEnd
    ? `Your current billing period is scheduled to end on ${periodEnd}.`
    : "Your BA Advisory Desk Monthly Support access has been updated.";
  const helpText = `If this cancellation was not intended, reply to this email or contact ${supportEmail()}.`;
  const subject = scheduled
    ? "BA Advisory Desk Monthly Support cancellation scheduled"
    : "BA Advisory Desk Monthly Support cancellation confirmed";
  const heading = scheduled ? "Monthly Support cancellation scheduled" : "Monthly Support cancellation confirmed";
  const intro = scheduled
    ? "Your BA Advisory Desk Monthly Support plan is set to cancel at the end of the current billing period."
    : "Your BA Advisory Desk Monthly Support plan has been cancelled.";

  return {
    templateKey: scheduled ? "subscription_cancellation_scheduled" : "subscription_canceled",
    subject,
    body: `${intro} ${effectiveText} You can open billing for plan and credit history. ${helpText}`,
    html: wrapEmail({
      heading,
      intro,
      paragraphs: [effectiveText, "Your workspace remains available for existing files, messages, deliverables, and payment history."],
      actionLabel: "Open billing",
      actionUrl: billingUrl,
      supportText: helpText,
    }),
  };
}

function adminSubscriptionCancellationAlert({ subscription, customerEmail, scheduled = false, source }) {
  const adminUrl = `${publicBaseUrl()}/index.html#admin`;
  const status = subscription?.status || (scheduled ? "cancel_at_period_end" : "canceled");
  const periodEnd = formatDate(subscription?.current_period_end) || "not available";
  const title = scheduled ? "subscription cancellation scheduled" : "subscription cancelled";

  return {
    templateKey: scheduled ? "admin_subscription_cancellation_scheduled" : "admin_subscription_canceled",
    subject: `[BAAD Admin] Monthly Support ${scheduled ? "cancellation scheduled" : "cancelled"}`,
    body: `Monthly Support ${title}. Customer email: ${customerEmail || "not provided"}. Organization ID: ${subscription?.organization_id || "not linked"}. Status: ${status}. Current period end: ${periodEnd}. Source: ${source || "stripe"}.`,
    html: wrapEmail({
      heading: `Monthly Support ${scheduled ? "cancellation scheduled" : "cancelled"}`,
      intro: `A BA Advisory Desk Monthly Support ${title} event was received.`,
      paragraphs: [
        `Customer email: ${customerEmail || "not provided"}.`,
        `Organization ID: ${subscription?.organization_id || "not linked"}.`,
        `Status: ${status}.`,
        `Current period end: ${periodEnd}.`,
        `Source: ${source || "stripe"}.`,
      ],
      actionLabel: "Open admin dashboard",
      actionUrl: adminUrl,
      supportText: "Review the client workspace, payment history, and any follow-up actions before closing the alert.",
    }),
  };
}

module.exports = {
  adminPaymentNotification,
  adminSubscriptionCancellationAlert,
  depletedCredit,
  lowCredit,
  paymentConfirmed,
  subscriptionCancellation,
};
