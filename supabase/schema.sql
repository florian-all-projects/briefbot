-- ══════════════════════════════════════════════════
-- BriefBot — Schema Supabase
-- Exécuter dans : Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════

-- Table des projets
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL,
  url TEXT DEFAULT '',
  context TEXT DEFAULT '',
  current_phase INTEGER DEFAULT 1,
  phases_completed INTEGER[] DEFAULT '{}',
  share_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des messages
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  mode TEXT DEFAULT 'client' CHECK (mode IN ('client', 'consultant')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX idx_messages_project_id ON messages(project_id);
CREATE INDEX idx_messages_created_at ON messages(project_id, created_at);
CREATE INDEX idx_projects_share_token ON projects(share_token);

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════
-- Row Level Security (RLS)
-- On désactive pour simplifier — l'accès est contrôlé
-- côté app via le service_role_key sur les API routes
-- et l'anon_key pour les lectures client via share_token
-- ══════════════════════════════════════════════════

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Politique : tout le monde peut lire un projet via son share_token
CREATE POLICY "Lecture projet via token" ON projects
  FOR SELECT USING (true);

-- Politique : tout le monde peut lire les messages d'un projet
CREATE POLICY "Lecture messages" ON messages
  FOR SELECT USING (true);

-- Politique : insertion messages (via anon key depuis le client)
CREATE POLICY "Insertion messages" ON messages
  FOR INSERT WITH CHECK (true);

-- Politique : mise à jour projets (via anon key)
CREATE POLICY "Update projets" ON projects
  FOR UPDATE USING (true);

-- Politique : insertion projets (dashboard consultant uniquement, via API route)
CREATE POLICY "Insertion projets" ON projects
  FOR INSERT WITH CHECK (true);

-- Politique : suppression (via API route service_role)
CREATE POLICY "Suppression projets" ON projects
  FOR DELETE USING (true);

CREATE POLICY "Suppression messages" ON messages
  FOR DELETE USING (true);
