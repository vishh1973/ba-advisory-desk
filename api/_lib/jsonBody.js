class InvalidJsonBodyError extends Error {
  constructor(message = "Request body must be valid JSON.") {
    super(message);
    this.name = "InvalidJsonBodyError";
    this.statusCode = 400;
  }
}

function parseJsonBody(req) {
  try {
    if (typeof req.body === "string") {
      return JSON.parse(req.body || "{}");
    }
    return req.body || {};
  } catch (_error) {
    throw new InvalidJsonBodyError();
  }
}

function sendInvalidJson(res) {
  res.status(400).json({ error: "Request body must be valid JSON." });
}

module.exports = { InvalidJsonBodyError, parseJsonBody, sendInvalidJson };
