import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

type PushBody = {
  title?: string;
  body?: string;
  category?: 'announcements' | 'sermons' | 'articles' | 'chat' | 'prayer' | 'all' | 'media';
  data?: Record<string, unknown>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Server is not configured.' }, 500);

  const authHeader = req.headers.get('Authorization') || '';
  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceKey);

  const { data: userResult, error: userError } = await authedClient.auth.getUser();
  const user = userResult.user;
  if (userError || !user) return json({ error: 'Authentication required.' }, 401);

  const { data: roles } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);
  const allowed = new Set(['admin', 'super_admin', 'staff', 'leader', 'media_admin', 'moderator']);
  if (!roles?.some((row) => allowed.has(String(row.role)))) {
    return json({ error: 'Admin, staff, leader, media admin, or moderator role required.' }, 403);
  }

  const input = await req.json().catch(() => ({})) as PushBody;
  const title = input.title?.trim();
  const message = input.body?.trim();
  const category = normalizeCategory(input.category);
  if (!title || !message) return json({ error: 'Title and body are required.' }, 400);

  const { data: tokens, error: tokenError } = await serviceClient
    .from('push_tokens')
    .select('token,user_id')
    .order('updated_at', { ascending: false });
  if (tokenError) return json({ error: tokenError.message }, 500);

  const userIds = [...new Set((tokens || []).map((row) => row.user_id).filter(Boolean))];
  const { data: prefs } = userIds.length
    ? await serviceClient
      .from('notification_preferences')
      .select('user_id,announcements,sermons,articles,chat,prayer')
      .in('user_id', userIds)
    : { data: [] };
  const prefsByUser = new Map((prefs || []).map((row) => [row.user_id, row]));

  const messages = (tokens || [])
    .filter((row) => shouldReceive(category, prefsByUser.get(row.user_id)))
    .map((row) => ({
      to: row.token,
      title,
      body: message,
      sound: 'default',
      channelId: 'ogn-updates',
      data: { ...(input.data || {}), category },
    }));

  const tickets = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });
    tickets.push(await response.json());
  }

  return json({ sent: messages.length, tickets });
});

function normalizeCategory(category: PushBody['category']) {
  if (category === 'media') return 'sermons';
  return category || 'announcements';
}

function shouldReceive(category: NonNullable<PushBody['category']>, prefs?: Record<string, unknown>) {
  if (category === 'all') return true;
  if (!prefs) return true;
  return prefs[category] !== false;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
