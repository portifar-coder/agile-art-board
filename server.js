const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Jira proxy — forwards /jira/* to your Jira Cloud instance
// No CORS issues since it's server-side
app.all("/jira/*", async (req, res) => {
  const authHeader = req.headers.authorization;
  const jiraDomain = req.headers["x-jira-domain"];
  
  if (!authHeader || !jiraDomain) {
    return res.status(400).json({ error: "Missing Authorization header or X-Jira-Domain header" });
  }

  // Build target URL: /jira/rest/api/3/myself → https://domain.atlassian.net/rest/api/3/myself
  const jiraPath = req.originalUrl.replace(/^\/jira/, "");
  let domain = jiraDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain.includes(".atlassian.net")) domain = domain + ".atlassian.net";
  const targetUrl = "https://" + domain + jiraPath;

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
    console.error("Proxy error:", err.message);
    res.status(502).json({ error: "Proxy error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log("");
  console.log("  ╔═══════════════════════════════════════════════════╗");
  console.log("  ║  Sterling ART Health Board                       ║");
  console.log("  ║  Running at: http://localhost:" + PORT + "                ║");
  console.log("  ╚═══════════════════════════════════════════════════╝");
  console.log("");
});
