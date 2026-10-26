// Directories: every SEBI-registered FPI (NSDL's register) and every entity in IFSCA's directory of
// GIFT IFSC regulated entities (fund managers, schemes, banks, ...).
//   POST /functions/v1/directory?only=nsdl    whole FPI register in one request
//   POST /functions/v1/directory?only=ifsca   directory list (at most once a day) + registration details for up to 150 entries
// Requires header x-ingest-key = app_secrets.ingest_key; NSDL needs x-region: ap-south-1 (Mumbai).
// FPI addresses and phone numbers are not stored: many FPIs are individuals. IFSCA contact details go to the
// private ifsca_contacts table, which the public key cannot read; the owner-only leads function serves them.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const NSDL_PAGE = "https://www.fpi.nsdl.co.in/web/Reports/RegisteredFIISAFPI.aspx";
const IFSCA = "https://ifsca.gov.in/DirectoryList";

async function logRun(source: string, started: Date, ok: boolean, found: number, added: number, error?: string) {
  await db.from("runs").insert({
    source, started_at: started.toISOString(), finished_at: new Date().toISOString(),
    ok, items_found: found, items_new: added, error: error?.slice(0, 500) ?? null,
  });
}

// "15/11/2026" -> "2026-11-15"
const dmy = (s?: string | null) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((s || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const COUNTRY: Record<string, string> = { US: "UNITED STATES OF AMERICA", USA: "UNITED STATES OF AMERICA", UK: "UNITED KINGDOM", UAE: "UNITED ARAB EMIRATES" };

async function upsertAll(table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 1000), { onConflict });
    if (error) throw new Error(error.message);
  }
}

// ---------- NSDL: the FPI register ----------

async function runNsdl() {
  const started = new Date();
  try {
    // The register's search runs a background request from its page; open the page first for its cookies.
    const page = await fetch(NSDL_PAGE, { headers: { "user-agent": UA, "accept-language": "en-IN,en;q=0.9" }, signal: AbortSignal.timeout(60_000) });
    await page.arrayBuffer();
    const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    const body = new URLSearchParams({ type: "0", Search: "%", RegNo: "", CategoryId: "", SubCategoryId: "", CountryId: "", StatusId: "", RegTypeId: "" });
    const res = await fetch(`${NSDL_PAGE}?action=getregdata`, {
      method: "POST", body,
      headers: {
        "user-agent": UA, cookie, "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        accept: "application/json, text/javascript, */*; q=0.01", "x-requested-with": "XMLHttpRequest",
        origin: "https://www.fpi.nsdl.co.in", referer: NSDL_PAGE,
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from NSDL`);
    const list = ((await res.json()).Table ?? []) as Record<string, string | number>[];
    // A short answer means NSDL cut the response off; keep yesterday's directory rather than a partial one.
    if (list.length < 5000) throw new Error(`NSDL returned only ${list.length} FPIs`);
    const now = new Date().toISOString();
    const byReg = new Map<string, Record<string, unknown>>();
    for (const r of list) {
      const reg = String(r.Reg_No || "").trim().toUpperCase();
      const m = /^IN([A-Z]{2})FP(\d{4})(\d{2})$/.exec(reg);
      if (!reg) continue;
      const country = String(r.CountryName || "").trim().toUpperCase();
      byReg.set(reg, {
        reg_no: reg, name: String(r.Appl_Nm || "").replace(/\s+/g, " ").trim(),
        country: COUNTRY[country] || country || null, country_code: m?.[1] ?? null,
        category: String(r.Category_nm || "").trim() || null, sub_category: String(r.SubCategory || "").trim() || null,
        status: String(r.StatusName || "").trim() || null, valid_upto: dmy(String(r.Reg_Date || "")),
        reg_year: m ? 2000 + +m[3] : null, serial: m ? +m[2] : null, source: "nsdl", last_seen: now,
      });
    }
    const before = (await db.from("fpi_registry").select("reg_no", { count: "exact", head: true })).count ?? 0;
    await upsertAll("fpi_registry", [...byReg.values()], "reg_no");
    const after = (await db.from("fpi_registry").select("reg_no", { count: "exact", head: true })).count ?? 0;
    await logRun("nsdl_fpi_list", started, true, byReg.size, after - before);
    return { fpis: byReg.size, new: after - before };
  } catch (e) {
    await logRun("nsdl_fpi_list", started, false, 0, 0, (e as Error).message);
    return { error: (e as Error).message };
  }
}

// ---------- IFSCA: directory of regulated entities ----------

async function getJson(url: string) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json, */*", "x-requested-with": "XMLHttpRequest", referer: IFSCA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function refreshIfscaList() {
  const size = 250, now = new Date().toISOString(), rows: Record<string, unknown>[] = [];
  for (let page = 1, total = 1; page <= total && page <= 40; page++) {
    const q = new URLSearchParams({ draw: "1", start: String((page - 1) * size), length: String(size), PageNumber: String(page), PageSize: String(size),
      SearchText: "", SearchName: "", Id: "0", ParentTypeId: "0", EntityFilter: "", CategoryFilter: "0", SubCategoryFilter: "0" });
    const j = await getJson(`${IFSCA}/DirectoryGetList?${q}`);
    const data = (j.data ?? []) as Record<string, any>[];
    if (!data.length) break;
    total = data[0].PaginationRequest?.TotalPage ?? 1;
    for (const d of data) {
      if (!d.EncryptedId) continue;
      rows.push({ enc_id: d.EncryptedId, name: String(d.Title || "").replace(/\s+/g, " ").trim(),
        category: d.DirParentCategoryName?.trim() || null, sub_category: d.DirSubCategoryName?.trim() || null, last_seen: now });
    }
  }
  if (rows.length < 500) throw new Error(`IFSCA directory returned only ${rows.length} entries`);
  await upsertAll("ifsca_entities", rows, "enc_id");
  await db.from("directory_state").upsert({ key: "ifsca_list", value: String(rows.length), updated_at: now });
  return rows.length;
}

async function runIfsca(force: boolean) {
  const started = new Date();
  try {
    const { data: st } = await db.from("directory_state").select("updated_at").eq("key", "ifsca_list").maybeSingle();
    const stale = !st || Date.now() - new Date(st.updated_at).getTime() > 20 * 3600e3;
    const listed = force || stale ? await refreshIfscaList() : null;
    // Registration details (number, date, address, website): new entries first, a batch per run.
    const { data: todo } = await db.from("ifsca_entities").select("enc_id").is("detail_at", null).order("first_seen").limit(150);
    let done = 0;
    const queue = [...(todo ?? [])];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          const d = await getJson(`${IFSCA}/DirectoryDetailGet?EncryptedId=${encodeURIComponent(t.enc_id)}`);
          const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s && s.toLowerCase() !== "null" ? s : null; };
          await db.from("ifsca_entities").update({
            reg_no: clean(d.RegistrationNumber), reg_date: dmy(clean(d.DateOfRegistration)),
            address: clean(d.RegisteredAddress), website: clean(d.Website), detail_at: new Date().toISOString(),
          }).eq("enc_id", t.enc_id);
          await db.from("ifsca_contacts").upsert({
            enc_id: t.enc_id, contact_name: clean(d.NameofContactPerson)?.replace(/[\u200b\u00a0]/g, " ").trim() || null,
            phone: clean(d.ContactNumber), email: clean(d.Email) || clean(d.EmailId), remarks: clean(d.Remarks), updated_at: new Date().toISOString(),
          }, { onConflict: "enc_id" });
          done++;
        } catch { /* left for the next run */ }
      }
    }));
    await logRun("ifsca_directory", started, true, listed ?? done, done);
    return { listed, details: done };
  } catch (e) {
    await logRun("ifsca_directory", started, false, 0, 0, (e as Error).message);
    return { error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams, only = q.get("only");
  if (only === "nsdl") return Response.json({ nsdl: await runNsdl() });
  if (only === "ifsca") return Response.json({ ifsca: await runIfsca(q.get("force") === "1") });
  return new Response("use ?only=nsdl or ?only=ifsca", { status: 400 });
});
