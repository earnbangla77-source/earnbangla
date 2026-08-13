// functions/api/auth/me.js
import { getUserFromRequest, publicUser, json, errorJson } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const db = env.DB;
  const user = await getUserFromRequest(request, db);

  if (!user) {
    return errorJson("Not signed in.", 401);
  }

  return json({ user: publicUser(user) });
}
