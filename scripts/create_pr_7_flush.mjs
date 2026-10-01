// Opens the two "flush to main" PRs for the Phase 5/6 stack, mirroring the #45
// pattern: a stacked PR merged into its base branch leaves the content off main;
// a follow-up PR from the receiving branch onto main carries it up.
// Reads the credential from the configured remote URL; NEVER prints it.
// Prints only the created PR URLs.
import { execSync } from 'child_process';

const remote = execSync('git -C /home/z/my-project/juzu remote get-url origin').toString().trim();
const m = remote.match(/^https?:\/\/(?:[^:\/]+:)?([^@]+)@github\.com\/(.+?)(?:\.git)?$/);
if (!m) { console.error('No credential in remote URL; aborting'); process.exit(1); }
const token = m[1];
const slug = m[2];

async function openPr({ title, head, base, body }) {
  const res = await fetch(`https://api.github.com/repos/${slug}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, head, base, body }),
  });
  const pr = await res.json();
  if (pr.html_url) {
    console.log(pr.html_url);
  } else {
    console.error(`PR creation failed (${head} -> ${base}):`, JSON.stringify(pr).slice(0, 400));
    process.exit(1);
  }
}

await openPr({
  title: 'Phase 5: water system onto main (follows #46)',
  head: 'phase-3-terrain-materials',
  base: 'main',
  body: `PR #46 was stacked with base \`phase-3-terrain-materials\`, so GitHub merged the Phase 5 water work (4093a03) into that branch (2dbac81), not into \`main\`. This PR carries the Phase 5 content onto \`main\`, mirroring the #45 flush after #44.

Phase 5 content and evidence: see PR #46 (§8.3 gate table — 15 PASS + 3 documented XFAIL + flow/foam/depth gates PASS; \`docs/verification/phase-5/\`; tsc + build clean).

**Merge order:** this one first, then the \`phase-5-water\` → \`main\` flush (which then reduces to the Phase 6 delta).

For Samuel to merge.`,
});

await openPr({
  title: 'Phase 6: atmosphere onto main (follows #47)',
  head: 'phase-5-water',
  base: 'main',
  body: `PR #47 was stacked with base \`phase-5-water\`, so GitHub merged the Phase 6 atmosphere work (6d25f13) into that branch (d846ac1), not into \`main\`. This PR carries the Phase 6 content onto \`main\`.

Phase 6 content and evidence: see PR #47 (§8.3 gate table — 13 PASS + 2 documented XFAIL + motion/presence/softness gates PASS; \`docs/verification/phase-6/\`; tsc + build clean).

**Merge order:** after the \`phase-3-terrain-materials\` → \`main\` flush (Phase 5) — at creation this diff shows P5+P6; once the Phase 5 flush merges it reduces to the Phase 6 delta.

For Samuel to merge.`,
});
