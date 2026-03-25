import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServiceSupabase } from '@/lib/supabase';

export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function callWithRetry(params, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      if (err.status === 429 && i < maxRetries - 1) {
        const wait = Math.pow(2, i) * 2000 + Math.random() * 500;
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

// Tronquer la conversation pour rester sous les limites
function truncateConversation(messages) {
  let text = messages
    .map(m => `${m.role === "user" ? (m.mode === "consultant" ? "CONSULTANT" : "CLIENT") : "BRIEFBOT"}: ${m.content}`)
    .join("\n\n");

  const MAX = 40000;
  if (text.length > MAX) {
    const keepStart = Math.floor(MAX * 0.4);
    const keepEnd = Math.floor(MAX * 0.5);
    text = text.substring(0, keepStart)
      + `\n\n[... contenu intermédiaire omis ...]\n\n`
      + text.substring(text.length - keepEnd);
  }
  return text;
}

// Base du prompt partagé par toutes les sections
function sectionPrompt(sectionInstruction, project, conv, summaries) {
  return `Tu es un expert en rédaction de briefs stratégiques. Génère en HTML la section suivante du document de briefing.

GÉNÈRE UNIQUEMENT cette section (HTML pur, pas de balises html/head/body) :
${sectionInstruction}

RÈGLES :
- Sois EXHAUSTIF. Reprends CHAQUE info, chiffre, nom.
- Cite le client entre guillemets quand pertinent.
- Français uniquement.
- Utilise h1, h2, h3, p, table, ul, blockquote, strong.
- IMPORTANT : Génère UNIQUEMENT du HTML brut. PAS de blocs markdown (\`\`\`html ou \`\`\`). PAS de commentaires. Commence directement par la première balise HTML.
- Assure-toi que TOUTES les balises HTML sont correctement fermées (notamment </table>, </tr>, </td>). Un tableau non fermé casserait tout le reste du document.
- Si la section n'a pas été abordée : "⚠️ Section non abordée — À compléter".
${summaries}
${project.context ? `\nContexte initial :\n${project.context.substring(0, 8000)}\n` : ""}
Conversation :
${conv}`;
}

// 10 sections du document — une génération par section puis assemblage
const SECTIONS = [
  {
    id: 'intro',
    label: 'Page de garde & Résumé',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Page de garde</h1> — nom du projet "${project.name}", client "${project.client_name}", date "${new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}", URL "${project.url || 'Non renseigné'}"
<h1>Résumé exécutif</h1> — 1 paragraphe dense synthétisant tout le projet (enjeux, objectifs, recommandations clés)`,
      project, conv, summaries),
  },
  {
    id: 'profil',
    label: 'Profil & Identité',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Profil de l'interlocuteur</h1> — métier, rôle, niveau digital/SEO/UX, connaissances techniques
<h1>Identité & Vision</h1> — histoire de l'entreprise, mission, valeurs, vision à moyen terme, proposition de valeur unique. TOUS les détails.`,
      project, conv, summaries),
  },
  {
    id: 'offre',
    label: 'Offre & Services',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Offre & Services</h1> — liste EXHAUSTIVE de tous les services/produits avec tableau structuré. Pour chacun : description, tarif si mentionné, catégorie, niveau de demande, rentabilité, saisonnalité.`,
      project, conv, summaries),
  },
  {
    id: 'cibles',
    label: 'Cibles & Personas',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Cibles & Personas</h1> — fiches personas détaillées. Pour CHAQUE segment : profil (âge, CSP, situation), motivations, freins, parcours d'achat, déclencheurs, part de CA estimée, messages clés à adresser.`,
      project, conv, summaries),
  },
  {
    id: 'concurrence',
    label: 'Concurrence & Mots-clés',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Concurrence & Mots-clés</h1> — TOUS les concurrents mentionnés (noms, URLs, forces/faiblesses), TOUS les mots-clés et expressions, zone géographique ciblée, résultats SERP si analysés, intentions de recherche identifiées, comment les clients trouvent actuellement l'entreprise.`,
      project, conv, summaries),
  },
  {
    id: 'swot',
    label: 'SWOT & Tonalité',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Analyse SWOT</h1> — tableau 2×2 complet (forces, faiblesses, opportunités, menaces) avec CHAQUE point identifié dans la conversation.
<h1>Tonalité & Univers de marque</h1> — personnalité de marque, registre de langue, adjectifs, couleurs souhaitées, ambiances, marques d'inspiration, éléments visuels existants (logo, charte).`,
      project, conv, summaries),
  },
  {
    id: 'ux',
    label: 'Parcours UX',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Parcours utilisateur & UX</h1> — pour chaque persona : parcours idéal sur le site, actions prioritaires (CTA), fonctionnalités indispensables, structure de page, irritants actuels, navigation souhaitée. Si une analyse du site actuel a été faite, inclure les observations.`,
      project, conv, summaries),
  },
  {
    id: 'objectifs',
    label: 'Objectifs & SEO',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Objectifs business & SEO</h1> — objectifs chiffrés (6 mois, 1 an), KPIs à tracker, budget marketing/digital, canaux d'acquisition actuels et souhaités, mots-clés stratégiques, objectifs SEO spécifiques, stack technique. CHAQUE chiffre mentionné doit apparaître.`,
      project, conv, summaries),
  },
  {
    id: 'contenus',
    label: 'Contenus & Contraintes',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Contenus & Storytelling</h1> — histoires marquantes, témoignages, cas d'usage, contenu existant réutilisable, stratégie éditoriale, blog/articles prévus, fréquence de publication.
<h1>Éléments existants & Contraintes</h1> — site actuel (ce qui marche/marche pas), CMS, hébergement, intégrations, outils tiers, budget et délais pour la refonte.`,
      project, conv, summaries),
  },
  {
    id: 'recommandations',
    label: 'Recommandations & Prochaines étapes',
    prompt: (project, conv, summaries) => sectionPrompt(
      `<h1>Données SEO complémentaires</h1> — données SERP et analyses de sites collectées pendant le briefing, structurées en tableaux.
<h1>Recommandations stratégiques</h1> — recommandations concrètes et actionnables classées par priorité. Chaque recommandation justifiée par un élément du briefing.
<h1>Prochaines étapes</h1> — roadmap suggérée avec étapes concrètes, livrables attendus et timeline indicative.`,
      project, conv, summaries),
  },
];

// GET : lister les exports d'un projet ou re-télécharger un export
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const exportId = searchParams.get('exportId');
    const password = searchParams.get('pw');
    const format = searchParams.get('format') || 'doc';

    if (password !== process.env.CONSULTANT_PASSWORD) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    const sb = getServiceSupabase();

    // Re-télécharger un export spécifique
    if (exportId) {
      const { data: exp } = await sb
        .from('exports')
        .select('*, projects(client_name)')
        .eq('id', exportId)
        .single();

      if (!exp) {
        return NextResponse.json({ error: 'Export non trouvé' }, { status: 404 });
      }

      return buildDocResponse(exp.html_content, { client_name: exp.projects.client_name }, format);
    }

    // Lister les exports d'un projet
    if (projectId) {
      const { data: exports } = await sb
        .from('exports')
        .select('id, format, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      return NextResponse.json({ exports: exports || [] });
    }

    return NextResponse.json({ error: 'projectId ou exportId requis' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { projectId, password, format = 'doc', part, action, htmlContent } = await request.json();

    // ── Action save : sauvegarder un export assemblé ──
    if (action === 'save' && htmlContent) {
      if (password !== process.env.CONSULTANT_PASSWORD) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
      }
      const sb = getServiceSupabase();
      const { data, error } = await sb
        .from('exports')
        .insert({ project_id: projectId, format, html_content: htmlContent })
        .select('id, created_at')
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ saved: true, export_id: data.id, created_at: data.created_at });
    }

    if (!projectId) {
      return NextResponse.json({ error: 'projectId requis' }, { status: 400 });
    }

    if (password !== process.env.CONSULTANT_PASSWORD) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    const sb = getServiceSupabase();

    const { data: project } = await sb
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Projet non trouvé' }, { status: 404 });
    }

    const currentCost = project.cost_micro_usd || 0;
    const budget = project.budget_micro_usd || 5000000;
    if (currentCost >= budget) {
      return NextResponse.json({
        error: 'Budget atteint pour ce projet.',
        limit_reached: true,
      }, { status: 429 });
    }

    const { data: messages } = await sb
      .from('messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (!messages || messages.length < 2) {
      return NextResponse.json({ error: 'Pas assez de messages pour générer un export' }, { status: 400 });
    }

    const conversationText = truncateConversation(messages);

    // Construire le bloc des résumés de phases pour l'export
    const summaries = project.phase_summaries || {};
    const summaryBlock = Object.keys(summaries).length > 0
      ? '\n\nRÉSUMÉS DES PHASES (source fiable — prioritaire sur la conversation) :\n' +
        Object.keys(summaries).sort((a, b) => Number(a) - Number(b)).map(phaseId => {
          return `## Phase ${phaseId}\n${summaries[phaseId]}`;
        }).join('\n\n')
      : '';

    // ── Mode multi-part : générer une seule section en streaming ──
    if (part !== undefined && part >= 0 && part < SECTIONS.length) {
      const section = SECTIONS[part];
      const prompt = section.prompt(project, conversationText, summaryBlock);

      const stream = anthropic.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      });

      const encoder = new TextEncoder();

      const readable = new ReadableStream({
        async start(controller) {
          try {
            // Envoyer les métadonnées en premier
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'meta', part, total_parts: SECTIONS.length, label: section.label })}\n\n`));

            // Streamer les chunks de texte
            stream.on('text', (text) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`));
            });

            // Attendre la fin du stream
            const finalMessage = await stream.finalMessage();

            // Calculer et enregistrer les coûts
            const inputTokens = finalMessage.usage?.input_tokens || 0;
            const outputTokens = finalMessage.usage?.output_tokens || 0;
            const cacheWrite = finalMessage.usage?.cache_creation_input_tokens || 0;
            const cacheRead = finalMessage.usage?.cache_read_input_tokens || 0;
            const costMicro = Math.round(inputTokens * 3 + cacheWrite * 3.75 + cacheRead * 0.30 + outputTokens * 15);

            await sb.rpc('increment_project_cost', { project_id: projectId, amount: costMicro });
            await sb.rpc('increment_project_tokens', { project_id: projectId, amount: inputTokens + outputTokens });

            // Envoyer le signal de fin
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // ── Mode legacy : assembler le doc final ──
    const { htmlParts, format: fmt } = await request.json().catch(() => ({}));

    // Si htmlParts est fourni, on assemble directement
    if (htmlParts && Array.isArray(htmlParts)) {
      const htmlContent = htmlParts.join('\n\n<hr style="border:none;border-top:2px solid #e2e8f0;margin:40px 0;">\n\n');
      return buildDocResponse(htmlContent, project, format);
    }

    return NextResponse.json({ error: 'Paramètre "part" requis (0 à 9)' }, { status: 400 });
  } catch (err) {
    console.error('Export API error:', err);

    if (err.status === 429) {
      return NextResponse.json(
        { error: 'L\'API Claude est temporairement surchargée. Réessayez dans quelques secondes.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Erreur export : ' + (err.message || 'Inconnue') },
      { status: 500 }
    );
  }
}

function buildDocResponse(htmlContent, project, format) {
  const styles = `
  body { font-family: Calibri, sans-serif; color: #1a1a1a; line-height: 1.7; padding: 50px; max-width: 800px; margin: 0 auto; }
  h1 { color: #1e3a5f; font-size: 28px; border-bottom: 3px solid #e8913a; padding-bottom: 10px; margin-top: 40px; }
  h2 { color: #2c5282; font-size: 22px; margin-top: 30px; }
  h3 { color: #4a6fa5; font-size: 18px; }
  table { border-collapse: collapse; width: 100%; margin: 15px 0; }
  th, td { border: 1px solid #cbd5e0; padding: 10px 14px; text-align: left; }
  th { background-color: #edf2f7; color: #2d3748; font-weight: 600; }
  tr:nth-child(even) { background-color: #f7fafc; }
  ul, ol { padding-left: 24px; }
  li { margin-bottom: 6px; }
  blockquote { border-left: 4px solid #e8913a; padding: 12px 16px; background: #fef7ed; margin: 16px 0; font-style: italic; }
  .badge { display: inline-block; background: #ebf4ff; color: #2b6cb0; padding: 2px 10px; border-radius: 12px; font-size: 13px; }
  .warning { background: #fef3c7; padding: 12px 16px; border-left: 4px solid #f59e0b; margin: 16px 0; border-radius: 4px; }`;

  const filename = `Brief_${project.client_name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`;

  if (format === 'pdf') {
    const pdfHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${filename}</title>
<style>
  @media print { @page { margin: 15mm; } }
  ${styles}
</style></head><body>${htmlContent}</body></html>`;
    return NextResponse.json({ html: pdfHtml, filename });
  }

  const fullDoc = `\ufeff<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><style>${styles}</style></head><body>${htmlContent}</body></html>`;

  return new NextResponse(fullDoc, {
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.doc"`,
    },
  });
}
