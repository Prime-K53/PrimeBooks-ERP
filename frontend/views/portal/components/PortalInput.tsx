import React from 'react';

interface Props {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
  autoFocus?: boolean;
  required?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onBlur?: () => void;
  onFocus?: () => void;
}

const PortalInput: React.FC<Props> = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
  error,
  hint,
  autoFocus = false,
  required = false,
  style,
  className = '',
  onBlur,
  onFocus,
}) => {
  const [focused, setFocused] = React.useState(false);

  const handleFocus = () => {
    setFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setFocused(false);
    onBlur?.();
  };

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}>
      {label && (
        <label style={{
          fontSize: 12, fontWeight: 600, color: '#0b3e39',
          letterSpacing: 0.01
        }}>
          {label}
          {required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        required={required}
        className="input-base"
        style={{
          width: '100%',
          fontFamily: "'Inter', sans-serif",
          fontSize: 13.5,
          color: '#0b3e39',
          background: focused ? '#fff' : '#f8fafc',
          border: error ? '1.4px solid #dc2626' : `1px solid ${focused ? '#4ed3c7' : 'rgba(16,24,40,0.06)'}`,
          padding: '9px 12px',
          outline: 'none',
          transition: 'border-color .15s ease, box-shadow .15s ease, background .15s ease',
          boxShadow: focused ? '0 0 0 3px rgba(78,211,199,.15)' : 'none',
          opacity: disabled ? 0.6 : 1,
        }}
      />
      {error && <p style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>{error}</p>}
      {hint && !error && <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{hint}</p>}
    </div>
  );
};

export default PortalInput;
