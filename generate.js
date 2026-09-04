/**
 * =============================================================================
 * GITHUB DAY-BY-DAY CONTRIBUTION GRAPH — single-file bundle
 * =============================================================================
 *
 * WHERE THIS GOES:
 *   1. Put THIS file at the root of your profile repo (the repo named
 *      exactly the same as your username, e.g. SanthoshKumar-572/SanthoshKumar-572)
 *      as:  generate.js
 *
 *   2. GitHub Actions requires workflow files to live at a fixed path —
 *      that's a GitHub platform rule, so it can't be folded into this file.
 *      Copy the YAML block below (between the ===WORKFLOW=== markers,
 *      excluding the marker lines and leading "//") into a new file at:
 *         .github/workflows/update-graph.yml
 *
 *   3. In your README.md, embed the generated image with:
 *         ![GitHub Contributions](./contribution-graph.svg)
 *
 * WHY IT'S STRUCTURED THIS WAY:
 *   GitHub READMEs render Markdown/HTML but cannot execute JavaScript —
 *   so a live D3/Chart.js widget never actually runs inside a README.
 *   The standard pattern: this script fetches your real daily contribution
 *   counts from GitHub's GraphQL API and draws a static SVG image. The
 *   Action below reruns it daily and commits the refreshed SVG, so the
 *   image embedded in your README stays current automatically.
 *
 * ONE-TIME SETUP:
 *   a. Create a Personal Access Token (classic): GitHub → Settings →
 *      Developer settings → Personal access tokens → Tokens (classic) →
 *      Generate new token → scope: read:user
 *      (The default Actions token can't read contribution data — a PAT
 *      is required.)
 *   b. In your profile repo → Settings → Secrets and variables → Actions →
 *      New repository secret → name it GH_PAT → paste the token.
 *   c. Add this file (generate.js) and the workflow file (step 2 above).
 *   d. Repo → Actions tab → "Update Contribution Graph" → Run workflow
 *      (first run). After that it runs daily on its own.
 *
 * TESTING LOCALLY:
 *   GITHUB_TOKEN=your_pat GITHUB_USERNAME=SanthoshKumar-572 DAYS=30 node generate.js
 *   Then open contribution-graph.svg in a browser.
 *
 * CUSTOMIZING:
 *   - Number of trailing days plotted: change DAYS env var (or the
 *     default fallback "30" below).
 *   - Colors / sizing / fonts: edit the constants inside renderSVG().
 *   - Run time / cadence: edit the cron line in the workflow block below.
 * =============================================================================
 *
 * // ===WORKFLOW=== copy everything below this line, minus the leading "// ",
 * // into .github/workflows/update-graph.yml
 * //
 * // name: Update Contribution Graph
 * //
 * // on:
 * //   schedule:
 * //     - cron: "0 0 * * *"   # every day at 00:00 UTC
 * //   workflow_dispatch: {}     # allows manual trigger from the Actions tab
 * //
 * // jobs:
 * //   build:
 * //     runs-on: ubuntu-latest
 * //     permissions:
 * //       contents: write
 * //     steps:
 * //       - name: Checkout repo
 * //         uses: actions/checkout@v4
 * //
 * //       - name: Set up Node
 * //         uses: actions/setup-node@v4
 * //         with:
 * //           node-version: "20"
 * //
 * //       - name: Generate SVG
 * //         env:
 * //           GITHUB_TOKEN: ${{ secrets.GH_PAT }}
 * //           GITHUB_USERNAME: SanthoshKumar-572
 * //           DAYS: "30"
 * //         run: node generate.js
 * //
 * //       - name: Commit updated graph
 * //         run: |
 * //           git config user.name "github-actions[bot]"
 * //           git config user.email "github-actions[bot]@users.noreply.github.com"
 * //           git add contribution-graph.svg
 * //           git diff --staged --quiet || git commit -m "chore: update contribution graph"
 * //           git push
 * // ===END WORKFLOW===
 */

const https = require("https");
const fs = require("fs");

const USERNAME = process.env.GITHUB_USERNAME || "SanthoshKumar-572";
const TOKEN = process.env.GITHUB_TOKEN;
const DAYS = parseInt(process.env.DAYS || "30", 10); // how many trailing days to plot

if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN environment variable.");
  process.exit(1);
}

const query = `
query($userName: String!) {
  user(login: $userName) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

function graphqlRequest() {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables: { userName: USERNAME } });
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/graphql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `bearer ${TOKEN}`,
          "User-Agent": "contribution-graph-script",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function fmtLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${day} ${month}`;
}

function niceMax(max) {
  if (max <= 0) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / pow;
  let niceNorm;
  if (norm <= 1) niceNorm = 1;
  else if (norm <= 2) niceNorm = 2;
  else if (norm <= 5) niceNorm = 5;
  else niceNorm = 10;
  return niceNorm * pow;
}

async function main() {
  const result = await graphqlRequest();
  if (result.errors) {
    console.error("GraphQL errors:", JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }

  const weeks = result.data.user.contributionsCollection.contributionCalendar.weeks;
  const allDays = weeks.flatMap((w) => w.contributionDays);
  const trailing = allDays.slice(-DAYS);

  renderSVG(trailing);
}

function renderSVG(days) {
  // ----- Layout constants -----
  const PADDING_LEFT = 60;
  const PADDING_RIGHT = 40;
  const PADDING_TOP = 110;
  const PADDING_BOTTOM = 90;
  const POINT_GAP = 56; // horizontal spacing per day -> enables horizontal scroll
  const CHART_HEIGHT = 320;

  const chartWidth = Math.max(days.length * POINT_GAP, 900);
  const svgWidth = chartWidth + PADDING_LEFT + PADDING_RIGHT;
  const svgHeight = CHART_HEIGHT + PADDING_TOP + PADDING_BOTTOM;

  const counts = days.map((d) => d.contributionCount);
  const rawMax = Math.max(...counts, 1);
  const yMax = niceMax(rawMax);
  const yTicks = 4; // gridlines above zero

  const xFor = (i) => PADDING_LEFT + i * POINT_GAP;
  const yFor = (v) => PADDING_TOP + CHART_HEIGHT - (v / yMax) * CHART_HEIGHT;

  // ----- Grid lines + Y axis labels -----
  let gridLines = "";
  let yLabels = "";
  for (let t = 0; t <= yTicks; t++) {
    const value = Math.round((yMax / yTicks) * t);
    const y = yFor(value);
    gridLines += `<line x1="${PADDING_LEFT}" y1="${y}" x2="${
      PADDING_LEFT + chartWidth
    }" y2="${y}" stroke="#252525" stroke-width="1" />\n`;
    yLabels += `<text x="${PADDING_LEFT - 16}" y="${
      y + 4
    }" text-anchor="end" font-size="12" fill="#B3B3B3" font-family="Segoe UI, Helvetica, Arial, sans-serif">${value}</text>\n`;
  }

  // ----- X axis labels (every day) -----
  let xLabels = "";
  days.forEach((d, i) => {
    const x = xFor(i);
    xLabels += `<text x="${x}" y="${
      PADDING_TOP + CHART_HEIGHT + 34
    }" text-anchor="middle" font-size="11" fill="#B3B3B3" font-family="Segoe UI, Helvetica, Arial, sans-serif" transform="rotate(45 ${x} ${
      PADDING_TOP + CHART_HEIGHT + 34
    })">${fmtLabel(d.date)}</text>\n`;
  });

  // ----- Line path -----
  const linePoints = days
    .map((d, i) => `${xFor(i)},${yFor(d.contributionCount)}`)
    .join(" ");

  // ----- Area fill under line (subtle) -----
  const areaPath = `M${xFor(0)},${yFor(0)} L${linePoints
    .split(" ")
    .join(" L")} L${xFor(days.length - 1)},${yFor(0)} Z`;

  // ----- Data point circles -----
  let circles = "";
  days.forEach((d, i) => {
    const x = xFor(i);
    const y = yFor(d.contributionCount);
    circles += `<circle cx="${x}" cy="${y}" r="4.5" fill="#3B82F6" stroke="#0d1117" stroke-width="1.5">
      <title>${d.date}: ${d.contributionCount} contributions</title>
    </circle>\n`;
  });

  const totalContribs = counts.reduce((a, b) => a + b, 0);

  const svg = `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#3B82F6" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="#000000" />

  <text x="${PADDING_LEFT}" y="42" font-size="26" fill="#FFFFFF" font-weight="700">GitHub Contributions</text>
  <text x="${PADDING_LEFT}" y="68" font-size="14" fill="#B3B3B3">Contribution activity over time.</text>
  <text x="${PADDING_LEFT}" y="90" font-size="12" fill="#B3B3B3">Last ${days.length} days · ${totalContribs} total contributions</text>

  <!-- Grid -->
  ${gridLines}
  <!-- Y labels -->
  ${yLabels}

  <!-- Area under line -->
  <path d="${areaPath}" fill="url(#areaFill)" stroke="none" />

  <!-- Contribution line (day-by-day, straight segments) -->
  <polyline points="${linePoints}" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />

  <!-- Data points -->
  ${circles}

  <!-- X labels -->
  ${xLabels}

  <!-- Axis baseline -->
  <line x1="${PADDING_LEFT}" y1="${PADDING_TOP + CHART_HEIGHT}" x2="${
    PADDING_LEFT + chartWidth
  }" y2="${PADDING_TOP + CHART_HEIGHT}" stroke="#252525" stroke-width="1" />
</svg>`;

  fs.writeFileSync("contribution-graph.svg", svg);
  console.log(`Wrote contribution-graph.svg (${days.length} days, max=${yMax})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
