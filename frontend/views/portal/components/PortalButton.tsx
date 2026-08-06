import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
  type?: 'button' | 'submit' | 'reset';
}

const PortalButton: React.FC<Props> = ({
  children,
  onClick,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  className = '',
  style,
  type = 'button',
}) => {
  const baseStyle: React.CSSProperties = {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 600,
    borderRadius: 'var(--radius-sm)',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    transition: 'all var(--motion-fast) ease',
    opacity: disabled || loading ? 0.6 : 1,
    border: '1.4px solid transparent',
    position: 'relative',
    height: 44,
    minHeight: 44,
    paddingLeft: 16,
    paddingRight: 16,
    fontSize: 13,
  };

  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '4px 12px', fontSize: 12, height: 36, minHeight: 36 },
    md: { padding: '8px 18px', fontSize: 13, height: 44, minHeight: 44 },
    lg: { padding: '12px 24px', fontSize: 14, height: 48, minHeight: 48 },
  };

  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'linear-gradient(155deg, #1f8577, #0f544c)',
      color: '#fff',
      boxShadow: '0 6px 16px -6px rgba(15,84,76,.55)',
    },
    secondary: {
      background: '#FEFDFB',
      color: '#23282A',
      border: '1.4px solid #e4ddd1',
      boxShadow: 'none',
    },
    ghost: {
      background: 'transparent',
      color: '#146b60',
      border: '1.4px solid transparent',
      boxShadow: 'none',
    },
    danger: {
      background: 'linear-gradient(155deg, #dc2626, #b91c1c)',
      color: '#fff',
      boxShadow: '0 6px 16px -6px rgba(185,28,28,.55)',
    },
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={className}
      style={{ ...baseStyle, ...sizeStyles[size], ...variantStyles[variant], ...style }}
    >
      {loading && (
        <span style={{
          width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)',
          borderTopColor: '#fff', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', display: 'inline-block'
        }} />
      )}
      {!loading && Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
};

export default PortalButton;
