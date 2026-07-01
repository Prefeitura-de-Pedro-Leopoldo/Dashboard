// Edge Function: login (entry). Equivalente ao POST /api/login da Vercel.
// A lógica está em handler.ts (testável); aqui só ligamos o getUser real via
// supabase-js (SERVICE_ROLE ignora RLS, como o dono do banco na Vercel).
//
// Deploy:
//   supabase functions deploy login --project-ref gbtbkviprqnblgdwkaxk --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleLogin, type AppUser, type GetUser } from "./handler.ts";

function realGetUser(): GetUser {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  return async (email: string): Promise<AppUser | null> => {
    const { data, error } = await supabase
      .from("app_users")
      .select("email, name, password_hash, role, active, must_change_password, evento_id")
      .ilike("email", email)
      .limit(1);
    if (error) throw error; // vira 503 no handler
    return (data && (data[0] as AppUser)) || null;
  };
}

const getUser = realGetUser();
Deno.serve((req) => handleLogin(req, { getUser }));
