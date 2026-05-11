'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { PHASES } from '@/lib/phases';

// Markdown rendering
function renderMd(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

// ─── Cost helpers (mirror src/app/page.js) ───
function microToUsd(micro) {
  return (micro || 0) / 1000000;
}

function formatUsd(usd) {
  if (usd >= 1) return '$' + usd.toFixed(2);
  if (usd >= 0.01) return '$' + usd.toFixed(2);
  return '$' + usd.toFixed(3);
}

function costPercentage(costMicro, budgetMicro) {
  if (!budgetMicro) return 0;
  return Math.min(Math.round(((costMicro || 0) / budgetMicro) * 100), 100);
}

function costBarColor(pct) {
  if (pct >= 90) return 'from-red-500 to-red-600';
  if (pct >= 70) return 'from-amber-500 to-orange-500';
  return 'from-emerald-500 to-green-500';
}

function CostBar({ costMicro, budgetMicro }) {
  const cost = costMicro || 0;
  const budget = budgetMicro || 5000000;
  const pct = costPercentage(cost, budget);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-500">
          {formatUsd(microToUsd(cost))} / {formatUsd(microToUsd(budget))}
        </span>
        <span className={`text-[10px] font-bold ${
          pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-emerald-600'
        }`}>
          {pct}%
        </span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-1.5">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${costBarColor(pct)} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ClientPage() {
  const params = useParams();
  const token = params.token;

  const [project, setProject] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [limitReached, setLimitReached] = useState(false);

  const chatEndRef = useRef(null);

  // Load project by token
  useEffect(() => {
    loadProject();
  }, [token]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  const loadProject = async () => {
    setLoading(true);
    try {
      const { data: proj } = await supabase
        .from('projects')
        .select('*')
        .eq('share_token', token)
        .single();

      if (!proj) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setProject(proj);

      // Initialiser limitReached si le projet a déjà dépassé son budget
      const initialBudget = proj.budget_micro_usd || 5000000;
      if ((proj.cost_micro_usd || 0) >= initialBudget) {
        setLimitReached(true);
      }

      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('project_id', proj.id)
        .order('created_at', { ascending: true });

      setMessages(msgs || []);

      // If no messages, send initial
      if (!msgs || msgs.length === 0) {
        setChatLoading(true);
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: proj.id,
              message: proj.context
                ? `Bonjour ! Je suis prêt à commencer le briefing pour ${proj.client_name}. Un contexte initial a été fourni par le consultant — analyse-le et identifie les phases déjà couvertes avant de commencer.`
                : `Bonjour ! Je suis prêt à commencer le briefing pour ${proj.client_name}.`,
              mode: 'client',
            }),
          });
          const data = await res.json();
          if (data.content) {
            // Reload messages from DB
            const { data: updatedMsgs } = await supabase
              .from('messages')
              .select('*')
              .eq('project_id', proj.id)
              .order('created_at', { ascending: true });
            setMessages(updatedMsgs || []);

            // Sync phase state from server
            if (data.current_phase !== undefined || data.phases_completed) {
              setProject(prev => ({
                ...prev,
                ...(data.current_phase !== undefined && { current_phase: data.current_phase }),
                ...(data.phases_completed && { phases_completed: data.phases_completed }),
              }));
            }
          }
        } catch (e) {
          setError('Erreur de connexion');
        }
        setChatLoading(false);
      }
    } catch (e) {
      setNotFound(true);
    }
    setLoading(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || chatLoading || limitReached) return;
    const userMsg = { role: 'user', content: input.trim(), mode: 'client', created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setChatLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          message: userMsg.content,
          mode: 'client',
        }),
      });
      const data = await res.json();

      // Cas budget atteint (HTTP 429)
      if (data.limit_reached) {
        // Sync cost/budget pour mettre à jour la barre en live
        setProject(prev => ({
          ...prev,
          ...(data.cost_usd != null && { cost_micro_usd: Math.round(data.cost_usd * 1000000) }),
          ...(data.budget_usd != null && { budget_micro_usd: Math.round(data.budget_usd * 1000000) }),
        }));
        setLimitReached(true);
        // Retirer le message utilisateur ajouté optimistiquement
        setMessages(prev => prev.slice(0, -1));
        setChatLoading(false);
        return;
      }

      if (data.error) throw new Error(data.error);

      const aiMsg = { role: 'assistant', content: data.content, mode: 'client', created_at: new Date().toISOString() };
      setMessages(prev => [...prev, aiMsg]);

      // Sync cost/budget en live (comme côté admin)
      if (data.cost_usd != null) {
        setProject(prev => ({
          ...prev,
          cost_micro_usd: Math.round(data.cost_usd * 1000000),
          ...(data.budget_usd != null && { budget_micro_usd: Math.round(data.budget_usd * 1000000) }),
        }));
      }

      // Sync phase state from server (source of truth)
      if (data.current_phase !== undefined || data.phases_completed) {
        setProject(prev => ({
          ...prev,
          ...(data.current_phase !== undefined && { current_phase: data.current_phase }),
          ...(data.phases_completed && { phases_completed: data.phases_completed }),
        }));
      }
    } catch (e) {
      setError('Erreur : ' + e.message);
    }
    setChatLoading(false);
  };

  // ─── Loading / Not found ───
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50">
        <div className="text-center">
          <div className="text-4xl mb-3">🤖</div>
          <div className="text-slate-600 font-medium">Chargement du briefing...</div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-orange-50">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-xl font-bold text-slate-800 mb-2">Projet introuvable</h1>
          <p className="text-slate-500 text-sm">Ce lien de briefing n'existe pas ou a été supprimé. Vérifiez le lien avec votre consultant.</p>
        </div>
      </div>
    );
  }

  // ─── Chat ───
  const currentPhase = PHASES.find(p => p.id === (project.current_phase ?? 0));

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-64 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-slate-100">
            <div className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 text-[10px] font-semibold text-amber-700 mb-3">
              🤖 BRIEFBOT
            </div>
            <h2 className="font-bold text-slate-800 text-sm truncate" title={project.name}>{project.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5" title={`Briefing pour ${project.client_name}`}>Briefing pour {project.client_name}</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">Progression</label>
            {PHASES.map(phase => {
              const isActive = (project.current_phase ?? 0) === phase.id;
              const isComplete = (project.phases_completed || []).includes(phase.id);
              const isFuture = !isActive && !isComplete;

              return (
                <div
                  key={phase.id}
                  title={`Phase ${phase.id} — ${phase.name}\n${phase.desc}`}
                  className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 cursor-default transition-all ${
                    isActive
                      ? 'bg-amber-50 border-2 border-amber-400 shadow-sm animate-pulse-slow'
                      : isComplete
                      ? 'bg-emerald-50/60 border border-emerald-200'
                      : 'bg-slate-50/40 border border-slate-200 opacity-50'
                  }`}
                >
                  <span className="text-base flex-shrink-0">
                    {isComplete ? '✅' : isFuture ? '🔒' : phase.icon}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-xs font-semibold truncate ${
                      isActive ? 'text-amber-800'
                      : isComplete ? 'text-emerald-700'
                      : 'text-slate-400'
                    }`}>{phase.name}</div>
                    <div className={`text-[10px] truncate ${isFuture ? 'text-slate-300' : 'text-slate-400'}`} title={phase.desc}>{phase.desc}</div>
                  </div>
                  {isActive && (
                    <span className="ml-auto text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">EN COURS</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-4 border-t border-slate-100 space-y-3">
            <div>
              <div className="text-center text-[10px] text-slate-400">
                {(project.phases_completed || []).filter(id => id > 0).length}/11 phases complétées
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5 mt-2">
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-1.5 rounded-full transition-all" style={{ width: `${((project.phases_completed || []).filter(id => id > 0).length / 11) * 100}%` }} />
              </div>
            </div>
            <div className="pt-3 border-t border-slate-100" title="Consommation API en temps réel (Claude Haiku)">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Consommation</div>
              <CostBar costMicro={project.cost_micro_usd} budgetMicro={project.budget_micro_usd} />
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 flex-shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 text-sm">
            {sidebarOpen ? '◀' : '▶'}
          </button>
          <div className="flex-1">
            <span className="text-sm font-semibold text-slate-800">{project.client_name}</span>
            <span className="text-xs text-slate-400 ml-2">Phase {project.current_phase ?? 0} — {currentPhase?.name}</span>
          </div>
          <div className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
            👤 Briefing en cours
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-4 py-2">
            {error} <button onClick={() => setError(null)} className="font-bold ml-3">✕</button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''} mb-5 animate-fade-in`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm shadow-sm ${
                m.role === 'user'
                  ? m.mode === 'consultant' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'
                  : 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
              }`}>
                {m.role === 'user' ? (m.mode === 'consultant' ? '🔧' : '👤') : '🤖'}
              </div>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                m.role === 'user'
                  ? 'bg-slate-700 text-white rounded-tr-md'
                  : 'bg-white border border-slate-200 text-slate-800 rounded-tl-md'
              }`}>
                <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMd(m.content) }} />
                {m.created_at && (
                  <div className={`text-[10px] mt-1.5 ${m.role === 'user' ? 'text-white/50' : 'text-slate-400'}`}>
                    {new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="flex gap-3 mb-5 animate-fade-in">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm">🤖</div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-md px-5 py-3.5 shadow-sm">
                <div className="flex gap-1.5">
                  <span className="typing-dot w-2 h-2 rounded-full bg-amber-500 inline-block" />
                  <span className="typing-dot w-2 h-2 rounded-full bg-amber-500 inline-block" />
                  <span className="typing-dot w-2 h-2 rounded-full bg-amber-500 inline-block" />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 bg-white p-4">
          {limitReached ? (
            <div className="max-w-4xl mx-auto text-center py-3 text-sm text-amber-800 bg-amber-50 rounded-xl border border-amber-200">
              ⚠️ Le budget de cette conversation a été atteint. Contactez votre consultant pour le poursuivre.
            </div>
          ) : (
            <>
              <div className="flex gap-3 items-end max-w-4xl mx-auto">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder={chatLoading ? "BriefBot rédige sa réponse, patientez..." : "Répondez aux questions de BriefBot..."}
                  rows={1}
                  disabled={chatLoading}
                  className={`flex-1 px-4 py-3 border border-slate-300 rounded-xl text-sm resize-none transition-colors ${
                    chatLoading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-50 focus:bg-white'
                  }`}
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                  onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || chatLoading}
                  className={`px-5 py-3 rounded-xl text-sm font-bold transition-all ${
                    input.trim() && !chatLoading ? 'bg-slate-800 text-white hover:bg-slate-700 shadow-md' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  Envoyer
                </button>
              </div>
              <div className="text-center mt-2 text-[10px] text-slate-400">
                Entrée pour envoyer · Shift+Entrée pour un saut de ligne
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
