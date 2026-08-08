import React from 'react';

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  iconBg?: string;
  iconColor?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: React.ElementType;
    disabled?: boolean;
  };
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const PortalPageHeader: React.FC<Props> = ({
  title,
  subtitle,
  icon: Icon,
  iconBg = 'linear-gradient(155deg, #1f8577, #0f544c)',
  iconColor = '#fff',
  action,
  children,
  style,
}) => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 24px',
      borderBottom: `1px solid rgba(16,24,40,0.05)`,
      background: '#FFFFFF',
      boxShadow: '0 1px 2px rgba(16,24,40,0.03)',
      flexWrap: 'wrap',
      gap: 12,
      ...(style as any),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        {Icon && (
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)', flexShrink: 0
          }}>
            <Icon size={19} color={iconColor} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontFamily: "'Inter', sans-serif",
            fontWeight: 600, fontSize: 20, margin: 0,
            color: '#0b3e39', letterSpacing: -0.2
          }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280', letterSpacing: -0.01 }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {children}
        {action && (
          <button
            onClick={action.onClick}
            disabled={action.disabled}
            style={{
              fontFamily: "'Inter', sans-serif", fontSize: 13, fontWeight: 600,
              padding: '9px 18px', borderRadius: 9, cursor: action.disabled ? 'not-allowed' : 'pointer',
              border: 'none',
              background: `linear-gradient(155deg, #1f8577, #0f544c)`,
              color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 7,
              boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
              opacity: action.disabled ? 0.6 : 1,
              transition: 'transform .15s ease, box-shadow .15s ease',
            }}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(.96)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {action.icon && <action.icon size={16} />}
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
};

export default PortalPageHeader;
