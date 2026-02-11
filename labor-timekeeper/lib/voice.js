import fs from "fs";
import { z } from "zod";
import { getOpenAI } from "./openai.js";
import { weekStartYMD, weekDates, todayYMD, TZ } from "./time.js";
import Fuse from "fuse.js";

// Schema for parsing a "voice command" into entries
export const VoiceParseSchema = z.object({
  entries: z.array(
    z.object({
      customer: z.string(),
      day: z.enum(["mon","tue","wed","thu","fri","sat","sun"]).nullable().optional(),
      // allow direct date too (YYYY-MM-DD)
      work_date: z.string().nullable().optional(),
      hours: z.number(),
      start_time: z.string().nullable().optional(),
      end_time: z.string().nullable().optional(),
      notes: z.string().nullable().optional()
    })
  )
});

export async function transcribeAudio(tempFilePath, originalName = "audio.webm") {
  const openai = getOpenAI();
  if (!openai) throw new Error("OPENAI_API_KEY is not set");
  
  // Rename temp file to have proper extension for OpenAI
  const ext = originalName.includes('.') ? originalName.split('.').pop() : 'webm';
  const newPath = `${tempFilePath}.${ext}`;
  fs.renameSync(tempFilePath, newPath);
  
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(newPath),
    model: "whisper-1",
    response_format: "json"
  });
  
  // Clean up renamed file
  fs.unlinkSync(newPath);
  
  return transcription.text || "";
}

export async function parseVoiceCommand({ text, customers, referenceDate }) {
  const openai = getOpenAI();
  if (!openai) throw new Error("OPENAI_API_KEY is not set");

  const normalizedText = normalizeCompactTimes(text || "");
  const nowYmd = todayYMD();
  const weekStart = weekStartYMD(referenceDate ?? new Date());
  const { map, ordered } = weekDates(weekStart);
  const customerList = customers.map(c => c.name);

  // Keep list compact; if huge, you'd do server-side retrieval instead
  const system = [
    "You extract structured time entries from short, messy voice commands.",
    "Return JSON that matches the schema exactly.",
    "Rules:",
    "- Interpret weekday words (Mon/Tue/.../Friday/etc) as days in the CURRENT payroll week.",
    `- Payroll week starts on ${weekStart}.`,
    `- Today (America/New_York) is ${nowYmd}.`,
    "- If day is omitted, assume the user means today.",
    "- Hours are numeric (allow decimals like 7.5).",
    "- If a time range is spoken, include start_time and end_time in 24-hour HH:MM format.",
    "- Customer must be chosen from the provided customer list; if not sure, pick the closest match.",
    "- Treat 'lunch' (including mishears like 'launch') as a special customer named Lunch even if it is not in the list.",
    "- If a day is stated once, apply it to subsequent entries until another day is stated.",
    "- Normalize compact times like 730 -> 07:30 and 330 -> 03:30; if two compact times appear back-to-back, treat them as start_time and end_time.",
    "- Do not invent employees or rates; only output what you can parse from the command.",
    "",
    "Customer list:",
    customerList.join(" | ")
  ].join("\n");

  // Use Structured Outputs (Zod) via responses.parse
  // Ref: Structured outputs guide
  const response = await openai.responses.parse({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: `Command: ${normalizedText}\n\nOutput JSON only.` }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "voice_time_entries",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["entries"],
          properties: {
            entries: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["customer", "day", "work_date", "hours", "start_time", "end_time", "notes"],
                properties: {
                  customer: { type: "string" },
                  day: { type: ["string", "null"], enum: ["mon","tue","wed","thu","fri","sat","sun", null] },
                  work_date: { type: ["string", "null"] },
                  hours: { type: "number" },
                  start_time: { type: ["string", "null"] },
                  end_time: { type: ["string", "null"] },
                  notes: { type: ["string", "null"] }
                }
              }
            }
          }
        }
      }
    }
  });

  const parsed = response.output_parsed;
  const safe = VoiceParseSchema.parse(parsed);

  // Resolve customer names robustly with Fuse, then map weekday->date.
  const fuse = new Fuse(customers, { keys: ["name"], threshold: 0.35 });

  let lastDay = null;
  const dayFromYmd = (ymd) => {
    if (!ymd || typeof ymd !== 'string') return null;
    const d = new Date(`${ymd}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    const idx = d.getUTCDay(); // 0=Sun..6=Sat
    return ["sun","mon","tue","wed","thu","fri","sat"][idx] || null;
  };

  const resolveDayKey = (entry) => {
    if (entry.day) return entry.day;
    const inferred = dayFromYmd(entry.work_date);
    if (inferred) return inferred;
    if (lastDay) return lastDay;
    return null;
  };

  const resolved = safe.entries.map(e => {
    const customerLower = String(e.customer || '').toLowerCase();
    if (customerLower.includes('lunch') || customerLower.includes('launch')) {
      const lunchCustomer = customers.find(c => c.name.toLowerCase() === 'lunch');
      const dayKey = resolveDayKey(e);
      let workDate = dayKey ? (map[dayKey] || map["mon"]) : null;
      if (!workDate) {
        const t = todayYMD();
        const inWeek = Object.values(map).includes(t);
        workDate = inWeek ? t : (map["mon"] || t);
      }
      if (dayKey) lastDay = dayKey;
      return {
        ...e,
        customer_id: lunchCustomer?.id || null,
        customer_name: 'Lunch',
        customer: 'Lunch',
        work_date: workDate
      };
    }
    const match = fuse.search(e.customer)[0]?.item;
    const customer = match || customers.find(c => c.name.toLowerCase() === e.customer.toLowerCase()) || null;

    const dayKey = resolveDayKey(e);
    let workDate = dayKey ? (map[dayKey] || map["mon"]) : null;
    if (!workDate) {
      // If no day specified, assume today (in America/New_York) but keep it inside the current week.
      const t = todayYMD();
      const inWeek = Object.values(map).includes(t);
      workDate = inWeek ? t : (map["mon"] || t);
    }
    if (dayKey) lastDay = dayKey;
    return {
      ...e,
      customer_id: customer?.id || null,
      customer_name: customer?.name || e.customer,
      work_date: workDate
    };
  });

  return { week_start: weekStart, ordered_days: ordered, entries: resolved };
}

function inferDayFromText(text) {
  const t = text.toLowerCase();
  if (t.includes("monday") || t.includes("mon")) return "mon";
  if (t.includes("tuesday") || t.includes("tue")) return "tue";
  if (t.includes("wednesday") || t.includes("wed")) return "wed";
  if (t.includes("thursday") || t.includes("thu")) return "thu";
  if (t.includes("friday") || t.includes("fri")) return "fri";
  if (t.includes("saturday") || t.includes("sat")) return "sat";
  if (t.includes("sunday") || t.includes("sun")) return "sun";
  // default "today" handled elsewhere; here default mon
  return "mon";
}

function normalizeCompactTimes(input) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtTime = (h, m) => `${pad2(h)}:${pad2(m)}`;
  const parseStartFrom3 = (s) => {
    if (s.length !== 3) return null;
    const h = Number(s[0]);
    const m = Number(s.slice(1));
    if (!(h >= 1 && h <= 12)) return null;
    if (!(m === 0 || m === 30)) return null;
    return { h, m };
  };
  const parseEndFrom4 = (s) => {
    if (s.length !== 4) return null;
    const hh = Number(s.slice(0, 2));
    const mm = Number(s.slice(2));
    if (hh >= 1 && hh <= 12 && (mm === 0 || mm === 30)) return { h: hh, m: mm };
    const h = Number(s[0]);
    if (h >= 1 && h <= 12 && (mm === 0 || mm === 30)) return { h, m: mm };
    return null;
  };
  const parseEndHourFromTwo = (s) => {
    if (s.length !== 2) return null;
    const n = Number(s);
    if (n >= 1 && n <= 12) return n;
    if (n >= 20 && n <= 29) return n % 10;
    return null;
  };
  const expand7 = (t) => {
    const start = parseStartFrom3(t.slice(0, 3));
    const end = parseEndFrom4(t.slice(3));
    if (!start || !end) return t;
    return `${fmtTime(start.h, start.m)} to ${fmtTime(end.h, end.m)}`;
  };
  const expand5 = (t) => {
    const start = parseStartFrom3(t.slice(0, 3));
    const endHour = parseEndHourFromTwo(t.slice(3));
    if (!start || endHour == null) return t;
    return `${fmtTime(start.h, start.m)} to ${fmtTime(endHour, 0)}`;
  };
  const expand4 = (t) => {
    const firstTwo = Number(t.slice(0, 2));
    let startHour = null;
    if (firstTwo >= 1 && firstTwo <= 12) startHour = firstTwo;
    else startHour = Number(t[0]);
    const endHour = parseEndHourFromTwo(t.slice(2));
    if (!(startHour >= 1 && startHour <= 12) || endHour == null) return t;
    return `${fmtTime(startHour, 0)} to ${fmtTime(endHour, 0)}`;
  };
  const expand3 = (t) => {
    if (t.length !== 3) return t;
    if (t[1] !== "2") return t;
    const startHour = Number(t[0]);
    const endHour = Number(t[2]);
    if (!(startHour >= 1 && startHour <= 12) || !(endHour >= 0 && endHour <= 9)) return t;
    return `${fmtTime(startHour, 0)} to ${fmtTime(endHour, 0)}`;
  };

  return String(input)
    .replace(/\b\d{7}\b/g, (t) => expand7(t))
    .replace(/\b\d{5}\b/g, (t) => expand5(t))
    .replace(/\b\d{4}\b/g, (t) => {
      const n = Number(t);
      if (n >= 2000 && n <= 2099) return t;
      return expand4(t);
    })
    .replace(/\b\d{3}\b/g, (t) => expand3(t));
}
