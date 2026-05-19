const { requireAdmin } = require("./_lib/adminAuth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!(await requireAdmin(req))) {
    res.status(401).json({ isAdmin: false, error: "Unauthorized." });
    return;
  }

  res.status(200).json({ isAdmin: true });
};
