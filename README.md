# Sterling Financial Holdings — ART Health Board

Real-time Agile Release Train health dashboard pulling live data from Jira Cloud.

## Deploy to Vercel (Recommended)

### Step 1: Push to GitHub
```bash
cd sterling-art-board
git init
git add .
git commit -m "Initial commit"
```
Create a new repo at https://github.com/new, then:
```bash
git remote add origin https://github.com/YOUR-USERNAME/sterling-art-board.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → Sign up with GitHub
2. Click **"Add New Project"**
3. Import your `sterling-art-board` repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Done! Your dashboard is live at `https://sterling-art-board.vercel.app`

### Step 3: Connect to Jira
1. Open your Vercel URL
2. Click the **gear icon** (top right)
3. Enter your Jira details:
   - **Domain**: `sterlingbank` (pre-filled)
   - **Email**: your Jira account email
   - **API Token**: generate at https://id.atlassian.com/manage-profile/security/api-tokens
4. Click **Test** → then **Save & Connect**

No CORS proxy needed — Vercel serverless functions proxy Jira calls server-side.

## Local Development

```bash
cd sterling-art-board
npm install
npm run dev
```

Open **http://localhost:3000**.

## Architecture

```
sterling-art-board/
├── api/
│   └── jira/
│       └── [...path].js    # Vercel serverless Jira proxy
├── src/
│   └── main.jsx             # Full dashboard React app
├── index.html               # Entry point
├── vite.config.js           # Dev server + local Jira proxy
├── vercel.json              # Vercel deployment config
├── server.js                # Production Express server (non-Vercel)
└── package.json
```

## What's Displayed

### Bank Summary Columns (Top)
3 columns for Sterling Bank, Alternative Bank, and Shared Services, each containing:
- Planned vs Delivered line chart (aggregated across all ARTs)
- Planned vs Unplanned line chart
- Total (P+U) vs Delivered line chart
- % Delivery per Sprint table with progress bars

### ART Detail Carousel (Bottom)
15 scrollable ART columns, each with:
- Planned vs Delivered / Planned vs Unplanned / Total vs Delivered line charts
- Planned Deliverables table
- Unplanned Deliverables table
- Bottleneck bar chart (avg hours per workflow status)
- % Delivery Aggregates table
- 5 AI-generated observations & recommendations

### Metric Definitions
- **Planned** = count of all open sprint epics
- **Delivered** = count of epics with status = "Deployed to prod"
- **Unplanned** = count of epics with Request Type ∈ {Production Fix, Regulatory request, ISG Vulnerability Fix}

## Tech Stack
- React 18 + Vite
- Recharts for charts
- Lucide React for icons
- Vercel serverless functions for Jira proxy
- Jira Cloud REST API v3
