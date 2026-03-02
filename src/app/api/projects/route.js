import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

// GET — Liste tous les projets (dashboard consultant)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('pw');

  // Protection simple du dashboard
  if (password !== process.env.CONSULTANT_PASSWORD) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('projects')
    .select('id, name, client_name, url, current_phase, phases_completed, share_token, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects: data });
}

// POST — Créer un nouveau projet
export async function POST(request) {
  const { name, client_name, url, context, password } = await request.json();

  if (password !== process.env.CONSULTANT_PASSWORD) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  if (!name || !client_name) {
    return NextResponse.json({ error: 'name et client_name requis' }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('projects')
    .insert({ name, client_name, url: url || '', context: context || '' })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data });
}

// DELETE — Supprimer un projet
export async function DELETE(request) {
  const { projectId, password } = await request.json();

  if (password !== process.env.CONSULTANT_PASSWORD) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const sb = getServiceSupabase();
  const { error } = await sb.from('projects').delete().eq('id', projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
