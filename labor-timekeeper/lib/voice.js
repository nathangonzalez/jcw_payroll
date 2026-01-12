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
    "- Customer must be chosen from the provided customer list; if not sure, pick the closest match.",
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
      { role: "user", content: `Command: ${text}\n\nOutput JSON only.` }
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
                required: ["customer", "day", "work_date", "hours", "notes"],
                properties: {
                  customer: { type: "string" },
                  day: { type: ["string", "null"], enum: ["mon","tue","wed","thu","fri","sat","sun", null] },
                  work_date: { type: ["string", "null"] },
                  hours: { type: "number" },
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

  const resolved = safe.entries.map(e => {
    const match = fuse.search(e.customer)[0]?.item;
    const customer = match || customers.find(c => c.name.toLowerCase() === e.customer.toLowerCase()) || null;

    let workDate = e.work_date;
    if (!workDate) {
      if (e.day) {
        workDate = map[e.day] || map["mon"];
      } else {
        // If no day specified, assume today (in America/New_York) but keep it inside the current week.
        const t = todayYMD();
        const inWeek = Object.values(map).includes(t);
        workDate = inWeek ? t : (map["mon"] || t);
      }
    }
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
