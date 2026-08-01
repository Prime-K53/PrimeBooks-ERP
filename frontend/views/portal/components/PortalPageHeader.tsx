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
      padding: '22px 28px 18px',
      borderBottom: `1px solid #e4ddd1`,
      background: '#FEFDFB',
      flexWrap: 'wrap',
      gap: 12,
      ...style,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        {Icon && (
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 10px -3px rgba(15,84,76,.6)', flexShrink: 0
          }}>
            <Icon size={19} color={iconColor} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontFamily: "'DM Serif Display', 'Georgia', serif",
            fontWeight: 400, fontSize: 22, margin: 0,
            color: '#0b3e39', letterSpacing: 0.2
          }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#5c6567', letterSpacing: 0.02 }}>
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
              border: '1.4px solid transparent',
              background: `linear-gradient(155deg, #1f8577, #0f544c)`,
              color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 7,
              boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
              transition: 'all .15s ease',
              opacity: action.disabled ? 0.6 : 1,
            }}
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
