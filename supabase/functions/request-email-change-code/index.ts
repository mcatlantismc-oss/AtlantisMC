import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function key(name: string, legacy: string) {
  const value = Deno.env.get(name);
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.default) return String(parsed.default);
    } catch {}
    return value;
  }
  return Deno.env.get(legacy) ?? "";
}

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendEmail(to: string, code: string, newEmail: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) throw new Error("RESEND_API_KEY eksik.");

  const from = Deno.env.get("RESEND_FROM_EMAIL") || "AtlantisMC <onboarding@resend.dev>";

  const html = `<!doctype html><html lang="tr"><body style="margin:0;padding:0;background:#050d18;font-family:Arial,Helvetica,sans-serif;color:#fff"><div style="max-width:520px;margin:0 auto;padding:30px 16px"><div style="background:#111827;border:1px solid #214964;border-radius:20px;padding:30px 24px;text-align:center"><div style="font-size:40px;margin-bottom:12px">⚔️</div><div style="color:#69d2ff;font-size:12px;font-weight:bold;letter-spacing:4px;margin-bottom:8px">ATLANTIS MC</div><h1 style="margin:0 0 14px;color:#a9e7ff;font-size:27px">E-POSTA DEĞİŞİKLİĞİ</h1><p style="color:#a9bbca;font-size:15px;line-height:1.7">Yeni e-posta adresini doğrulamak için aşağıdaki 6 haneli kodu Atlantis MC'de kullan.</p><p style="color:#8ea8b9;font-size:13px">Yeni e-posta: <strong style="color:#d0f2ff">${newEmail}</strong></p><div style="margin:24px 0;padding:24px 18px;border-radius:15px;background:#0b1d30;border:1px solid #285b78"><div style="font-size:11px;color:#7893a5;font-weight:bold;letter-spacing:2px;margin-bottom:12px">DOĞRULAMA KODU</div><div style="display:inline-block;padding:15px 20px;background:#07101d;border:1px solid #326b8e;border-radius:12px;color:#9de6ff;font-size:36px;font-weight:bold;letter-spacing:8px">${code}</div></div><p style="color:#788f9f;font-size:13px;line-height:1.6">Bu kod 10 dakika boyunca geçerlidir. Kodu kimseyle paylaşma.</p><div style="height:1px;background:#19374b;margin:24px 0 18px"></div><p style="margin:0;color:#5f7789;font-size:12px">Atlantis MC — Oyuncu odaklı Minecraft topluluğu<br>© 2026 Atlantis MC</p></div></div></body></html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: "AtlantisMC - E-posta Değiştirme Kodu", html }),
  });
  if (!response.ok) throw new Error(`Mail gönderilemedi: ${await response.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Sadece POST kullanılabilir." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Giriş yapmalısın." }, 401);

    const accessToken = authHeader.slice(7).trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const publishableKey = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !publishableKey || !secretKey) return json({ ok: false, error: "Supabase function anahtarları eksik." }, 500);

    const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ ok: false, error: "Oturum geçersiz veya süresi dolmuş." }, 401);

    const admin = createClient(supabaseUrl, secretKey);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "request");

    if (action === "request") {
      const newEmail = String(body.newEmail || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return json({ ok: false, error: "Geçerli bir e-posta adresi gir." }, 400);
      if (newEmail === String(user.email || "").toLowerCase()) return json({ ok: false, error: "Yeni e-posta mevcut adresinle aynı." }, 400);

      const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      if (list?.users?.some(u => String(u.email || "").toLowerCase() === newEmail)) return json({ ok: false, error: "Bu e-posta adresi zaten kullanılıyor." }, 409);

      const { data: recent } = await admin.from("email_change_codes").select("created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (recent?.created_at && Date.now() - new Date(recent.created_at).getTime() < 60_000) return json({ ok: false, error: "Yeni kod istemek için 1 dakika bekle." }, 429);

      const code = makeCode();
      const hash = await sha256(code);
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

      await admin.from("email_change_codes").delete().eq("user_id", user.id);
      const { error: insertError } = await admin.from("email_change_codes").insert({ user_id: user.id, new_email: newEmail, code_hash: hash, expires_at: expiresAt, attempts: 0 });
      if (insertError) throw insertError;

      await sendEmail(newEmail, code, newEmail);
      return json({ ok: true, message: "Doğrulama kodu yeni e-posta adresine gönderildi.", expires_at: expiresAt });
    }

    if (action === "verify") {
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "6 haneli kodu doğru gir." }, 400);

      const { data: record, error: fetchError } = await admin.from("email_change_codes").select("id,new_email,code_hash,expires_at,attempts").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (fetchError) throw fetchError;
      if (!record) return json({ ok: false, error: "Aktif bir doğrulama kodu bulunamadı." }, 404);
      if (new Date(record.expires_at).getTime() < Date.now()) return json({ ok: false, error: "Kodun süresi dolmuş. Yeni kod iste." }, 410);
      if (Number(record.attempts) >= 5) return json({ ok: false, error: "Çok fazla hatalı deneme. Yeni kod iste." }, 429);

      const incomingHash = await sha256(code);
      if (incomingHash !== record.code_hash) {
        await admin.from("email_change_codes").update({ attempts: Number(record.attempts) + 1 }).eq("id", record.id);
        return json({ ok: false, error: "Kod yanlış." }, 400);
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { email: record.new_email, email_confirm: true });
      if (updateError) throw updateError;
      await admin.from("email_change_codes").delete().eq("id", record.id);

      return json({ ok: true, message: "E-posta adresin başarıyla değiştirildi." });
    }

    return json({ ok: false, error: "Geçersiz işlem." }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu." }, 500);
  }
});
                                                                    
