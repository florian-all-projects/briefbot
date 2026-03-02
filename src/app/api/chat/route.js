import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceSupabase } from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/phases';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request) {
  try {
    const { projectId, message, mode } = await request.json();

    if (!projectId || !message) {
      return NextResponse.json({ error: 'projectId et message requis' }, { status: 400 });
    }

    const sb = getServiceSupabase();

    // Récupérer le projet
    const { data: project, error: projErr } = await sb
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 });
    }

    // Sauvegarder le message de l'utilisateur
    await sb.from('messages').insert({
      project_id: projectId,
      role: 'user',
      content: message,
      mode: mode || 'client',
    });

    // Récupérer l'historique des messages
    const { data: history } = await sb
      .from('messages')
      .select('role, content')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    // Construire les messages pour l'API
    const apiMessages = (history || []).map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Appeler Claude
    const systemPrompt = buildSystemPrompt(project, mode || 'client');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      system: systemPrompt,
      messages: apiMessages,
    });

    const aiText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Sauvegarder la réponse de l'IA
    await sb.from('messages').insert({
      project_id: projectId,
      role: 'assistant',
      content: aiText,
      mode: mode || 'client',
    });

    // Détecter la complétion d'une phase
    const phaseMatch = aiText.match(/✅\s*Phase\s*(\d+)/);
    if (phaseMatch) {
      const completedId = parseInt(phaseMatch[1]);
      const currentPhases = project.phases_completed || [];
      if (!currentPhases.includes(completedId)) {
        await sb
          .from('projects')
          .update({
            phases_completed: [...currentPhases, completedId],
            current_phase: Math.min(completedId + 1, 10),
          })
          .eq('id', projectId);
      }
    }

    return NextResponse.json({ content: aiText });
  } catch (err) {
    console.error('Chat API error:', err);
    return NextResponse.json(
      { error: 'Erreur serveur : ' + (err.message || 'Inconnue') },
      { status: 500 }
    );
  }
}
