import { readFileSync } from 'node:fs';
import { BrowserActions } from '../src/actions.js';

async function main() {
  const articlePath = '/Users/webkubor/dev/gitlab/webkubor/blog/content/articles/ai-api-protocols-explained.md';
  const raw = readFileSync(articlePath, 'utf-8');

  // Strip YAML frontmatter correctly
  let body = raw;
  if (raw.startsWith('---')) {
    const secondDashIndex = raw.indexOf('\n---', 3);
    if (secondDashIndex > 0) {
      body = raw.slice(secondDashIndex + 4).trim();
    }
  }

  const browser = await BrowserActions.connectToSession();
  const res = await browser.eval(`(() => {
    const cmEl = document.querySelector(".CodeMirror");
    if (cmEl && cmEl.CodeMirror) {
      cmEl.CodeMirror.setValue(${JSON.stringify(body)});
      return { ok: true, chars: ${body.length} };
    }
    // Fallback to textarea
    const ta = document.querySelector("textarea");
    if (ta) {
      ta.value = ${JSON.stringify(body)};
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, chars: ${body.length}, fallback: true };
    }
    return { ok: false, error: "未找到 CodeMirror 或 textarea" };
  })()`);

  console.log('注入结果:', JSON.stringify(res));
  process.exit(0);
}

main();
