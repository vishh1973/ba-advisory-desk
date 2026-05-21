const { randomUUID } = require("crypto");

function createEmailReference(prefix = "BAAD") {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const token = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${datePart}-${token}`;
}

function subjectWithReference(subject, reference) {
  const cleanSubject = String(subject || "BA Advisory Desk update").trim();
  if (!reference || cleanSubject.includes(reference)) return cleanSubject;
  return `[${reference}] ${cleanSubject}`;
}

function textWithReference(text, reference) {
  if (!reference) return text || "";
  return `${text || ""}\n\nSupport reference: ${reference}`;
}

function htmlWithReference(html, reference) {
  if (!reference) return html || "";
  const referenceHtml = `<p style="margin:22px 0 0;color:#5c6670;font-size:13px;">Support reference: <strong>${reference}</strong></p>`;
  const source = html || "";
  if (source.includes("</div>")) {
    return source.replace(/<\/div>\s*$/, `${referenceHtml}</div>`);
  }
  return `${source}${referenceHtml}`;
}

module.exports = {
  createEmailReference,
  htmlWithReference,
  subjectWithReference,
  textWithReference,
};
