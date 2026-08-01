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
  padding = '18px 20px',
  style,
  className = '',
  onClick,
  hoverable = false,
}) => {
  const baseStyle: React.CSSProperties = {
    background: '#FEFDFB',
    borderRadius: 14,
    border: '1.4px solid #e4ddd1',
    boxShadow: '0 1px 3px rgba(0,0,0,.04)',
    transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
    cursor: onClick ? 'pointer' : 'default',
  };

  const [hovered, setHovered] = React.useState(false);

  const combinedStyle: React.CSSProperties = {
    ...baseStyle,
    ...style,
    ...(hoverable && hovered
      ? { transform: 'translateY(-1px)', boxShadow: '0 4px 12px rgba(0,0,0,.08)', borderColor: '#a6d9d3' }
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
