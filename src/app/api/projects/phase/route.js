import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export async function POST(request) {
  const { projectId, phaseId, action } = await request.json();

  if (!projectId || phaseId === undefined) {
    return NextResponse.json({ error: 'projectId et phaseId requis' }, { status: 400 });
  }

  const sb = getServiceSupabase();

  // Action "complete" : marquer une phase comme complétée manuellement
  if (action === 'complete') {
    const { data: project } = await sb
      .from('projects')
      .select('phases_completed')
      .eq('id', projectId)
      .single();

    const currentPhases = project?.phases_completed || [];
    if (!currentPhases.includes(phaseId)) {
      currentPhases.push(phaseId);
    }

    const { error } = await sb
      .from('projects')
      .update({ phases_completed: currentPhases })
      .eq('id', projectId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, phases_completed: currentPhases });
  }

  // Action "uncomplete" : retirer la complétion d'une phase
  if (action === 'uncomplete') {
    const { data: project } = await sb
      .from('projects')
      .select('phases_completed')
      .eq('id', projectId)
      .single();

    const currentPhases = (project?.phases_completed || []).filter(id => id !== phaseId);

    const { error } = await sb
      .from('projects')
      .update({ phases_completed: currentPhases })
      .eq('id', projectId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, phases_completed: currentPhases });
  }

  // Action par défaut : changer la phase courante
  const { error } = await sb
    .from('projects')
    .update({ current_phase: phaseId })
    .eq('id', projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
