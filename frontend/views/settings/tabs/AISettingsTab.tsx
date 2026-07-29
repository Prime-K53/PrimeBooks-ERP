import React, { useEffect, useState } from 'react';
import { aiService } from '../../../services/ai/aiService';
import { ProviderName } from '../../../services/ai/types';
import { Sparkles, Key, Globe, Cpu, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

const PROVIDER_OPTIONS: { value: ProviderName; label: string; desc: string }[] = [
  { value: 'local', label: 'Local (Ollama)', desc: 'Run models locally via Ollama' },
  { value: 'openrouter', label: 'OpenRouter', desc: 'Access 200+ models via OpenRouter API' },
  { value: 'openai', label: 'OpenAI', desc: 'GPT-4, GPT-4o-mini and other OpenAI models' },
];

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  local: { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

export const AISettingsTab: React.FC = () => {
  const [provider, setProvider] = useState<ProviderName>('local');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = aiService.getConfig();
    setProvider(cfg.provider || 'local');
    setApiKey(cfg.apiKey || '');
    setBaseUrl(cfg.baseUrl || '');
    setModel(cfg.model || '');
  }, []);

  const handleProviderChange = (newProvider: ProviderName) => {
    setProvider(newProvider);
    const defaults = PROVIDER_DEFAULTS[newProvider];
    if (defaults) {
      setBaseUrl(defaults.baseUrl);
      setModel(defaults.model);
    }
    if (newProvider === 'local') {
      setApiKey('');
    }
    setTestStatus('idle');
    setTestMessage('');
  };

  const handleSave = () => {
    aiService.saveConfig({
      provider,
      apiKey,
      baseUrl,
      model,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const providerObj = provider === 'openrouter'
        ? (await import('../../../services/ai/providers/openrouter')).openrouterProvider
        : (await import('../../../services/ai/providers/local')).localProvider;
      const result = await aiService.testConnection(providerObj, apiKey, model, baseUrl);
      setTestStatus(result.ok ? 'success' : 'error');
      setTestMessage(result.message);
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(err?.message || 'Connection failed');
    }
  };

  const showApiKey = provider !== 'local';

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4">
      <section>
        <h3 className="text-[11px] font-black text-[#5c6567] uppercase tracking-[0.2em] mb-10 flex items-center gap-3">
          <Sparkles size={18} className="text-[#d99a3f]" /> AI Provider
        </h3>
        <div style={{ background: '#FEFDFB', borderRadius: 12, border: '1.4px solid #e4ddd1', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }} className="space-y-8">
          <div>
            <p className="font-black text-[#23282A] uppercase text-base mb-1">Select AI Provider</p>
            <p className="text-[10px] text-[#5c6567] italic font-medium mb-4">Choose which AI backend to use for all AI-powered features.</p>
            <div className="grid grid-cols-1 gap-3">
              {PROVIDER_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    provider === opt.value
                      ? 'border-[#1f8577] bg-[#eef7f6]'
                      : 'border-[#e4ddd1] bg-white hover:border-[#3fa294]'
                  }`}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={opt.value}
                    checked={provider === opt.value}
                    onChange={() => handleProviderChange(opt.value)}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    provider === opt.value ? 'border-[#1f8577]' : 'border-[#D4D7DC]'
                  }`}>
                    {provider === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-[#1f8577]" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-sm text-[#23282A]">{opt.label}</p>
                    <p className="text-[11px] text-[#5c6567]">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="h-px bg-[#e4ddd1]" />

          <div className="grid grid-cols-2 gap-10">
            {showApiKey && (
              <div className="col-span-2">
                <label className="block text-[10px] font-black text-[#5c6567] uppercase tracking-widest mb-3 px-1 flex items-center gap-2">
                  <Key size={14} /> API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestStatus('idle'); }}
                  className="w-full px-5 py-4 bg-[#eef7f6] border border-[#e4ddd1] rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-[#1f8577]/5 focus:border-[#1f8577] transition-all"
                  placeholder={provider === 'openrouter' ? 'sk-or-...' : 'sk-...'}
                />
                <p className="text-[10px] text-[#5c6567] mt-2 italic font-medium px-1">
                  {provider === 'openrouter'
                    ? 'Get your API key from openrouter.ai/keys'
                    : 'Your API key is stored locally and never sent to our servers'}
                </p>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-black text-[#5c6567] uppercase tracking-widest mb-3 px-1 flex items-center gap-2">
                <Globe size={14} /> API Endpoint
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                className="w-full px-5 py-4 bg-[#eef7f6] border border-[#e4ddd1] rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-[#1f8577]/5 focus:border-[#1f8577] transition-all"
                placeholder="https://..."
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-[#5c6567] uppercase tracking-widest mb-3 px-1 flex items-center gap-2">
                <Cpu size={14} /> Model
              </label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full px-5 py-4 bg-[#eef7f6] border border-[#e4ddd1] rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-[#1f8577]/5 focus:border-[#1f8577] transition-all"
                placeholder={provider === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini'}
              />
              <p className="text-[10px] text-[#5c6567] mt-2 italic font-medium px-1">
                {provider === 'openrouter'
                  ? 'Use OpenRouter model slug (e.g. openai/gpt-4o-mini, deepseek/deepseek-r1:free)'
                  : 'Model identifier'}
              </p>
            </div>
          </div>

          <div className="h-px bg-[#e4ddd1]" />

          <div className="flex items-center gap-4">
            <button
              onClick={handleSave}
              className="px-8 py-3.5 rounded-2xl font-bold text-sm border-none cursor-pointer transition-all"
              style={{
                background: 'linear-gradient(135deg, #1f8577, #146b60)',
                color: '#fff',
                boxShadow: '0 4px 14px 0 rgba(31,133,119,.2)',
              }}
            >
              {saved ? <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Saved</span> : 'Save Settings'}
            </button>
            {showApiKey && (
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing' || !apiKey}
                className="px-8 py-3.5 rounded-2xl font-bold text-sm border cursor-pointer transition-all disabled:opacity-50"
                style={{
                  background: '#fff',
                  color: '#1f8577',
                  borderColor: '#1f8577',
                }}
              >
                {testStatus === 'testing' ? (
                  <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Testing...</span>
                ) : 'Test Connection'}
              </button>
            )}
          </div>

          {testStatus === 'success' && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              {testMessage}
            </div>
          )}
          {testStatus === 'error' && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
              <XCircle size={18} className="text-red-600 shrink-0" />
              {testMessage}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-[11px] font-black text-[#5c6567] uppercase tracking-[0.2em] mb-10 flex items-center gap-3">
          <Cpu size={18} className="text-[#1f8577]" /> About AI Features
        </h3>
        <div style={{ background: '#FEFDFB', borderRadius: 12, border: '1.4px solid #e4ddd1', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <p className="text-sm text-[#5c6567] leading-relaxed">
            AI features include copilot assistance, intelligent document extraction (OCR),
            business health reports, predictive maintenance, inventory forecasting, pricing
            suggestions, cash flow analysis, and more. When using OpenRouter or OpenAI,
            your API key is stored locally in your browser and is never transmitted to our servers.
            All AI processing is done via the provider you select.
          </p>
        </div>
      </section>
    </div>
  );
};
