import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { Settings, ChevronLeft, ChevronRight, X, Loader2, AlertTriangle, CheckCircle2, Activity, BarChart3, TrendingUp, RefreshCw, Eye, EyeOff } from "lucide-react";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const ART_CONFIG = {
  sterling: {
    label: "Sterling Bank",
    color: "#0EA5E9",
    arts: [
      { name: "Backoffice ART", short: "BOA", key: "BOA", boards: [114,113,111,104,417,112] },
      { name: "Digital Channels ART", short: "DCAF", key: "DCAF", boards: [128,93,92,70,94,71,72,91,218] },
      { name: "Digital Lending ART", short: "DLSA", key: "DLSA", boards: [181,188,187] },
      { name: "Investment Solutions ART", short: "ISAB", key: "ISAB", boards: [131,219,116,285] },
      { name: "Integration & Partnerships ART", short: "IN", key: "IN", boards: [215,814,135] },
      { name: "Feature Channels ART", short: "FTC", key: "FTC", boards: [96] },
    ],
  },
  altbank: {
    label: "Alternative Bank",
    color: "#F59E0B",
    arts: [
      { name: "Backoffice ART", short: "BAT", key: "BAT", boards: [155] },
      { name: "Digital Channels ART", short: "DCAB", key: "DCAB", boards: [163,176,173,169,175] },
      { name: "Digital Lending ART", short: "DLSTA", key: "DLSTA", boards: [204,158,681,159,212] },
      { name: "Investment Solutions ART", short: "IST", key: "IST", boards: [195,196] },
      { name: "Integration & Partnerships ART", short: "IPT", key: "IPT", boards: [193] },
      { name: "Feature Channels ART", short: "FEAT", key: "FEAT", boards: [211] },
    ],
  },
  shared: {
    label: "Shared Services",
    color: "#8B5CF6",
    arts: [
      { name: "AI and Research", short: "AR", key: "AR", boards: [549] },
      { name: "Productivity & Automation ART", short: "PROD", key: "PROD", boards: [483,136,140,141] },
      { name: "Data Engineering Projects", short: "DEP", key: "DEP", boards: [615] },
    ],
  },
};

const UNPLANNED_TYPES = ["Production Fix", "Regulatory request", "ISG Vulnerability Fix"];
const REQUEST_TYPE_FIELD = "customfield_10507";
const BOTTLENECK_STATUSES = [
  "Ready for coding","Coding in progress","In review","Ready for QA",
  "Deployed to QA","Functional testing","Security testing","QA completed",
  "Awaiting CAB approval","Deployed to pilot","Deployed to prod"
];

const ALL_ARTS = [
  ...ART_CONFIG.sterling.arts.map(a => ({ ...a, bank: "sterling", bankLabel: "Sterling Bank", bankColor: ART_CONFIG.sterling.color })),
  ...ART_CONFIG.altbank.arts.map(a => ({ ...a, bank: "altbank", bankLabel: "Alternative Bank", bankColor: ART_CONFIG.altbank.color })),
  ...ART_CONFIG.shared.arts.map(a => ({ ...a, bank: "shared", bankLabel: "Shared Services", bankColor: ART_CONFIG.shared.color })),
];

// ─── JIRA API SERVICE ────────────────────────────────────────────────────────
class JiraService {
  constructor(domain, email, token) {
    let cleaned = domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!cleaned.includes(".atlassian.net")) cleaned = `${cleaned}.atlassian.net`;
    this.domain = cleaned;
    this.headers = {
      Authorization: `Basic ${btoa(`${email.trim()}:${token.trim()}`)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Jira-Domain": cleaned,
    };
  }

  async apiFetch(path) {
    const url = `/api/jira${path}`;
    const res = await fetch(url, { headers: this.headers });
    if (res.status === 401) throw new Error("AUTH_FAILED: Invalid email or API token. Check your Jira credentials.");
    if (res.status === 403) throw new Error("FORBIDDEN: Your API token lacks permission. Ensure it has read access to these boards.");
    if (res.status === 404) {
      let body = ""; try { body = await res.text(); } catch(e) {}
      throw new Error(`NOT_FOUND: ${path} — Jira returned 404. Body: ${body.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(`Jira API error ${res.status}: ${res.statusText} for ${path}`);
    return res.json();
  }

  async testConnection() {
    return this.apiFetch("/rest/api/3/myself");
  }

  async getBoardSprints(boardId) {
    const allSprints = [];
    let startAt = 0;
    let isLast = false;
    while (!isLast) {
      const data = await this.apiFetch(`/rest/agile/1.0/board/${boardId}/sprint?maxResults=50&startAt=${startAt}`);
      allSprints.push(...(data.values || []));
      isLast = data.isLast !== false;
      startAt += 50;
    }
    return allSprints;
  }

  async getSprintIssues(sprintId, projectKey) {
    const allIssues = [];
    let startAt = 0;
    let total = 1;
    while (startAt < total) {
      const jql = encodeURIComponent(`project=${projectKey} AND issuetype=Epic AND sprint=${sprintId}`);
      const fields = `key,summary,status,${REQUEST_TYPE_FIELD}`;
      const data = await this.apiFetch(`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100&startAt=${startAt}`);
      console.log(`[JiraService] Sprint ${sprintId} / ${projectKey}: found ${data.total || 0} epics`);
      allIssues.push(...(data.issues || []));
      total = data.total || 0;
      startAt += 100;
    }
    return allIssues;
  }

  async getIssueChangelog(issueKey) {
    const data = await this.apiFetch(`/rest/api/3/issue/${issueKey}?expand=changelog`);
    return data.changelog?.histories || [];
  }
}

// ─── PI & SPRINT PARSING ─────────────────────────────────────────────────────
function parsePIFromSprint(sprintName) {
  const match = sprintName.match(/^(PI\s*\d+\s+\d{4})/i);
  if (!match) return null;
  return match[1]
    .replace(/^PI\s*/i, "PI ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSprintName(sprintName) {
  const match = sprintName.match(/(sprint\s*\d+)/i);
  if (match) return match[1].replace(/sprint\s*/i, "Sprint ");
  return sprintName
    .replace(/^PI\s*\d+\s+\d{4}\s*[-,.:]\s*/i, "")
    .replace(/^PI\s*\d+\s+\d{4}\s+/i, "")
    .trim() || sprintName;
}

function parseSprintNumber(sprintName) {
  const match = sprintName.match(/Sprint\s*(\d+)/i);
  return match ? parseInt(match[1]) : 0;
}

function sortBySprint(a, b) {
  return parseSprintNumber(a.name) - parseSprintNumber(b.name);
}

// ─── MOCK DATA GENERATOR ────────────────────────────────────────────────────
function generateMockData() {
  const pis = ["PI 1 2026", "PI 2 2026"];
  const sprintsPerPI = 5;
  const statuses = ["To Do","Ready for coding","Coding in progress","In review","Ready for QA","Deployed to QA","Functional testing","Security testing","QA completed","Awaiting CAB approval","Deployed to pilot","Deployed to prod"];
  const requestTypes = ["Feature Request","Enhancement","Production Fix","Regulatory request","ISG Vulnerability Fix","Technical Debt","New Feature"];

  const data = {};
  for (const pi of pis) {
    data[pi] = {};
    for (const art of ALL_ARTS) {
      const sprints = [];
      for (let s = 1; s <= sprintsPerPI; s++) {
        const sprintName = `${pi} - Sprint ${s}`;
        const isOpen = pi === "PI 2 2026" && s === 3;
        const isClosed = pi === "PI 1 2026" || s < 3;
        const numEpics = 8 + Math.floor(Math.random() * 12);
        const epics = [];
        for (let e = 0; e < numEpics; e++) {
          const reqType = requestTypes[Math.floor(Math.random() * requestTypes.length)];
          const statusIdx = isClosed ? statuses.length - 1 : Math.floor(Math.random() * statuses.length);
          epics.push({
            key: `${art.key}-${100 + s * 20 + e}`,
            summary: `${["Implement","Fix","Upgrade","Migrate","Refactor","Build","Deploy","Optimize"][Math.floor(Math.random()*8)]} ${["payment gateway","user auth","dashboard","reporting","notifications","API","database","cache"][Math.floor(Math.random()*8)]} ${["module","service","flow","integration","pipeline","endpoint"][Math.floor(Math.random()*6)]}`,
            status: statuses[statusIdx],
            requestType: reqType,
            timeInStatus: Object.fromEntries(
              BOTTLENECK_STATUSES.map(st => [st, Math.floor(Math.random() * 72) + 1])
            ),
          });
        }
        sprints.push({
          id: Math.floor(Math.random() * 10000),
          name: sprintName,
          state: isOpen ? "active" : isClosed ? "closed" : "future",
          epics,
        });
      }
      data[pi][art.key] = sprints;
    }
  }
  return { pis, data, activePi: "PI 2 2026" };
}

// ─── METRIC CALCULATIONS ─────────────────────────────────────────────────────
function calcMetrics(epics) {
  const total = epics.length;
  const delivered = epics.filter(e => (e.status || "").toLowerCase() === "deployed to prod").length;
  const planned = total;
  const unplanned = epics.filter(e => UNPLANNED_TYPES.some(t => t.toLowerCase() === (e.requestType || "").toLowerCase())).length;
  return { total, delivered, planned, unplanned };
}

function getSprintTrendData(sprints) {
  return sprints.map(s => {
    const m = calcMetrics(s.epics);
    return {
      name: cleanSprintName(s.name),
      planned: m.planned,
      delivered: m.delivered,
      unplanned: m.unplanned,
      state: s.state,
    };
  }).sort(sortBySprint);
}

function calcBottleneck(epics) {
  return BOTTLENECK_STATUSES.map(status => {
    const key = status.toLowerCase();
    const times = epics.map(e => e.timeInStatus?.[key] || 0).filter(t => t > 0);
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    return { status: status.length > 14 ? status.slice(0, 13) + "…" : status, fullStatus: status, hours: Math.round(avg * 10) / 10 };
  });
}

function calcDeliveryAggregates(allPiData, artKey, currentPi) {
  const rows = [];
  if (!allPiData) return rows;
  for (const [pi, artMap] of Object.entries(allPiData)) {
    const sprints = artMap[artKey] || [];
    for (const sprint of sprints) {
      if (sprint.state === "future") continue;
      const m = calcMetrics(sprint.epics);
      rows.push({
        pi,
        sprint: cleanSprintName(sprint.name),
        total: m.total,
        delivered: m.delivered,
        pct: m.total > 0 ? Math.round((m.delivered / m.total) * 100) : 0,
        isOpen: sprint.state === "active",
        isCurrent: pi === currentPi,
      });
    }
  }
  return rows.filter(r => r.isCurrent || r.pi !== currentPi);
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const theme = {
  bg: "#0B1120",
  card: "#111827",
  cardBorder: "#1E293B",
  surface: "#1A2332",
  text: "#E2E8F0",
  textMuted: "#94A3B8",
  textDim: "#64748B",
  accent: "#0EA5E9",
  accentAlt: "#06B6D4",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  purple: "#8B5CF6",
  pink: "#EC4899",
  grid: "#1E293B",
  tooltipBg: "#1E293B",
};

// ─── INSIGHT GENERATOR ───────────────────────────────────────────────────────
function generateInsights(art, sprints, trendData, bottleneckData, deliveryRows, metrics) {
  const insights = [];
  const epics = sprints.find(s => s.state === "active")?.epics || [];
  const m = metrics;

  // 1. Delivery rate analysis
  const deliveryPct = m.total > 0 ? Math.round((m.delivered / m.total) * 100) : 0;
  if (deliveryPct < 30) {
    insights.push({ type: "danger", text: `Only ${deliveryPct}% delivered in open sprint (${m.delivered}/${m.total}). Escalate blockers immediately and consider descoping low-priority items.` });
  } else if (deliveryPct < 60) {
    insights.push({ type: "warning", text: `${deliveryPct}% delivery rate so far. Review remaining ${m.total - m.delivered} items for achievability before sprint end.` });
  } else {
    insights.push({ type: "success", text: `Strong ${deliveryPct}% delivery rate. ${m.total - m.delivered} items remaining — on track for sprint completion.` });
  }

  // 2. Unplanned ratio
  const unplannedPct = m.total > 0 ? Math.round((m.unplanned / m.total) * 100) : 0;
  if (unplannedPct > 40) {
    insights.push({ type: "danger", text: `${unplannedPct}% of sprint is unplanned work (${m.unplanned} items). Excessive reactive work — investigate root causes of production fixes and regulatory requests.` });
  } else if (unplannedPct > 20) {
    insights.push({ type: "warning", text: `${unplannedPct}% unplanned items. Consider allocating a buffer capacity for unplanned work in future sprint planning.` });
  } else {
    insights.push({ type: "success", text: `Low unplanned ratio (${unplannedPct}%). Good sprint discipline — planned work is not being displaced.` });
  }

  // 3. Bottleneck analysis
  const sortedBottleneck = [...bottleneckData].sort((a, b) => b.hours - a.hours);
  const topBottleneck = sortedBottleneck[0];
  if (topBottleneck && topBottleneck.hours > 0) {
    const secondWorst = sortedBottleneck[1];
    if (topBottleneck.hours > 48) {
      insights.push({ type: "danger", text: `"${topBottleneck.fullStatus}" is a critical bottleneck at ${topBottleneck.hours}h avg. Assign dedicated capacity to unblock this stage.` });
    } else if (topBottleneck.hours > 24) {
      insights.push({ type: "warning", text: `"${topBottleneck.fullStatus}" averaging ${topBottleneck.hours}h. ${secondWorst ? `Followed by "${secondWorst.fullStatus}" at ${secondWorst.hours}h.` : ""} Consider parallel processing or automation.` });
    } else {
      insights.push({ type: "success", text: `No major bottlenecks. Longest wait is "${topBottleneck.fullStatus}" at ${topBottleneck.hours}h — workflow is flowing well.` });
    }
  }

  // 4. Sprint-over-sprint trend
  if (trendData.length >= 2) {
    const recent = trendData[trendData.length - 1];
    const prev = trendData[trendData.length - 2];
    const deliveryTrend = recent.delivered - prev.delivered;
    const scopeTrend = recent.planned - prev.planned;
    if (scopeTrend > 3 && deliveryTrend < scopeTrend) {
      insights.push({ type: "warning", text: `Scope grew by ${scopeTrend} items vs previous sprint but delivery only increased by ${deliveryTrend}. Avoid overcommitting — right-size sprint capacity.` });
    } else if (deliveryTrend > 0) {
      insights.push({ type: "success", text: `Delivery improving: +${deliveryTrend} items vs previous sprint. Maintain this momentum and document what's working.` });
    } else if (deliveryTrend < -2) {
      insights.push({ type: "danger", text: `Delivery dropped by ${Math.abs(deliveryTrend)} items vs previous sprint. Conduct a focused retrospective on what changed.` });
    } else {
      insights.push({ type: "info", text: `Delivery is flat sprint-over-sprint. Look for small process improvements to unlock incremental gains.` });
    }
  }

  // 5. Delivery aggregate trend for closed sprints
  const closedRows = deliveryRows.filter(r => !r.isOpen && r.pct > 0);
  if (closedRows.length >= 2) {
    const avgPct = Math.round(closedRows.reduce((a, r) => a + r.pct, 0) / closedRows.length);
    const worst = closedRows.reduce((min, r) => r.pct < min.pct ? r : min, closedRows[0]);
    if (avgPct < 60) {
      insights.push({ type: "danger", text: `PI average delivery is ${avgPct}%. Worst sprint: ${worst.sprint} at ${worst.pct}%. Systemic capacity or estimation issues — recalibrate velocity.` });
    } else if (avgPct < 80) {
      insights.push({ type: "warning", text: `PI average delivery at ${avgPct}%. Target 80%+. Tighten estimation accuracy using last 3 sprints as baseline.` });
    } else {
      insights.push({ type: "success", text: `Excellent PI delivery average of ${avgPct}%. Consistent execution across sprints — share practices with other ARTs.` });
    }
  } else {
    // Fallback: status distribution insight
    const stuckInQA = epics.filter(e => {
      const s = (e.status || "").toLowerCase();
      return s.includes("testing") || s.includes("qa") || s.includes("review");
    }).length;
    if (stuckInQA > m.total * 0.4) {
      insights.push({ type: "warning", text: `${stuckInQA} of ${m.total} items (${Math.round(stuckInQA/m.total*100)}%) are in testing/review stages. Prioritize QA throughput to release completed work.` });
    } else {
      insights.push({ type: "info", text: `Work is distributed across stages. Monitor items approaching "Awaiting CAB Approval" to prevent end-of-sprint pile-up.` });
    }
  }

  return insights.slice(0, 5);
}

// ─── BANK SUMMARY COLUMN ─────────────────────────────────────────────────────
function BankSummaryColumn({ bankKey, bankLabel, bankColor, trendData, onClickIssues }) {
  const ttip = { background: theme.tooltipBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, fontSize: 11, color: theme.text };

  // Compute aggregate % delivery per sprint
  const deliveryData = trendData.map(d => ({
    name: d.name,
    pct: d.planned > 0 ? Math.round((d.delivered / d.planned) * 100) : 0,
    total: d.planned,
    delivered: d.delivered,
  }));

  const MiniChart = ({ title, dk1, dk2, c1, c2, n1, n2 }) => (
    <div>
      <div style={{ fontSize: 10, color: theme.textMuted, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{title}</div>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
          <XAxis dataKey="name" tick={{ fontSize: 8, fill: theme.textDim }} />
          <YAxis tick={{ fontSize: 8, fill: theme.textDim }} />
          <Tooltip contentStyle={ttip} />
          <Legend wrapperStyle={{ fontSize: 8, paddingTop: 2 }} iconSize={6} />
          <Line type="monotone" dataKey={dk1} stroke={c1} strokeWidth={2} dot={{ r: 2 }} name={n1} />
          <Line type="monotone" dataKey={dk2} stroke={c2} strokeWidth={2} dot={{ r: 2 }} name={n2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div style={{
      background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 14,
      borderTop: `3px solid ${bankColor}`, flex: "1 1 0", minWidth: 280, maxWidth: 400,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div onClick={onClickIssues} style={{ padding: "12px 16px 8px", borderBottom: `1px solid ${theme.cardBorder}`, cursor: "pointer" }}
        onMouseEnter={e => { e.currentTarget.style.background = theme.surface; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>{bankLabel}</div>
        <div style={{ fontSize: 10, color: theme.textDim, marginTop: 2 }}>Click to view open sprint epics</div>
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", flex: 1 }}>
        <MiniChart title="Planned vs Delivered" dk1="planned" dk2="delivered" c1="#0EA5E9" c2="#10B981" n1="Planned" n2="Delivered" />
        <MiniChart title="Planned vs Unplanned" dk1="planned" dk2="unplanned" c1="#0EA5E9" c2="#F59E0B" n1="Planned" n2="Unplanned" />
        <MiniChart title="Total vs Delivered" dk1="planned" dk2="delivered" c1="#8B5CF6" c2="#10B981" n1="Total (P+U)" n2="Delivered" />

        {/* % Delivery Aggregates per Sprint */}
        <div>
          <div style={{ fontSize: 10, color: theme.textMuted, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>% Delivery per Sprint</div>
          <div style={{ borderRadius: 6, border: `1px solid ${theme.cardBorder}`, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
              <thead>
                <tr style={{ background: theme.surface }}>
                  {["Sprint", "Total", "Delivered", "% Del"].map(h => (
                    <th key={h} style={{ padding: "4px 6px", textAlign: "left", color: theme.textDim, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliveryData.map((d, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${theme.cardBorder}22` }}>
                    <td style={{ padding: "3px 6px", color: theme.text }}>{d.name}</td>
                    <td style={{ padding: "3px 6px", color: theme.text }}>{d.total}</td>
                    <td style={{ padding: "3px 6px", color: theme.success }}>{d.delivered}</td>
                    <td style={{ padding: "3px 6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ flex: 1, height: 5, background: theme.surface, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${d.pct}%`, height: "100%", borderRadius: 2, background: d.pct >= 80 ? theme.success : d.pct >= 50 ? theme.warning : theme.danger }} />
                        </div>
                        <span style={{ color: d.pct >= 80 ? theme.success : d.pct >= 50 ? theme.warning : theme.danger, fontWeight: 600, fontSize: 8, minWidth: 24, textAlign: "right" }}>{d.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SUB COMPONENTS ──────────────────────────────────────────────────────────

function SummaryPanel({ title, bankColor, trendData, type, onClick }) {
  const colors = type === "pvd"
    ? { line1: "#0EA5E9", line2: "#10B981", label1: "Planned", label2: "Delivered" }
    : { line1: "#0EA5E9", line2: "#F59E0B", label1: "Planned", label2: "Unplanned" };
  const dataKey1 = type === "pvd" ? "planned" : "planned";
  const dataKey2 = type === "pvd" ? "delivered" : "unplanned";

  return (
    <div onClick={onClick} style={{
      background: theme.card, border: `1px solid ${theme.cardBorder}`,
      borderRadius: 12, padding: "14px 16px", cursor: "pointer",
      borderTop: `3px solid ${bankColor}`, transition: "all 0.2s",
      flex: "1 1 0", minWidth: 200,
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = bankColor; e.currentTarget.style.transform = "translateY(-2px)"; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = theme.cardBorder; e.currentTarget.style.transform = "none"; }}
    >
      <div style={{ fontSize: 11, color: theme.textMuted, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: theme.textDim }} />
          <YAxis tick={{ fontSize: 9, fill: theme.textDim }} />
          <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, fontSize: 11, color: theme.text }} />
          <Legend wrapperStyle={{ fontSize: 9, paddingTop: 4 }} iconSize={8} />
          <Line type="monotone" dataKey={dataKey1} stroke={colors.line1} strokeWidth={2} dot={{ r: 3 }} name={colors.label1} />
          <Line type="monotone" dataKey={dataKey2} stroke={colors.line2} strokeWidth={2} dot={{ r: 3 }} name={colors.label2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function IssueModal({ issues, title, onClose }) {
  const [tab, setTab] = useState("all");
  if (!issues) return null;

  const delivered = issues.filter(e => (e.status || "").toLowerCase() === "deployed to prod");
  const unplanned = issues.filter(e => UNPLANNED_TYPES.some(t => t.toLowerCase() === (e.requestType || "").toLowerCase()));
  const plannedOnly = issues.filter(e => !UNPLANNED_TYPES.some(t => t.toLowerCase() === (e.requestType || "").toLowerCase()));

  const tabs = [
    { key: "all", label: "All", count: issues.length, color: theme.text },
    { key: "planned", label: "Planned", count: issues.length, color: theme.accent },
    { key: "delivered", label: "Delivered", count: delivered.length, color: theme.success },
    { key: "unplanned", label: "Unplanned", count: unplanned.length, color: theme.warning },
    { key: "plannedOnly", label: "Planned (excl. unplanned)", count: plannedOnly.length, color: theme.purple },
  ];

  const filtered = tab === "delivered" ? delivered : tab === "unplanned" ? unplanned : tab === "plannedOnly" ? plannedOnly : issues;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 16, padding: 24, maxWidth: 900, width: "95%", maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: theme.text, margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textMuted, cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>

        {/* Summary counts */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16, padding: "12px 16px", background: theme.surface, borderRadius: 10 }}>
          {[
            { label: "Planned (All)", val: issues.length, color: theme.accent },
            { label: "Delivered", val: delivered.length, color: theme.success },
            { label: "Unplanned", val: unplanned.length, color: theme.warning },
            { label: "Delivery %", val: issues.length > 0 ? Math.round((delivered.length / issues.length) * 100) + "%" : "0%", color: delivered.length / issues.length >= 0.8 ? theme.success : delivered.length / issues.length >= 0.5 ? theme.warning : theme.danger },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ textAlign: "center", flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
              <div style={{ fontSize: 10, color: theme.textDim, textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, overflowX: "auto" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
              background: tab === t.key ? `${t.color}22` : theme.surface,
              color: tab === t.key ? t.color : theme.textMuted,
              borderBottom: tab === t.key ? `2px solid ${t.color}` : "2px solid transparent",
            }}>
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>{["Key","Summary","Status","Request Type","Category"].map(h => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: theme.textMuted, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: 600 }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>{filtered.map(issue => {
            const isDelivered = (issue.status || "").toLowerCase() === "deployed to prod";
            const isUnplanned = UNPLANNED_TYPES.some(t => t.toLowerCase() === (issue.requestType || "").toLowerCase());
            return (
              <tr key={issue.key} style={{ borderBottom: `1px solid ${theme.cardBorder}22` }}>
                <td style={{ padding: "7px 10px", color: theme.accent, fontFamily: "monospace" }}>{issue.key}</td>
                <td style={{ padding: "7px 10px", color: theme.text, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issue.summary}</td>
                <td style={{ padding: "7px 10px" }}><StatusBadge status={issue.status} /></td>
                <td style={{ padding: "7px 10px", color: theme.textMuted }}>{issue.requestType}</td>
                <td style={{ padding: "7px 10px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {isDelivered && <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600, background: `${theme.success}22`, color: theme.success }}>Delivered</span>}
                    {isUnplanned && <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600, background: `${theme.warning}22`, color: theme.warning }}>Unplanned</span>}
                    {!isUnplanned && <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 9, fontWeight: 600, background: `${theme.accent}22`, color: theme.accent }}>Planned</span>}
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
        {filtered.length === 0 && <p style={{ color: theme.textDim, textAlign: "center", padding: 24 }}>No issues in this category</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = (status || "").toLowerCase();
  let bg = theme.textDim + "22";
  let color = theme.textMuted;
  if (s.includes("prod") && s.includes("deployed")) { bg = "#10B98122"; color = "#10B981"; }
  else if (s.includes("progress") || s.includes("coding")) { bg = "#0EA5E922"; color = "#0EA5E9"; }
  else if (s.includes("review") || s.includes("testing")) { bg = "#F59E0B22"; color = "#F59E0B"; }
  else if (s.includes("ready")) { bg = "#8B5CF622"; color = "#8B5CF6"; }
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, background: bg, color, whiteSpace: "nowrap" }}>{status}</span>;
}

function ARTColumn({ art, sprints, allPiData, currentPi }) {
  const openSprint = sprints.find(s => s.state === "active") || sprints[sprints.length - 1];
  const trendData = getSprintTrendData(sprints);
  const epics = openSprint?.epics || [];
  const planned = epics.filter(e => !UNPLANNED_TYPES.some(t => t.toLowerCase() === (e.requestType || "").toLowerCase()));
  const unplanned = epics.filter(e => UNPLANNED_TYPES.some(t => t.toLowerCase() === (e.requestType || "").toLowerCase()));
  const bottleneckData = calcBottleneck(epics);
  const deliveryRows = calcDeliveryAggregates(allPiData, art.key, currentPi);
  const m = calcMetrics(epics);

  const maxBottleneck = Math.max(...bottleneckData.map(d => d.hours), 1);

  return (
    <div style={{
      minWidth: 420, maxWidth: 460, background: theme.card,
      border: `1px solid ${theme.cardBorder}`, borderRadius: 16,
      borderTop: `3px solid ${art.bankColor}`, padding: 0, flexShrink: 0,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${theme.cardBorder}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>{art.name}</div>
            <div style={{ fontSize: 11, color: art.bankColor, fontWeight: 600, marginTop: 2 }}>{art.bankLabel}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: theme.textDim }}>OPEN SPRINT</div>
            <div style={{ fontSize: 11, color: theme.textMuted, fontWeight: 600 }}>{openSprint ? cleanSprintName(openSprint.name) : "N/A"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
          {[
            { label: "Planned", val: m.planned, color: theme.accent },
            { label: "Delivered", val: m.delivered, color: theme.success },
            { label: "Unplanned", val: m.unplanned, color: theme.warning },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
              <div style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 16px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Planned vs Delivered Line Chart */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Planned vs Delivered</div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: theme.textDim }} />
              <YAxis tick={{ fontSize: 9, fill: theme.textDim }} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, fontSize: 11, color: theme.text }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="planned" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 2.5 }} name="Planned" />
              <Line type="monotone" dataKey="delivered" stroke="#10B981" strokeWidth={2} dot={{ r: 2.5 }} name="Delivered" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Planned vs Unplanned Line Chart */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Planned vs Unplanned</div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: theme.textDim }} />
              <YAxis tick={{ fontSize: 9, fill: theme.textDim }} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, fontSize: 11, color: theme.text }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="planned" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 2.5 }} name="Planned" />
              <Line type="monotone" dataKey="unplanned" stroke="#F59E0B" strokeWidth={2} dot={{ r: 2.5 }} name="Unplanned" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Planned + Unplanned vs Delivered Line Chart */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Planned + Unplanned vs Delivered</div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: theme.textDim }} />
              <YAxis tick={{ fontSize: 9, fill: theme.textDim }} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, fontSize: 11, color: theme.text }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="planned" stroke="#8B5CF6" strokeWidth={2} dot={{ r: 2.5 }} name="Total (P+U)" />
              <Line type="monotone" dataKey="delivered" stroke="#10B981" strokeWidth={2} dot={{ r: 2.5 }} name="Delivered" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Planned Deliverables Table */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Planned Deliverables <span style={{ color: theme.accent, fontWeight: 700 }}>({planned.length})</span>
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", borderRadius: 8, border: `1px solid ${theme.cardBorder}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: theme.surface }}>
                  {["Key","Summary","Status","Type"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: theme.textDim, fontWeight: 600, position: "sticky", top: 0, background: theme.surface }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{planned.map(e => (
                <tr key={e.key} style={{ borderBottom: `1px solid ${theme.cardBorder}22` }}>
                  <td style={{ padding: "5px 8px", color: theme.accent, fontFamily: "monospace", fontSize: 9 }}>{e.key}</td>
                  <td style={{ padding: "5px 8px", color: theme.text, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.summary}</td>
                  <td style={{ padding: "5px 8px" }}><StatusBadge status={e.status} /></td>
                  <td style={{ padding: "5px 8px", color: theme.textMuted, fontSize: 9 }}>{e.requestType}</td>
                </tr>
              ))}</tbody>
            </table>
            {planned.length === 0 && <p style={{ color: theme.textDim, textAlign: "center", padding: 12, fontSize: 11 }}>No planned deliverables</p>}
          </div>
        </div>

        {/* Unplanned Deliverables Table */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Unplanned Deliverables <span style={{ color: theme.warning, fontWeight: 700 }}>({unplanned.length})</span>
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", borderRadius: 8, border: `1px solid ${theme.cardBorder}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: theme.surface }}>
                  {["Key","Summary","Status","Type"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: theme.textDim, fontWeight: 600, position: "sticky", top: 0, background: theme.surface }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{unplanned.map(e => (
                <tr key={e.key} style={{ borderBottom: `1px solid ${theme.cardBorder}22` }}>
                  <td style={{ padding: "5px 8px", color: theme.warning, fontFamily: "monospace", fontSize: 9 }}>{e.key}</td>
                  <td style={{ padding: "5px 8px", color: theme.text, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.summary}</td>
                  <td style={{ padding: "5px 8px" }}><StatusBadge status={e.status} /></td>
                  <td style={{ padding: "5px 8px", color: theme.textMuted, fontSize: 9 }}>{e.requestType}</td>
                </tr>
              ))}</tbody>
            </table>
            {unplanned.length === 0 && <p style={{ color: theme.textDim, textAlign: "center", padding: 12, fontSize: 11 }}>No unplanned deliverables</p>}
          </div>
        </div>

        {/* Bottleneck Bar Chart */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Bottleneck (Avg Hours in Status)</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={bottleneckData} margin={{ top: 5, right: 5, left: -15, bottom: 30 }} barCategoryGap="15%">
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
              <XAxis dataKey="status" tick={{ fontSize: 7.5, fill: theme.textDim }} angle={-45} textAnchor="end" interval={0} height={60} />
              <YAxis tick={{ fontSize: 9, fill: theme.textDim }} />
              <Tooltip
                contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, fontSize: 11, color: theme.text }}
                formatter={(val, name, props) => [`${val}h`, props.payload.fullStatus]}
              />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                {bottleneckData.map((entry, i) => (
                  <Cell key={i} fill={entry.hours > maxBottleneck * 0.7 ? theme.danger : entry.hours > maxBottleneck * 0.4 ? theme.warning : theme.accent} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Delivery Aggregates Table */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>% Delivery Aggregates</div>
          <div style={{ borderRadius: 8, border: `1px solid ${theme.cardBorder}`, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: theme.surface }}>
                  {["PI","Sprint","Total","Delivered","% Delivery"].map(h => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: theme.textDim, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{deliveryRows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${theme.cardBorder}22`, background: r.isOpen ? `${theme.accent}08` : "transparent" }}>
                  <td style={{ padding: "5px 8px", color: theme.text, fontWeight: r.isOpen ? 600 : 400 }}>{r.pi}</td>
                  <td style={{ padding: "5px 8px", color: theme.textMuted }}>{r.sprint}{r.isOpen ? " *" : ""}</td>
                  <td style={{ padding: "5px 8px", color: theme.text }}>{r.total}</td>
                  <td style={{ padding: "5px 8px", color: theme.success }}>{r.delivered}</td>
                  <td style={{ padding: "5px 8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, height: 6, background: theme.surface, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${r.pct}%`, height: "100%", borderRadius: 3, background: r.pct >= 80 ? theme.success : r.pct >= 50 ? theme.warning : theme.danger }} />
                      </div>
                      <span style={{ color: r.pct >= 80 ? theme.success : r.pct >= 50 ? theme.warning : theme.danger, fontWeight: 600, minWidth: 32, textAlign: "right" }}>{r.pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {deliveryRows.length === 0 && <p style={{ color: theme.textDim, textAlign: "center", padding: 12, fontSize: 11 }}>No data</p>}
          </div>
        </div>

        {/* AI Observations & Recommendations */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12 }}>💡</span> Observations & Recommendations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {generateInsights(art, sprints, trendData, bottleneckData, deliveryRows, m).map((insight, i) => {
              const iconMap = { danger: "🔴", warning: "🟡", success: "🟢", info: "🔵" };
              const borderMap = { danger: theme.danger, warning: theme.warning, success: theme.success, info: theme.accent };
              return (
                <div key={i} style={{
                  padding: "8px 10px", borderRadius: 8, fontSize: 10, lineHeight: 1.5,
                  background: `${borderMap[insight.type]}08`,
                  borderLeft: `3px solid ${borderMap[insight.type]}`,
                  color: theme.text,
                }}>
                  <span style={{ marginRight: 4 }}>{iconMap[insight.type]}</span>
                  {insight.text}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS MODAL ──────────────────────────────────────────────────────────
function SettingsModal({ config, onSave, onClose }) {
  const [form, setForm] = useState(config);
  const [showToken, setShowToken] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: 20, padding: 32, width: 440, maxHeight: "80vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
          <h2 style={{ color: theme.text, margin: 0, fontSize: 18 }}>Jira Configuration</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: theme.textMuted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        {[
          { key: "domain", label: "Jira Domain", placeholder: "yourcompany or yourcompany.atlassian.net", help: "Enter just your subdomain (e.g. 'sterling') or the full domain (e.g. 'sterling.atlassian.net')" },
          { key: "email", label: "Email", placeholder: "you@company.com" },
        ].map(({ key, label, placeholder, help }) => (
          <div key={key} style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, color: theme.textMuted, fontWeight: 600, marginBottom: 6 }}>{label}</label>
            <input
              value={form[key] || ""}
              onChange={e => set(key, e.target.value)}
              placeholder={placeholder}
              style={{ width: "100%", padding: "10px 12px", background: theme.surface, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            {help && <div style={{ fontSize: 10, color: theme.textDim, marginTop: 3 }}>{help}</div>}
          </div>
        ))}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, color: theme.textMuted, fontWeight: 600, marginBottom: 6 }}>API Token</label>
          <div style={{ position: "relative" }}>
            <input
              type={showToken ? "text" : "password"}
              value={form.token || ""}
              onChange={e => set("token", e.target.value)}
              placeholder="Your Jira API token"
              style={{ width: "100%", padding: "10px 36px 10px 12px", background: theme.surface, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
            <button onClick={() => setShowToken(!showToken)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: theme.textDim, cursor: "pointer", padding: 2 }}>
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        {testResult && (
          <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, fontSize: 11, background: testResult.ok ? `${theme.success}15` : `${theme.danger}15`, color: testResult.ok ? theme.success : theme.danger, border: `1px solid ${testResult.ok ? theme.success : theme.danger}33` }}>
            {testResult.ok ? `✓ Connected as ${testResult.name}` : `✗ ${testResult.error}`}
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={async () => {
            setTestResult(null);
            try {
              const jira = new JiraService(form.domain, form.email, form.token);
              const me = await jira.testConnection();
              setTestResult({ ok: true, name: me.displayName || me.emailAddress });
            } catch (e) {
              setTestResult({ ok: false, error: e.message });
            }
          }} style={{ padding: "10px 16px", background: theme.surface, color: theme.textMuted, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            Test Connection
          </button>
          <button onClick={() => { onSave(form); }} style={{ flex: 1, padding: "10px 16px", background: theme.accent, color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            Save & Connect
          </button>
          <button onClick={onClose} style={{ padding: "10px 16px", background: theme.surface, color: theme.textMuted, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function ARTHealthBoard() {
  const [config, setConfig] = useState({ domain: "sterlingbank", email: "", token: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [useMock, setUseMock] = useState(true);
  const [mockData] = useState(() => generateMockData());
  const [piOptions, setPiOptions] = useState([]);
  const [selectedPi, setSelectedPi] = useState("");
  const [allPiData, setAllPiData] = useState({});
  const [modalIssues, setModalIssues] = useState(null);
  const [modalTitle, setModalTitle] = useState("");
  const [showPiPrompt, setShowPiPrompt] = useState(false);
  const [rawSprints, setRawSprints] = useState({}); // Sprint lists per ART, stored between phases
  const [piLoaded, setPiLoaded] = useState(""); // Which PI's data is currently loaded
  const carouselRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;
  const rawSprintsRef = useRef(rawSprints);
  rawSprintsRef.current = rawSprints;

  // Initialize with mock data
  useEffect(() => {
    if (useMock) {
      setPiOptions(mockData.pis);
      setSelectedPi(mockData.activePi);
      setAllPiData(mockData.data);
    }
  }, [useMock, mockData]);

  // ─── PHASE 1: Fetch PIs (sprint lists only) ──────────────────────────────
  const fetchPIs = useCallback(async (cfg) => {
    const c = cfg || configRef.current;
    if (!c.domain || !c.email || !c.token) {
      setError("Please configure Jira credentials in Settings (domain, email, and API token are all required).");
      return;
    }
    setLoading(true);
    setError(null);
    setProgress("Connecting to Jira...");
    setUseMock(false);
    setAllPiData({});
    setPiLoaded("");
    setSelectedPi("");
    setShowPiPrompt(false);

    try {
      const jira = new JiraService(c.domain, c.email, c.token);

      setProgress("Testing credentials...");
      const me = await jira.testConnection();
      setProgress(`Authenticated as ${me.displayName || me.emailAddress || "OK"}. Fetching sprints...`);

      const allSprints = {};
      const piSet = new Set();
      let fetchedCount = 0;
      let failedBoards = [];
      const currentYear = new Date().getFullYear().toString();

      for (const art of ALL_ARTS) {
        fetchedCount++;
        const sprintMap = {}; // Deduplicate sprints by ID across all boards
        
        for (let bi = 0; bi < art.boards.length; bi++) {
          const boardId = art.boards[bi];
          setProgress(`Fetching sprints: ${art.name} board ${bi + 1}/${art.boards.length} (ART ${fetchedCount}/${ALL_ARTS.length})...`);
          try {
            const sprints = await jira.getBoardSprints(boardId);
            sprints.forEach(s => {
              if (!sprintMap[s.id]) sprintMap[s.id] = s; // Deduplicate by sprint ID
            });
          } catch (e) {
            failedBoards.push({ art: art.name, board: boardId, error: e.message });
            console.warn(`Failed: ${art.key} board ${boardId}:`, e);
          }
        }

        const dedupedSprints = Object.values(sprintMap);
        allSprints[art.key] = dedupedSprints;
        dedupedSprints.forEach(s => {
          const pi = parsePIFromSprint(s.name);
          if (pi && pi.includes(currentYear)) piSet.add(pi);
        });
      }

      if (Object.values(allSprints).every(arr => arr.length === 0)) {
        const firstErr = failedBoards[0]?.error || "Unknown error";
        if (firstErr.includes("AUTH_FAILED")) {
          throw new Error("Authentication failed for all boards. Double-check your email and API token in Settings.");
        }
        throw new Error(`No sprints found across any boards. First error: ${firstErr}`);
      }

      const piList = Array.from(piSet).sort();
      if (piList.length === 0) {
        throw new Error(
          `Connected successfully but no PIs found for ${currentYear}. Sprints may not match the naming pattern "PI X ${currentYear} - Sprint N". ` +
          `${failedBoards.length > 0 ? `${failedBoards.length} boards also failed to load.` : ""}`
        );
      }

      // Store sprint data for Phase 2
      setRawSprints(allSprints);
      rawSprintsRef.current = allSprints;
      setPiOptions(piList);
      setProgress("");
      setShowPiPrompt(true); // Show prompt to select PI

      if (failedBoards.length > 0) {
        setError(`Connected but ${failedBoards.length} board(s) failed: ${failedBoards.map(f => f.art).join(", ")}. Check board IDs.`);
      }
    } catch (e) {
      setError(e.message);
      setUseMock(true);
      setProgress("");
    }
    setLoading(false);
  }, []);

  // ─── PHASE 2: Load data for selected PI ───────────────────────────────────
  const loadPIData = useCallback(async (pi) => {
    const c = configRef.current;
    const allSprints = rawSprintsRef.current;
    if (!c.domain || !c.email || !c.token || !pi) return;
    if (!allSprints || Object.keys(allSprints).length === 0) {
      setError("No sprint data available. Click Sync Jira first.");
      return;
    }

    setLoading(true);
    setError(null);
    setProgress(`Loading data for ${pi}...`);
    setShowPiPrompt(false);

    try {
      const jira = new JiraService(c.domain, c.email, c.token);
      const piData = {};
      piData[pi] = {};

      let totalSprints = 0;
      let sprintsDone = 0;

      // Count sprints for this PI
      for (const art of ALL_ARTS) {
        totalSprints += (allSprints[art.key] || []).filter(s => parsePIFromSprint(s.name) === pi).length;
      }

      for (const art of ALL_ARTS) {
        const sprints = (allSprints[art.key] || []).filter(s => parsePIFromSprint(s.name) === pi);
        const sprintsWithEpics = [];
        for (const sprint of sprints) {
          sprintsDone++;
          setProgress(`Loading epics: ${art.short} / ${cleanSprintName(sprint.name)} (${sprintsDone}/${totalSprints})`);
          try {
            const issues = await jira.getSprintIssues(sprint.id, art.key);
            const epics = issues.map(iss => ({
              key: iss.key,
              summary: iss.fields?.summary || "",
              status: iss.fields?.status?.name || "Unknown",
              requestType: iss.fields?.[REQUEST_TYPE_FIELD]?.value || iss.fields?.[REQUEST_TYPE_FIELD] || "N/A",
              timeInStatus: {},
            }));

            // Fetch changelog for bottleneck (only for active sprint to limit API calls)
            if (sprint.state === "active" && epics.length > 0) {
              setProgress(`Loading bottleneck data: ${art.short} (${Math.min(epics.length, 20)} epics)...`);
              for (const epic of epics.slice(0, 20)) {
                try {
                  const histories = await jira.getIssueChangelog(epic.key);
                  const statusTimes = {};
                  let lastStatusChange = null;
                  for (const h of histories) {
                    for (const item of h.items || []) {
                      if (item.field === "status") {
                        if (lastStatusChange && item.fromString) {
                          const from = new Date(lastStatusChange);
                          const to = new Date(h.created);
                          const hours = (to - from) / 3600000;
                          statusTimes[item.fromString.toLowerCase()] = (statusTimes[item.fromString.toLowerCase()] || 0) + hours;
                        }
                        lastStatusChange = h.created;
                      }
                    }
                  }
                  epic.timeInStatus = statusTimes;
                } catch (e) { /* skip individual changelog failures */ }
              }
            }

            sprintsWithEpics.push({ ...sprint, epics });
          } catch (e) {
            sprintsWithEpics.push({ ...sprint, epics: [] });
          }
        }
        piData[pi][art.key] = sprintsWithEpics;
      }

      setAllPiData(piData);
      setPiLoaded(pi);
      setProgress("");
    } catch (e) {
      setError(e.message);
      setProgress("");
    }
    setLoading(false);
  }, []);

  // When user selects a PI from dropdown, load its data
  const handlePiSelect = useCallback((pi) => {
    setSelectedPi(pi);
    if (pi && pi !== piLoaded && !useMock) {
      loadPIData(pi);
    }
  }, [piLoaded, useMock, loadPIData]);

  // Save config and auto-trigger PI fetch
  const handleSaveConfig = useCallback((newConfig) => {
    setConfig(newConfig);
    configRef.current = newConfig;
    setShowSettings(false);
    setTimeout(() => fetchPIs(newConfig), 100);
  }, [fetchPIs]);

  // Current PI data
  const currentPiData = useMemo(() => allPiData[selectedPi] || {}, [allPiData, selectedPi]);

  // Summary panel data aggregators
  function getSummaryTrend(bankKey) {
    const arts = ART_CONFIG[bankKey].arts;
    const sprintMap = {};
    const bankLabel = ART_CONFIG[bankKey].label;
    
    for (const art of arts) {
      const sprints = currentPiData[art.key] || [];
      for (const s of sprints) {
        const label = cleanSprintName(s.name);
        if (!sprintMap[label]) sprintMap[label] = { name: label, planned: 0, delivered: 0, unplanned: 0, epics: [] };
        const m = calcMetrics(s.epics);
        sprintMap[label].planned += m.planned;
        sprintMap[label].delivered += m.delivered;
        sprintMap[label].unplanned += m.unplanned;
        sprintMap[label].epics.push(...s.epics);
      }
    }

    // Verification logging
    const result = Object.values(sprintMap).sort(sortBySprint);
    console.group(`📊 ${bankLabel} — Summary Breakdown`);
    for (const sprint of result) {
      const deliveredEpics = sprint.epics.filter(e => (e.status || "").toLowerCase() === "deployed to prod");
      const unplannedEpics = sprint.epics.filter(e => UNPLANNED_TYPES.some(t => t.toLowerCase() === (e.requestType || "").toLowerCase()));
      console.group(`${sprint.name}: Planned=${sprint.planned}, Delivered=${sprint.delivered}, Unplanned=${sprint.unplanned}`);
      console.log("All epics:", sprint.epics.map(e => `${e.key} | Status: "${e.status}" | Type: "${e.requestType}"`));
      console.log("Delivered (status = 'deployed to prod'):", deliveredEpics.map(e => `${e.key} "${e.status}"`));
      console.log("Unplanned (Production Fix / Regulatory / ISG):", unplannedEpics.map(e => `${e.key} "${e.requestType}"`));
      console.groupEnd();
    }
    console.groupEnd();

    return result;
  }

  function getOpenSprintIssues(bankKey) {
    const arts = ART_CONFIG[bankKey].arts;
    const issues = [];
    for (const art of arts) {
      const sprints = currentPiData[art.key] || [];
      const open = sprints.find(s => s.state === "active");
      if (open) issues.push(...open.epics);
    }
    return issues;
  }

  // Carousel scroll
  const scrollCarousel = (dir) => {
    if (carouselRef.current) {
      const scrollAmount = 460;
      carouselRef.current.scrollBy({ left: dir * scrollAmount, behavior: "smooth" });
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, color: theme.text, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      {/* ── Header ─────────────────────────────────── */}
      <div style={{
        padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${theme.cardBorder}`, background: `${theme.card}CC`, backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            background: `linear-gradient(135deg, ${theme.accent}, ${theme.purple})`,
          }}>
            <Activity size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3 }}>Sterling Financial Holdings</div>
            <div style={{ fontSize: 11, color: theme.textDim }}>ART Health Board</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {useMock && (
            <div style={{ padding: "4px 10px", background: `${theme.warning}22`, color: theme.warning, borderRadius: 6, fontSize: 10, fontWeight: 600 }}>
              DEMO MODE
            </div>
          )}
          {loading && <Loader2 size={16} className="spin" style={{ color: theme.accent, animation: "spin 1s linear infinite" }} />}
          <button onClick={() => fetchPIs()} disabled={loading || !config.domain}
            style={{ padding: "6px 12px", background: theme.surface, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.textMuted, cursor: config.domain ? "pointer" : "not-allowed", fontSize: 11, display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
            <RefreshCw size={12} /> Sync Jira
          </button>
          <div style={{ position: "relative" }}>
            <select value={selectedPi} onChange={e => handlePiSelect(e.target.value)} disabled={piOptions.length === 0 || loading}
              style={{ padding: "6px 12px", background: showPiPrompt ? theme.accent : theme.surface, border: `1px solid ${showPiPrompt ? theme.accent : theme.cardBorder}`, borderRadius: 8, color: showPiPrompt ? "#fff" : theme.text, fontSize: 12, fontWeight: 600, cursor: piOptions.length > 0 ? "pointer" : "not-allowed", outline: "none", animation: showPiPrompt ? "pulse 1.5s ease-in-out infinite" : "none" }}>
              {!selectedPi && <option value="">— Select PI —</option>}
              {piOptions.map(pi => <option key={pi} value={pi}>{pi}</option>)}
            </select>
            {showPiPrompt && (
              <div style={{
                position: "absolute", top: "100%", right: 0, marginTop: 8, padding: "10px 14px",
                background: theme.accent, color: "#fff", borderRadius: 10, fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap", zIndex: 200, boxShadow: "0 4px 20px rgba(14,165,233,0.4)",
              }}>
                <div style={{ position: "absolute", top: -6, right: 16, width: 12, height: 12, background: theme.accent, transform: "rotate(45deg)" }} />
                Select a PI to load the dashboard
              </div>
            )}
          </div>
          <button onClick={() => setShowSettings(true)}
            style={{ width: 34, height: 34, borderRadius: 8, background: theme.surface, border: `1px solid ${theme.cardBorder}`, color: theme.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {progress && (
        <div style={{ margin: "8px 24px", padding: "10px 16px", background: `${theme.accent}12`, border: `1px solid ${theme.accent}33`, borderRadius: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <Loader2 size={14} style={{ color: theme.accent, animation: "spin 1s linear infinite", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: theme.accent }}>{progress}</span>
        </div>
      )}

      {error && (
        <div style={{ margin: "8px 24px", padding: "10px 16px", background: `${theme.danger}12`, border: `1px solid ${theme.danger}33`, borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <AlertTriangle size={14} color={theme.danger} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: theme.danger, whiteSpace: "pre-wrap" }}>{error}</span>
        </div>
      )}

      {/* ── Summary Panels ────────────────────────── */}
      <div style={{ padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[
            { bank: "sterling", label: ART_CONFIG.sterling.label, color: ART_CONFIG.sterling.color },
            { bank: "altbank", label: ART_CONFIG.altbank.label, color: ART_CONFIG.altbank.color },
            { bank: "shared", label: ART_CONFIG.shared.label, color: ART_CONFIG.shared.color },
          ].map(({ bank, label, color }) => (
            <BankSummaryColumn
              key={bank}
              bankKey={bank}
              bankLabel={label}
              bankColor={color}
              trendData={getSummaryTrend(bank)}
              onClickIssues={() => {
                const issues = getOpenSprintIssues(bank);
                setModalIssues(issues);
                setModalTitle(`${label} — Open Sprint Epics`);
              }}
            />
          ))}
        </div>
      </div>

      {/* ── ART Carousel ──────────────────────────── */}
      <div style={{ padding: "0 24px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>ART Detail Columns</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => scrollCarousel(-1)} style={{ width: 32, height: 32, borderRadius: 8, background: theme.surface, border: `1px solid ${theme.cardBorder}`, color: theme.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => scrollCarousel(1)} style={{ width: 32, height: 32, borderRadius: 8, background: theme.surface, border: `1px solid ${theme.cardBorder}`, color: theme.textMuted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div ref={carouselRef} style={{
          display: "flex", gap: 16, overflowX: "auto", paddingBottom: 12,
          scrollSnapType: "x mandatory", scrollbarWidth: "thin",
          scrollbarColor: `${theme.cardBorder} transparent`,
        }}>
          {ALL_ARTS.map(art => (
            <div key={art.key} style={{ scrollSnapAlign: "start" }}>
              <ARTColumn
                art={art}
                sprints={currentPiData[art.key] || []}
                allPiData={allPiData}
                currentPi={selectedPi}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Modals ────────────────────────────────── */}
      {showSettings && <SettingsModal config={config} onSave={handleSaveConfig} onClose={() => setShowSettings(false)} />}
      {modalIssues && <IssueModal issues={modalIssues} title={modalTitle} onClose={() => setModalIssues(null)} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(14,165,233,0.4); } 50% { box-shadow: 0 0 0 8px rgba(14,165,233,0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${theme.cardBorder}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${theme.textDim}; }
        select option { background: ${theme.card}; color: ${theme.text}; }
      `}</style>
    </div>
  );
}

// ─── RENDER ────────────────────────────────────────────────────────────────
createRoot(document.getElementById("root")).render(<ARTHealthBoard />);
