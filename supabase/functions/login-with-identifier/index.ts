import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if(req.method !== 'POST') return json({error:'Method not allowed'},405);

  try {
    const { username, password } = await req.json();
    if(typeof username !== 'string' || typeof password !== 'string') return json({error:'Invalid request'},400);
    const clean = username.trim();
    if(!/^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}$/.test(clean)) return json({error:'Geçersiz kullanıcı adı'},400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || (() => {
      try {
        const parsed = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
        return parsed.default || Object.values(parsed)[0] || '';
      } catch { return ''; }
    })();
    if(!supabaseUrl || !serviceKey || !anonKey) return json({error:'Server auth configuration missing'},500);

    const admin = createClient(supabaseUrl, serviceKey, {auth:{autoRefreshToken:false,persistSession:false}});
    const publicClient = createClient(supabaseUrl, anonKey, {auth:{autoRefreshToken:false,persistSession:false}});

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id,username')
      .ilike('username', clean)
      .maybeSingle();

    if(profileError || !profile) return json({error:'Kullanıcı adı veya şifre hatalı.'},401);

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    const email = userData?.user?.email;
    if(userError || !email) return json({error:'Kullanıcı adı veya şifre hatalı.'},401);

    const { data: authData, error: authError } = await publicClient.auth.signInWithPassword({email,password});
    if(authError || !authData.session) return json({error:'Kullanıcı adı veya şifre hatalı.'},401);

    return json({ session: authData.session });
  } catch (_error) {
    return json({error:'Giriş sırasında bir hata oluştu.'},500);
  }
});
