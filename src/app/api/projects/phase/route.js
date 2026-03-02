import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export async function POST(request) {
  const { projectId, phaseId } = await request.json();

  if (!projectId || !phaseId) {
    return NextResponse.json({ error: 'projectId et phaseId requis' }, { status: 400 });
  }

  const sb = getServiceSupabase();
  const { error } = await sb
    .from('projects')
    .update({ current_phase: phaseId })
    .eq('id', projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
