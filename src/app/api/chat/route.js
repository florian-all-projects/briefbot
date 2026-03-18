import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceSupabase } from '@/lib/supabase';
import { buildSystemPrompt } from '@/lib/phases';
import { TOOLS, executeTool } from '@/lib/tools';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Pricing Claude Sonnet en micro-dollars par token
// $3/M input = 3 µ$/token, $15/M output = 15 µ$/token
const INPUT_COST_MICRO = 3;
const OUTPUT_COST_MICRO = 15;

export async function POST(request) {
  try {
    const { projectId, message, mode } = await request.json();

    if (!projectId || !message) {
      return NextResponse.json({ error: 'projectId et message requis' }, { status: 400 });
    }

    const sb = getServiceSupabase();

    const { data: project, error: projErr } = await sb
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (projErr || !project) {
      return NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 });
    }

    // Vérifier le budget (nouveau système en micro-dollars)
    const currentCost = project.cost_micro_usd || 0;
    const budget = project.budget_micro_usd || 5000000; // $5 par défaut
    if (currentCost >= budget) {
      return NextResponse.json({
        error: 'Budget atteint pour ce projet.',
        limit_reached: true,
        cost_usd: currentCost / 1000000,
        budget_usd: budget / 1000000,
      }, { status: 429 });
    }

    // Sauvegarder le message utilisateur
    await sb.from('messages').insert({
      project_id: projectId,
      role: 'user',
      content: message,
      mode: mode || 'client',
    });

    // Récupérer l'historique
    const { data: history } = await sb
      .from('messages')
      .select('role, content')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    const apiMessages = (history || []).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const systemPrompt = buildSystemPrompt(project, mode || 'client');

    // ── Boucle tool use ──
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let loopMessages = [...apiMessages];
    let maxIterations = 5;

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: loopMessages,
      tools: TOOLS,
    });

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
      iterations++;

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        console.log(`[Tool Use] ${toolUse.name}(${JSON.stringify(toolUse.input)})`);
        const result = await executeTool(toolUse.name, toolUse.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result).substring(0, 15000),
        });
      }

      loopMessages.push({ role: 'assistant', content: response.content });
      loopMessages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        messages: loopMessages,
        tools: TOOLS,
      });

      totalInputTokens += response.usage?.input_tokens || 0;
      totalOutputTokens += response.usage?.output_tokens || 0;
    }

    // Extraire le texte final
    const aiText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Calculer le coût réel en micro-dollars
    const costMicro = totalInputTokens * INPUT_COST_MICRO + totalOutputTokens * OUTPUT_COST_MICRO;
    const totalTokens = totalInputTokens + totalOutputTokens;

    // Incrémenter le coût réel
    const { data: newCostMicro, error: costRpcErr } = await sb.rpc('increment_project_cost', {
      project_id: projectId,
      amount: costMicro,
    });

    // Incrémenter aussi les tokens (pour info/référence)
    await sb.rpc('increment_project_tokens', {
      project_id: projectId,
      amount: totalTokens,
    });

    const actualCostMicro = costRpcErr ? currentCost + costMicro : newCostMicro;

    // Sauvegarder la réponse finale
    await sb.from('messages').insert({
      project_id: projectId,
      role: 'assistant',
      content: aiText,
      mode: mode || 'client',
    });

    // Détecter la complétion de phase
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

    return NextResponse.json({
      content: aiText,
      // Nouveau système de coût
      cost_usd: actualCostMicro / 1000000,
      budget_usd: budget / 1000000,
      cost_this_message_usd: costMicro / 1000000,
      // Ancien système (rétrocompatibilité)
      tokens_used: totalTokens,
      tokens_this_message: totalTokens,
      tokens_input: totalInputTokens,
      tokens_output: totalOutputTokens,
      tools_used: iterations > 0,
    });
  } catch (err) {
    console.error('Chat API error:', err);
    return NextResponse.json(
      { error: 'Erreur serveur : ' + (err.message || 'Inconnue') },
      { status: 500 }
    );
  }
}
