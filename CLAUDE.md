# CLAUDE.md — BriefBot

> Fichier de contexte pour Claude Code. Maintenu a jour apres chaque tache significative.

---

## [CORE] Contexte

**Projet** : BriefBot — outil SaaS de briefing client automatise par IA pour consultants SEO / web.
L'IA guide les clients a travers 10 phases de briefing structure (identite, offre, personas, concurrence, SWOT, UX, SEO, contenus, contraintes). Chaque projet genere un document strategique exporte en `.doc`.

**Mode d'usage** :
- Consultant (Florian) cree un projet dans le dashboard, genere un lien partageable
- Client ouvre le lien, discute avec l'IA en autonomie phase par phase
- Consultant peut reprendre la conversation a tout moment (mode avance)
- Export `.doc` structure en 10 sections generees une par une (pour eviter les coupures)

**Aucun NDD** ne pointe pour l'instant vers le deploiement Vercel — acces via l'URL `*.vercel.app`.

---

## [CORE] Stack

| Couche | Techno | Role |
|---|---|---|
| Framework | Next.js 14 (App Router) | Front + API routes |
| UI | React 18 + Tailwind CSS 3 | Dashboard + chat |
| Base de donnees | Supabase (Postgres) | Projets, conversations, messages, exports |
| IA | Anthropic API (Claude Sonnet) | Chat de briefing + generation export |
| Hebergement | **Vercel** (Hobby tier) | Auto-deploy sur push `main` |
| CI/CD | GitHub -> Vercel integration native | Pas de webhook custom |

**Dependencies cles** :
- `@anthropic-ai/sdk` ^0.39.0
- `@supabase/supabase-js` ^2.47.0
- `next` ^14.2.0

---

## [CORE] Etat

- Repo GitHub : `florian-all-projects/briefbot` (post-transfert depuis `vkbackpro-ctrl/briefbot`)
- Dossier local : `briefbot-git` (renomme depuis `Briefbot` lors du setup skill)
- Branch principale : `main`
- Deploy auto actif sur chaque push vers `main`
- Pas de domaine custom (acces via URL Vercel)
- Secrets `.env.production` configures cote Vercel (voir section APIs)
- Pipeline valide : commit local -> push -> Vercel redeploy automatique sous 1-2 min

---

## [CORE] Preferences Claude

- **Communiquer en francais**
- **Git add + commit + push auto apres chaque modification** (Vercel redeploy automatiquement)
- **Ne jamais committer de credentials** : toute cle API, mot de passe, token doit passer par Vercel env vars, jamais dans le code
- **Ne pas modifier `vercel.json` ni la config Vercel sauf demande explicite** (equivalent de la regle deploy.php pour o2switch)
- **Proposer `/rename [NomProjet] derniere tache`** comme derniere action apres chaque tache significative
- **Test d'impact avant modifs sur `phases.js` ou `export/route.js`** : ces fichiers pilotent la qualite du brief genere, les changements sont visibles en prod immediatement

---

## [APIs]

| Service | Variable env | Role |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Chat IA (Sonnet) + generation export |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL` | URL projet Supabase |
| Supabase | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cle anon (client-side OK) |
| Supabase | `SUPABASE_SERVICE_ROLE_KEY` | Cle service (server-side only, bypass RLS) |
| Auth consultant | `CONSULTANT_PASSWORD` | Mot de passe du dashboard |
| SerpAPI (optionnel) | `SERP_API_KEY` | Recherche Google pendant le brief |
| Haloscan (optionnel) | `HALOSCAN_API_KEY` | Analyse SEO pendant le brief |
| URL app | `NEXT_PUBLIC_APP_URL` | Base URL pour construire les liens clients |

Tous configures cote **Vercel -> Project Settings -> Environment Variables**. Local = `.env.local` (git-ignore).

---

## [Architecture]

```
src/
  app/
    page.js                  # Dashboard consultant (protege par mdp)
    layout.js                # Root layout
    p/[token]/page.js        # Page client (acces via lien token)
    api/
      chat/route.js          # Proxy Anthropic + persist messages Supabase
      export/route.js        # Genere .doc en 10 sections (evite timeout Vercel 60s)
      projects/
        route.js             # CRUD projets
        phase/route.js       # Transition de phase
  lib/
    supabase.js              # Client Supabase (browser + service)
    phases.js                # Config 10 phases + system prompts IA
  components/
    Chat.jsx                 # Composant chat reutilisable
supabase/
  schema.sql                 # Schema tables Postgres
```

---

## [Commandes]

```bash
npm run dev    # Next.js dev server (localhost:3000)
npm run build  # Build prod
npm run start  # Serveur prod local
npm run lint   # ESLint
```

Pas de tests automatises actuellement.

---

## [Acces]

- **Dashboard BriefBot** : URL Vercel + mot de passe `CONSULTANT_PASSWORD`
- **Vercel project** : vercel.com/dashboard (compte Florian)
- **Supabase project** : supabase.com/dashboard
- **GitHub repo** : github.com/florian-all-projects/briefbot

---

## [Specificites]

- **Export en 10 sections** : `export/route.js` genere le document section par section (une requete Anthropic par theme) au lieu d'une seule requete monolithique. Raison : evite les coupures et le timeout Vercel de 60s (`maxDuration = 60` explicit).
- **Detection de phase par regex** : supporte le markdown gras `**Phase X**` et les variations de casse.
- **Fuseau horaire** : le system prompt force `Europe/Paris` pour la date (corrige le UTC par defaut).
- **Token de partage client** : chaque projet a un `share_token` unique pour generer le lien `*/p/[token]`.
- **Injection de contexte** : a la creation, le consultant peut coller une transcription d'appel pour que l'IA ne repose pas les memes questions.

---

## [Ressources]

- Repo : https://github.com/florian-all-projects/briefbot
- Deploy : Vercel (auto depuis `main`)
- Docs Anthropic : https://docs.anthropic.com
- Docs Supabase : https://supabase.com/docs
- Docs Next.js 14 App Router : https://nextjs.org/docs
