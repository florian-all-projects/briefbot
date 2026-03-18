// ══════════════════════════════════════
// Outils IA — Fetch URL, SERP, Haloscan
// ══════════════════════════════════════

// Définitions des outils pour l'API Anthropic (tool use)
export const TOOLS = [
  {
    name: "fetch_url",
    description: "Récupère et analyse le contenu d'une page web (titre, meta, headings, texte). Utilise cet outil quand l'utilisateur mentionne une URL, quand tu veux analyser un site concurrent, ou quand tu as besoin de vérifier le contenu d'une page.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "L'URL complète de la page à analyser (ex: https://example.com)"
        }
      },
      required: ["url"]
    }
  },
  {
    name: "search_google",
    description: "Effectue une recherche Google (SERP) et retourne les résultats organiques, les questions fréquentes et les recherches associées. Utilise cet outil pour analyser la concurrence SEO, vérifier le positionnement sur des mots-clés, ou comprendre ce que les internautes trouvent quand ils cherchent un service/produit.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "La requête de recherche Google"
        },
        num_results: {
          type: "number",
          description: "Nombre de résultats souhaités (max 10, défaut 10)"
        },
        country: {
          type: "string",
          description: "Code pays pour localiser les résultats (ex: 'fr', 'be', 'ch'). Défaut: 'fr'"
        }
      },
      required: ["query"]
    }
  },
];

// ══════════════════════════════════════
// Exécution des outils
// ══════════════════════════════════════

async function fetchUrl(url) {
  try {
    // Valider l'URL
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { error: 'Seuls les protocoles HTTP et HTTPS sont supportés', url };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BriefBot/1.0; +https://briefbot.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { error: `Erreur HTTP ${response.status} pour ${url}`, url };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { error: `Type de contenu non supporté: ${contentType}`, url };
    }

    const html = await response.text();

    // Extraire les métadonnées
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)?.[1]?.trim()
      || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i)?.[1]?.trim()
      || '';
    const metaKeywords = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([\s\S]*?)["']/i)?.[1]?.trim() || '';
    const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([\s\S]*?)["']/i)?.[1]?.trim() || '';
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([\s\S]*?)["']/i)?.[1]?.trim() || '';
    const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([\s\S]*?)["']/i)?.[1]?.trim() || '';

    // Extraire les headings
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 5);
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 15);
    const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)]
      .map(m => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 15);

    // Extraire les liens internes et externes
    const links = [...html.matchAll(/<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => ({ url: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }))
      .filter(l => l.text)
      .slice(0, 20);

    // Nettoyer le HTML pour extraire le texte principal
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // Limiter la taille du texte
    if (text.length > 6000) {
      text = text.substring(0, 6000) + '... [contenu tronqué]';
    }

    return {
      url,
      title,
      meta_description: metaDesc,
      meta_keywords: metaKeywords,
      og: { title: ogTitle, description: ogDesc },
      canonical,
      headings: { h1: h1s, h2: h2s, h3: h3s },
      links_sample: links,
      content_text: text,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { error: `Timeout : la page ${url} a mis trop de temps à répondre`, url };
    }
    return { error: `Impossible de charger ${url} : ${err.message}`, url };
  }
}

async function searchGoogle(query, numResults = 10, country = 'fr') {
  const apiKey = process.env.SERP_API_KEY;

  if (!apiKey) {
    return {
      error: 'API SERP non configurée. Impossible de consulter les résultats Google.',
      suggestion: 'Pour activer la recherche SERP, ajoutez SERP_API_KEY (SerpAPI) dans les variables d\'environnement Vercel.',
      query,
    };
  }

  try {
    const params = new URLSearchParams({
      q: query,
      gl: country,
      hl: 'fr',
      num: String(Math.min(numResults || 10, 10)),
      api_key: apiKey,
    });

    const response = await fetch(`https://serpapi.com/search.json?${params}`);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { error: `Erreur API SerpAPI (${response.status}): ${errText}`, query };
    }

    const data = await response.json();

    return {
      query,
      country,
      total_results: data.search_information?.total_results,
      search_time: data.search_information?.time_taken_displayed,
      organic_results: (data.organic_results || []).slice(0, numResults).map(r => ({
        position: r.position,
        title: r.title,
        url: r.link,
        domain: r.displayed_link,
        snippet: r.snippet,
      })),
      featured_snippet: data.answer_box ? {
        title: data.answer_box.title,
        answer: data.answer_box.answer || data.answer_box.snippet,
        source: data.answer_box.link,
      } : null,
      people_also_ask: (data.related_questions || []).slice(0, 5).map(q => q.question),
      related_searches: (data.related_searches || []).slice(0, 8).map(s => s.query),
      local_results: (data.local_results?.places || []).slice(0, 5).map(p => ({
        name: p.title,
        rating: p.rating,
        reviews: p.reviews,
        type: p.type,
      })),
    };
  } catch (err) {
    return { error: `Erreur recherche Google : ${err.message}`, query };
  }
}

async function haloscanAnalyze(url, analysisType = 'overview') {
  const apiKey = process.env.HALOSCAN_API_KEY;

  if (!apiKey) {
    return {
      error: 'API Haloscan non configurée. Impossible d\'effectuer l\'analyse SEO.',
      suggestion: 'Pour activer Haloscan, ajoutez HALOSCAN_API_KEY dans les variables d\'environnement Vercel.',
      url,
    };
  }

  try {
    const baseUrl = 'https://api.haloscan.com/api';

    // Nettoyer le domaine
    const domain = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

    // Endpoints réels de l'API Haloscan
    const endpoints = {
      overview: '/domains/overview',
      keywords: '/domains/positions',
      backlinks: '/domains/gmbBacklinks',
      pages: '/domains/topPages',
      competitors: '/domains/siteCompetitors',
    };

    const endpoint = endpoints[analysisType] || endpoints.overview;

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'haloscan-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ url: domain }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        error: `Erreur API Haloscan (${response.status}): ${errText || 'Erreur inconnue'}`,
        domain,
        analysis_type: analysisType,
      };
    }

    const data = await response.json();

    return {
      domain,
      analysis_type: analysisType,
      data,
    };
  } catch (err) {
    return {
      error: `Erreur Haloscan : ${err.message}`,
      url,
      analysis_type: analysisType,
    };
  }
}

// Fonctions Haloscan supplémentaires pour analyses enrichies

export async function haloscanKeywordsOverview(keyword, country = 'FR') {
  const apiKey = process.env.HALOSCAN_API_KEY;
  if (!apiKey) return { error: 'HALOSCAN_API_KEY manquante' };

  try {
    const response = await fetch('https://api.haloscan.com/api/keywords/overview', {
      method: 'POST',
      headers: {
        'haloscan-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keyword, country }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { error: `Erreur Haloscan keywords (${response.status}): ${errText}` };
    }

    return await response.json();
  } catch (err) {
    return { error: `Erreur Haloscan keywords : ${err.message}` };
  }
}

export async function haloscanSiteCompetitors(domain) {
  const apiKey = process.env.HALOSCAN_API_KEY;
  if (!apiKey) return { error: 'HALOSCAN_API_KEY manquante' };

  try {
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const response = await fetch('https://api.haloscan.com/api/domains/siteCompetitors', {
      method: 'POST',
      headers: {
        'haloscan-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: cleanDomain }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { error: `Erreur Haloscan competitors (${response.status}): ${errText}` };
    }

    return await response.json();
  } catch (err) {
    return { error: `Erreur Haloscan competitors : ${err.message}` };
  }
}

// ─── Dispatcher ───

export async function executeTool(name, input) {
  switch (name) {
    case 'fetch_url':
      return await fetchUrl(input.url);
    case 'search_google':
      return await searchGoogle(input.query, input.num_results, input.country);
    default:
      return { error: `Outil inconnu : ${name}` };
  }
}
