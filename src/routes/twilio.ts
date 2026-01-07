import { Router, type Request, type Response } from "express";
import {
  TWILIO_CONSOLE_NUMBERS,
  consoleDigitsToE164,
  isAllowedConsoleNumberDigits,
} from "../config/twilioConsole";
import { normalizeUsPhoneToE164 } from "../utils/phoneNumber";
import { listMessagesForNumber, sendSmsFrom } from "../utils/twilioClient";

const router = Router();

function formatUs10DigitsAsE164Pretty(digits10: string): string {
  // digits-only 10-digit US number (AAA BBB CCCC) => +1 (AAA) BBB-CCCC
  const d = digits10.replace(/\D/g, "");
  if (d.length !== 10) return digits10;
  return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function escapeHtml(input: string): string {
  // NOTE: we avoid String.prototype.replaceAll for older TS targets.
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        margin: 0;
        padding: 32px 24px 24px;
        display: flex;
        justify-content: center;
        /* Keep content top-aligned; just add comfortable top spacing via padding. */
        align-items: flex-start;
      }

      .container {
        width: min(900px, 100%);
      }
      a { color: #2563eb; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .muted { color: #6b7280; }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; max-width: 900px; }
      .messages { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; height: 460px; overflow: auto; background: #fafafa; }

      /* Chat layout */
      .msg-row { display: flex; margin: 8px 0; }
      .msg-row.inbound { justify-content: flex-start; }
      .msg-row.outbound { justify-content: flex-end; }

      .bubble {
        max-width: min(680px, 92%);
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(17, 24, 39, 0.08);
        background: white;
        box-shadow: 0 6px 20px rgba(17, 24, 39, 0.06);
      }
      .msg-row.inbound .bubble {
        background: #ffffff;
      }
      .msg-row.outbound .bubble {
        background: #eef7ff;
        border-color: rgba(37, 99, 235, 0.18);
      }

      .meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 12px;
        color: #6b7280;
        margin-bottom: 6px;
      }

      .badge {
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.02em;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(17, 24, 39, 0.12);
        color: #111827;
        background: rgba(255, 255, 255, 0.75);
      }
      .badge.in { border-color: rgba(16, 185, 129, 0.25); background: rgba(16, 185, 129, 0.10); }
      .badge.out { border-color: rgba(37, 99, 235, 0.25); background: rgba(37, 99, 235, 0.10); }

      .meta .who { display: flex; gap: 8px; align-items: center; }
      .meta .rest { display: flex; gap: 10px; align-items: center; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

      input, textarea { font: inherit; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; }
      textarea { width: 100%; min-height: 80px; }
      button { font: inherit; padding: 9px 12px; border: 1px solid #111827; background: #111827; color: white; border-radius: 10px; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
    </style>
  </head>
  <body>
    <main class="container">
      ${bodyHtml}
    </main>
  </body>
</html>`;
}

// GET /twilio
router.get("/", (req: Request, res: Response) => {
  const links = TWILIO_CONSOLE_NUMBERS.map(n => {
    const label = n.label ?? formatUs10DigitsAsE164Pretty(n.digits);
    return `<li><a href="/twilio/${encodeURIComponent(n.digits)}">${escapeHtml(label)}</a></li>`;
  }).join("\n");

  res
    .status(200)
    .type("html")
    .send(
      renderPage(
        "Twilio",
        `<h1>Twilio</h1>
         <p class="muted">Pick a Twilio number:</p>
         <ul>${links}</ul>
         <p class="muted">To add/remove numbers, edit <code>src/config/twilioConsole.ts</code>.</p>
         <p><a href="/">← back</a></p>`
      )
    );
});

// GET /twilio/:phoneDigits
router.get("/:phoneDigits", (req: Request, res: Response) => {
  const { phoneDigits } = req.params;
  if (!/^\d{10}$/.test(phoneDigits)) {
    return res.status(400).type("html").send(renderPage("Bad Request", "<p>Invalid phone number</p>"));
  }
  if (!isAllowedConsoleNumberDigits(phoneDigits)) {
    return res
      .status(404)
      .type("html")
      .send(renderPage("Not Found", `<p>Unknown number: ${escapeHtml(phoneDigits)}</p>`));
  }

  const phoneE164 = consoleDigitsToE164(phoneDigits);
  const pretty = formatUs10DigitsAsE164Pretty(phoneDigits);
  const defaultToDigits = phoneDigits === "5074282550" ? "7209642185" : "5074282550";

  res.status(200).type("html").send(
    renderPage(
      `Twilio ${pretty}`,
      `<div class="row" style="justify-content: space-between; max-width: 900px;">
         <h1 style="margin: 0;">Twilio: ${escapeHtml(pretty)}</h1>
         <div class="row">
           <span class="muted">${escapeHtml(phoneE164)}</span>
           <a href="/twilio">all numbers</a>
         </div>
       </div>

       <div class="card" style="margin-top: 14px; max-width: 900px;">
         <div class="row" style="justify-content: space-between;">
           <h2 style="margin: 0;">Messages</h2>
           <div class="row">
             <label class="muted">poll:</label>
             <select id="pollMs">
               <option value="1000">1s</option>
               <option value="2000" selected>2s</option>
               <option value="5000">5s</option>
               <option value="0">off</option>
             </select>
             <button id="refreshBtn" type="button">Refresh</button>
           </div>
         </div>
         <div id="messages" class="messages" aria-label="messages"></div>
       </div>

       <div class="card" style="margin-top: 14px; max-width: 900px;">
         <h2 style="margin-top: 0;">Send</h2>
         <form id="sendForm">
           <div class="row">
             <label for="to">To:</label>
             <input id="to" name="to" placeholder="(555) 555-5555 or +15555555555" style="min-width: 320px;" />
           </div>
           <div style="margin-top: 10px;">
             <label for="body">Message:</label>
             <textarea id="body" name="body" placeholder="Hello..."></textarea>
           </div>
           <div class="row" style="margin-top: 10px; justify-content: space-between;">
             <div class="muted" id="sendStatus"></div>
             <button id="sendBtn" type="submit">Send</button>
           </div>
         </form>
       </div>

       <script>
         const phoneDigits = ${JSON.stringify(phoneDigits)};
         const phoneE164 = ${JSON.stringify(phoneE164)};
         const defaultToDigits = ${JSON.stringify(defaultToDigits)};

         const messagesEl = document.getElementById('messages');
         const refreshBtn = document.getElementById('refreshBtn');
         const pollMsEl = document.getElementById('pollMs');
         const sendForm = document.getElementById('sendForm');
         const sendBtn = document.getElementById('sendBtn');
         const sendStatus = document.getElementById('sendStatus');

         // Pre-fill To: with a sensible default (user can override).
         const toInput = document.getElementById('to');
         if (toInput && !toInput.value) toInput.value = defaultToDigits;

         let lastCount = 0;
         function fmtTime(iso) {
           try { return new Date(iso).toLocaleString(); } catch { return iso || ''; }
         }

         function last10(num) {
           const digits = String(num || '').replace(/\D/g, '');
           return digits.length >= 10 ? digits.slice(-10) : digits;
         }

         function isInbound(msg) {
           // Prefer exact E.164 match; fallback to last-10-digits comparison.
           return (msg?.to === phoneE164) || (last10(msg?.to) === last10(phoneE164));
         }

         function escapeHtml(s) {
           return String(s || '')
             .replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/\"/g, '&quot;')
             .replace(/'/g, '&#039;');
         }

         function renderMessages(msgs) {
           if (!messagesEl) return;
           messagesEl.innerHTML = '';
           for (const m of msgs) {
             const inbound = isInbound(m);
             const row = document.createElement('div');
             row.className = 'msg-row ' + (inbound ? 'inbound' : 'outbound');

             const bubble = document.createElement('div');
             bubble.className = 'bubble';

             const meta = document.createElement('div');
             meta.className = 'meta';

             const who = document.createElement('div');
             who.className = 'who';

             const badge = document.createElement('span');
             badge.className = 'badge ' + (inbound ? 'in' : 'out');
             badge.textContent = inbound ? 'IN' : 'OUT';

             const counterparty = inbound ? (m.from || '') : (m.to || '');
             const label = inbound ? 'From:' : 'To:';
             const whoText = document.createElement('span');
             whoText.className = 'mono';
             whoText.innerHTML = escapeHtml(label + ' ' + counterparty);

             who.appendChild(badge);
             who.appendChild(whoText);

             const rest = document.createElement('div');
             rest.className = 'rest';
             const time = document.createElement('span');
             time.textContent = fmtTime(m.dateCreated);
             const status = document.createElement('span');
             status.textContent = m.status ? String(m.status) : '';
             rest.appendChild(time);
             if (m.status) rest.appendChild(status);

             meta.appendChild(who);
             meta.appendChild(rest);

             const pre = document.createElement('pre');
             pre.textContent = m.body || '';

             bubble.appendChild(meta);
             bubble.appendChild(pre);
             row.appendChild(bubble);
             messagesEl.appendChild(row);
           }
           if (msgs.length > lastCount) {
             messagesEl.scrollTop = messagesEl.scrollHeight;
           }
           lastCount = msgs.length;
         }

         async function refresh() {
           const res = await fetch('/twilio/' + encodeURIComponent(phoneDigits) + '/api/messages?limit=50');
           const data = await res.json();
           if (!res.ok) {
             renderMessages([{ from: 'error', to: '', body: data?.error || 'Failed to load', dateCreated: new Date().toISOString() }]);
             return;
           }
           renderMessages(data.messages || []);
         }

         refreshBtn?.addEventListener('click', () => refresh());

         let pollTimer = null;
         function updatePolling() {
           if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
           const ms = Number(pollMsEl?.value || 0);
           if (ms > 0) pollTimer = setInterval(refresh, ms);
         }
         pollMsEl?.addEventListener('change', updatePolling);

         sendForm?.addEventListener('submit', async (e) => {
           e.preventDefault();
           const to = document.getElementById('to')?.value || '';
           const body = document.getElementById('body')?.value || '';

           sendBtn.disabled = true;
           sendStatus.textContent = 'Sending...';
           try {
             const res = await fetch('/twilio/' + encodeURIComponent(phoneDigits) + '/api/send', {
               method: 'POST',
               headers: { 'content-type': 'application/json' },
               body: JSON.stringify({ to, body })
             });
             const data = await res.json();
             if (!res.ok) throw new Error(data?.error || 'send failed');
             sendStatus.textContent = 'Sent: ' + data.messageSid;
             document.getElementById('body').value = '';
             await refresh();
           } catch (err) {
             sendStatus.textContent = 'Error: ' + (err?.message || String(err));
           } finally {
             sendBtn.disabled = false;
           }
         });

         refresh();
         updatePolling();
       </script>`
    )
  );
});

// GET /twilio/:phoneDigits/api/messages
router.get("/:phoneDigits/api/messages", async (req: Request, res: Response) => {
  const { phoneDigits } = req.params;
  if (!/^\d{10}$/.test(phoneDigits)) return res.status(400).json({ error: "Invalid phone number" });
  if (!isAllowedConsoleNumberDigits(phoneDigits)) {
    return res.status(404).json({ error: "Unknown number" });
  }

  const limitRaw = req.query.limit ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  try {
    const phoneE164 = consoleDigitsToE164(phoneDigits);
    const messages = await listMessagesForNumber(phoneE164, limit);
    res.json({ phoneDigits, phoneE164, messages });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to list messages" });
  }
});

// POST /twilio/:phoneDigits/api/send
router.post("/:phoneDigits/api/send", async (req: Request, res: Response) => {
  const { phoneDigits } = req.params;
  if (!/^\d{10}$/.test(phoneDigits)) return res.status(400).json({ error: "Invalid phone number" });
  if (!isAllowedConsoleNumberDigits(phoneDigits)) {
    return res.status(404).json({ error: "Unknown number" });
  }

  const { to, body } = req.body ?? {};
  if (!to || typeof to !== "string") {
    return res.status(400).json({ error: "to is required" });
  }
  if (!body || typeof body !== "string") {
    return res.status(400).json({ error: "body is required" });
  }

  try {
    const fromE164 = consoleDigitsToE164(phoneDigits);
    const toE164 = normalizeUsPhoneToE164(to);
    const messageSid = await sendSmsFrom(fromE164, toE164, body);
    res.json({ messageSid, from: fromE164, to: toE164 });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to send" });
  }
});

export default router;
