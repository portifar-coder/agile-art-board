module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Jira-Domain");

  if (req.method === "OPTIONS") return res.status(204).end();

  const authHeader = req.headers.authorization;
  const jiraDomain = req.headers["x-jira-domain"] || "sterlingbank";

  if (!authHeader) return res.status(400).json({ error: "Missing Authorization header" });

  const pathSegments = req.query.path || [];
  const jiraPath = "/" + pathSegments.join("/");

  const url = new URL(req.url, "http://localhost");
  url.searchParams.delete("path");
  const queryString = url.searchParams.toString();
  const fullQuery = queryString ? "?" + queryString : "";

  let domain = jiraDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain.includes(".atlassian.net")) domain = domain + ".atlassian.net";
  const targetUrl = "https://" + domain + jiraPath + fullQuery;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("json") ? await response.json() : await response.text();
    res.status(response.status);
    if (typeof body === "string") res.send(body);
    else res.json(body);
  } catch (err) {
    res.status(502).json({ error: "Proxy error: " + err.message });
  }
};
