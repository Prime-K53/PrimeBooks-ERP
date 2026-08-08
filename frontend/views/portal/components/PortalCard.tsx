import React from 'react';

interface Props {
  children: React.ReactNode;
  padding?: string;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

const PortalCard: React.FC<Props> = ({
  children,
  padding,
  style,
  className = '',
  onClick,
  hoverable = false,
}) => {
  const baseStyle: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(16,24,40,0.07)',
    boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 12px 30px -16px rgba(16,24,40,0.18)',
    transition: 'box-shadow .2s ease, transform .2s ease, border-color .2s ease',
    cursor: onClick ? 'pointer' : 'default',
    padding: padding || '20px',
  };

  const [hovered, setHovered] = React.useState(false);

  const combinedStyle: React.CSSProperties = {
    ...baseStyle,
    ...style,
    ...(hoverable && hovered
      ? { transform: 'translateY(-1px)', boxShadow: '0 2px 4px rgba(16,24,40,0.05), 0 18px 40px -18px rgba(16,24,40,0.22)' }
      : {}),
  };

  return (
    <div
      className={className}
      style={combinedStyle}
      onClick={onClick}
      onMouseEnter={() => hoverable && setHovered(true)}
      onMouseLeave={() => hoverable && setHovered(false)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {children}
    </div>
  );
};

export default PortalCard;
