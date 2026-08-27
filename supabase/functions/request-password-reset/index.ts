import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers':
'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods':
'POST, OPTIONS',
'Content-Type':
'application/json',
};

/*
* Basit işlem/yavaşlatma koruması.
*
* Edge Function instance'ı belleğinde tutulur.
* Production'da daha güçlü rate-limit için
* ayrıca CAPTCHA / harici rate-limit kullanılabilir.
*/
const requestMap = new Map<string, number>();

const RATE_LIMIT_MS = 60_000;

function json(
body: unknown,
status = 200
) {
return new Response(
JSON.stringify(body),
{
status,
headers: corsHeaders,
}
);
}

function getSecretKey(): string {
/*
* Yeni Supabase API key sistemi:
* SUPABASE_SECRET_KEYS
*
* Eski sistem:
* SUPABASE_SERVICE_ROLE_KEY
*/
try {
const raw =
Deno.env.get(
'SUPABASE_SECRET_KEYS'
);

if(raw){
const parsed =
JSON.parse(raw);

if(
parsed &&
typeof parsed === 'object'
){
const key =
parsed.default;

if(
typeof key === 'string' &&
key.length > 0
){
return key;
}

const first =
Object.values(parsed)
.find(
value =>
typeof value === 'string'
);

if(
typeof first === 'string'
){
return first;
}
}
}
}catch{
// Eski anahtar sistemine geç
}

return (
Deno.env.get(
'SUPABASE_SERVICE_ROLE_KEY'
) || ''
);
}

function getPublishableKey(): string {
try {
const raw =
Deno.env.get(
'SUPABASE_PUBLISHABLE_KEYS'
);

if(raw){
const parsed =
JSON.parse(raw);

if(
parsed &&
typeof parsed === 'object'
){
const key =
parsed.default;

if(
typeof key === 'string' &&
key.length > 0
){
return key;
}

const first =
Object.values(parsed)
.find(
value =>
typeof value === 'string'
);

if(
typeof first === 'string'
){
return first;
}
}
}
}catch{
// Eski anahtar sistemine geç
}

return (
Deno.env.get(
'SUPABASE_ANON_KEY'
) || ''
);
}

function normalizeEmail(
value: unknown
): string {
return typeof value === 'string'
? value.trim().toLowerCase()
: '';
}

function isValidEmail(
email: string
): boolean {
return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
.test(email);
}

function getClientIdentifier(
req: Request,
email: string
): string {
/*
* Önce proxy'nin gönderdiği IP'yi kullan.
* IP yoksa e-postayı yedek anahtar yap.
*/
const forwarded =
req.headers.get(
'x-forwarded-for'
);

const ip =
forwarded
?.split(',')[0]
?.trim();

return (
ip || email
);
}

async function findUserByEmail(
admin: ReturnType<typeof createClient>,
email: string
) {
/*
* Auth Admin API kullanıcı listesini sayfalı
* olarak döndürür. Kullanıcı sayısı büyürse
* sayfaları dolaşıyoruz.
*/
const perPage = 1000;
let page = 1;

while(page <= 20){
const {
data,
error
} =
await admin.auth.admin.listUsers({
page,
perPage,
});

if(error){
throw error;
}

const users =
data?.users || [];

const found =
users.find(
user =>
String(
user.email || ''
)
.trim()
.toLowerCase() === email
);

if(found){
return found;
}

if(
users.length < perPage
){
break;
}

page++;
}

return null;
}

Deno.serve(
async req => {

/*
* Tarayıcı CORS preflight isteği.
*/
if(
req.method === 'OPTIONS'
){
return new Response(
'ok',
{
status: 200,
headers: corsHeaders,
}
);
}

if(
req.method !== 'POST'
){
return json(
{
ok: false,
error:
'Bu işlem için POST isteği gereklidir.'
},
405
);
}

try{
const body =
await req.json();

const email =
normalizeEmail(
body?.email
);

if(
!isValidEmail(email)
){
return json(
{
ok: false,
error:
'Lütfen geçerli bir Gmail veya e-posta adresi gir.'
},
400
);
}

/*
* 60 saniyelik tekrar gönderme sınırı.
*/
const rateKey =
getClientIdentifier(
req,
email
);

const now =
Date.now();

const lastRequest =
requestMap.get(
rateKey
) || 0;

const remaining =
RATE_LIMIT_MS -
(
now -
lastRequest
);

if(
remaining > 0
){
const seconds =
Math.ceil(
remaining / 1000
);

return json(
{
ok: false,
error:
`Yeni kod istemeden önce ${seconds} saniye beklemelisin.`,
retryAfter:
seconds,
},
429
);
}

/*
* Supabase bilgileri.
*/
const supabaseUrl =
Deno.env.get(
'SUPABASE_URL'
);

const secretKey =
getSecretKey();

const publishableKey =
getPublishableKey();

if(
!supabaseUrl ||
!secretKey ||
!publishableKey
){
console.error(
'[Atlantis MC] Supabase yapılandırması eksik.'
);

return json(
{
ok: false,
error:
'Atlantis MC hesap sistemi şu anda kullanılamıyor.'
},
500
);
}

/*
* Admin client sadece Edge Function
* üzerinde çalışır.
*
* Secret key kesinlikle frontend'e
* gönderilmez.
*/
const admin =
createClient(
supabaseUrl,
secretKey,
{
auth: {
autoRefreshToken:
false,
persistSession:
false,
},
}
);

/*
* Public client recovery e-postasını
* Supabase Auth üzerinden göndermek için.
*/
const publicClient =
createClient(
supabaseUrl,
publishableKey,
{
auth: {
autoRefreshToken:
false,
persistSession:
false,
},
}
);

/*
* Hesabı bul.
*/
const user =
await findUserByEmail(
admin,
email
);

if(!user){
/*
* Kullanıcı bulunamadığında hiçbir
* e-posta gönderilmez.
*/
return json(
{
ok: false,
error:
'Bu e-posta adresiyle kayıtlı bir Atlantis MC hesabı bulunamadı.'
},
404
);
}

/*
* E-posta doğrulanmamış hesapların da
* recovery kullanmasına izin vermiyoruz.
*/
if(
!user.email_confirmed_at
){
return json(
{
ok: false,
error:
'Bu hesabın e-posta adresi henüz doğrulanmamış.'
},
403
);
}

/*
* Supabase recovery OTP isteği.
*
* E-posta şablonunda:
*
* {{ .Token }}
*
* kullanılırsa kullanıcıya 6 haneli kod
* gönderilebilir.
*/
const {
error: resetError
} =
await publicClient.auth
.resetPasswordForEmail(
email,
{
redirectTo:
(
Deno.env.get(
'ATLANTIS_SITE_URL'
) ||
'https://mcatlantismc-oss.github.io/Atlantis/'
),
}
);

if(resetError){
console.error(
'[Atlantis MC] Recovery mail error:',
resetError
);

return json(
{
ok: false,
error:
'Doğrulama kodu gönderilemedi. Birkaç dakika sonra tekrar dene.'
},
500
);
}

/*
* Başarılı istekten sonra 60 saniye
* boyunca tekrar gönderme.
*/
requestMap.set(
rateKey,
now
);

console.log(
`[Atlantis MC] Recovery OTP requested for ${email}`
);

return json(
{
ok: true,
message:
'6 haneli doğrulama kodun e-posta adresine gönderildi.',
email,
cooldown:
60,
},
200
);

}catch(error){

console.error(
'[Atlantis MC] request-password-reset:',
error
);

return json(
{
ok: false,
error:
'İşlem sırasında beklenmeyen bir hata oluştu. Lütfen tekrar dene.'
},
500
);
}
}
);
  
