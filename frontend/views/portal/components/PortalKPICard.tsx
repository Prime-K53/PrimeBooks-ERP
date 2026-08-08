import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: { value: number; positive: boolean };
  color?: 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'teal' | 'slate';
  selected?: boolean;
  onClick?: () => void;
}

const colorConfig: Record<string, { border: string; bg: string; iconBg: string; iconColor: string }> = {
  emerald: { border: '#1f8577', bg: '#FEFDFB', iconBg: '#eef7f6', iconColor: '#1f8577' },
  blue: { border: '#3b82f6', bg: '#FEFDFB', iconBg: '#eff6ff', iconColor: '#3b82f6' },
  amber: { border: '#d99a3f', bg: '#FEFDFB', iconBg: '#fbead0', iconColor: '#d99a3f' },
  rose: { border: '#b5493f', bg: '#FEFDFB', iconBg: '#fef2f2', iconColor: '#b5493f' },
  violet: { border: '#6366F1', bg: '#FEFDFB', iconBg: '#eef2ff', iconColor: '#6366F1' },
  teal: { border: '#0f766e', bg: '#FEFDFB', iconBg: '#f0fdfa', iconColor: '#0f766e' },
  slate: { border: '#475569', bg: '#FEFDFB', iconBg: '#f1f5f9', iconColor: '#475569' },
};

const PortalKPICard: React.FC<Props> = ({ label, value, icon: Icon, trend, color = 'emerald', selected = false, onClick }) => {
  const colors = colorConfig[color];

  return (
    <div
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        padding: '14px 16px',
        borderRadius: 14,
        background: colors.bg,
        border: '1px solid rgba(16,24,40,0.06)',
        borderLeft: `4px solid ${colors.border}`,
        boxShadow: selected ? '0 8px 20px -8px rgba(16,24,40,.12)' : '0 1px 3px rgba(16,24,40,.04)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        transition: 'transform .15s ease, box-shadow .15s ease',
        transform: selected ? 'scale(1.01)' : 'scale(1)',
      }}
    >
      <div style={{ padding: 10, borderRadius: 10, background: colors.iconBg, color: colors.iconColor, display: 'inline-flex' }}>
        <Icon size={20} />
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: '#5c6567', textTransform: 'uppercase', letterSpacing: 0.08, margin: '0 0 6px' }}>{label}</p>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#23282A', margin: 0, fontFamily: "'Inter', sans-serif", fontVariantNumeric: 'tabular-nums', textAlign: 'right', letterSpacing: -0.2 }}>
          {value}
        </p>
      </div>
    </div>
  );
};

export default PortalKPICard;
