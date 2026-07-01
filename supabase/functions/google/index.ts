// Edge Function: google (entry). Equivalente ao POST /api/auth/google.
// clientId público embutido (env sobrepõe); tokeninfo do Google + allowlist.
//   supabase functions deploy google --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleGoogle } from "./handler.ts";
import type { GoogleClaims } from "../_shared/google.ts";
import type { AppUser } from "../login/handler.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ||
  "237676994992-pohe63acdm9bb7idbmtvslpmbhf4hlkr.apps.googleusercontent.com";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const getUser = async (email: string): Promise<AppUser | null> => {
  const { data, error } = await supabase
    .from("app_users")
    .select("email, name, password_hash, role, active, must_change_password, evento_id")
    .ilike("email", email)
    .limit(1);
  if (error) throw error;
  return (data && (data[0] as AppUser)) || null;
};

async function fetchTokenInfo(idToken: string): Promise<GoogleClaims | null> {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!r.ok) return null;
  return await r.json();
}

Deno.serve((req) => handleGoogle(req, { clientId: CLIENT_ID, fetchTokenInfo, getUser }));
